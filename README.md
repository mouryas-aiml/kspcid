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
- **An SOS point is activated mid-shift** — the kind of public emergency call box Bengaluru City Police have installed at busy locations. The nearest available unit and its road travel time are computed live, and you dispatch or hold
- A road closure is injected later and you decide whether to move units or hold coverage
- At the end, compare your plan against the baseline and against an optimised plan

> The SOS points, the activation and the roster are generated for the demonstration — the archive holds no device inventory and no control-room log. The **response time is real**: an OSRM road-network duration from the unit's actual post, using the same matrix the coverage engine uses.

### 5. Justice Pipeline — act
Shows every case from registration to conviction, and where cases stop moving. In Bengaluru, **92,874 FIRs are undetected** — 21.8% of the caseload.

### 6. Station Brief — brief
A printable one-page summary for each of the 106 stations, at `/station/<code>`. It lists the three largest changes in FIRs registered, the fastest-rising category against its historical expected range, the most-affected beat, the five oldest open cases, workload context, victim counts, and five comparable stations in the same division.

Station names are shown in Kannada where a label could be sourced from OpenStreetMap — 43 of 106 today. The rest render in English; nothing is transliterated or invented, and unmatched stations are listed in `etl/overrides/station_names_kn_review.csv` for review.

Every figure is stated against the **snapshot week ending 31 December 2023**, which is where the source data ends. Nothing on the page is live.

> PDF rendering through Catalyst SmartBrowz, delivery by Catalyst Mail, and the acknowledgement workflow are **not built** — they are console-gated. The page prints to A4 from the browser today.

### 7. Demand outlook and workload
Two things a commander asks that the earlier build could not answer.

**Expected next week** projects FIRs likely to be registered, as a **Low / Expected / High range** rather than a single number. It uses a 52-week moving average with a negative-binomial interval, and deliberately leaves out the seasonal factor — that factor is fitted across the whole series, so using it would let future weeks leak into a forward claim. It forecasts registration workload, never crime, and never anything about a person.

**Where the load sits** ranks stations by open cases per officer, showing which are carrying most and which have room.

> **Officer strength is generated for the demo.** The source carries no establishment or posting data at all, so station strength is synthesised — plausibly, from caseload and jurisdiction area — and every figure derived from it is tagged `generated_demo` and labelled on screen. Open-case counts are real. Read the ratio as a worked example, not as how any station is staffed.

### 8. Commander's Home
The landing screen at `/`. One scan gives the stations that raised an alert, undetected caseload, the biggest weekly jumps, next week's expected range, where the case load sits, and a station picker. Each panel carries its own scope and date, because they cover different periods.

### 9. Assistant
A bilingual question box, reachable from any screen with `⌘/`. It answers from the station briefs only — what is rising, the brief, oldest open cases, victims, workload, what is expected next week, which stations are busiest, and comparisons between two stations — and says so plainly when a question falls outside them. Kannada questions are understood and answered in Kannada.

There is no language model in it: intents are matched against a fixed set and answers are filled from computed values, the same decision made for the map's "Why here?" panel. Speech output works where the device has a voice installed; speech input works where the browser supports it and degrades to typing where it does not.

### 10. Cyber Intelligence Wing
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
npm run etl:17:brief       # station briefs, all 106 stations
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
| Data ends 31 December 2023 | Every screen states its snapshot week; nothing is live |
| Forecast excludes seasonality | The seasonal factor is fitted across the whole series, so it would leak future weeks into a forward claim. The outlook uses a causal moving average only, and is shown as a range |
| Officer strength is generated | The source has no establishment or posting data. Station strength is synthesised for the demo and labelled `generated_demo`; open-case counts are real |
| No sanctioned strength | The source has no staffing table. Workload is reported as open records against the investigating-officer aliases appearing on them — a proxy, not evidence of posting |
| Kannada names cover 43 of 106 stations | Sourced from OpenStreetMap by exact match only; the rest render in English pending review |

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
