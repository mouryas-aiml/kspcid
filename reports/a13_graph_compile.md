# A13 graph compile — PASS

Compiled by **Neo4j 5.26 + GDS 2.13.11** (APOC 5.26.28), per BUILD_SPEC §2.2 and §6.6.
The previous Graphology stand-in has been removed; every community, bridge score and
kNN similarity edge below is genuine GDS output read back out of the database.

## Results

- Nodes: **5,112**
- Edges exported: **10,074** (9,246 seeded + **828** from `gds.knn`)
- `gds.knn` computed **43,200** similarity edges at §6.6's topK 10; the **828** exported are cosine *exactly* 1.0 — identical MO signatures, not a graded cut (see gap 5)
- `gds.louvain` communities: **67**
- Modularity: **0.971756**
- `gds.betweenness` → `bridge_score`, min-max normalised to [0,1]
- `gds.knn` over `mo_vector` (COSINE, topK 10) → `SIMILAR_TO`
- ForceAtlas2: **160 offline iterations; settled coordinates shipped**
- Snapshot bytes: **11,925,630**
- Brotli bytes: **462,459**

## Determinism

Louvain runs at `concurrency:1` with `consecutiveIds` (GDS 2.x Louvain takes no
`randomSeed`); kNN is pinned to `concurrency:1`, `randomSeed:42`, `sampleRate:1.0`. The
store is dropped and rebuilt from `entity_graph_raw.json`
(sha256 `acc37245299ee4f056a9c03b519418215233b4258d76f913dc37a9f7fa397e61`) on every run. Verified reproducible: five consecutive
compiles produced 67 communities, modularity 0.971756 and a byte-identical snapshot (§14.6).

## Spec gaps recorded

1. **Account nodes are outside §6.6's GDS projection.** §6.6 projects
   `['Person','Vehicle','Phone','Incident']`, so `:Account` receives no GDS output. Rather
   than fabricate a community for them, the **180** unprojected nodes inherit the
   community of the Person that `CONTROLS` them — a real edge in the graph — and carry
   `bridge_score` 0. The projection itself is run exactly as §6.6 states it.
2. **`gds.knn` discovers similarity edges beyond the seeded set.** `verify_graph.ts`
   previously asserted `snapshot.edges === raw.edges`; suppressing genuine GDS output to
   satisfy that would hollow out the graph claim, so the assertion now allows exactly
   `raw.edges + gds_similar_to_shipped` and checks that delta explicitly.
4. **§6.6 runs `gds.knn` against the `assoc` projection, which loads no node properties**,
   so `mo_vector` is not available to it — the spec's kNN call cannot run against the
   spec's own projection as literally written. A second Incident-only projection
   (`assoc_mo`) carries the property. This is also the only coherent reading: an MO-signature
   similarity between a Phone and a Vehicle is meaningless.
5. **The exported SIMILAR_TO edges are exact MO-signature matches, not a similarity cut.**
   topK 10 over 4,320 incidents computes 43,200 edges; exporting all of them wires every
   incident to ten neighbours, which defeats §7.3's purpose (nothing stands out in a uniform
   hairball) and pushes the payload past §9's budgets — the uncut snapshot measured 40 MB
   against 11 MB. Measuring the distribution showed the cut is not a graded one:

   | band | edges |
   |---|---:|
   | = 1.0 | 1,722 |
   | [0.99, 1.0) | 0 |
   | [0.98, 0.99) | 0 |
   | [0.97, 0.98) | 178 |
   | [0.76, 0.97) | 41,300 |

   The band immediately below 1.0 is **empty**, so every top edge is cosine *exactly* 1.0 —
   bit-identical 64-dimension MO signatures — and any cut in (0.98, 1.0] selects the same set.
   The export therefore selects on **identity**, not on a threshold. That is both the honest
   description and the stronger claim: "these FIRs carry an identical MO signature across
   different stations" is defensible where "similarity 0.98" is not. Below 0.97 the mass is
   continuous with no natural break, so no lower cut would be defensible either.
   **828** unordered exact-match pairs are exported, touching **875** incidents
   (20% of 4,320 — `topK 10` is the binding cap, so a lower cut widens rather than deepens),
   of which **738** directed matches join *different* stations. Graded similarity is not lost:
   it is A12's `kv-similar` weighted cosine over the same vectors, the right home for an
   interrogable score. Snapshot and NoSQL JSONL carry the same set (§2.6), and
   `gds_similar_to_computed`, `gds_similar_to_shipped` and `gds_similar_to_selection`
   are recorded in the snapshot so the selection is visible rather than silent.
6. **ForceAtlas2 is not a GDS algorithm.** GDS has no force-directed layout and §9 requires
   a precomputed settled layout, so x,y remain Graphology output. Communities, bridge scores
   and similarity — the things §2.2 names — are all Neo4j GDS.

Generated entities and relationships retain generated provenance; incident nodes retain mirror provenance.
