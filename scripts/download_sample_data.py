"""Download a manageable LA crime dataset in small, reliable batches."""

from __future__ import annotations

import io
import os
import sys
import time
from pathlib import Path

import pandas as pd
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry


API_URL = "https://data.lacity.org/resource/2nrs-mtv8.json"

# Enough data for the dashboard and ML features without downloading
# the complete one-million-row dataset.
TARGET_ROWS = 10_000
BATCH_SIZE = 1_000

START_DATE = "2024-01-01T00:00:00.000"
END_DATE = "2025-01-01T00:00:00.000"


def create_session() -> requests.Session:
    """Create an HTTP session with retries and backoff."""

    retry_policy = Retry(
        total=5,
        connect=5,
        read=5,
        status=5,
        backoff_factor=2,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=frozenset(["GET"]),
        raise_on_status=False,
    )

    adapter = HTTPAdapter(
        max_retries=retry_policy,
        pool_connections=5,
        pool_maxsize=5,
    )

    session = requests.Session()
    session.mount("https://", adapter)
    session.mount("http://", adapter)

    session.headers.update(
        {
            "Accept": "application/json",
            "User-Agent": "City-Crime-Safety-Dashboard/1.0",
        }
    )

    # Optional Socrata token for better request limits.
    app_token = os.getenv("SOCRATA_APP_TOKEN")

    if app_token:
        session.headers["X-App-Token"] = app_token

    return session


def download_batches(session: requests.Session) -> pd.DataFrame:
    """Download records in small batches."""

    batches: list[pd.DataFrame] = []
    downloaded = 0
    offset = 0

    print("Downloading LA crime data in small batches...")
    print(f"Target records: {TARGET_ROWS:,}")
    print(f"Batch size: {BATCH_SIZE:,}")
    print()

    while downloaded < TARGET_ROWS:
        current_limit = min(BATCH_SIZE, TARGET_ROWS - downloaded)

        params = {
            "$select": (
                "dr_no,date_occ,time_occ,crm_cd_desc,"
                "area_name,lat,lon"
            ),
            "$where": (
                f"date_occ >= '{START_DATE}' "
                f"AND date_occ < '{END_DATE}'"
            ),
            "$order": "dr_no",
            "$limit": current_limit,
            "$offset": offset,
        }

        try:
            response = session.get(
                API_URL,
                params=params,
                timeout=(15, 60),
            )

            if response.status_code != 200:
                print(
                    f"API returned HTTP {response.status_code}: "
                    f"{response.text[:500]}"
                )
                response.raise_for_status()

            records = response.json()

        except requests.exceptions.ReadTimeout:
            print(
                f"Batch at offset {offset:,} timed out. "
                "Retrying after 5 seconds..."
            )
            time.sleep(5)
            continue

        except requests.exceptions.ConnectionError as error:
            print(f"Connection error: {error}")
            print("Retrying after 5 seconds...")
            time.sleep(5)
            continue

        except requests.exceptions.RequestException as error:
            raise RuntimeError(
                f"Unable to download LA crime data: {error}"
            ) from error

        if not records:
            print("No additional records were returned.")
            break

        batch = pd.DataFrame.from_records(records)

        if batch.empty:
            break

        batches.append(batch)

        received = len(batch)
        downloaded += received
        offset += received

        print(
            f"Downloaded {downloaded:,} / {TARGET_ROWS:,} records"
        )

        if received < current_limit:
            break

        # Small delay reduces the chance of API throttling.
        time.sleep(0.5)

    if not batches:
        raise RuntimeError(
            "The API returned no records. Check your internet connection "
            "or try again later."
        )

    return pd.concat(batches, ignore_index=True)


def transform_data(raw: pd.DataFrame) -> pd.DataFrame:
    """Convert the LAPD columns into the dashboard schema."""

    required_columns = {
        "date_occ",
        "time_occ",
        "crm_cd_desc",
        "area_name",
        "lat",
        "lon",
    }

    missing_columns = required_columns.difference(raw.columns)

    if missing_columns:
        raise RuntimeError(
            f"API response is missing columns: "
            f"{sorted(missing_columns)}"
        )

    dates = pd.to_datetime(
        raw["date_occ"],
        errors="coerce",
    ).dt.normalize()

    military_time = (
        pd.to_numeric(raw["time_occ"], errors="coerce")
        .fillna(0)
        .astype(int)
    )

    hours = (military_time // 100).clip(lower=0, upper=23)
    minutes = (military_time % 100).clip(lower=0, upper=59)

    dataframe = pd.DataFrame(
        {
            "datetime": (
                dates
                + pd.to_timedelta(hours, unit="h")
                + pd.to_timedelta(minutes, unit="m")
            ),
            "crime_type": (
                raw["crm_cd_desc"]
                .fillna("Unknown")
                .astype(str)
            ),
            "neighborhood": (
                raw["area_name"]
                .fillna("Unknown")
                .astype(str)
            ),
            "latitude": pd.to_numeric(
                raw["lat"],
                errors="coerce",
            ),
            "longitude": pd.to_numeric(
                raw["lon"],
                errors="coerce",
            ),
        }
    )

    dataframe = dataframe.dropna(
        subset=[
            "datetime",
            "latitude",
            "longitude",
        ]
    )

    # LAPD records without usable coordinates may contain 0,0.
    dataframe = dataframe[
        dataframe["latitude"].between(33, 35)
        & dataframe["longitude"].between(-119, -117)
    ]

    dataframe = dataframe.drop_duplicates().reset_index(drop=True)

    if dataframe.empty:
        raise RuntimeError(
            "Records were downloaded, but none contained valid "
            "dates and geographic coordinates."
        )

    return dataframe


def main() -> None:
    project_root = Path(__file__).resolve().parents[1]
    output_directory = project_root / "data" / "processed"
    output_file = output_directory / "sample_la_crime_2024.csv"

    output_directory.mkdir(parents=True, exist_ok=True)

    session = create_session()

    try:
        raw_data = download_batches(session)
        cleaned_data = transform_data(raw_data)

        cleaned_data.to_csv(
            output_file,
            index=False,
            encoding="utf-8",
        )

    except KeyboardInterrupt:
        print("\nDownload cancelled by the user.")
        sys.exit(130)

    finally:
        session.close()

    print()
    print("Download and preparation completed.")
    print(f"Output file: {output_file}")
    print(f"Valid records saved: {len(cleaned_data):,}")
    print()
    print("Next command:")
    print("streamlit run dashboard\\app.py")


if __name__ == "__main__":
    main()