# A11 patrol acceptance

- Scenario checksum: `5263cf5f46def00788f27c7bd950f0c5754a98682c5d1d021321ed11ebaf5436`
- Score recompute: **0.049 ms average** across 500 consecutive runs
- Client heuristic: **18.0 ms**, score **913**
- Adapter-backed `kv-optimize`: **25.9 ms**, **100.0%** demand coverage in the fixture
- Cross-station-boundary road-time coverage: **PASS**
- Browser path: optimize → replay → closure injection → compare: **PASS**
- Browser console/page errors: **0**

The UI and function both label the method “MCLP-inspired heuristic (greedy + local
search)” and cite Church & ReVelle (1974). The method is a deterministic greedy
placement followed by 300 one-swaps and an equity repair.
