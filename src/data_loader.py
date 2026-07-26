"""Data loading and preprocessing functions."""
import os
import streamlit as st
import pandas as pd
from pathlib import Path
import sys

# Add project root to path
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from config.settings import (
    BENGALURU_BOUNDS,
    DATA_FILE_ENV,
    DATA_FILES,
    DATASET_REQUIRED_COLUMNS,
)


def _configured_data_paths() -> list[Path]:
    """Return one explicit override or the bundled dataset candidates."""
    override = os.environ.get(DATA_FILE_ENV)
    if override:
        override_path = Path(override).expanduser()
        if not override_path.is_file():
            raise FileNotFoundError(
                f"{DATA_FILE_ENV} does not point to a readable file: "
                f"{override_path}"
            )
        return [override_path]

    data_dir = Path(__file__).resolve().parents[1] / "data" / "processed"
    return [data_dir / filename for filename in DATA_FILES]


def _adapt_synthetic_schema(df: pd.DataFrame) -> pd.DataFrame:
    """Add dashboard aliases when the full prepared dataset is mounted."""
    aliases = {
        "occurred_at": "datetime",
        "crime_subcategory": "crime_type",
        "police_station": "neighborhood",
    }
    adapted = df.copy()
    for source, target in aliases.items():
        if target not in adapted.columns and source in adapted.columns:
            adapted[target] = adapted[source]

    if "crime_type" in adapted.columns:
        adapted["crime_type"] = (
            adapted["crime_type"]
            .astype("string")
            .str.replace("_", " ", regex=False)
            .str.title()
        )
    return adapted


def _validate_synthetic_dataset(df: pd.DataFrame, source: Path) -> None:
    """Reject incomplete, non-synthetic, or geographically invalid inputs."""
    missing = sorted(DATASET_REQUIRED_COLUMNS.difference(df.columns))
    if missing:
        raise ValueError(
            f"{source} is missing required dataset columns: {', '.join(missing)}"
        )
    if df.empty:
        raise ValueError(f"{source} contains no incident rows.")

    synthetic_values = (
        df["is_synthetic"]
        .astype("string")
        .str.strip()
        .str.lower()
    )
    if not synthetic_values.isin({"true", "1", "yes"}).all():
        raise ValueError(
            f"{source} is not the prepared synthetic Bengaluru dataset."
        )

    for column, (minimum, maximum) in BENGALURU_BOUNDS.items():
        values = pd.to_numeric(df[column], errors="coerce")
        if values.isna().any() or not values.between(minimum, maximum).all():
            raise ValueError(
                f"{source} contains invalid {column} values outside the "
                "configured Bengaluru bounds."
            )


@st.cache_data(ttl=3600)  # Cache for 1 hour
def load_crime_data():
    """Load and validate the prepared synthetic Bengaluru incident dataset."""
    candidates = _configured_data_paths()

    for path in candidates:
        if path.is_file():
            # Read header first to determine parse columns
            header = pd.read_csv(path, nrows=0)
            parse_cols = [
                column
                for column in ["datetime", "occurred_at", "date"]
                if column in header.columns
            ]

            # Load full dataset
            df = pd.read_csv(path, parse_dates=parse_cols, low_memory=False)
            df = _adapt_synthetic_schema(df)
            _validate_synthetic_dataset(df, path)
            return df

    searched = ", ".join(str(path) for path in candidates)
    st.warning(f"No configured synthetic dataset found. Searched: {searched}")
    return pd.DataFrame()


def process_datetime_columns(df):
    """Process and derive datetime-related columns."""
    df = df.copy()
    df.columns = [c.strip() for c in df.columns]
    
    # Create datetime column if missing
    if "datetime" not in df.columns:
        if "date" in df.columns:
            df["date"] = pd.to_datetime(df["date"], errors="coerce")
        
        if "time" in df.columns:
            t1 = pd.to_datetime(df["time"], format="%H:%M:%S", errors="coerce")
            t2 = pd.to_datetime(df["time"], format="%H:%M", errors="coerce")
            tt = t1.fillna(t2)
            df["datetime"] = (
                df["date"]
                + pd.to_timedelta(tt.dt.hour.fillna(0), unit="h")
                + pd.to_timedelta(tt.dt.minute.fillna(0), unit="m")
            )
        elif "date" in df.columns:
            df["datetime"] = df["date"]
    
    # Derive time-based features
    if "datetime" in df.columns:
        df["year"] = df["datetime"].dt.year
        df["hour"] = df["datetime"].dt.hour
        df["weekday"] = df["datetime"].dt.day_name()
        df["month"] = df["datetime"].dt.strftime("%Y-%m")
    
    return df


@st.cache_data
def apply_filters(df, years=None, crime_types=None, neighborhoods=None, arrest_made=None):
    """Apply filters to the dataset efficiently."""
    mask = pd.Series(True, index=df.index)
    
    if years and "datetime" in df.columns:
        mask &= df["datetime"].dt.year.isin(years)
    
    if crime_types and "crime_type" in df.columns:
        mask &= df["crime_type"].isin(crime_types)
    
    if neighborhoods and "neighborhood" in df.columns:
        mask &= df["neighborhood"].isin(neighborhoods)
    
    if arrest_made is not None and "arrest_made" in df.columns:
        mask &= (df["arrest_made"] == arrest_made)
    
    return df[mask].copy()


def get_filter_options(df):
    """Extract unique values for filter dropdowns."""
    year_opts = sorted(df["datetime"].dt.year.dropna().unique()) if "datetime" in df.columns else []
    crime_types = sorted(df["crime_type"].dropna().unique()) if "crime_type" in df.columns else []
    neighborhoods = sorted(df["neighborhood"].dropna().unique()) if "neighborhood" in df.columns else []
    
    return {
        "years": year_opts,
        "crime_types": crime_types,
        "neighborhoods": neighborhoods
    }
