# KSPCID

**Karnataka State Police Crime Intelligence Dashboard**
A crime intelligence and analysis platform for the State Crime Records Bureau, built on Zoho Catalyst.

---

## The problem

Karnataka's police record a huge amount of data — 1.67 million FIRs between 2016 and 2024, including 425,408 from Bengaluru City alone. Today most of that sits in separate systems and Excel sheets.

This causes four problems:

1. **Data silos.** Each station holds its own records. Cases that belong together sit in different files.
2. **No advanced analysis.** Patterns, criminal networks and repeated methods stay hidden.
3. **Fragmented reporting.** The SCRB receives partial information, so state-wide analysis is hard.
4. **Reactive policing.** Without early warning, police respond after a crime instead of planning ahead.

A real example from the data: four two-wheeler thefts with the same act sections, the same Tuesday-night pattern, and almost the same location — filed in **four different police stations across two divisions**. Four inspectors each saw one case. Nobody saw all four.

---

## What KSPCID does

The platform follows one continuous flow: **Detect → Explain → Connect → Plan → Act → Brief**

### 1. Command Feed — detect
Watches every police station against its own 52-week history. When registered FIRs go above the expected statistical range, an alert card appears showing the actual count, the expected range, and a 13-week control chart.

### 2. Command Map — explain
An interactive map of Bengaluru with real streets and all 106 police station boundaries. Crime density is shown as hexagon aggregates. Clicking a hotspot gives a plain-language explanation: which crime type dominates, which hours, what is nearby, and how confident the system is.

### 3. Case Similarity and Case Constellation — connect
- **Case Similarity** ranks the most similar past cases for any selected case, and shows *why* each one matched.
- **Case Constellation** is a network graph built with Neo4j. Press the arrow key and the graph expands one step at a time, revealing how cases, people, vehicles and phones connect across station boundaries.

### 4. Namma Patrol Lab — plan *(the main feature)*
A patrol planning simulator built on Bengaluru's real road network.

- Choose a station and a shift
- Place Hoysala cars, Cheetah bikes, foot patrols and Pink Hoysala teams on the map
- Coverage spreads across real streets using real road travel times
- The score updates instantly as you move units (coverage, response time, fairness, reserve, efficiency — out of 1000)
- Press play and last month's real incidents arrive in time order; units travel along genuine road routes
- A road closure is injected mid-shift and you decide whether to move units or hold coverage
- At the end, compare your plan against the baseline and against an optimised plan

### 5. Justice Pipeline — act
Shows every case from registration to conviction, and where cases stop moving. In Bengaluru, **92,874 FIRs are undetected** — 21.8% of the caseload.

### 6. Station Brief — brief
A printable one-page summary per station in Kannada and English, listing the three most important changes that week.

### 7. Cyber Intelligence Wing
**15.19% of Bengaluru FIRs are cybercrime**, and these have no location. This screen deliberately has no map and uses charts instead.

---

## Technology stack

| Area | Technology |
|---|---|
| Cloud platform | **Zoho Catalyst** — Slate, Serverless Functions, API Gateway, Data Store, NoSQL, Stratus, Cache, Circuits, SmartBrowz, Cron, Signals |
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Maps | MapLibre GL, deck.gl, self-hosted PMTiles, H3 |
| Graph | Neo4j 5.26 with Graph Data Science 2.13, Sigma.js |
| Routing | OSRM over OpenStreetMap data |
| Charts | Visx |
| Data pipeline | DuckDB, Apache Parquet, Node.js, TypeScript |

---

## Setup and execution

### Requirements

| Requirement | Version | Notes |
|---|---|---|
| Node.js | 24+ | |
| Docker Desktop | running | for Neo4j and OSRM |
| osmium-tool | any | `brew install osmium-tool` |
| Disk space | ~30 GB | source data and map files |
| RAM | 8 GB+ | |

### Step 1 — Install

```bash
git clone <repository-url> KPSCID
cd KPSCID
npm install
npm install --prefix client
```

### Step 2 — Get the source data

Large data files are not stored in Git. Download them:

```bash
bash Data_Docs/download_sources.sh
```

This downloads the Karnataka FIR dataset, the official KSP monthly crime reviews, and the OpenCity police station files (about 1.5 GB).

### Step 3 — Prepare the road network

This takes 30–40 minutes and only needs to be done once.

```bash
mkdir -p .data/osrm && cd .data/osrm
curl -O https://download.geofabrik.de/asia/india/southern-zone-latest.osm.pbf
osmium extract -b 77.35,12.70,77.85,13.20 southern-zone-latest.osm.pbf -o bengaluru.osm.pbf

IMG=ghcr.io/project-osrm/osrm-backend:v5.27.1
docker run -t -v "$PWD:/data" $IMG osrm-extract -p /opt/car.lua /data/bengaluru.osm.pbf
docker run -t -v "$PWD:/data" $IMG osrm-partition /data/bengaluru.osrm
docker run -t -v "$PWD:/data" $IMG osrm-customize /data/bengaluru.osrm
cd ../..

docker run -d --name kspcid-osrm --restart unless-stopped -p 5001:5000 \
  -v "$PWD/.data/osrm:/data" ghcr.io/project-osrm/osrm-backend:v5.27.1 \
  osrm-routed --algorithm mld --max-table-size 8000 /data/bengaluru.osrm
```

> **Note on the port.** The routing service uses host port **5001**, not 5000.
> On macOS, port 5000 is already used by AirPlay Receiver.

### Step 4 — Start the graph database

```bash
docker compose up -d neo4j
```

Wait until it reports healthy (about 30 seconds), then confirm:

```bash
docker exec kspcid-neo4j cypher-shell -u neo4j -p <password> "RETURN gds.version();"
```

### Step 5 — Build the data

Run in this order. Total time is roughly 30–45 minutes.

```bash
npm run etl:audit          # check the source data matches expectations
npm run etl:all            # ingest, station mapping, locations, time, patterns, baselines
npm run etl:08:corridor    # road travel-time matrix for the demo area
npm run etl:20:congestion  # Bengaluru traffic speed correction
npm run etl:10:patrol      # patrol lab data
npm run etl:10b:dispatch   # dispatch routes
npm run etl:a13            # entity graph, then Neo4j + GDS
npm run etl:12:similarity  # case similarity
npm run etl:15:justice     # justice pipeline
npm run etl:16:feed        # command feed alerts
npm run etl:17b:cyber      # cyber wing
npm run etl:map            # command map
npm run etl:19b:offline    # offline demo snapshot
```

Optional — the full 106-region road network (several hours, runs in background):

```bash
npm run etl:08:full:start
```

### Step 6 — Run the application

```bash
npm run dev --prefix client
```

Open **http://localhost:3000**

> The map takes about 3 seconds to draw the streets after the page loads.

### Step 7 — Build for production

```bash
npm run build --prefix client
```

This produces a static site in `client/out/`, ready to deploy to Catalyst Slate.

---

## Verifying the build

```bash
npm run check
```

This runs every check in sequence:

- TypeScript compilation
- 13 data-truth rules (tested against deliberate failure cases)
- 30 exact reconciliations against the raw source file
- Module checks for routing, patrol, graph, similarity, justice, feed, cyber, map and offline

All checks must pass. Any failure means the data or the code has drifted.

---

## Deploying to Catalyst

```bash
npx catalyst login
npx catalyst project:list
npx catalyst init --project <project_id>
npx catalyst apig:enable
npx catalyst ds:import --table Incidents --config etl/dsimport/incidents.json
npx catalyst deploy
```

---

## Data sources

| Source | Use | Licence |
|---|---|---|
| Karnataka FIR dataset (Kaggle mirror) | Case data | Apache 2.0 |
| KSP monthly crime reviews | Official totals | Public |
| OpenCity / KSRSAC police boundaries | 106 station polygons | Public Domain |
| OpenStreetMap | Roads and map | ODbL 1.0 |
| TomTom Traffic Index 2025 | Traffic speed correction | Cited, not redistributed |

---

## How we handle data honestly

Every panel shows where its numbers come from. Two labels are used together: **who provided the data** and **what we did to it**.

- Green — real FIR record
- Blue — official KSP figure
- Amber — calculated or estimated (hovering shows the exact method)
- Purple — demonstration data

Rules we follow:

1. **We never claim crimes prevented.** The patrol score measures coverage, response time, fairness, reserve and efficiency only.
2. **We never use caste, religion or income.** Risk is attached to places and times, never to people.
3. **Estimated locations are never shown as exact points.** They appear only inside hexagon aggregates.
4. **Officer names are replaced with aliases.**
5. **Real limitations are stated on screen.** The source has no exact crime time and no case number, so we say so.

---

## Known limitations

| Limitation | Reason |
|---|---|
| Occurrence time is estimated | The source records the registration date only |
| No FIR number | The source has no case identifier; a demonstration reference is used |
| 30% of records have coordinates | The rest are shown as area aggregates only |
| Beat boundaries are not drawn | Beat names exist, map shapes do not |
| Coverage uses free-flow speeds | Response time is traffic-corrected; coverage correction is pending |
| Person and vehicle links are demonstration data | Real CCTNS person records were not available |

---

## Project structure

```
KPSCID/
├── etl/          data pipeline (build-time only, not deployed)
├── functions/    Catalyst serverless functions
├── client/       Next.js frontend
├── data/         generated data files
├── reports/      verification reports
├── Data_Docs/    source data archive
└── BUILD_SPEC.md full technical specification
```

---

## Troubleshooting

| Problem | Solution |
|---|---|
| Map shows no streets | Wait 3 seconds; if still blank, clear site data and reload |
| Routing errors | Check `docker ps` shows `kspcid-osrm` on port 5001 |
| Graph is empty | Check Neo4j is healthy, then re-run `npm run etl:a13` |
| Old numbers appear after rebuilding | Increase `CACHE_NAME` in `client/public/offline-sw.js` |
| Next.js module errors | Stop the dev server, delete `client/.next`, restart |

---

## Appendix — synthetic donor dataset

This repository also contains an older pipeline that generated a synthetic Bengaluru dataset from a public United States crime dataset (`scripts/`, `output/`).

**It is not part of KSPCID.** It is used once, offline, by `etl/04_time_model.ts` to learn hour-of-day distributions. Nothing from it is ever displayed as a Bengaluru event. Its `occurred_at`, `victim_age` and `victim_sex` columns are outside the KSPCID data model.

Rebuild it with `npm run donor:build`. Source: City of Los Angeles, *Crime Data from 2020 to 2024*, CC0.
