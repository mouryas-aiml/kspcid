# CipherWatch Dataset

> **SYNTHETIC DATA:** These are generated demonstration records, not real
> Bengaluru crimes. Do not use them for policing, safety claims, neighborhood
> ranking, enforcement, or individual-level decisions.

CipherWatch uses a deterministic sample of the prepared **Synthetic Bengaluru
Crime Dataset 2020–2024**.

## Bundled artifact

| Property | Value |
|---|---|
| File | `processed/bengaluru_synthetic_crime_2020_2024.csv` |
| Rows | 10,000 |
| Years | 2020–2024 (2,000 rows per year) |
| Police station areas | 106 |
| Crime types represented | 31 |
| Generation version | `blr-synthetic-v1.0.0` |
| Sample SHA-256 | `87e085a59bdcd4058b322c398fbba792ea156bbfb306fc51cc9b883c8c63fdfb` |

The accompanying
`processed/bengaluru_synthetic_crime_2020_2024.metadata.json` records the
source checksum, sample checksum, schema, date range, generation version, and
sampling method.

## Why the repository contains a sample

The validated prepared source contains 1,004,894 rows. Its CSV is approximately
398 MB and its Parquet file is approximately 162 MB, both above GitHub's
per-file limit. The repository therefore bundles an exact, reproducible
year-stratified sample suitable for deployment and demonstrations.

The sample selects the lexically smallest UUID incident IDs within each year.
The UUIDs are deterministic hash identifiers, so this gives a stable selection
without depending on input row order.

## Dashboard schema

| Column | Meaning |
|---|---|
| `incident_id` | Deterministic synthetic record identifier |
| `datetime` | Synthetic event timestamp in IST |
| `reported_date` | Synthetic reporting date |
| `crime_type` | Human-readable synthetic crime subcategory |
| `crime_category` | Broad synthetic category |
| `neighborhood` | Dashboard alias for `police_station` |
| `police_division` | Bengaluru police division label |
| `police_station` | Synthetic police station assignment |
| `station_code` | Stable synthetic station code |
| `latitude`, `longitude` | Generated point inside the assigned jurisdiction |
| `is_synthetic` | Must be true for every row |
| `source_dataset` | Donor-distribution provenance |
| `generation_version` | Synthetic generator version |

The runtime loader rejects files that omit required fields, contain a
non-synthetic row, or include coordinates outside the configured Bengaluru
bounds. This prevents the former LA sample—or another accidental dataset—from
silently becoming active.

## Rebuild the sample

From the repository root:

```bash
python scripts/prepare_synthetic_sample.py \
  /path/to/bengaluru_synthetic_crime_2020_2024.csv
```

The default output is the bundled CSV in `data/processed/`. The command also
regenerates its metadata JSON.

## Use the complete prepared CSV

For a machine with enough memory, point CipherWatch at the full generated CSV:

```bash
export CIPHERWATCH_DATA_FILE=/absolute/path/to/bengaluru_synthetic_crime_2020_2024.csv
streamlit run dashboard/app.py
```

The loader maps the prepared source fields `occurred_at`,
`crime_subcategory`, and `police_station` to the dashboard's compatibility
fields `datetime`, `crime_type`, and `neighborhood`.

## Provenance and limitations

- The records are generated and do not describe real Bengaluru incidents.
- Donor distributions come from municipal crime data documented by the
  prepared dataset's own manifest; source rows are not presented as Bengaluru
  events.
- Police-station geography, street anchors, and generation constraints belong
  to the prepared synthetic-data pipeline.
- Dashboard models learn demonstration patterns in this sample. Their outputs
  are not operational forecasts or evidence about any place or person.
