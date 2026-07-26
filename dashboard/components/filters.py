"""Form-batched CipherWatch analysis controls."""

from __future__ import annotations

from datetime import datetime
import html

import streamlit as st

from config.settings import DEFAULT_YEAR


FILTER_KEYS = {
    "years": "cw_filter_years",
    "crime_types": "cw_filter_crime_types",
    "neighborhoods": "cw_filter_neighborhoods",
    "arrest": "cw_filter_arrest",
}


def _default_years(year_options: list) -> list:
    if DEFAULT_YEAR in year_options:
        return [DEFAULT_YEAR]
    return year_options[-1:] if year_options else []


def _filters_from_widget_state() -> dict:
    arrest_label = st.session_state.get(FILTER_KEYS["arrest"], "All")
    arrest_made = {"Yes": True, "No": False}.get(arrest_label)
    return {
        "years": list(st.session_state.get(FILTER_KEYS["years"], [])),
        "crime_types": list(
            st.session_state.get(FILTER_KEYS["crime_types"], [])
        ),
        "neighborhoods": list(
            st.session_state.get(FILTER_KEYS["neighborhoods"], [])
        ),
        "arrest_made": arrest_made,
    }


def _apply_filter_state(filters: dict | None = None) -> None:
    st.session_state["cw_applied_filters"] = (
        dict(filters) if filters is not None else _filters_from_widget_state()
    )
    st.session_state["analysis_timestamp"] = datetime.now().astimezone()
    st.session_state["cw_filters_just_applied"] = True


def _queue_filter_action(action: str) -> None:
    st.session_state["cw_pending_filter_action"] = action


def _reset_filter_state(default_years: list) -> None:
    st.session_state[FILTER_KEYS["years"]] = list(default_years)
    st.session_state[FILTER_KEYS["crime_types"]] = []
    st.session_state[FILTER_KEYS["neighborhoods"]] = []
    st.session_state[FILTER_KEYS["arrest"]] = "All"
    _apply_filter_state()


def _clear_filter_state() -> None:
    st.session_state[FILTER_KEYS["years"]] = []
    st.session_state[FILTER_KEYS["crime_types"]] = []
    st.session_state[FILTER_KEYS["neighborhoods"]] = []
    st.session_state[FILTER_KEYS["arrest"]] = "All"
    _apply_filter_state()


def render_filter_header() -> None:
    """Render the Analysis controls section label."""
    st.html('<div class="cw-sidebar-label">Analysis controls</div>')


def _initialize_filter_state(filter_options: dict) -> None:
    years = _default_years(list(filter_options.get("years", [])))
    st.session_state.setdefault(FILTER_KEYS["years"], years)
    st.session_state.setdefault(FILTER_KEYS["crime_types"], [])
    st.session_state.setdefault(FILTER_KEYS["neighborhoods"], [])
    st.session_state.setdefault(FILTER_KEYS["arrest"], "All")
    st.session_state.setdefault(
        "cw_applied_filters",
        {
            "years": list(years),
            "crime_types": [],
            "neighborhoods": [],
            "arrest_made": None,
        },
    )


def _render_active_filter_chips(filters: dict) -> None:
    chips = []
    for year in filters["years"]:
        chips.append(f"<span class='cw-chip'><b>Year</b> {html.escape(str(year))} ×</span>")
    for value in filters["crime_types"][:2]:
        chips.append(
            f"<span class='cw-chip'><b>Type</b> {html.escape(str(value))} ×</span>"
        )
    if len(filters["crime_types"]) > 2:
        chips.append(
            f"<span class='cw-chip'>+{len(filters['crime_types']) - 2} crime types</span>"
        )
    for value in filters["neighborhoods"][:2]:
        chips.append(
            f"<span class='cw-chip'><b>Area</b> {html.escape(str(value))} ×</span>"
        )
    if len(filters["neighborhoods"]) > 2:
        chips.append(
            f"<span class='cw-chip'>+{len(filters['neighborhoods']) - 2} areas</span>"
        )
    if filters["arrest_made"] is not None:
        label = "Yes" if filters["arrest_made"] else "No"
        chips.append(f"<span class='cw-chip'><b>Arrest</b> {label} ×</span>")
    if not chips:
        chips.append("<span class='cw-chip'>All available records</span>")
    st.html(f"<div class='cw-filter-summary'>{''.join(chips)}</div>")


def render_filters(filter_options: dict) -> dict:
    """Render filters and return only the last explicitly submitted values."""
    render_filter_header()
    _initialize_filter_state(filter_options)

    year_options = list(filter_options.get("years", []))
    crime_types = list(filter_options.get("crime_types", []))
    neighborhoods = list(filter_options.get("neighborhoods", []))
    has_arrest = bool(filter_options.get("has_arrest", True))
    default_years = _default_years(year_options)

    pending_action = st.session_state.pop(
        "cw_pending_filter_action",
        None,
    )
    if pending_action == "reset":
        _reset_filter_state(default_years)
    elif pending_action == "clear":
        _clear_filter_state()

    with st.form("cw_analysis_controls", border=True):
        selected_years = st.multiselect(
            "Year",
            year_options,
            key=FILTER_KEYS["years"],
            help="Filter the historical incident period.",
        )
        selected_crime_types = st.multiselect(
            "Crime type",
            crime_types,
            key=FILTER_KEYS["crime_types"],
            placeholder="All crime types",
            help="Select one or more recorded crime categories.",
        )
        selected_neighborhoods = st.multiselect(
            "Neighborhood",
            neighborhoods,
            key=FILTER_KEYS["neighborhoods"],
            placeholder="All neighborhoods",
            help="Select one or more geographic areas.",
        )
        selected_arrest = st.selectbox(
            "Arrest status",
            ["All", "Yes", "No"],
            key=FILTER_KEYS["arrest"],
            disabled=not has_arrest,
            help=(
                "Filter records by arrest status."
                if has_arrest
                else "Arrest status is not available in the active dataset."
            ),
        )
        apply_clicked = st.form_submit_button(
            "Apply filters",
            type="primary",
            icon=":material/filter_alt:",
            width="stretch",
        )
        with st.container(horizontal=True, gap="small"):
            st.form_submit_button(
                "Reset",
                icon=":material/restart_alt:",
                on_click=_queue_filter_action,
                args=("reset",),
                width="stretch",
            )
            st.form_submit_button(
                "Clear all",
                icon=":material/filter_alt_off:",
                on_click=_queue_filter_action,
                args=("clear",),
                width="stretch",
            )

    if apply_clicked:
        _apply_filter_state(
            {
                "years": list(selected_years),
                "crime_types": list(selected_crime_types),
                "neighborhoods": list(selected_neighborhoods),
                "arrest_made": {
                    "Yes": True,
                    "No": False,
                }.get(selected_arrest),
            }
        )

    applied = dict(st.session_state["cw_applied_filters"])
    active_count = (
        len(applied["years"])
        + len(applied["crime_types"])
        + len(applied["neighborhoods"])
        + int(applied["arrest_made"] is not None)
    )
    st.caption(f"{active_count} active filter{'s' if active_count != 1 else ''}")
    _render_active_filter_chips(applied)
    return applied
