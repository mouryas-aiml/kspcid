import { writeFile } from "node:fs/promises";
import { ROOT } from "./lib.mjs";

const bounds = { south: 12.73, west: 77.35, north: 13.18, east: 77.85 };
const divisions = 4;
const mirrors = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.nchc.org.tw/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

function tileBounds(row, column) {
  const latStep = (bounds.north - bounds.south) / divisions;
  const lonStep = (bounds.east - bounds.west) / divisions;
  return {
    south: bounds.south + row * latStep,
    north: bounds.south + (row + 1) * latStep,
    west: bounds.west + column * lonStep,
    east: bounds.west + (column + 1) * lonStep,
  };
}

function queryFor(tile) {
  const box = `${tile.south.toFixed(6)},${tile.west.toFixed(6)},${tile.north.toFixed(6)},${tile.east.toFixed(6)}`;
  return `[out:json][timeout:240][maxsize:268435456];
(
  way["highway"]["name"](${box});
  node["amenity"](${box});
  node["shop"](${box});
  node["public_transport"](${box});
  node["railway"~"station|halt|tram_stop"](${box});
  node["leisure"~"park|playground|sports_centre"](${box});
);
out geom;`;
}

async function fetchTile(tile, tileId) {
  const body = new URLSearchParams({ data: queryFor(tile) });
  let lastError;
  for (const mirror of mirrors) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(mirror, {
          method: "POST",
          body,
          headers: { "user-agent": "KPSCID-Synthetic-Data/1.0" },
          signal: AbortSignal.timeout(300_000),
        });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const json = await response.json();
        console.log(`tile ${tileId}: ${json.elements.length} elements from ${new URL(mirror).host}`);
        return { json, mirror };
      } catch (error) {
        lastError = error;
        console.warn(`tile ${tileId}: ${new URL(mirror).host} attempt ${attempt} failed: ${error.message}`);
      }
    }
  }
  throw new Error(`Unable to download tile ${tileId}: ${lastError?.message}`);
}

const elements = new Map();
const tileManifest = [];
for (let row = 0; row < divisions; row++) {
  for (let column = 0; column < divisions; column++) {
    const tile = tileBounds(row, column);
    const tileId = `${row}-${column}`;
    const { json, mirror } = await fetchTile(tile, tileId);
    tileManifest.push({ tile_id: tileId, ...tile, mirror, returned_elements: json.elements.length });
    for (const element of json.elements) {
      const key = `${element.type}/${element.id}`;
      if (!elements.has(key)) elements.set(key, element);
    }
  }
}

const output = {
  version: 0.6,
  generator: "KPSCID fixed 4x4 tiled Overpass acquisition",
  bounds,
  tile_manifest: tileManifest,
  elements: [...elements.values()].sort((a, b) => a.type.localeCompare(b.type) || a.id - b.id),
};
await writeFile(`${ROOT}/reference/raw/bengaluru_osm_overpass.json`, JSON.stringify(output));
console.log(`merged ${output.elements.length} unique OSM elements`);
