"""Presentation-only page compositions for CipherWatch."""

from __future__ import annotations

import pandas as pd
import plotly.express as px
import streamlit as st

from dashboard.components.analytical_charts import (
    create_daily_trend_chart,
    create_day_hour_heatmap,
    create_month_year_heatmap,
    create_neighborhood_crime_heatmap,
)
from dashboard.components.chart_containers import render_chart_panel
from dashboard.components.header import render_command_hero
from dashboard.components.kpi_cards import render_kpi_grid
from dashboard.components.map_view import render_map_workspace
from dashboard.components.states import (
    render_empty_state,
    render_responsible_ai_notice,
)
from dashboard.styles.design_tokens import COLORS
from src.visualizations import (
    create_day_of_week_chart,
    create_hourly_chart,
    create_monthly_trend_chart,
    create_top_crimes_chart,
)


def _data_period(df: pd.DataFrame) -> str:
    if "datetime" not in df.columns or df["datetime"].dropna().empty:
        return "Data period unavailable"
    return (
        f"{df['datetime'].min():%d %b %Y} – "
        f"{df['datetime'].max():%d %b %Y}"
    )


def _observed_peak_hour(df: pd.DataFrame) -> int | None:
    if "hour" not in df.columns or df["hour"].dropna().empty:
        return None
    return int(df["hour"].value_counts().index[0])


def _observed_peak_day(df: pd.DataFrame) -> str | None:
    if "weekday" not in df.columns or df["weekday"].dropna().empty:
        return None
    return str(df["weekday"].value_counts().index[0])


def render_command_center(
    source_df: pd.DataFrame,
    filtered_df: pd.DataFrame,
) -> None:
    """Render the primary operational overview."""
    render_command_hero(source_df)
    render_kpi_grid(source_df, filtered_df)
    if filtered_df.empty:
        render_empty_state(
            "No incidents match the selected filters",
            "The command center has no records to analyse.",
            "Adjust the date, neighborhood, or crime category and apply filters.",
            icon="search_off",
        )
        return

    st.subheader("Operational picture")
    left, right = st.columns(2, gap="medium")
    with left:
        render_chart_panel(
            "Observed incident trend",
            "Historical monthly record volume for the active controls.",
            create_monthly_trend_chart(filtered_df),
            caption=_data_period(filtered_df),
            key="cw_command_trend",
        )
    with right:
        render_chart_panel(
            "Highest-volume crime types",
            "Top historical categories in the active records.",
            create_top_crimes_chart(filtered_df),
            caption=_data_period(filtered_df),
            key="cw_command_types",
        )

    with st.container(border=True, key="cw_command_map_panel"):
        render_map_workspace(filtered_df, compact=True)
    render_responsible_ai_notice(compact=True)


def _neighborhood_chart(df: pd.DataFrame):
    if "neighborhood" not in df.columns or df["neighborhood"].dropna().empty:
        return None
    counts = (
        df["neighborhood"]
        .value_counts()
        .head(15)
        .rename_axis("neighborhood")
        .reset_index(name="incidents")
        .sort_values("incidents")
    )
    return px.bar(
        counts,
        x="incidents",
        y="neighborhood",
        orientation="h",
        title="Historical incidents by neighborhood",
        labels={
            "incidents": "Historical incident records",
            "neighborhood": "Neighborhood",
        },
        color_discrete_sequence=[COLORS["blue"]],
    )


def _arrest_chart(df: pd.DataFrame):
    if "arrest_made" not in df.columns or df["arrest_made"].dropna().empty:
        return None
    counts = (
        df["arrest_made"]
        .fillna(False)
        .map({True: "Arrest recorded", False: "No arrest recorded"})
        .value_counts()
        .rename_axis("status")
        .reset_index(name="incidents")
    )
    return px.bar(
        counts,
        x="status",
        y="incidents",
        title="Recorded arrest status",
        labels={"status": "", "incidents": "Historical incident records"},
        color="status",
        color_discrete_map={
            "Arrest recorded": COLORS["success"],
            "No arrest recorded": COLORS["text_muted"],
        },
    )


def render_incident_analytics(df: pd.DataFrame) -> None:
    """Render incident distribution, comparison, and record exploration."""
    if df.empty:
        render_empty_state(
            "No incident analytics available",
            "No records match the active controls.",
            "Adjust the analysis controls and apply filters.",
            icon="analytics",
        )
        return

    row_one, row_two = st.columns(2, gap="medium")
    with row_one:
        render_chart_panel(
            "Incident trend",
            "Observed monthly record volume; no forecast is included.",
            create_monthly_trend_chart(df),
            caption=_data_period(df),
            key="cw_incident_trend",
        )
    with row_two:
        render_chart_panel(
            "Crime category distribution",
            "Highest-volume historical crime categories.",
            create_top_crimes_chart(df),
            caption=_data_period(df),
            key="cw_incident_categories",
        )

    row_three, row_four = st.columns(2, gap="medium")
    with row_three:
        render_chart_panel(
            "Neighborhood comparison",
            "Historical record volume by represented neighborhood.",
            _neighborhood_chart(df),
            caption=_data_period(df),
            key="cw_incident_neighborhoods",
        )
    with row_four:
        render_chart_panel(
            "Arrest status distribution",
            "Shown only when the source dataset supplies arrest status.",
            _arrest_chart(df),
            caption=_data_period(df),
            empty_message=(
                "Arrest-status data is unavailable in the active dataset."
            ),
            key="cw_incident_arrests",
        )

    render_chart_panel(
        "Neighborhood and crime-category matrix",
        (
            "Observed historical record counts across the most represented "
            "neighborhoods and crime categories."
        ),
        create_neighborhood_crime_heatmap(df),
        caption=(
            "Cell intensity represents source-record volume, not predicted risk."
        ),
        key="cw_incident_neighborhood_category_heatmap",
    )

    with st.container(border=True, key="cw_incident_table_panel"):
        st.subheader("Filtered incident register")
        st.caption(
            f"Showing the first {min(len(df), 500):,} of {len(df):,} filtered "
            "records. Sort and search within the interactive table."
        )
        display_columns = [
            column
            for column in [
                "datetime",
                "crime_type",
                "neighborhood",
                "latitude",
                "longitude",
                "arrest_made",
            ]
            if column in df.columns
        ]
        st.dataframe(
            df[display_columns].head(500),
            hide_index=True,
            width="stretch",
            height=430,
            key="cw_incident_register",
            column_config={
                "datetime": st.column_config.DatetimeColumn(
                    "Reported date and time",
                    format="DD MMM YYYY, HH:mm",
                ),
                "latitude": st.column_config.NumberColumn(format="%.5f"),
                "longitude": st.column_config.NumberColumn(format="%.5f"),
            },
        )


def render_temporal_intelligence(df: pd.DataFrame) -> None:
    """Render deterministic hourly, weekday, and monthly intelligence."""
    if df.empty:
        render_empty_state(
            "Temporal intelligence unavailable",
            "No records match the active controls.",
            "Adjust filters and apply the analysis again.",
            icon="schedule",
        )
        return

    peak_hour = _observed_peak_hour(df)
    peak_day = _observed_peak_day(df)
    with st.container(horizontal=True):
        st.metric(
            "Peak activity window",
            f"{peak_hour:02d}:00" if peak_hour is not None else "Unavailable",
            "Observed historical hour",
            border=True,
        )
        st.metric(
            "Peak recorded day",
            peak_day or "Unavailable",
            "Observed historical weekday",
            border=True,
        )
        st.metric(
            "Analysis period",
            _data_period(df),
            f"{len(df):,} records",
            border=True,
        )

    if peak_hour is not None and peak_day is not None:
        st.info(
            f"**Observed pattern:** The highest recorded hour is "
            f"**{peak_hour:02d}:00**, and **{peak_day}** has the largest "
            "historical weekday count under the active controls.",
            icon=":material/insights:",
        )

    first, second = st.columns(2, gap="medium")
    with first:
        render_chart_panel(
            "Hourly incident distribution",
            "Observed record volume across the 24-hour cycle.",
            create_hourly_chart(df),
            caption=_data_period(df),
            key="cw_temporal_hour",
        )
    with second:
        render_chart_panel(
            "Day-of-week pattern",
            "Observed record volume by weekday.",
            create_day_of_week_chart(df),
            caption=_data_period(df),
            key="cw_temporal_day",
        )

    heatmap_one, heatmap_two = st.columns(2, gap="medium")
    with heatmap_one:
        render_chart_panel(
            "Weekday and hour heatmap",
            (
                "Observed incident volume across every represented weekday "
                "and hour combination."
            ),
            create_day_hour_heatmap(df),
            caption="Darker and warmer cells indicate more historical records.",
            key="cw_temporal_day_hour_heatmap",
        )
    with heatmap_two:
        render_chart_panel(
            "Month and year heatmap",
            (
                "Observed record volume by calendar month and year. The current "
                "demonstration dataset contains one represented year."
            ),
            create_month_year_heatmap(df),
            caption="This view expands automatically when additional years exist.",
            key="cw_temporal_month_year_heatmap",
        )

    render_chart_panel(
        "Daily trend and moving average",
        (
            "Observed daily records with a seven-day moving average to reveal "
            "short-term variation without forecasting."
        ),
        create_daily_trend_chart(df),
        caption=_data_period(df),
        key="cw_temporal_daily_trend",
    )
    render_chart_panel(
        "Monthly temporal trend",
        "Observed monthly record volume across the active period.",
        create_monthly_trend_chart(df),
        caption=_data_period(df),
        key="cw_temporal_month",
    )


def render_system_information(
    source_df: pd.DataFrame,
    filtered_df: pd.DataFrame,
) -> None:
    """Render transparent dataset, capability, and system information."""
    start = (
        source_df["datetime"].min()
        if "datetime" in source_df.columns
        else None
    )
    end = (
        source_df["datetime"].max()
        if "datetime" in source_df.columns
        else None
    )
    with st.container(horizontal=True):
        st.metric("Loaded records", f"{len(source_df):,}", border=True)
        st.metric("Filtered records", f"{len(filtered_df):,}", border=True)
        st.metric(
            "Dataset start",
            f"{start:%d %b %Y}" if start is not None else "Unavailable",
            border=True,
        )
        st.metric(
            "Dataset end",
            f"{end:%d %b %Y}" if end is not None else "Unavailable",
            border=True,
        )

    dataset, models = st.columns(2, gap="medium")
    with dataset:
        with st.container(border=True):
            st.subheader("Dataset status")
            st.success("Incident dataset loaded", icon=":material/database:")
            st.write(
                "The repository currently loads the first configured file "
                "available under `data/processed/`."
            )
            st.warning(
                "The bundled demonstration data originates from the LA Open "
                "Data sample in this repository. The Karnataka State Police "
                "branding does not change that source.",
                icon=":material/data_info_alert:",
            )
            st.write("Available fields:")
            st.code(", ".join(map(str, source_df.columns)))
    with models:
        with st.container(border=True):
            st.subheader("Analytical capabilities")
            st.markdown(
                """
                - **Spatial concentration:** existing DBSCAN clusterer
                - **Risk classification:** existing Gradient Boosting classifier
                - **Crime-count estimate:** existing Gradient Boosting regressor
                - **Historical charts:** existing temporal and category functions
                - **Geographic display:** existing Folium heatmap and marker clusters
                - **Analytical matrices:** frontend-only aggregations of existing records
                - **Model diagnostics:** evaluation-only charts from unchanged outputs
                """
            )
            st.info(
                "Models run only when their workspace action is explicitly "
                "selected. No model retraining, replacement, or parameter "
                "change is performed by the frontend.",
                icon=":material/model_training:",
            )

    with st.container(border=True):
        st.subheader("Interpretation limits")
        st.markdown(
            """
            CipherWatch separates four analytical concepts:

            1. **Reported incident:** an individual historical source record.
            2. **Historical cluster:** a density-based spatial concentration.
            3. **Risk classification:** a model-generated category for grouped scenarios.
            4. **Predicted count:** a regression estimate for a represented grouped scenario.
            """
        )
    render_responsible_ai_notice()
