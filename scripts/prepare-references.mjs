import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parse } from "csv-parse";
import { parse as parseSync } from "csv-parse/sync";
import {
  area, bbox, booleanPointInPolygon, point, featureCollection, multiPolygon,
} from "@turf/turf";
import {
  ROOT, SOURCE_FILE, GENERATION_VERSION, GENERATION_SEED, normalizeName,
  classifyCrime, classifyPremise, classifyWeapon, classifyStatus,
  classifyVictimSex, sha256File, stableUint64, percentile, csvEscape,
} from "./lib.mjs";

const paths = {
  jurisdictionsKml: `${ROOT}/reference/raw/bengaluru_police_jurisdictions.kml`,
  stationsKml: `${ROOT}/reference/raw/bengaluru_police_stations.kml`,
  contacts: `${ROOT}/reference/raw/bengaluru_police_contacts.csv`,
  osm: `${ROOT}/reference/raw/bengaluru_osm_overpass.json`,
  jurisdictions: `${ROOT}/reference/processed/jurisdictions.geojson`,
  anchors: `${ROOT}/reference/processed/anchors.json`,
  config: `${ROOT}/reference/processed/generation_config.json`,
};

await mkdir(`${ROOT}/reference/processed`, { recursive: true });
await mkdir(`${ROOT}/mappings`, { recursive: true });

function extractTag(block, tag) {
  return block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>\\s*([\\s\\S]*?)\\s*</${tag}>`, "i"))?.[1]?.trim() ?? "";
}

function simpleData(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return block.match(new RegExp(`<SimpleData\\s+name="${escaped}">\\s*([\\s\\S]*?)\\s*</SimpleData>`, "i"))?.[1]?.trim() ?? "";
}

function parseCoordinateRing(text) {
  const ring = text.trim().split(/\s+/).map((tuple) => {
    const [lon, lat] = tuple.split(",").map(Number);
    return [lon, lat];
  }).filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
  if (ring.length && (ring[0][0] !== ring.at(-1)[0] || ring[0][1] !== ring.at(-1)[1])) ring.push([...ring[0]]);
  return ring;
}

function parseJurisdictions(kml) {
  const placemarks = [...kml.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/gi)].map((match) => match[0]);
  return placemarks.map((block) => {
    const polygons = [...block.matchAll(/<Polygon\b[\s\S]*?<\/Polygon>/gi)].map((match) => {
      const polygonBlock = match[0];
      const outerBlock = polygonBlock.match(/<outerBoundaryIs>[\s\S]*?<\/outerBoundaryIs>/i)?.[0] ?? "";
      const outer = parseCoordinateRing(extractTag(outerBlock, "coordinates"));
      const holes = [...polygonBlock.matchAll(/<innerBoundaryIs>[\s\S]*?<\/innerBoundaryIs>/gi)]
        .map((inner) => parseCoordinateRing(extractTag(inner[0], "coordinates")))
        .filter((ring) => ring.length >= 4);
      return [outer, ...holes];
    }).filter((polygon) => polygon[0]?.length >= 4);
    if (!polygons.length) return null;
    const geometry = multiPolygon(polygons);
    const name = simpleData(block, "PS_BOUNDName") || extractTag(block, "name");
    return {
      type: "Feature",
      geometry: geometry.geometry,
      properties: {
        station_name: name.replace(/\s+PS$/i, "").trim(),
        station_code: simpleData(block, "PS_BOUNDCode").replace(/\s+/g, ""),
        subdivision_id: simpleData(block, "KGISPS_SUB_DIVID"),
        geometry_source: "official_polygon",
      },
    };
  }).filter(Boolean);
}

const contactsText = await readFile(paths.contacts, "utf8");
const contacts = parseSync(contactsText, { columns: true, skip_empty_lines: true, relax_column_count: true });
const contactByName = new Map();
for (const row of contacts) {
  const name = row["Traffic Police Station"]?.trim();
  if (name) contactByName.set(normalizeName(name), { name, division: row.Division.trim(), subdivision: row.Subdivision.trim() });
}

const aliases = new Map(Object.entries({
  ashokenagar: "ashoknagar",
  ashokanagara: "ashoknagar",
  halasurgate: "halasoor gate",
  sampangiramanagar: "s.r.nagar",
  seshadripuram: "sheshadripuram",
  highgrounds: "highground",
  srnagar: "s.r.nagar",
  devarajeevanahalli: "d.j.halli",
  kadugondanahalli: "k.g.halli",
  jeevanbheemanagar: "j.b.nagar",
  yeshwanthpurarmcyard: "r.m.c.yard",
  rajarajeshwarinagar: "rajarajeswarinagar",
  jayaprakashnagar: "j.p.nagar",
  micolayoutbangalore: "mico layout",
  yelahanka: "yalahanka ps",
  banaswadi: "banasawadi",
  halasur: "halasoor",
  srirampura: "srirampuram",
  mahalakshmilayout: "mahalaxmi layout",
  gangammagudi: "gangammanagudi",
  jcnagarps: "j.c. nagar",
  amruthahally: "amrutha halli",
  kothanur: "kothanuru",
  sanjaynagara: "sanjaynagar",
  kumaraswamylayout: "kumarswamy layout",
  thalaghattapura: "talaghattapura",
  ckacchukattu: "c.k.achchukattu",
  madiwala: "madivala",
  tilaknagar: "thilaknagar",
  chamarajpet: "chamarajapet",
  cottonpet: "cottenpet",
  shankarapuram: "shankarapurm",
  hanumathanagar: "hanumanthanagar",
  bagalur: "bhagalur",
  begur: "beguru",
  vidhyaranyapura: "vidyaranyapura",
}).map(([a, b]) => [normalizeName(a), normalizeName(b)]));

function matchContact(stationName) {
  let normalized = normalizeName(stationName);
  normalized = aliases.get(normalized) ?? normalized;
  return contactByName.get(normalized) ?? null;
}

const jurisdictionKml = await readFile(paths.jurisdictionsKml, "utf8");
const parsedJurisdictions = parseJurisdictions(jurisdictionKml);
let matchedJurisdictions = [];
const unmatchedPolygons = [];
for (const feature of parsedJurisdictions) {
  const match = matchContact(feature.properties.station_name);
  if (!match) {
    unmatchedPolygons.push(feature.properties.station_name);
    continue;
  }
  feature.properties.police_division = match.division;
  feature.properties.subdivision = match.subdivision;
  feature.properties.contact_station_name = match.name;
  feature.properties.area_sq_km = Number((area(feature) / 1_000_000).toFixed(3));
  feature.properties.bbox = bbox(feature);
  matchedJurisdictions.push(feature);
}

// The published KML contains multipart stations as separate features and also
// reuses four station codes for distinct stations. Merge same-station parts,
// then add deterministic suffixes only where a public code remains ambiguous.
const partsByStation = new Map();
for (const feature of matchedJurisdictions) {
  const key = `${feature.properties.station_code}|${normalizeName(feature.properties.contact_station_name)}`;
  if (!partsByStation.has(key)) partsByStation.set(key, []);
  partsByStation.get(key).push(feature);
}
matchedJurisdictions = [...partsByStation.values()].map((parts) => {
  if (parts.length === 1) return parts[0];
  const merged = multiPolygon(parts.flatMap((part) => part.geometry.coordinates));
  merged.properties = { ...parts[0].properties };
  merged.properties.area_sq_km = Number((area(merged) / 1_000_000).toFixed(3));
  merged.properties.bbox = bbox(merged);
  merged.properties.merged_source_feature_count = parts.length;
  return merged;
});
const featuresByPublicCode = new Map();
for (const feature of matchedJurisdictions) {
  const code = feature.properties.station_code;
  if (!featuresByPublicCode.has(code)) featuresByPublicCode.set(code, []);
  featuresByPublicCode.get(code).push(feature);
}
const stationCodeDisambiguations = [];
for (const [publicCode, features] of featuresByPublicCode) {
  if (features.length === 1) continue;
  features.sort((a, b) =>
    normalizeName(a.properties.contact_station_name).localeCompare(normalizeName(b.properties.contact_station_name))
    || a.properties.bbox[0] - b.properties.bbox[0]
  );
  features.forEach((feature, index) => {
    const uniqueCode = `${publicCode}-${String(index + 1).padStart(2, "0")}`;
    feature.properties.source_station_code = publicCode;
    feature.properties.station_code = uniqueCode;
    stationCodeDisambiguations.push({
      source_station_code: publicCode,
      generated_station_code: uniqueCode,
      station_name: feature.properties.contact_station_name,
    });
  });
}
matchedJurisdictions.sort((a, b) => a.properties.station_code.localeCompare(b.properties.station_code));

if (matchedJurisdictions.length < 80) {
  throw new Error(`Only ${matchedJurisdictions.length} official city jurisdictions matched contact records; refusing degraded generation.`);
}

const osm = JSON.parse(await readFile(paths.osm, "utf8"));
const singleLine = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const nodes = new Map();
const poiNodes = [];
for (const element of osm.elements) {
  if (element.type !== "node") continue;
  nodes.set(element.id, { lat: element.lat, lon: element.lon, tags: element.tags ?? {} });
  if (element.tags && (element.tags.amenity || element.tags.shop || element.tags.public_transport || element.tags.railway || element.tags.leisure)) {
    poiNodes.push(element);
  }
}

const roadWays = osm.elements.filter((element) => element.type === "way" && element.tags?.highway && element.tags?.name && (element.nodes?.length || element.geometry?.length));
for (const way of roadWays) way.tags.name = singleLine(way.tags.name);
const nodeRoadNames = new Map();
const syntheticGeometryNodes = new Map();
for (const way of roadWays) {
  const wayNodeIds = way.nodes?.length
    ? way.nodes
    : way.geometry.map((coordinate, index) => `${way.id}:geometry:${index}`);
  if (way.geometry?.length) {
    wayNodeIds.forEach((nodeId, index) => syntheticGeometryNodes.set(nodeId, {
      lat: way.geometry[index].lat, lon: way.geometry[index].lon, tags: {},
    }));
  }
  way._resolvedNodeIds = wayNodeIds;
  for (const nodeId of wayNodeIds) {
    if (!nodeRoadNames.has(nodeId)) nodeRoadNames.set(nodeId, new Set());
    nodeRoadNames.get(nodeId).add(way.tags.name.trim());
  }
}

const rawAnchors = [];
const seenAnchor = new Set();
function addAnchor(anchor) {
  const key = `${anchor.osm_type}:${anchor.osm_id}:${anchor.anchor_kind}:${anchor.street_name}:${anchor.cross_street ?? ""}`;
  if (seenAnchor.has(key)) return;
  seenAnchor.add(key);
  rawAnchors.push(anchor);
}

for (const way of roadWays) {
  const nodeIds = way._resolvedNodeIds;
  const step = Math.max(1, Math.floor(nodeIds.length / 5));
  const selected = new Set([nodeIds[0], nodeIds.at(-1)]);
  for (let i = step; i < nodeIds.length - 1; i += step) selected.add(nodeIds[i]);
  for (const nodeId of selected) {
    const node = nodes.get(nodeId) ?? syntheticGeometryNodes.get(nodeId);
    if (!node) continue;
    const residential = way.tags.highway === "residential" || way.tags.highway === "living_street";
    addAnchor({
      osm_type: "way_node", osm_id: `${way.id}:${nodeId}`,
      latitude: node.lat, longitude: node.lon,
      street_name: way.tags.name.trim(), cross_street: null,
      anchor_kind: residential ? "residential" : "outdoor",
      location_type: residential ? "residential_road" : "named_road",
    });
  }
}

for (const [nodeId, roadNamesSet] of nodeRoadNames) {
  const roadNames = [...roadNamesSet].filter(Boolean).sort();
  if (roadNames.length < 2) continue;
  const node = nodes.get(nodeId) ?? syntheticGeometryNodes.get(nodeId);
  if (!node) continue;
  addAnchor({
    osm_type: "node", osm_id: String(nodeId),
    latitude: node.lat, longitude: node.lon,
    street_name: roadNames[0], cross_street: roadNames[1],
    anchor_kind: "intersection", location_type: "intersection",
  });
}

function poiKind(tags) {
  if (tags.public_transport || /station|halt|tram_stop/.test(tags.railway ?? "") || /bus_station|ferry_terminal/.test(tags.amenity ?? "")) return "transit";
  if (tags.shop || /restaurant|cafe|bank|marketplace|fuel|pharmacy|cinema|pub|bar/.test(tags.amenity ?? "")) return "commercial";
  if (/school|college|university|hospital|clinic|place_of_worship|police|fire_station|courthouse|library|community_centre/.test(tags.amenity ?? "") || /park|playground|sports_centre/.test(tags.leisure ?? "")) return "public_institutional";
  return "built_other";
}

const roadGrid = new Map();
const gridSize = 0.01;
for (const anchor of rawAnchors.filter((item) => item.anchor_kind === "outdoor" || item.anchor_kind === "residential")) {
  const key = `${Math.floor(anchor.latitude / gridSize)}:${Math.floor(anchor.longitude / gridSize)}`;
  if (!roadGrid.has(key)) roadGrid.set(key, []);
  roadGrid.get(key).push(anchor);
}
function nearestRoad(lat, lon) {
  const gx = Math.floor(lat / gridSize);
  const gy = Math.floor(lon / gridSize);
  let best = null;
  let bestDistance = Infinity;
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
    for (const anchor of roadGrid.get(`${gx + dx}:${gy + dy}`) ?? []) {
      const distance = (anchor.latitude - lat) ** 2 + (anchor.longitude - lon) ** 2;
      if (distance < bestDistance) { best = anchor; bestDistance = distance; }
    }
  }
  return bestDistance <= 0.0002 ? best : null;
}

for (const poi of poiNodes) {
  const nearest = nearestRoad(poi.lat, poi.lon);
  if (!nearest) continue;
  const kind = poiKind(poi.tags ?? {});
  addAnchor({
    osm_type: "poi_context", osm_id: `${nearest.osm_id}:${kind}`,
    latitude: nearest.latitude, longitude: nearest.longitude,
    street_name: nearest.street_name, cross_street: null,
    anchor_kind: kind,
    location_type: `poi_context:${kind}`,
  });
}

function containingJurisdiction(anchor) {
  const candidates = matchedJurisdictions.filter((feature) => {
    const [minX, minY, maxX, maxY] = feature.properties.bbox;
    return anchor.longitude >= minX && anchor.longitude <= maxX && anchor.latitude >= minY && anchor.latitude <= maxY;
  });
  const inside = candidates.filter((feature) => booleanPointInPolygon(point([anchor.longitude, anchor.latitude]), feature));
  return inside.sort((a, b) => a.properties.area_sq_km - b.properties.area_sq_km || a.properties.station_code.localeCompare(b.properties.station_code))[0] ?? null;
}

const assignedAnchors = [];
for (const anchor of rawAnchors) {
  const jurisdiction = containingJurisdiction(anchor);
  if (!jurisdiction) continue;
  const roundedAnchor = {
    anchor_id: `${anchor.osm_type}/${anchor.osm_id}/${anchor.anchor_kind}`,
    station_code: jurisdiction.properties.station_code,
    ...anchor,
    latitude: Number(anchor.latitude.toFixed(4)),
    longitude: Number(anchor.longitude.toFixed(4)),
  };
  if (!booleanPointInPolygon(point([roundedAnchor.longitude, roundedAnchor.latitude]), jurisdiction)) continue;
  assignedAnchors.push(roundedAnchor);
}
assignedAnchors.sort((a, b) => a.station_code.localeCompare(b.station_code) || a.anchor_id.localeCompare(b.anchor_id));

const forbiddenLocationPattern = /\b(?:los angeles|california|hollywood|wilshire|van nuys|topanga|devonshire|hollenbeck|rampart|lapd)\b/i;
const safeAssignedAnchors = assignedAnchors.filter((anchor) =>
  !forbiddenLocationPattern.test(`${anchor.street_name} ${anchor.cross_street ?? ""} ${anchor.location_type}`)
);
const roadCounts = new Map();
for (const anchor of safeAssignedAnchors) {
  if (anchor.anchor_kind === "outdoor" || anchor.anchor_kind === "residential" || anchor.anchor_kind === "intersection") {
    roadCounts.set(anchor.station_code, (roadCounts.get(anchor.station_code) ?? 0) + 1);
  }
}
const eligibleCodes = new Set([...roadCounts].filter(([, count]) => count > 0).map(([code]) => code));
const eligibleJurisdictions = matchedJurisdictions.filter((feature) => eligibleCodes.has(feature.properties.station_code));
const finalAnchors = safeAssignedAnchors.filter((anchor) => eligibleCodes.has(anchor.station_code));

const sourceSha = await sha256File(SOURCE_FILE);
const rdCounts = new Map();
const crimeValues = new Map();
const premiseValues = new Map();
const weaponValues = new Map();
const statusValues = new Map();
const sexValues = new Set();
let sourceRows = 0;
const parser = createReadStream(SOURCE_FILE).pipe(parse({ columns: true, bom: true, relax_quotes: true }));
for await (const row of parser) {
  sourceRows++;
  rdCounts.set(row["Rpt Dist No"], (rdCounts.get(row["Rpt Dist No"]) ?? 0) + 1);
  crimeValues.set(row["Crm Cd"], row["Crm Cd Desc"]);
  premiseValues.set(row["Premis Cd"], row["Premis Desc"] ?? "");
  if (row["Weapon Used Cd"] || row["Weapon Desc"]) weaponValues.set(row["Weapon Used Cd"], row["Weapon Desc"] ?? "");
  statusValues.set(row.Status ?? "", row["Status Desc"] ?? "");
  sexValues.add(row["Vict Sex"] ?? "");
}

// These codes occur only as legacy secondary codes in this snapshot, so the
// neutral mapping avoids asserting a jurisdiction-specific legal description.
crimeValues.set("430", "VEHICLE-RELATED OFFENCE (LEGACY SECONDARY CODE)");
crimeValues.set("521", "VEHICLE-RELATED OFFENCE (LEGACY SECONDARY CODE)");
for (const code of ["431", "486", "846", "945", "972", "976", "978", "979", "980", "990", "993", "994", "996", "997", "998", "999"]) {
  crimeValues.set(code, "UNSPECIFIED LEGACY SECONDARY CODE");
}

for (const column of ["Crm Cd 1", "Crm Cd 2", "Crm Cd 3", "Crm Cd 4"]) {
  const missing = new Set();
  const checkParser = createReadStream(SOURCE_FILE).pipe(parse({ columns: true, bom: true, relax_quotes: true }));
  for await (const row of checkParser) {
    const code = row[column];
    if (code && !crimeValues.has(code)) missing.add(code);
  }
  if (missing.size) throw new Error(`Unmapped secondary crime codes in ${column}: ${[...missing].join(", ")}`);
}

const stationCapacities = eligibleJurisdictions.map((feature) => ({
  station_code: feature.properties.station_code,
  raw_capacity: roadCounts.get(feature.properties.station_code),
}));
const sortedCapacities = stationCapacities.map((item) => item.raw_capacity).sort((a, b) => a - b);
const p10 = percentile(sortedCapacities, 0.1);
const p90 = percentile(sortedCapacities, 0.9);
for (const station of stationCapacities) station.capacity = Math.max(p10, Math.min(p90, station.raw_capacity));
const totalCapacity = stationCapacities.reduce((sum, item) => sum + item.capacity, 0);
for (const station of stationCapacities) {
  station.target_quota = sourceRows * station.capacity / totalCapacity;
  station.assigned_records = 0;
  station.assigned_districts = 0;
}

const reportingDistrictAssignments = [];
const sortedDistricts = [...rdCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
for (const [reportingDistrict, count] of sortedDistricts) {
  const ranked = stationCapacities.map((station) => ({
    station,
    ratio: (station.assigned_records + count) / station.target_quota,
    tie: stableUint64("station_assignment_tie", reportingDistrict, station.station_code),
  })).sort((a, b) => a.ratio - b.ratio || (a.tie < b.tie ? -1 : a.tie > b.tie ? 1 : 0));
  const chosen = ranked[0].station;
  chosen.assigned_records += count;
  chosen.assigned_districts++;
  reportingDistrictAssignments.push({
    reporting_district: reportingDistrict,
    source_record_count: count,
    station_code: chosen.station_code,
  });
}
reportingDistrictAssignments.sort((a, b) => a.reporting_district.localeCompare(b.reporting_district));

function writeCsv(path, headers, rows) {
  const lines = [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))];
  return writeFile(path, `${lines.join("\n")}\n`);
}

const crimeMappingRows = [...crimeValues].sort(([a], [b]) => a.localeCompare(b)).map(([code, description]) => {
  const mapped = classifyCrime(description);
  return { source_code: code, source_description: description, crime_category: mapped.category, crime_subcategory: mapped.subcategory };
});
const premiseMappingRows = [...premiseValues].sort(([a], [b]) => a.localeCompare(b)).map(([code, description]) => {
  const mapped = classifyPremise(description);
  return { source_code: code, source_description: description, premise_category: mapped.category, broad_anchor_class: mapped.broad };
});
const weaponMappingRows = [...weaponValues].sort(([a], [b]) => a.localeCompare(b)).map(([code, description]) => ({
  source_code: code, source_description: description, weapon_category: classifyWeapon(description),
}));
const statusMappingRows = [...statusValues].sort(([a], [b]) => a.localeCompare(b)).map(([code, description]) => ({
  source_code: code, source_description: description, case_status: classifyStatus(code),
}));
const sexMappingRows = [...sexValues].sort().map((code) => ({ source_code: code, victim_sex: classifyVictimSex(code) }));

await Promise.all([
  writeFile(paths.jurisdictions, JSON.stringify(featureCollection(eligibleJurisdictions), null, 2)),
  writeFile(paths.anchors, JSON.stringify(finalAnchors)),
  writeCsv(`${ROOT}/mappings/crime_mapping.csv`, ["source_code", "source_description", "crime_category", "crime_subcategory"], crimeMappingRows),
  writeCsv(`${ROOT}/mappings/premise_mapping.csv`, ["source_code", "source_description", "premise_category", "broad_anchor_class"], premiseMappingRows),
  writeCsv(`${ROOT}/mappings/weapon_mapping.csv`, ["source_code", "source_description", "weapon_category"], weaponMappingRows),
  writeCsv(`${ROOT}/mappings/status_mapping.csv`, ["source_code", "source_description", "case_status"], statusMappingRows),
  writeCsv(`${ROOT}/mappings/victim_sex_mapping.csv`, ["source_code", "victim_sex"], sexMappingRows),
  writeCsv(`${ROOT}/mappings/reporting_district_station.csv`, ["reporting_district", "source_record_count", "station_code"], reportingDistrictAssignments),
  writeCsv(`${ROOT}/mappings/station_allocation.csv`,
    ["station_code", "raw_capacity", "winsorized_capacity", "target_record_quota", "assigned_records", "assigned_districts"],
    stationCapacities.map((station) => ({
      station_code: station.station_code,
      raw_capacity: station.raw_capacity,
      winsorized_capacity: Number(station.capacity.toFixed(6)),
      target_record_quota: Number(station.target_quota.toFixed(3)),
      assigned_records: station.assigned_records,
      assigned_districts: station.assigned_districts,
    })).sort((a, b) => a.station_code.localeCompare(b.station_code))
  ),
]);

const referenceChecksums = {
  source_csv: sourceSha,
  police_jurisdictions_kml: await sha256File(paths.jurisdictionsKml),
  police_station_locations_kml: await sha256File(paths.stationsKml),
  police_contacts_csv: await sha256File(paths.contacts),
  osm_overpass_json: await sha256File(paths.osm),
};
const config = {
  generation_version: GENERATION_VERSION,
  generation_seed: GENERATION_SEED,
  source_rows: sourceRows,
  source_file: "Crime_Data_from_2020_to_2024_20260724.csv",
  reference_checksums: referenceChecksums,
  official_polygon_count: eligibleJurisdictions.length,
  voronoi_polygon_count: 0,
  excluded_unmatched_polygon_count: unmatchedPolygons.length,
  excluded_unmatched_polygons: unmatchedPolygons.sort(),
  station_code_disambiguations: stationCodeDisambiguations,
  anchor_count: finalAnchors.length,
  road_anchor_count_by_station: Object.fromEntries([...roadCounts].filter(([code]) => eligibleCodes.has(code)).sort()),
  winsorization: { p10, p90 },
  osm_query_bbox: [12.73, 77.35, 13.18, 77.85],
  osm_attribution: "© OpenStreetMap contributors, ODbL 1.0",
  jurisdiction_source: "KSRSAC via OpenCity, Public Domain",
  station_assignment_method: "capacity-weighted deterministic bin packing",
  anchor_shortage_policy: ["exact", "broad_class_fallback", "general_road_fallback", "fail"],
};
await writeFile(paths.config, JSON.stringify(config, null, 2));

console.log(JSON.stringify({
  sourceRows,
  parsedJurisdictions: parsedJurisdictions.length,
  eligibleJurisdictions: eligibleJurisdictions.length,
  unmatchedPolygons: unmatchedPolygons.length,
  roadWays: roadWays.length,
  poiNodes: poiNodes.length,
  anchors: finalAnchors.length,
  reportingDistricts: reportingDistrictAssignments.length,
}, null, 2));
