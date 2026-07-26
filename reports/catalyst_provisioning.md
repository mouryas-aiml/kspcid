# Catalyst A1 / A4 provisioning report

Date: 2026-07-26  
Repository baseline: `d358856`  
Cloud mutation performed in this work: **none**

## Outcome

The repository side of A4 is ready: the shared adapter supports ZCQL and
Catalyst Search, deterministic Data Store CSVs and upsert configs are compiled,
the 0.2 cloud allowlist is checksummed, NoSQL and Cache loaders are dry-run safe,
and all 14 Node 22 Catalyst packages build from source without DuckDB or other
local ETL runtime dependencies. This includes the missing `kv-graph` AIO path,
the Cache Cron, and seven Basic I/O functions implementing the cloud-publication
Circuit states. Six authenticated API Gateway rules are also recorded as an
owner-reconcilable template.

Actual provisioning remains owner-gated. No `catalyst.json`, project ID, data
center, schema, bucket, table, function, route, domain, or deployment has been
created or claimed here.

| Stage | Status | Evidence / blocker |
|---|---|---|
| 0 — decisions and adapter | PASS locally | Shared `queryTable` + `searchText`; adapter verifier passes |
| 1 — project initialization | BLOCKED — owner | `catalyst project:list`, `init`, `apig:enable`, certificate request not run |
| 2 — Data Store | READY locally / NOT IMPORTED | Schema, five configs, CSV compiler, committed manifest, cloud verifier |
| 3 — Stratus / NoSQL / Cache | READY locally / NOT UPLOADED | Six runtime objects, three NoSQL tables, 148 Cache keys |
| 4 — functions / client / gateway | PACKAGES READY / NOT DEPLOYED | 14 packages build; project IDs, remote function IDs, gateway deployment, and Slate remain owner-gated |
| 5 — Circuits | IMPLEMENTED LOCALLY / STOP gate | Seven real state functions and failure/idempotency tests pass; project DC and console Code View IDs remain unknown |

## What ships

The runtime Stratus allowlist is exactly 46,072,634 bytes. Data Store bulk-write
inputs add 453,280,777 temporary bytes and expire after seven days; they are
recorded separately in the 0.2 allowlist and must be deleted immediately after a
verified publication.

| Artifact | Decision | Destination | Exact result |
|---|---|---|---|
| `data/nosql/mo_vectors.jsonl` | local only | compiler | Similarity candidates are already precomputed |
| `data/routing/full/**/duration_matrix.bin` | local only | compiler | Full-city matrices are not on the audited demo path |
| corridor routing set | ship | Stratus | 6,475,076 bytes across region, matrix, bitsets, and H3 index |
| `client/public/tiles/bengaluru.pmtiles` | ship | Stratus | 39,135,099 bytes; HTTP 206 acceptance is mandatory |
| `data/derived/graph_snapshot.json.br` | ship | Stratus | 462,459 bytes; `kv-graph` expands it and streams JSON |
| graph nodes / edges | ship | NoSQL | 5,112 / 10,074 documents keyed by `id` |
| `data/scenarios/*.json` | ship | NoSQL | 7 documents keyed by filename |
| stations | ship | Data Store | 178 rows: 106 territorial plus 62 non-territorial |
| incidents | ship | Data Store | 425,408 rows plus three lossless FTS chunks |
| weekly baselines | reduce, then ship | Data Store | 286,330 rows: all 418 weeks for 685 pairs that ever breach |
| justice flow | ship | Data Store | 2,150 observed/modelled aggregate rows |
| alerts | runtime only | Data Store | Empty table; no seed import |

The objective's “stations — 106 rows” is DRIFT against the governed data model.
The build maps 178 unit names to 106 territorial polygons and deliberately keeps
62 non-territorial units in counts. Importing only 106 would silently change
state totals, so all 178 rows are retained with `is_territorial`.

The baseline reduction changes zero Command Feed facts. Every retained pair has
its complete 418-week history; `baseline_id` makes reruns upserts rather than
duplicates.

## Quotas checked before import

These are platform limits, not a substitute for confirming the selected
project's commercial plan in the Catalyst console.

| Constraint | Current documented limit | KSPCID decision |
|---|---|---|
| Data Store development rows | 5,000/table and 25,000/project | Production import is mandatory |
| Data Store production rows | no documented upper row cap | Confirm paid-plan/storage quota before import |
| Data Store columns | 100/table in development; no documented production upper limit | Incidents remains below 100 |
| Var Char / Text | Var Char 255; Text 10,000; Search Index is not available on Text | Preserve 619-char `act_section` in Text and index three 255-char chunks |
| Catalyst Search results | maximum 500 per request | Adapter caps/paginates callers at 500 |
| Data Store free storage | 5 GB | 453 MB of CSV inputs is below this, but actual stored/indexed size must be observed |
| Stratus free storage | 5 GB | Runtime + temporary inputs total 499,353,411 bytes |
| Stratus object size | 250 GB maximum | Largest object is the 352,661,735-byte incident CSV |
| Stratus buckets | 10 maximum | One `kspcid-data` bucket |
| Basic I/O | 30 seconds; output maximum 1 MB | CRUD endpoints and Circuit control states only |
| Advanced I/O | 30 seconds; supports streams | `kv-optimize` and 11,925,630-byte expanded `kv-graph` |
| Cache value | 16,000 characters | Largest compiled value is 12,002 characters |
| Cache development | 5 MB/segment; 20 segments | Warm set is about 1.35 MB in 148 keys |
| Cache TTL | two days maximum/default | Warm every 24 hours with 172,800-second TTL |

Official references: [Data Store columns](https://docs.catalyst.zoho.com/en/cloud-scale/help/data-store/columns/),
[Data Store insert limits](https://docs.catalyst.zoho.com/en/sdk/web/v4/cloud-scale/data-store/insert-rows/),
[Search](https://docs.catalyst.zoho.com/en/sdk/nodejs/v2/cloud-scale/search/search-data/),
[Stratus bucket limits](https://docs.catalyst.zoho.com/en/cloud-scale/help/stratus/buckets/name-bucket/),
[Stratus ranges](https://docs.catalyst.zoho.com/en/sdk/web/v4/cloud-scale/stratus/download-object/),
[Basic I/O](https://docs.catalyst.zoho.com/en/serverless/help/functions/basic-io/),
[Advanced I/O](https://docs.catalyst.zoho.com/en/serverless/help/functions/advanced-io/),
[API Gateway](https://docs.catalyst.zoho.com/en/cloud-scale/help/api-gateway/key-concepts/),
[Cache implementation](https://docs.catalyst.zoho.com/en/cloud-scale/help/cache/implementation/),
[Cache concepts](https://docs.catalyst.zoho.com/en/cloud-scale/help/cache/key-concepts/), and
[pricing](https://catalyst.zoho.com/pricing.html).

General secondary-index DDL is not exposed in the current Data Store
documentation. `etl/datastore/schema.json` records every required filter access
path, but index creation/performance must be confirmed in the production
console or with Catalyst support. This is a performance gate, not permission to
replace Data Store with another service.

## Owner runbook

### 1. Select and initialize the production project

Run these interactively as the project owner:

```bash
npx catalyst project:list
npx catalyst init --project <project_id>
npx catalyst apig:enable
```

Commit the generated `catalyst.json` separately. If initialization proposes
overwriting `functions/` or `client/`, decline. Reconcile the generated
`catalyst-config.json`, package entrypoint, and wrapper shell into each existing
source directory; never use `functions:add --overwrite`.

In the console, confirm the project data center and paid-plan quotas, then
request Domain Mapping and its certificate immediately.

### 2. Create Data Store schema in production

Create `Stations`, `JusticeFlow`, `WeeklyBaselines`, `Incidents`, and `Alerts`
from `etl/datastore/schema.json`. Apply unique and Search Index constraints
exactly as recorded. Confirm the recorded query filter columns have supported
indexes before performance acceptance.

Rebuild and validate the immutable inputs:

```bash
npm run etl:11:catalyst
npm run verify:datastore
npm run verify:cloud-plan
```

Import smallest first. The installed CLI 1.27.0 accepts the file as the
positional argument and the table through `--table`:

```bash
npx catalyst ds:import .staging/dsimport/stations.csv \
  --table Stations --config etl/dsimport/stations.json --production
npx catalyst ds:status import <jobid> --production

npx catalyst ds:import .staging/dsimport/justice.csv \
  --table JusticeFlow --config etl/dsimport/justice.json --production
npx catalyst ds:status import <jobid> --production

npx catalyst ds:import .staging/dsimport/baselines.csv \
  --table WeeklyBaselines --config etl/dsimport/baselines.json --production
npx catalyst ds:status import <jobid> --production

npx catalyst ds:import .staging/dsimport/incidents.csv \
  --table Incidents --config etl/dsimport/incidents.json --production
npx catalyst ds:status import <jobid> --production
```

After each completed job, run `KSPCID_VERIFY_CATALYST=1 npm run
verify:datastore` in an authenticated Catalyst SDK context. Do not continue if a
count differs. Final counts must be:

- Stations: 178
- JusticeFlow: 2,150
- WeeklyBaselines: 286,330
- Incidents: 425,408
- Alerts: 0 before runtime writes

The same verifier checks case-reference and act/section FTS plus justice anchors
105,647 / 92,874 / 73,310 / 25,668.

### 3. Publish Stratus, NoSQL, and Cache

Create one public production bucket named `kspcid-data`, enable versioning, and
configure CORS for only the mapped Slate origin. Then:

```bash
node --import tsx etl/upload_stratus.ts
node --import tsx etl/upload_stratus.ts --apply
KSPCID_STRATUS_BASE_URL=https://<bucket-base> npm run verify:stratus

node --import tsx etl/load_nosql.ts
node --import tsx etl/load_nosql.ts --apply

node --import tsx etl/warm_cache.ts
KSPCID_CACHE_SEGMENT=<segment_id> node --import tsx etl/warm_cache.ts --apply
```

The real range verifier must report HTTP 206, a 128-byte body, and
`Content-Range: bytes 0-127/39135099`. Rendering the PMTiles map from the
Stratus URL is a separate browser acceptance step.

NoSQL reruns fetch by `id`, insert only missing documents, and stop on
same-key/different-content drift. The Cache Cron runs every 24 hours.

### 4. Build and deploy functions, gateway, and Slate

Build and validate the deployment tree before touching the generated project
configuration:

```bash
npm run verify:catalyst-functions
```

This creates `.staging/catalyst/functions` with 14 standalone packages: four
runtime Basic I/O functions, two runtime Advanced I/O functions, one Cache Cron,
and seven Circuit-only Basic I/O functions. After owner initialization, set
`functions.source` in the generated `catalyst.json` to
`.staging/catalyst/functions`; do not overwrite the maintained `functions/`
source tree. Set `KSPCID_DATA_ADAPTER=catalyst`,
`KSPCID_STRATUS_BUCKET=<bucket>`, and `KSPCID_CACHE_SEGMENT=<segment_id>` for
the deployed functions.

After the functions have remote identities, pull the project API Gateway rules
and reconcile the six entries from `etl/cloud/api-gateway.template.json` into
`catalyst-user-rules.json`. The template requires Catalyst User Management on
every route and deliberately leaves throttling unconfigured until production
capacity is measured. Deploy the reconciled rules, bind CORS to the production
Slate domain, and load-test `/optimize` at one request per second with a burst
of three before setting a limit. Catalyst documents sliding-window rate limits
and HTTP 429 responses, but not a generic “burst” JSON field that can safely be
invented before the remote rule is pulled.

The client build requires:

```bash
NEXT_PUBLIC_DEMO_MODE=cloud \
NEXT_PUBLIC_CATALYST_API_BASE=https://<gateway-base> \
NEXT_PUBLIC_STRATUS_BASE_URL=https://<bucket-base> \
npm run build --prefix client
```

Link the existing static export with `npx catalyst slate:link` and deploy it
only after all gateway smoke checks pass. The offline build remains the default
when `NEXT_PUBLIC_DEMO_MODE` is absent or `offline`.

### 5. Circuits hard gate

Catalyst documents Circuits as Basic-I/O-only and unavailable in EU, AU, IN,
JP, SA, and CA data centers. See the
[Circuits introduction](https://docs.catalyst.zoho.com/en/serverless/help/circuits/introduction/)
and [key concepts](https://docs.catalyst.zoho.com/en/serverless/help/circuits/key-concepts/).

If the selected project is in any unavailable data center, **STOP A4b**. Do not
substitute an external orchestrator. The audited, idempotent Stage 2 workflow is
recorded in `etl/cloud/circuit-publication.contract.json`; it explicitly
excludes DuckDB, OSRM, and Neo4j/GDS. Its seven Basic I/O functions are
implemented and included in the 14-package build. It becomes Catalyst Code View
JSON only after the owner confirms a supported data center, deploys the
functions, and supplies the remote function IDs available to the Circuit
console.

For a supported DC, upload the four checksummed temporary inputs first:

```bash
node --import tsx etl/upload_stratus.ts --include-publication-inputs
node --import tsx etl/upload_stratus.ts --include-publication-inputs --apply
```

The Circuit sequence is: validate manifest → validation branch → start upsert
jobs → wait/poll branch → verify Stratus → warm Cache → smoke checks → smoke
branch → publish marker. The four imports start in parallel, job IDs are cached
under the immutable dataset hash for safe retries, completed row counts are
reconciled, and `publication/current.json` is written and read back only after
smoke checks. Failure writes no marker, so the prior dataset remains active.
Delete the four temporary objects immediately after successful publication even
though they carry a seven-day TTL.

## Verification status

- PASS locally: adapter parity including FTS.
- PASS locally: exact Data Store source counts and justice anchors.
- PASS locally: baseline reduction and zero Command Feed mismatch.
- PASS locally: six runtime Stratus object checksums and four publication-input checksums.
- PASS locally: NoSQL counts/key contract and Cache size/value limits.
- PASS locally: 148 Cache keys include 20 station aggregates, one
  bitset-consuming scenario split into 96 chunks, and 30 Command Feed cards.
- PASS locally: `kv-graph` expands to 5,112 nodes / 10,074 edges.
- PASS locally: 14 deployable Node 22 Catalyst packages; package scanning
  proves no local adapter, DuckDB query, or local ETL data dependency is bundled.
- PASS locally: six API Gateway route definitions reconcile exactly to every
  public runtime function; authentication and unset-throttling contracts are checked.
- PASS locally: Circuit validation failure, four parallel imports, retry job
  reuse, wait/poll, row reconciliation, Stratus range, Cache warm, smoke checks,
  and deterministic publication marker/read-back.
- PASS locally: `npm run check`.
- PASS locally: Next static production build.
- PASS locally: offline mode remains the default and offline verifier passes.
- PENDING cloud: all imports, Search results, HTTP 206, PMTiles rendering,
  backend routes without local ETL files, throttle behavior, Slate deployment,
  certificate, and production smoke checks.
- BLOCKED: `catalyst.json` until owner initialization.
- BLOCKED: A4b until project data center is known and supports Circuits.

## Exact rollback

No rollback is currently required because no external state was changed.

For the first owner deployment:

1. Disable or repoint the API Gateway routes before touching data.
2. Restore the prior Slate version and prior function deployment from the
   preceding Git stage commit.
3. If a publication marker exists, point it back to the previous
   `dataset_sha256`; never mark a failed dataset active.
4. Re-import the previous committed publication manifest. Data Store has no
   repository-level rollback, so the previous checksummed upsert CSVs are the
   recovery source.
5. Restore the prior Stratus object versions. Versioning must be enabled before
   first upload; otherwise re-upload the six objects from the previous
   allowlist commit.
6. Re-run the previous NoSQL loader. It uses stable IDs and refuses
   same-key/different-content writes; remove only IDs enumerated by a failed new
   manifest before restoring.
7. Re-run the previous Cache warmer, or purge the `kspcid-hot` segment and wait
   for its two-day TTL. Cache is never the source of record.
8. Re-run cloud count, FTS, justice, Stratus-range, route, and browser smoke
   checks before re-enabling traffic.

For an abandoned first provisioning with no previous release, disable routes,
remove only the exact resources named in this report (five Data Store tables,
three NoSQL tables, one Cache segment, one Stratus bucket after confirming its
allowlist, and the named functions/Slate app) through the Catalyst console.
Keep the local repository and offline build intact.
