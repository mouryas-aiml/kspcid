import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import parquet from "parquetjs-lite";
import { booleanPointInPolygon, point } from "@turf/turf";
import {
  ROOT, SOURCE_FILE, occurrenceTimestamp, classifyVictimSex, csvEscape,
} from "./lib.mjs";

const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const [key, value = "true"] = arg.replace(/^--/, "").split("=");
  return [key, value];
}));
const requestedOutputDir = args["output-dir"];
const outputDir = requestedOutputDir
  ? (requestedOutputDir.startsWith("/") ? requestedOutputDir : `${ROOT}/${requestedOutputDir.replace(/^\/+/, "")}`)
  : `${ROOT}/output`;
const csvPath = `${outputDir}/bengaluru_synthetic_crime_2020_2024.csv`;
const parquetPath = `${outputDir}/bengaluru_synthetic_crime_2020_2024.parquet`;
const manifest = JSON.parse(await readFile(`${outputDir}/manifest.json`, "utf8"));
const jurisdictions = JSON.parse(await readFile(`${ROOT}/reference/processed/jurisdictions.geojson`, "utf8"));
const anchors = JSON.parse(await readFile(`${ROOT}/reference/processed/anchors.json`, "utf8"));

const stationFeatures = new Map(jurisdictions.features.map((feature) => [feature.properties.station_code, feature]));
const anchorStreetKeys = new Set();
const intersectionKeys = new Set();
for (const anchor of anchors) {
  anchorStreetKeys.add(`${anchor.station_code}|${anchor.street_name}`);
  if (anchor.anchor_kind === "intersection") {
    intersectionKeys.add(`${anchor.station_code}|${anchor.street_name}|${anchor.cross_street}`);
  }
}

const failures = [];
const warnings = [...manifest.quality_warnings];
function assert(condition, message) { if (!condition) failures.push(message); }
function increment(object, key) { object[key] = (object[key] ?? 0) + 1; }
function ageBand(age) {
  if (age == null || age === "") return "unknown";
  const number = Number(age);
  if (number < 18) return "under_18";
  if (number < 30) return "18_29";
  if (number < 45) return "30_44";
  if (number < 60) return "45_59";
  return "60_plus";
}
function normalizeLogicalValue(header, value) {
  if (header === "secondary_categories") return Array.isArray(value) ? value.join(";") : (value ?? "");
  if (header === "is_synthetic") return value === true || value === "true" ? "true" : "false";
  if (value == null) return "";
  return String(value);
}

let determinismReplay = null;
if (args["replay-dir"]) {
  const replayDir = args["replay-dir"];
  const replayManifest = JSON.parse(await readFile(`${replayDir}/manifest.json`, "utf8"));
  determinismReplay = {
    primary_chunk_size: manifest.execution.chunk_size,
    replay_chunk_size: replayManifest.execution.chunk_size,
    primary_workers_requested: manifest.execution.workers_requested,
    replay_workers_requested: replayManifest.execution.workers_requested,
    csv_checksum_match: manifest.outputs.csv.sha256 === replayManifest.outputs.csv.sha256,
    parquet_checksum_match: manifest.outputs.parquet.sha256 === replayManifest.outputs.parquet.sha256,
    primary_csv_sha256: manifest.outputs.csv.sha256,
    replay_csv_sha256: replayManifest.outputs.csv.sha256,
    primary_parquet_sha256: manifest.outputs.parquet.sha256,
    replay_parquet_sha256: replayManifest.outputs.parquet.sha256,
  };
  assert(determinismReplay.csv_checksum_match, "Determinism replay CSV checksum differs");
  assert(determinismReplay.parquet_checksum_match, "Determinism replay Parquet checksum differs");
}

const headers = [
  "incident_id", "occurred_at", "reported_date", "lineage_hash",
  "police_division", "police_station", "station_code", "jurisdiction_geometry_source",
  "locality", "location_type", "street_name", "cross_street", "latitude", "longitude", "anchor_quality",
  "crime_category", "crime_subcategory", "secondary_categories",
  "premise_category", "weapon_category", "victim_age", "victim_sex", "case_status",
  "is_synthetic", "source_dataset", "generation_version",
];
const csvHash = createHash("sha256");
const ids = new Set();
const outputStats = {
  rows: 0, by_year: {}, by_month: {}, by_hour: {}, by_crime_category: {},
  by_victim_sex: {}, by_age_band: {}, by_station: {}, geometry_source_rows: {},
  leakage_rows: 0, outside_jurisdiction_rows: 0, unknown_street_rows: 0,
  invalid_intersection_rows: 0,
};
const forbiddenPattern = /\b(?:los angeles|lapd|california|hollywood|wilshire|van nuys|topanga|devonshire|hollenbeck|rampart)\b|\$/i;
const sampleRows = new Map();
function retainSample(key, row) {
  if (!sampleRows.has(key)) sampleRows.set(key, []);
  const samples = sampleRows.get(key);
  if (samples.length < 2) samples.push({
    stratum: key,
    incident_id: row.incident_id,
    police_division: row.police_division,
    police_station: row.police_station,
    street_name: row.street_name,
    cross_street: row.cross_street,
    latitude: row.latitude,
    longitude: row.longitude,
    crime_category: row.crime_category,
    premise_category: row.premise_category,
    anchor_quality: row.anchor_quality,
    jurisdiction_geometry_source: row.jurisdiction_geometry_source,
  });
}

const csvParser = createReadStream(csvPath).pipe(parse({ columns: true, bom: true }));
for await (const row of csvParser) {
  outputStats.rows++;
  const canonical = headers.map((header) => normalizeLogicalValue(header, row[header])).join("\x1f");
  csvHash.update(canonical).update("\n");
  if (ids.has(row.incident_id)) failures.push(`Duplicate incident_id: ${row.incident_id}`);
  ids.add(row.incident_id);
  if (row.is_synthetic !== "true") failures.push(`is_synthetic is not true at output row ${outputStats.rows}`);
  if (forbiddenPattern.test(Object.values(row).join(" "))) outputStats.leakage_rows++;
  const stationFeature = stationFeatures.get(row.station_code);
  if (!stationFeature || !booleanPointInPolygon(point([Number(row.longitude), Number(row.latitude)]), stationFeature)) {
    outputStats.outside_jurisdiction_rows++;
  }
  if (!anchorStreetKeys.has(`${row.station_code}|${row.street_name}`)) outputStats.unknown_street_rows++;
  if (row.cross_street && !intersectionKeys.has(`${row.station_code}|${row.street_name}|${row.cross_street}`)) {
    outputStats.invalid_intersection_rows++;
  }
  increment(outputStats.by_year, row.occurred_at.slice(0, 4));
  increment(outputStats.by_month, row.occurred_at.slice(0, 7));
  increment(outputStats.by_hour, row.occurred_at.slice(11, 13));
  increment(outputStats.by_crime_category, row.crime_category);
  increment(outputStats.by_victim_sex, row.victim_sex);
  increment(outputStats.by_age_band, ageBand(row.victim_age));
  increment(outputStats.by_station, row.station_code);
  increment(outputStats.geometry_source_rows, row.jurisdiction_geometry_source);
  retainSample(`division:${row.police_division}`, row);
  retainSample(`crime:${row.crime_category}`, row);
  retainSample(`premise:${row.premise_category}`, row);
  retainSample(`anchor_quality:${row.anchor_quality}`, row);
  retainSample(`geometry:${row.jurisdiction_geometry_source}`, row);
  if (outputStats.rows % 200000 === 0) console.log(`validated CSV ${outputStats.rows.toLocaleString()} rows`);
}
const csvLogicalHash = csvHash.digest("hex");

const parquetReader = await parquet.ParquetReader.openFile(parquetPath);
const cursor = parquetReader.getCursor();
const parquetHash = createHash("sha256");
let parquetRows = 0;
let parquetRow;
while ((parquetRow = await cursor.next())) {
  parquetRows++;
  const canonical = headers.map((header) => normalizeLogicalValue(header, parquetRow[header])).join("\x1f");
  parquetHash.update(canonical).update("\n");
  if (parquetRows % 200000 === 0) console.log(`validated Parquet ${parquetRows.toLocaleString()} rows`);
}
await parquetReader.close();
const parquetLogicalHash = parquetHash.digest("hex");

const crimeRows = parseSync(await readFile(`${ROOT}/mappings/crime_mapping.csv`, "utf8"), { columns: true, skip_empty_lines: true });
const crimeMap = new Map(crimeRows.map((row) => [row.source_code, row]));
const sourceStats = {
  rows: 0, by_year: {}, by_month: {}, by_hour: {}, by_crime_category: {},
  by_victim_sex: {}, by_age_band: {},
};
const sourceParser = createReadStream(SOURCE_FILE).pipe(parse({ columns: true, bom: true, relax_quotes: true }));
for await (const row of sourceParser) {
  sourceStats.rows++;
  const occurred = occurrenceTimestamp(row["DATE OCC"], row["TIME OCC"]);
  const crime = crimeMap.get(row["Crm Cd"]);
  const rawAge = Number(row["Vict Age"]);
  const cleanedAge = Number.isInteger(rawAge) && rawAge >= 1 && rawAge <= 100 ? rawAge : null;
  increment(sourceStats.by_year, occurred.slice(0, 4));
  increment(sourceStats.by_month, occurred.slice(0, 7));
  increment(sourceStats.by_hour, occurred.slice(11, 13));
  increment(sourceStats.by_crime_category, crime.crime_category);
  increment(sourceStats.by_victim_sex, classifyVictimSex(row["Vict Sex"] ?? ""));
  increment(sourceStats.by_age_band, ageBand(cleanedAge));
}

function sameCounts(left, right) {
  return JSON.stringify(Object.fromEntries(Object.entries(left).sort())) === JSON.stringify(Object.fromEntries(Object.entries(right).sort()));
}
assert(outputStats.rows === 1_004_894, `Expected 1,004,894 CSV rows; found ${outputStats.rows}`);
assert(parquetRows === outputStats.rows, `Parquet row count ${parquetRows} differs from CSV ${outputStats.rows}`);
assert(ids.size === outputStats.rows, `Unique ID count ${ids.size} differs from row count ${outputStats.rows}`);
assert(csvLogicalHash === parquetLogicalHash, "CSV and Parquet logical hashes differ");
assert(outputStats.leakage_rows === 0, `${outputStats.leakage_rows} rows contain forbidden LA/US leakage tokens`);
assert(outputStats.outside_jurisdiction_rows === 0, `${outputStats.outside_jurisdiction_rows} rows fall outside assigned jurisdiction`);
assert(outputStats.unknown_street_rows === 0, `${outputStats.unknown_street_rows} rows use streets absent from frozen anchor snapshot`);
assert(outputStats.invalid_intersection_rows === 0, `${outputStats.invalid_intersection_rows} rows use invalid cross-street pairs`);
assert(sameCounts(sourceStats.by_year, outputStats.by_year), "Year totals changed");
assert(sameCounts(sourceStats.by_month, outputStats.by_month), "Month totals changed");
assert(sameCounts(sourceStats.by_hour, outputStats.by_hour), "Hour totals changed");
assert(sameCounts(sourceStats.by_crime_category, outputStats.by_crime_category), "Normalized crime-category totals changed");
assert(sameCounts(sourceStats.by_victim_sex, outputStats.by_victim_sex), "Victim-sex totals changed");
assert(sameCounts(sourceStats.by_age_band, outputStats.by_age_band), "Victim age-band totals changed");

const approximateRows = outputStats.geometry_source_rows.voronoi_approximation ?? 0;
const approximatePct = 100 * approximateRows / outputStats.rows;
if (approximatePct > 0) warnings.push(`${approximatePct.toFixed(3)}% of rows use Voronoi-approximated jurisdictions`);
if (approximatePct > 10) warnings.push("GEOGRAPHY QUALITY DEGRADED: more than 10% of output rows use Voronoi approximations");

const validation = {
  status: failures.length ? "failed" : "passed",
  warning: manifest.warning,
  checks: {
    csv_rows: outputStats.rows,
    parquet_rows: parquetRows,
    unique_ids: ids.size,
    csv_logical_sha256: csvLogicalHash,
    parquet_logical_sha256: parquetLogicalHash,
    leakage_rows: outputStats.leakage_rows,
    outside_jurisdiction_rows: outputStats.outside_jurisdiction_rows,
    unknown_street_rows: outputStats.unknown_street_rows,
    invalid_intersection_rows: outputStats.invalid_intersection_rows,
    voronoi_row_percentage: Number(approximatePct.toFixed(3)),
    source_distribution_parity: {
      year: sameCounts(sourceStats.by_year, outputStats.by_year),
      month: sameCounts(sourceStats.by_month, outputStats.by_month),
      hour: sameCounts(sourceStats.by_hour, outputStats.by_hour),
      crime_category: sameCounts(sourceStats.by_crime_category, outputStats.by_crime_category),
      victim_sex: sameCounts(sourceStats.by_victim_sex, outputStats.by_victim_sex),
      age_band: sameCounts(sourceStats.by_age_band, outputStats.by_age_band),
    },
    determinism_replay: determinismReplay,
  },
  failures,
  warnings,
};
await writeFile(`${outputDir}/validation.json`, JSON.stringify(validation, null, 2));
const sampleHeaders = [
  "stratum", "incident_id", "police_division", "police_station", "street_name",
  "cross_street", "latitude", "longitude", "crime_category", "premise_category",
  "anchor_quality", "jurisdiction_geometry_source",
];
const flattenedSamples = [...sampleRows.values()].flat().sort((a, b) => a.stratum.localeCompare(b.stratum) || a.incident_id.localeCompare(b.incident_id));
await writeFile(`${ROOT}/reports/stratified_sample.csv`, `${sampleHeaders.join(",")}\n${
  flattenedSamples.map((row) => sampleHeaders.map((header) => csvEscape(row[header])).join(",")).join("\n")
}\n`);

const qualityReport = `# Synthetic Bengaluru Crime Dataset — Quality Report

> **SYNTHETIC DATA:** These are not real Bengaluru crime records and must not be used for policing, safety claims, or neighborhood ranking.

## Acceptance result

**${validation.status.toUpperCase()}**

- CSV rows: ${outputStats.rows.toLocaleString()}
- Parquet rows: ${parquetRows.toLocaleString()}
- Unique incident IDs: ${ids.size.toLocaleString()}
- Logical CSV/Parquet checksum match: ${csvLogicalHash === parquetLogicalHash ? "yes" : "no"}
- Rows outside assigned jurisdiction: ${outputStats.outside_jurisdiction_rows.toLocaleString()}
- Rows with invalid street/intersection references: ${(outputStats.unknown_street_rows + outputStats.invalid_intersection_rows).toLocaleString()}
- Rows containing forbidden LA leakage: ${outputStats.leakage_rows.toLocaleString()}
- Voronoi-backed rows: ${approximateRows.toLocaleString()} (${approximatePct.toFixed(3)}%)
${determinismReplay ? `- Different chunk/worker replay CSV checksum match: ${determinismReplay.csv_checksum_match ? "yes" : "no"}
- Different chunk/worker replay Parquet checksum match: ${determinismReplay.parquet_checksum_match ? "yes" : "no"}` : ""}

## Geography and fallback quality

All included jurisdictions are identified per row through \`jurisdiction_geometry_source\`. Anchor fallback and reuse statistics are recorded in \`manifest.json\`.

${warnings.length ? `Warnings:\n${warnings.map((warning) => `- ${warning}`).join("\n")}` : "No quality warnings were raised."}

${failures.length ? `## Failures\n\n${failures.map((failure) => `- ${failure}`).join("\n")}` : ""}
`;
await writeFile(`${ROOT}/reports/quality_report.md`, qualityReport);
console.log(JSON.stringify(validation, null, 2));
if (failures.length) process.exitCode = 1;
