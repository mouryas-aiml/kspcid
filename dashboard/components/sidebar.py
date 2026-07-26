"""CipherWatch sidebar branding, navigation, legend, and system telemetry."""

from __future__ import annotations

from datetime import datetime
import html

import streamlit as st

from dashboard.styles.design_tokens import APP_NAME, APP_VERSION


NAVIGATION_ITEMS = {
    "Command center": "dashboard",
    "Crime map": "map",
    "Incident analytics": "monitoring",
    "Temporal intelligence": "schedule",
    "Geographic hotspots": "location_searching",
    "AI risk assessment": "security",
    "Predictive intelligence": "model_training",
    "Model intelligence": "query_stats",
    "System information": "info",
}


def render_dashboard_title() -> None:
    """Render compact CipherWatch branding."""
    st.html(
        """
        <section class="cw-brand" aria-label="CipherWatch">
            <div class="cw-logo" aria-hidden="true">
                <span class="cw-logo-mark"></span>
            </div>
            <div>
                <h1>CipherWatch</h1>
                <p>Crime intelligence node</p>
            </div>
        </section>
        """
    )


def render_navigation() -> str:
    """Render native, keyboard-accessible workspace navigation."""
    st.html('<div class="cw-sidebar-label">Intelligence workspaces</div>')
    selected = st.radio(
        "Primary navigation",
        list(NAVIGATION_ITEMS),
        format_func=lambda page: (
            f":material/{NAVIGATION_ITEMS[page]}: {page}"
        ),
        key="cw_navigation",
        label_visibility="collapsed",
    )
    return selected


def render_sidebar_status(
    *,
    total_records: int,
    filtered_records: int,
    model_ready: bool,
) -> None:
    """Render compact dataset, model, and session telemetry."""
    model_status = "Ready" if model_ready else "Standby"
    updated = datetime.now().astimezone().strftime("%H:%M")
    st.html(
        f"""
        <div class="cw-sidebar-label">Node telemetry</div>
        <section class="cw-system-grid" aria-label="System status">
            <div class="cw-system-cell">
                <span>Dataset</span>
                <strong><i class="cw-status-dot cw-status-dot--active"></i>Loaded</strong>
            </div>
            <div class="cw-system-cell">
                <span>Model</span>
                <strong><i class="cw-status-dot"></i>{html.escape(model_status)}</strong>
            </div>
            <div class="cw-system-cell">
                <span>Records</span>
                <strong>{filtered_records:,} / {total_records:,}</strong>
            </div>
            <div class="cw-system-cell">
                <span>Refresh</span>
                <strong>{html.escape(updated)} IST</strong>
            </div>
        </section>
        """
    )
    st.caption(f"CipherWatch UI v{APP_VERSION} · Dark operations theme")


def render_map_key() -> None:
    """Render an accessible map and risk legend."""
    st.html(
        """
        <div class="cw-sidebar-label">Map legend</div>
        <section class="cw-map-legend" aria-label="Map legend">
            <div class="cw-legend-item" style="color:#FF3B5C">
                <i class="cw-legend-mark" aria-hidden="true"></i>
                <span><strong>High risk</strong><br>Elevated model or density signal</span>
            </div>
            <div class="cw-legend-item" style="color:#FFB020">
                <i class="cw-legend-mark" aria-hidden="true"></i>
                <span><strong>Medium risk</strong><br>Moderate historical concentration</span>
            </div>
            <div class="cw-legend-item" style="color:#22C55E">
                <i class="cw-legend-mark" aria-hidden="true"></i>
                <span><strong>Low risk</strong><br>Lower relative concentration</span>
            </div>
            <div class="cw-legend-item" style="color:#22D3EE">
                <i class="cw-legend-mark cw-legend-mark--pulse" aria-hidden="true"></i>
                <span><strong>Incident marker</strong><br>Reported historical record</span>
            </div>
        </section>
        """
    )


def render_title_and_map_key() -> None:
    """Backward-compatible branding and legend renderer."""
    render_dashboard_title()
    render_map_key()
