# A19b Offline Fallback

- Precomputed plan score: **913**
- Units in stored deployment: **16**
- Live optimizer timeout: **2000 ms**
- Offline routes: **7**
- Offline artifact contracts: **13**
- Fallback SHA-256: `0de3d49c4543c420eacfd9802d1e64971d05da9d2aab113776ebbaadcee9ef7a`
- Snapshot SHA-256: `4467fd5a0e0509b8160af323c21fc4f7df60bb360dec6c8cf7267bef65014123`

The bundle is a same-schema static fallback. It contains no Catalyst credentials and makes no deployment claim.

## Acceptance

- `verify:offline` re-runs the deterministic optimizer and confirms the stored 16-unit deployment and score 913 exactly.
- Every offline artifact is byte-counted and checksummed; all 7 demo routes and 13 required data assets — including the Command Map and the dispatch route geometry — are present in the service-worker contract.
- The service worker is asserted to write to a cache in exactly one guarded place, so a 206 range response can never reach `cache.put` and silently drop the basemap.
