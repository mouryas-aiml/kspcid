"""Data loading and preprocessing functions."""
import streamlit as st
import pandas as pd
from pathlib import Path
import sys

# Add project root to path
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from config.settings import DATA_FILES


@st.cache_data(ttl=3600)  # Cache for 1 hour
def load_crime_data():
    """Load crime data from CSV files with caching."""
    data_dir = Path(__file__).resolve().parents[1] / "data" / "processed"  # Look in processed folder
    
    for fname in DATA_FILES:
        f = data_dir / fname
        if f.exists():
            # Read header first to determine parse columns
            hdr = pd.read_csv(f, nrows=1)
            parse_cols = [c for c in ["datetime", "date"] if c in hdr.columns]
            
            # Load full dataset
            df = pd.read_csv(f, parse_dates=parse_cols, low_memory=False)
            return df
    
    st.warning(f"No data found in {data_dir}; using empty frame.")
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
        df["month"] = df["datetime"].dt.to_period("M").astype(str)
    
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