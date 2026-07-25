# A5/A6/A8 Command Map

- 90-day H3 r9 cells: **500**
- Eligible reported points in compact snapshot: **500**
- Deterministic Why Here? explanations: **24**
- Pulsed ranked alerts: **6**
- Adapter functions: **kv-incidents, kv-hotspots, kv-explain**
- Deterministic fixture SHA-256: `c921554b2ee7995415df9cfeb8a23d47df9278006350c209998ae043d2e36756`

Inferred locations render only as H3 aggregates. Point marks are map-pin-eligible reported coordinates only.

## Acceptance

- `kv-incidents`, `kv-hotspots`, and `kv-explain` import only the shared adapter contract and run against the functional LocalAdapter; Catalyst selection remains environment-driven.
- Warm station hotspots complete in **5.9 ms** and eligible reported incidents in **17.0 ms**, both below the 150 ms inspector target.
- The exported map renders 500 H3 cells, 500 eligible point marks, six ranked alert pulses, 24 deterministic explanations, and a dual-provenance Pulse Ring.
- A Command Feed query string selects the incoming station/head state; clearing filters restores all 500 cells; zoom changes the H3 viewport.
- Browser acceptance completed in 871 ms with no console or page errors.
