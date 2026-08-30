# A19b Offline Fallback

- Precomputed plan score: **814**
- Units in stored deployment: **16**
- Live optimizer timeout: **2000 ms**
- Offline routes: **7**
- Offline artifact contracts: **13**
- Fallback SHA-256: `b3bcd9316c8b7287c679e09ebbcfbe0a4cd1751fb3c1777dbe9f98e37b8d540c`
- Snapshot SHA-256: `d1598c5144b511a4b8264c30a5aeecda66ecf709a06c67d5bffa8be7453b6417`

The bundle is a same-schema static fallback. It contains no Catalyst credentials and makes no deployment claim.

## Acceptance

- `verify:offline` re-runs the deterministic optimizer and confirms the stored 16-unit deployment and score 814 exactly.
- Every offline artifact is byte-counted and checksummed; all 7 demo routes and 13 required data assets — including the Command Map and the dispatch route geometry — are present in the service-worker contract.
- The service worker is asserted to write to a cache in exactly one guarded place, so a 206 range response can never reach `cache.put` and silently drop the basemap.
