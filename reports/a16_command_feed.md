# A16 Command Feed

- Ranked alerts: **25**
- Eligible detector candidates in H2 2023: **25**
- Eligibility gate: **expected_count >= 0.5, window_observations >= 26**
- Alerts with an observed-coordinate station centroid: **11**
- Stored z-score range: **3.16 – 9.68**
- Replay duration: **60 seconds**

All alert facts are derived from complete-window baselines. The replay clock and acknowledgement state are presentation/session metadata.

## Eligibility

The baseline grid is densely zero-filled, so a long-dormant series divides by a near-zero variance and returns an
astronomical z-score — the largest in the grid is 9.017e24. Ranking on that suppressed every genuine spike. The gate
admits only series carrying half a year of history and a non-trivial expectation. `06_baselines.ts` is unchanged:
`z_score` is mandatory in the Data Store schema, so the raw grid keeps emitting it for every row, and eligibility is
decided here by the consumer.
