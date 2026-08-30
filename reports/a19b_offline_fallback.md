# A19b Offline Fallback

- Precomputed plan score: **814**
- Units in stored deployment: **16**
- Live optimizer timeout: **2000 ms**
- Offline routes: **7**
- Offline artifact contracts: **13**
- Fallback SHA-256: `d7597e5510aad0b14f379d028fa4e2a1a6b90c4ed497b229c7fce074e3249c47`
- Snapshot SHA-256: `f3b532800b3e839428786a9f55a212df258beb27f3ce426269916d641f10803e`

The bundle is a same-schema static fallback. It contains no Catalyst credentials and makes no deployment claim.

## Acceptance

- `verify:offline` re-runs the deterministic optimizer and confirms the stored 16-unit deployment and score 814 exactly.
- Every offline artifact is byte-counted and checksummed; all 7 demo routes and 13 required data assets — including the Command Map and the dispatch route geometry — are present in the service-worker contract.
- The service worker is asserted to write to a cache in exactly one guarded place, so a 206 range response can never reach `cache.put` and silently drop the basemap.
