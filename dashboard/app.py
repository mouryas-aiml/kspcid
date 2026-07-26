"""CipherWatch Streamlit frontend.

All analytical and model implementations remain in their original backend
modules. This entry point coordinates presentation, state, and explicit actions.
"""

from __future__ import annotations

from datetime import datetime
from pathlib import Path
import sys

import streamlit as st


# Streamlit configuration must be the first UI command.
st.set_page_config(
    page_title=(
        "CipherWatch — AI Crime Intelligence & Threat Analytics "
        "for Karnataka State Police"
    ),
    page_icon=":material/shield_lock:",
    layout="wide",
    initial_sidebar_state="expanded",
)


project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from dashboard.components.filters import render_filters
from dashboard.components.footer import render_footer
from dashboard.components.header import (
    render_page_heading,
    render_top_header,
)
from dashboard.components.map_view import (
    render_hotspot_intelligence,
    render_map_workspace,
)
from dashboard.components.pages import (
    render_command_center,
    render_incident_analytics,
    render_system_information,
    render_temporal_intelligence,
)
from dashboard.components.sidebar import (
    render_dashboard_title,
    render_map_key,
    render_navigation,
    render_sidebar_status,
)
from dashboard.components.states import (
    render_error_state,
    render_loading_message,
)
from dashboard.styles.custom_css import apply_custom_css
from src.data_loader import (
    apply_filters,
    get_filter_options,
    load_crime_data,
    process_datetime_columns,
)


apply_custom_css()
st.session_state.setdefault(
    "analysis_timestamp",
    datetime.now().astimezone(),
)


with st.sidebar:
    render_dashboard_title()
    active_page = render_navigation()


loading_slot = st.empty()
try:
    with loading_slot.container():
        render_loading_message(
            "Initializing CipherWatch",
            (
                "Loading incident intelligence and preparing the command "
                "workspace. Initial loads may take longer than cached sessions."
            ),
        )
        with st.status(
            "Preparing incident intelligence",
            expanded=False,
        ) as load_status:
            load_status.write("Loading the configured synthetic Bengaluru dataset.")
            source_df = load_crime_data()
            if source_df.empty:
                load_status.update(
                    label="Dataset unavailable",
                    state="error",
                    expanded=True,
                )
                render_error_state(
                    "No incident data available",
                    "CipherWatch could not find a configured processed dataset.",
                    action=(
                        "Check the repository data/processed directory and "
                        "restart the application."
                    ),
                )
                st.stop()
            load_status.write("Preparing temporal and geographic fields.")
            source_df = process_datetime_columns(source_df)
            filter_options = get_filter_options(source_df)
            filter_options["has_arrest"] = "arrest_made" in source_df.columns
            load_status.update(
                label="Incident intelligence ready",
                state="complete",
                expanded=False,
            )
except Exception as error:
    render_error_state(
        "CipherWatch initialization failed",
        "The frontend could not prepare the configured incident dataset.",
        error,
        "Review developer diagnostics, correct the source issue, and retry.",
    )
    st.stop()

loading_slot.empty()


with st.sidebar:
    selected_filters = render_filters(filter_options)


filtered_df = apply_filters(
    source_df,
    years=selected_filters["years"],
    crime_types=selected_filters["crime_types"],
    neighborhoods=selected_filters["neighborhoods"],
    arrest_made=selected_filters["arrest_made"],
)


with st.sidebar:
    if active_page in {"Crime map", "Geographic hotspots"}:
        render_map_key()
    render_sidebar_status(
        total_records=len(source_df),
        filtered_records=len(filtered_df),
        model_ready=len(filtered_df) >= 50,
    )


if st.session_state.pop("cw_filters_just_applied", False):
    st.toast(
        f"Analysis controls applied to {len(filtered_df):,} records.",
        icon=":material/filter_alt:",
    )


render_top_header(active_page, source_df, filtered_df)

with st.container(
    horizontal=True,
    horizontal_alignment="right",
    vertical_alignment="center",
):
    if st.button(
        "Refresh data",
        icon=":material/refresh:",
        key="cw_refresh_data",
        help="Clear the source-data cache and reload the configured file.",
    ):
        load_crime_data.clear()
        st.session_state["analysis_timestamp"] = datetime.now().astimezone()
        st.rerun()
    with st.popover("Help", icon=":material/help:"):
        st.markdown(
            """
            **Using CipherWatch**

            1. Choose an intelligence workspace in the sidebar.
            2. Set analysis controls and select **Apply filters**.
            3. Run maps or model pipelines only through their explicit actions.
            4. Treat predictive output as decision support, never as certainty.
            """
        )


if active_page == "Command center":
    render_command_center(source_df, filtered_df)
else:
    render_page_heading(active_page)
    try:
        if active_page == "Crime map":
            render_map_workspace(filtered_df)
        elif active_page == "Incident analytics":
            render_incident_analytics(filtered_df)
        elif active_page == "Temporal intelligence":
            render_temporal_intelligence(filtered_df)
        elif active_page == "Geographic hotspots":
            render_hotspot_intelligence(filtered_df)
        elif active_page == "AI risk assessment":
            from dashboard.components.predictions import render_risk_assessment

            render_risk_assessment(filtered_df)
        elif active_page == "Predictive intelligence":
            from dashboard.components.predictions import (
                render_predictive_intelligence,
            )

            render_predictive_intelligence(filtered_df)
        elif active_page == "Model intelligence":
            from dashboard.components.predictions import (
                render_model_intelligence,
            )

            render_model_intelligence(filtered_df)
        elif active_page == "System information":
            render_system_information(source_df, filtered_df)
    except Exception as error:
        render_error_state(
            "Workspace rendering interrupted",
            "The selected workspace could not be rendered.",
            error,
            "Review developer diagnostics, then retry or choose another workspace.",
        )


render_footer(filtered_df)
