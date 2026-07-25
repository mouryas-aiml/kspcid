# A15 Justice Pipeline

- Observed records: **425,408**
- Current-stage categories: **13**
- Stations: **107**
- Undetected: **92,874**
- Pending Trial: **105,647**
- Convicted: **73,310**
- Complete-window open records aged: **224,209**
- Deterministic fixture SHA-256: `0e39832dd6d6350b6cca374e2f5be4ba03ea34f35e7aa390391ce71f5b0ce71a`

Observed mode is one hop only. Generated multi-hop paths are terminal-constrained and separately labelled.

## Acceptance

- `verify:justice` reconciles every stage, year, station, and ageing count to the normalized Parquet source.
- The observed UI exposes city, year, and station scopes; exact/percentage views; open-case ageing; and two-station comparison.
- The generated multi-hop toggle maintains a persistent purple disclosure and uses generated provenance on every modelled panel.
- Exported `/justice/` passed headless-browser interaction checks with no console or page errors.
