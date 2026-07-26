"""CipherWatch page header and application hero."""

from __future__ import annotations

from datetime import datetime
import html

import pandas as pd
import streamlit as st

from dashboard.styles.design_tokens import FULL_TITLE, SUBTITLE


PAGE_DESCRIPTIONS = {
    "Command center": (
        "Monitor incident patterns, geographic concentrations, operational "
        "indicators, and model-generated risk intelligence."
    ),
    "Crime map": (
        "Explore synthetic incidents, spatial clusters, police-station-area "
        "patterns, and geographic risk indicators."
    ),
    "Incident analytics": (
        "Review incident volume, category distribution, neighborhood patterns, "
        "and filtered records."
    ),
    "Temporal intelligence": (
        "Analyse hourly, daily, monthly, and seasonal incident behaviour."
    ),
    "Geographic hotspots": (
        "Inspect density-based synthetic incident concentrations detected by "
        "the existing DBSCAN pipeline."
    ),
    "AI risk assessment": (
        "Evaluate a selected time-location scenario using the existing "
        "Gradient Boosting risk model."
    ),
    "Predictive intelligence": (
        "Evaluate model-generated risk levels and estimated incident counts for "
        "selected time-location scenarios."
    ),
    "Model intelligence": (
        "Review model performance, evaluation metrics, feature importance, and "
        "comparative results."
    ),
    "System information": (
        "Review dataset coverage, analytical capabilities, system state, and "
        "responsible-use controls."
    ),
}


def _date_range(df: pd.DataFrame) -> str:
    if "datetime" not in df.columns or df["datetime"].dropna().empty:
        return "Unavailable"
    start = df["datetime"].min()
    end = df["datetime"].max()
    if start.year == end.year:
        return str(start.year)
    return f"{start.year}–{end.year}"


def render_top_header(
    page: str,
    source_df: pd.DataFrame,
    filtered_df: pd.DataFrame,
) -> None:
    """Render sticky operational telemetry and page context."""
    timestamp = st.session_state.get(
        "analysis_timestamp",
        datetime.now().astimezone(),
    )
    st.html(
        f"""
        <header class="cw-topbar" aria-label="Analysis status">
            <div class="cw-breadcrumb">
                CipherWatch / <strong>{html.escape(page)}</strong>
            </div>
            <div class="cw-telemetry">
                <span>Dataset <b>Synthetic · {html.escape(_date_range(source_df))}</b></span>
                <span>Filtered <b>{len(filtered_df):,}</b></span>
                <span>Analysed <b>{timestamp.strftime("%H:%M:%S")}</b></span>
                <span class="cw-status-pill">
                    <i class="cw-status-dot cw-status-dot--active"></i>
                    Demonstration
                </span>
            </div>
        </header>
        """
    )


def render_page_heading(page: str) -> None:
    """Render a semantic page heading and concise purpose statement."""
    st.html(
        f"""
        <section class="cw-page-heading">
            <div class="cw-section-kicker">Active workspace</div>
            <h1>{html.escape(page)}</h1>
            <p>{html.escape(PAGE_DESCRIPTIONS[page])}</p>
        </section>
        """
    )


def render_command_hero(source_df: pd.DataFrame) -> None:
    """Render the primary CipherWatch identity on the command center."""
    last_record = "Unavailable"
    if "datetime" in source_df.columns and not source_df["datetime"].dropna().empty:
        last_record = source_df["datetime"].max().strftime("%d %b %Y")
    st.html(
        f"""
        <section class="cw-hero">
            <div class="cw-hero__eyebrow">
                <span class="cw-radar-mark" aria-hidden="true"></span>
                Karnataka State Police · Intelligence operations
            </div>
            <h1>{html.escape(FULL_TITLE)}</h1>
            <p>{html.escape(SUBTITLE)}. Last synthetic event: {html.escape(last_record)}.</p>
        </section>
        """
    )
