"""KPI cards and deterministic intelligence summaries."""

from __future__ import annotations

import pandas as pd
import streamlit as st


def _top_value(df: pd.DataFrame, column: str) -> str:
    if column not in df.columns or df[column].dropna().empty:
        return "Unavailable"
    return str(df[column].value_counts().index[0])


def _arrest_rate(df: pd.DataFrame) -> str:
    if "arrest_made" not in df.columns or df["arrest_made"].dropna().empty:
        return "Unavailable"
    return f"{df['arrest_made'].fillna(False).astype(bool).mean() * 100:.1f}%"


def _filtered_delta(source_df: pd.DataFrame, filtered_df: pd.DataFrame) -> str:
    if source_df.empty:
        return "No source records"
    retained = len(filtered_df) / len(source_df) * 100
    return f"{retained:.1f}% of loaded data"


def render_kpi_grid(source_df: pd.DataFrame, filtered_df: pd.DataFrame) -> None:
    """Render a responsive command-center KPI grid."""
    neighborhoods = (
        filtered_df["neighborhood"].nunique()
        if "neighborhood" in filtered_df.columns
        else 0
    )
    with st.container(horizontal=True, gap="small"):
        st.metric(
            "Total incidents",
            f"{len(source_df):,}",
            "Synthetic data loaded",
            border=True,
            help="Total synthetic demonstration records loaded from the active dataset.",
        )
        st.metric(
            "Filtered incidents",
            f"{len(filtered_df):,}",
            _filtered_delta(source_df, filtered_df),
            border=True,
            help="Records matching the submitted analysis controls.",
        )
        st.metric(
            "Arrest rate",
            _arrest_rate(filtered_df),
            "Source dependent",
            border=True,
            help="Share of filtered records marked with an arrest, when available.",
        )
        st.metric(
            "Station areas analysed",
            f"{neighborhoods:,}",
            "Geographic coverage",
            border=True,
            help="Unique police station areas represented by the filtered records.",
        )

    with st.container(horizontal=True, gap="small"):
        st.metric(
            "Highest incident area",
            _top_value(filtered_df, "neighborhood"),
            "Synthetic concentration",
            border=True,
            help="Police station area with the largest filtered synthetic record count.",
        )
        st.metric(
            "Most frequent crime type",
            _top_value(filtered_df, "crime_type"),
            "Observed category",
            border=True,
            help="Most frequent synthetic crime category in the filtered data.",
        )
        st.metric(
            "Estimated risk level",
            "On demand",
            "Run AI risk assessment",
            border=True,
            help="Model output is generated only after an explicit assessment action.",
        )
        st.metric(
            "Model status",
            "Prediction ready",
            "Gradient Boosting",
            border=True,
            help="The existing model pipeline is available and runs only when requested.",
        )


def render_area_snapshot(df: pd.DataFrame) -> None:
    """Render a compact deterministic geographic intelligence panel."""
    if df.empty:
        st.info(
            "No records match the selected analysis controls.",
            icon=":material/search_off:",
        )
        return

    area = _top_value(df, "neighborhood")
    crime = _top_value(df, "crime_type")
    peak_hour = (
        int(df["hour"].value_counts().index[0])
        if "hour" in df.columns and not df["hour"].dropna().empty
        else None
    )
    st.markdown("**Highest recorded incident area**")
    st.metric("Area", area, border=True)
    st.markdown("**Observed intelligence**")
    st.write(f"Top recorded crime type: **{crime}**")
    st.write(
        f"Peak recorded hour: **{peak_hour:02d}:00**"
        if peak_hour is not None
        else "Peak recorded hour: **Unavailable**"
    )
    st.write(f"Filtered incident count: **{len(df):,}**")
    st.caption(
        "This panel summarizes synthetic concentrations. It is not a prediction "
        "or an individual-level safety classification."
    )
