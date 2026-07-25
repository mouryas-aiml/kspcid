# A12 Case Similarity

- Candidate pool: **38,024** complete-window two-wheeler-theft records
- Demonstration targets: **12** reported-coordinate corridor cases
- Re-rankable candidates per target: **100**
- Graph dependency: **none**
- Vector layout: **64 dimensions, mo64_v1**

The published component weights remain separate in the fixture and may be adjusted by the user.

## Acceptance

- `kv-similar`: **6.6 ms** local adapter round-trip
- Weight change re-ranked the visible top 10: **PASS**
- Match evidence inspector: **PASS**
- Browser console/page errors: **0**
- Static production export: **PASS**
