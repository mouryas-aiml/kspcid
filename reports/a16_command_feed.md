# A16 Command Feed

- Ranked alerts: **30**
- Detector candidates in H2 2023: **84**
- Alerts with an observed-coordinate station centroid: **26**
- Replay duration: **60 seconds**
- Deterministic fixture SHA-256: `2ce5c798c33217a8230e90695a68949c421bea95df8a8f03983a36a49887dbe3`

All alert facts are derived from complete-window baselines. The replay clock and acknowledgement state are presentation/session metadata.

## Acceptance

- All 30 cards independently reconcile to `weekly_baselines.parquet` and satisfy `count ≥ 5 AND count > UCL`.
- Severity ranking is deterministic (`z-score × declared crime-head severity weight`); extreme sparse-series z-scores display as `20+σ` without altering their stored score.
- The feed loads fully populated, supports severity/search filtering, and can replay deterministically over 60 seconds.
- Explain, Similar cases, and Plan patrol links preserve station, crime head, week, and alert identifiers in their query strings.
- Disposition controls are explicitly local session state because Catalyst Data Store/Signals remain deployment-gated.
- Exported `/feed/` passed browser checks for selection, disposition, replay, and all three action links with no console or page errors.
