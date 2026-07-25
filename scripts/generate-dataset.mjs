import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { once } from "node:events";
import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import parquet from "parquetjs-lite";
import { v5 as uuidv5 } from "uuid";
import {
  ROOT, SOURCE_FILE, GENERATION_VERSION, UUID_NAMESPACE, csvEscape,
  occurrenceTimestamp, parseSourceDate, sha256File, sha256Text, stableIndex,
  quantiles,
} from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const requestedOutputDir = args["output-dir"];
const outputDir = requestedOutputDir
  ? (requestedOutputDir.startsWith("/") ? requestedOutputDir : `${ROOT}/${requestedOutputDir.replace(/^\/+/, "")}`)
  : `${ROOT}/output`;
const chunkSize = Number(args["chunk-size"] ?? 5000);
const workersRequested = Number(args.workers ?? 1);
await mkdir(outputDir, { recursive: true });

const outputCsv = `${outputDir}/bengaluru_synthetic_crime_2020_2024.csv`;
const outputParquet = `${outputDir}/bengaluru_synthetic_crime_2020_2024.parquet`;
const outputManifest = `${outputDir}/manifest.json`;

function loadCsvMap(path, keyColumn) {
  const rows = parseSync(requireText(path), { columns: true, skip_empty_lines: true });
  return new Map(rows.map((row) => [row[keyColumn], row]));
}
function requireText(path) {
  return requireText.cache.get(path);
}
requireText.cache = new Map();
const mappingPaths = [
  `${ROOT}/mappings/crime_mapping.csv`,
  `${ROOT}/mappings/premise_mapping.csv`,
  `${ROOT}/mappings/weapon_mapping.csv`,
  `${ROOT}/mappings/status_mapping.csv`,
  `${ROOT}/mappings/victim_sex_mapping.csv`,
  `${ROOT}/mappings/reporting_district_station.csv`,
  `${ROOT}/mappings/station_allocation.csv`,
];
for (const path of mappingPaths) requireText.cache.set(path, await readFile(path, "utf8"));

const crimeMap = loadCsvMap(mappingPaths[0], "source_code");
const premiseMap = loadCsvMap(mappingPaths[1], "source_code");
const weaponMap = loadCsvMap(mappingPaths[2], "source_code");
const statusMap = loadCsvMap(mappingPaths[3], "source_code");
const sexMap = loadCsvMap(mappingPaths[4], "source_code");
const districtMap = loadCsvMap(mappingPaths[5], "reporting_district");
const config = JSON.parse(await readFile(`${ROOT}/reference/processed/generation_config.json`, "utf8"));
const jurisdictionCollection = JSON.parse(await readFile(`${ROOT}/reference/processed/jurisdictions.geojson`, "utf8"));
const anchors = JSON.parse(await readFile(`${ROOT}/reference/processed/anchors.json`, "utf8"));

const stationByCode = new Map(jurisdictionCollection.features.map((feature) => [feature.properties.station_code, feature.properties]));
const pools = new Map();
for (const stationCode of stationByCode.keys()) {
  pools.set(stationCode, {
    allRoad: [], intersection: [], residential: [], commercial: [], transit: [],
    public_institutional: [], outdoor: [], built_other: [],
  });
}
for (const anchor of anchors) {
  const pool = pools.get(anchor.station_code);
  if (!pool) continue;
  if (["outdoor", "residential", "intersection"].includes(anchor.anchor_kind)) pool.allRoad.push(anchor);
  if (pool[anchor.anchor_kind]) pool[anchor.anchor_kind].push(anchor);
  if (anchor.anchor_kind === "intersection") pool.outdoor.push(anchor);
}
for (const pool of pools.values()) {
  for (const candidates of Object.values(pool)) candidates.sort((a, b) => a.anchor_id.localeCompare(b.anchor_id));
  if (!pool.allRoad.length) throw new Error("Eligible station unexpectedly lacks named-road anchors.");
}

const headers = [
  "incident_id", "occurred_at", "reported_date", "lineage_hash",
  "police_division", "police_station", "station_code", "jurisdiction_geometry_source",
  "locality", "location_type", "street_name", "cross_street", "latitude", "longitude", "anchor_quality",
  "crime_category", "crime_subcategory", "secondary_categories",
  "premise_category", "weapon_category", "victim_age", "victim_sex", "case_status",
  "is_synthetic", "source_dataset", "generation_version",
];

const schemaDefinition = {};
for (const header of headers) {
  if (header === "latitude" || header === "longitude") schemaDefinition[header] = { type: "DOUBLE", compression: "SNAPPY" };
  else if (header === "victim_age") schemaDefinition[header] = { type: "INT32", optional: true, compression: "SNAPPY" };
  else if (header === "is_synthetic") schemaDefinition[header] = { type: "BOOLEAN", compression: "SNAPPY" };
  else if (header === "secondary_categories") schemaDefinition[header] = { type: "UTF8", repeated: true, compression: "SNAPPY" };
  else schemaDefinition[header] = {
    type: "UTF8",
    optional: ["cross_street", "weapon_category"].includes(header),
    compression: "SNAPPY",
  };
}
const parquetSchema = new parquet.ParquetSchema(schemaDefinition);
const parquetWriter = await parquet.ParquetWriter.openFile(parquetSchema, outputParquet, {
  useDataPageV2: false,
  rowGroupSize: 5000,
});
const csvWriter = createWriteStream(outputCsv, { encoding: "utf8" });
csvWriter.write(`${headers.join(",")}\n`);

function chooseAnchor(row, stableKey, stationCode, premise) {
  const pool = pools.get(stationCode);
  if (!pool) throw new Error(`No anchor pool for station ${stationCode}`);
  if (row["Cross Street"]?.trim() && pool.intersection.length) {
    return {
      anchor: pool.intersection[stableIndex("anchor_selection", stableKey, `${stationCode}:intersection`, pool.intersection.length)],
      quality: "exact",
    };
  }
  const exact = pool[premise.premise_category] ?? [];
  if (exact.length) {
    return {
      anchor: exact[stableIndex("anchor_selection", stableKey, `${stationCode}:exact:${premise.premise_category}`, exact.length)],
      quality: "exact",
    };
  }
  const broad = pool[premise.broad_anchor_class] ?? [];
  if (broad.length) {
    return {
      anchor: broad[stableIndex("anchor_selection", stableKey, `${stationCode}:broad:${premise.broad_anchor_class}`, broad.length)],
      quality: "broad_class_fallback",
    };
  }
  return {
    anchor: pool.allRoad[stableIndex("anchor_selection", stableKey, `${stationCode}:general_road`, pool.allRoad.length)],
    quality: "general_road_fallback",
  };
}

const stats = {
  rows: 0,
  by_station: {},
  by_crime_category: {},
  by_year: {},
  by_month: {},
  by_hour: {},
  by_victim_sex: {},
  by_age_band: {},
  anchor_use: {},
  geometry_source_rows: {},
  fallback_by_station_and_premise: {},
};
function increment(object, key, amount = 1) { object[key] = (object[key] ?? 0) + amount; }
function ageBand(age) {
  if (age == null) return "unknown";
  if (age < 18) return "under_18";
  if (age < 30) return "18_29";
  if (age < 45) return "30_44";
  if (age < 60) return "45_59";
  return "60_plus";
}

let csvBuffer = [];
const sourceParser = createReadStream(SOURCE_FILE).pipe(parse({ columns: true, bom: true, relax_quotes: true }));
let rowNumber = 0;
for await (const row of sourceParser) {
  rowNumber++;
  const district = districtMap.get(row["Rpt Dist No"]);
  if (!district) throw new Error(`Unmapped reporting district ${row["Rpt Dist No"]} at row ${rowNumber}`);
  const stationCode = district.station_code;
  const station = stationByCode.get(stationCode);
  const crime = crimeMap.get(row["Crm Cd"]);
  const premise = premiseMap.get(row["Premis Cd"]);
  const status = statusMap.get(row.Status ?? "");
  const sex = sexMap.get(row["Vict Sex"] ?? "") ?? { victim_sex: "other_or_unknown" };
  if (!crime || !premise || !status) throw new Error(`Unmapped classification at source row ${rowNumber}`);

  const stableKey = `${config.reference_checksums.source_csv}|${rowNumber}|${row.DR_NO}`;
  const { anchor, quality } = chooseAnchor(row, stableKey, stationCode, premise);
  const secondary = [];
  for (const column of ["Crm Cd 2", "Crm Cd 3", "Crm Cd 4"]) {
    const code = row[column];
    if (!code) continue;
    const mapped = crimeMap.get(code);
    if (!mapped) throw new Error(`Unmapped secondary crime code ${code} at row ${rowNumber}`);
    if (!secondary.includes(mapped.crime_subcategory) && mapped.crime_subcategory !== crime.crime_subcategory) secondary.push(mapped.crime_subcategory);
  }
  secondary.sort();
  const rawAge = Number(row["Vict Age"]);
  const victimAge = Number.isInteger(rawAge) && rawAge >= 1 && rawAge <= 100 ? rawAge : null;
  const occurredAt = occurrenceTimestamp(row["DATE OCC"], row["TIME OCC"]);
  const crossStreet = row["Cross Street"]?.trim() && anchor.anchor_kind === "intersection" ? anchor.cross_street : null;
  const record = {
    incident_id: uuidv5(stableKey, UUID_NAMESPACE),
    occurred_at: occurredAt,
    reported_date: parseSourceDate(row["Date Rptd"]),
    lineage_hash: sha256Text(stableKey),
    police_division: station.police_division,
    police_station: station.contact_station_name,
    station_code: stationCode,
    jurisdiction_geometry_source: station.geometry_source,
    locality: station.contact_station_name,
    location_type: anchor.location_type,
    street_name: anchor.street_name,
    cross_street: crossStreet,
    latitude: anchor.latitude,
    longitude: anchor.longitude,
    anchor_quality: quality,
    crime_category: crime.crime_category,
    crime_subcategory: crime.crime_subcategory,
    secondary_categories: secondary,
    premise_category: premise.premise_category,
    weapon_category: row["Weapon Used Cd"] ? (weaponMap.get(row["Weapon Used Cd"])?.weapon_category ?? "") : "",
    victim_age: victimAge,
    victim_sex: sex.victim_sex,
    case_status: status.case_status,
    is_synthetic: true,
    source_dataset: "US municipal crime incidents 2020-2024 (CC0; see manifest)",
    generation_version: GENERATION_VERSION,
  };

  csvBuffer.push(headers.map((header) =>
    csvEscape(header === "secondary_categories" ? record[header].join(";") : record[header])
  ).join(","));
  await parquetWriter.appendRow(record);

  stats.rows++;
  if (!stats.by_station[stationCode]) {
    stats.by_station[stationCode] = {
      station_name: station.contact_station_name,
      division: station.police_division,
      total: 0, exact: 0, broad_class_fallback: 0, general_road_fallback: 0,
      geometry_source: station.geometry_source,
    };
  }
  stats.by_station[stationCode].total++;
  stats.by_station[stationCode][quality]++;
  if (!stats.fallback_by_station_and_premise[stationCode]) stats.fallback_by_station_and_premise[stationCode] = {};
  if (!stats.fallback_by_station_and_premise[stationCode][premise.premise_category]) {
    stats.fallback_by_station_and_premise[stationCode][premise.premise_category] = {
      exact: 0, broad_class_fallback: 0, general_road_fallback: 0,
    };
  }
  stats.fallback_by_station_and_premise[stationCode][premise.premise_category][quality]++;
  increment(stats.by_crime_category, crime.crime_category);
  increment(stats.by_year, occurredAt.slice(0, 4));
  increment(stats.by_month, occurredAt.slice(0, 7));
  increment(stats.by_hour, occurredAt.slice(11, 13));
  increment(stats.by_victim_sex, record.victim_sex);
  increment(stats.by_age_band, ageBand(victimAge));
  increment(stats.anchor_use, anchor.anchor_id);
  increment(stats.geometry_source_rows, station.geometry_source);

  if (csvBuffer.length >= chunkSize) {
    if (!csvWriter.write(`${csvBuffer.join("\n")}\n`)) await once(csvWriter, "drain");
    csvBuffer = [];
  }
  if (rowNumber % 100000 === 0) console.log(`generated ${rowNumber.toLocaleString()} rows`);
}
if (csvBuffer.length) csvWriter.write(`${csvBuffer.join("\n")}\n`);
csvWriter.end();
await once(csvWriter, "finish");
await parquetWriter.close();

if (stats.rows !== config.source_rows) throw new Error(`Row count changed: ${stats.rows} != ${config.source_rows}`);
const qualityWarnings = [];
for (const [stationCode, stationStats] of Object.entries(stats.by_station)) {
  const percent = 100 * stationStats.general_road_fallback / stationStats.total;
  stationStats.general_road_fallback_pct = Number(percent.toFixed(3));
  if (percent > 40) throw new Error(`Station ${stationCode} has ${percent.toFixed(2)}% general-road fallback (>40%).`);
  if (percent > 20) qualityWarnings.push(`${stationCode} general-road fallback ${percent.toFixed(2)}%`);
}
const anchorReuse = quantiles(Object.values(stats.anchor_use));
delete stats.anchor_use;

const mappingChecksums = {};
for (const path of mappingPaths) mappingChecksums[path.split("/").at(-1)] = await sha256File(path);
const manifest = {
  title: "Synthetic Bengaluru Crime Dataset 2020-2024",
  warning: "SYNTHETIC DATA. NOT REAL BENGALURU CRIME RECORDS. NOT FOR POLICING, SAFETY CLAIMS, OR NEIGHBORHOOD RANKING.",
  generated_at: "deterministic-build-no-wall-clock-timestamp",
  generation_version: GENERATION_VERSION,
  generation_seed: config.generation_seed,
  execution: { chunk_size: chunkSize, workers_requested: workersRequested, ordered_writer: true },
  source: {
    description: "City of Los Angeles Crime Data from 2020 to 2024",
    license: "CC0 1.0 / Public Domain",
    records: config.source_rows,
    sha256: config.reference_checksums.source_csv,
    url: "https://catalog.data.gov/dataset/crime-data-from-2020-to-present",
  },
  references: {
    jurisdiction_source: config.jurisdiction_source,
    osm_attribution: config.osm_attribution,
    checksums: config.reference_checksums,
    official_polygon_count: config.official_polygon_count,
    voronoi_polygon_count: config.voronoi_polygon_count,
  },
  deterministic_stages: {
    record_key: "source_sha256|one_based_input_row_number|source_report_number",
    id_generation: "UUIDv5(generation_version namespace, stable_record_key)",
    station_assignment: "capacity-weighted bin packing; HMAC-SHA256 only for exact ties",
    anchor_selection: "HMAC-SHA256 index into stable-sorted candidate pool",
    category_mapping: "deterministic lookup tables; no RNG",
  },
  anchor_shortage_policy: config.anchor_shortage_policy,
  statistics: {
    rows: stats.rows,
    by_station: stats.by_station,
    by_crime_category: stats.by_crime_category,
    by_year: stats.by_year,
    by_month: stats.by_month,
    by_hour: stats.by_hour,
    by_victim_sex: stats.by_victim_sex,
    by_age_band: stats.by_age_band,
    geometry_source_rows: stats.geometry_source_rows,
    fallback_by_station_and_premise: stats.fallback_by_station_and_premise,
    anchor_reuse_incidents_per_anchor: anchorReuse,
  },
  quality_warnings: qualityWarnings,
  mapping_checksums: mappingChecksums,
  outputs: {
    csv: { file: outputCsv.split("/").at(-1), sha256: await sha256File(outputCsv) },
    parquet: { file: outputParquet.split("/").at(-1), sha256: await sha256File(outputParquet) },
  },
};
await writeFile(outputManifest, JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({
  rows: stats.rows,
  csv: manifest.outputs.csv,
  parquet: manifest.outputs.parquet,
  qualityWarnings: qualityWarnings.length,
  anchorReuse,
}, null, 2));
