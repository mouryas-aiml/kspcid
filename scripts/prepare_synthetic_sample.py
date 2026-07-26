"""Build CipherWatch's deployable sample from the prepared Bengaluru dataset.

The complete prepared CSV is intentionally not copied into this repository:
it exceeds GitHub's per-file size limit. This utility selects an exact,
deterministic sample per year and records source/output checksums so the bundled
artifact remains reproducible and auditable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import pandas as pd


SOURCE_COLUMNS = [
    "incident_id",
    "occurred_at",
    "reported_date",
    "police_division",
    "police_station",
    "station_code",
    "locality",
    "latitude",
    "longitude",
    "crime_category",
    "crime_subcategory",
    "premise_category",
    "weapon_category",
    "victim_age",
    "victim_sex",
    "case_status",
    "is_synthetic",
    "source_dataset",
    "generation_version",
]
OUTPUT_COLUMNS = [
    "incident_id",
    "datetime",
    "reported_date",
    "crime_type",
    "crime_category",
    "neighborhood",
    "police_division",
    "police_station",
    "station_code",
    "locality",
    "latitude",
    "longitude",
    "premise_category",
    "weapon_category",
    "victim_age",
    "victim_sex",
    "case_status",
    "is_synthetic",
    "source_dataset",
    "generation_version",
]
DEFAULT_OUTPUT = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "processed"
    / "bengaluru_synthetic_crime_2020_2024.csv"
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _validate_source_columns(columns: list[str], source: Path) -> None:
    missing = sorted(set(SOURCE_COLUMNS).difference(columns))
    if missing:
        raise ValueError(
            f"{source} is missing required columns: {', '.join(missing)}"
        )


def build_sample(
    source: Path,
    output: Path,
    *,
    rows_per_year: int,
    chunk_size: int,
) -> dict[str, object]:
    """Select the lexically smallest UUIDs per year as a stable hash sample."""
    if rows_per_year <= 0:
        raise ValueError("rows_per_year must be positive.")

    header = pd.read_csv(source, nrows=0)
    _validate_source_columns(list(header.columns), source)
    candidates: dict[int, pd.DataFrame] = {}
    source_rows = 0

    for chunk in pd.read_csv(
        source,
        usecols=SOURCE_COLUMNS,
        chunksize=chunk_size,
        low_memory=False,
    ):
        source_rows += len(chunk)
        synthetic = (
            chunk["is_synthetic"]
            .astype("string")
            .str.strip()
            .str.lower()
        )
        if not synthetic.isin({"true", "1", "yes"}).all():
            raise ValueError("Source contains a non-synthetic row.")

        chunk["_year"] = pd.to_numeric(
            chunk["occurred_at"].astype("string").str.slice(0, 4),
            errors="raise",
        ).astype(int)
        for year, group in chunk.groupby("_year", sort=True):
            pool = pd.concat(
                [candidates.get(int(year), group.iloc[0:0]), group],
                ignore_index=True,
            )
            candidates[int(year)] = pool.sort_values(
                "incident_id",
                kind="stable",
            ).head(rows_per_year)

    if not candidates:
        raise ValueError(f"{source} contains no rows.")
    undersized = {
        year: len(rows)
        for year, rows in candidates.items()
        if len(rows) < rows_per_year
    }
    if undersized:
        raise ValueError(f"Insufficient rows for year strata: {undersized}")

    sample = pd.concat(
        [candidates[year] for year in sorted(candidates)],
        ignore_index=True,
    )
    sample["datetime"] = sample["occurred_at"]
    sample["crime_type"] = (
        sample["crime_subcategory"]
        .astype("string")
        .str.replace("_", " ", regex=False)
        .str.title()
    )
    sample["neighborhood"] = sample["police_station"]
    sample = sample.sort_values(
        ["datetime", "incident_id"],
        kind="stable",
    )[OUTPUT_COLUMNS]

    latitudes = pd.to_numeric(sample["latitude"], errors="raise")
    longitudes = pd.to_numeric(sample["longitude"], errors="raise")
    if not latitudes.between(12.7, 13.3).all():
        raise ValueError("Sample contains latitude values outside Bengaluru.")
    if not longitudes.between(77.3, 78.0).all():
        raise ValueError("Sample contains longitude values outside Bengaluru.")
    if sample["incident_id"].duplicated().any():
        raise ValueError("Sample contains duplicate incident IDs.")

    output.parent.mkdir(parents=True, exist_ok=True)
    sample.to_csv(output, index=False, lineterminator="\n")
    metadata_path = output.with_suffix(".metadata.json")
    metadata = {
        "title": "CipherWatch synthetic Bengaluru demonstration sample",
        "warning": (
            "SYNTHETIC DATA. NOT REAL BENGALURU CRIME RECORDS. "
            "NOT FOR POLICING, SAFETY CLAIMS, OR NEIGHBORHOOD RANKING."
        ),
        "source_file": source.name,
        "source_sha256": sha256_file(source),
        "source_rows": source_rows,
        "sample_file": output.name,
        "sample_sha256": sha256_file(output),
        "sampling": {
            "method": (
                "year-stratified deterministic UUID ordering "
                "(lexically smallest incident_id values)"
            ),
            "rows_per_year": rows_per_year,
            "year_counts": {
                str(year): int(count)
                for year, count in sample["datetime"]
                .astype("string")
                .str.slice(0, 4)
                .value_counts()
                .sort_index()
                .items()
            },
        },
        "rows": len(sample),
        "date_range": {
            "start": str(sample["datetime"].min()),
            "end": str(sample["datetime"].max()),
        },
        "crime_types": int(sample["crime_type"].nunique()),
        "police_stations": int(sample["neighborhood"].nunique()),
        "generation_versions": sorted(
            sample["generation_version"].astype(str).unique().tolist()
        ),
        "schema": OUTPUT_COLUMNS,
    }
    metadata_path.write_text(
        json.dumps(metadata, indent=2) + "\n",
        encoding="utf-8",
    )
    return metadata


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="Prepared synthetic CSV")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--rows-per-year", type=int, default=2_000)
    parser.add_argument("--chunk-size", type=int, default=100_000)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    metadata = build_sample(
        args.source.resolve(),
        args.output.resolve(),
        rows_per_year=args.rows_per_year,
        chunk_size=args.chunk_size,
    )
    print(
        f"Wrote {metadata['rows']:,} rows to {args.output} "
        f"(sha256 {metadata['sample_sha256']})."
    )


if __name__ == "__main__":
    main()
