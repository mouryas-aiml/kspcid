"""CipherWatch geographic intelligence components."""

from __future__ import annotations

from pathlib import Path
import html
import sys

import folium
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

# Preserve the project's existing import boundary.
project_root = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(project_root))
scripts_path = project_root / "scripts"
sys.path.append(str(scripts_path))

from geo_utils import add_clusters, add_heatmap

from config.settings import DEFAULT_ZOOM, MAX_MAP_POINTS
from dashboard.components.analytical_charts import (
    create_geographic_density_heatmap,
    create_hotspot_cluster_chart,
)
from dashboard.components.chart_containers import render_chart_panel
from dashboard.components.kpi_cards import render_area_snapshot
from dashboard.components.states import render_empty_state, render_error_state
from dashboard.styles.design_tokens import COLORS
from src.ml_models import CrimeClusterer


MAP_MODES = ["Combined", "Heatmap", "Incident clusters"]


def render_map_header() -> None:
    """Render the geographic intelligence section header."""
    st.html(
        """
        <div class="cw-panel-title">
            <div>
                <div class="cw-section-kicker">Geospatial layer</div>
                <h2>Crime map intelligence</h2>
            </div>
            <span class="cw-status-pill">
                <i class="cw-status-dot cw-status-dot--active"></i>
                Data loaded
            </span>
        </div>
        """
    )


def _valid_geo_data(df: pd.DataFrame) -> pd.DataFrame:
    if not {"latitude", "longitude"}.issubset(df.columns):
        return pd.DataFrame()
    return df.dropna(subset=["latitude", "longitude"]).copy()


def _sample_map_data(df: pd.DataFrame) -> tuple[pd.DataFrame, bool]:
    if len(df) <= MAX_MAP_POINTS:
        return df, False
    return df.sample(n=MAX_MAP_POINTS, random_state=42), True


def _base_map(df: pd.DataFrame) -> folium.Map:
    return folium.Map(
        location=[df["latitude"].median(), df["longitude"].median()],
        zoom_start=DEFAULT_ZOOM,
        tiles=None,
        prefer_canvas=True,
        control_scale=True,
    )


def _add_dark_tiles(map_object: folium.Map) -> None:
    folium.TileLayer(
        tiles=(
            "https://{s}.basemaps.cartocdn.com/dark_all/"
            "{z}/{x}/{y}{r}.png"
        ),
        attr=(
            "&copy; OpenStreetMap contributors "
            "&copy; CARTO"
        ),
        name="Dark intelligence layer",
        control=False,
        opacity=0.86,
    ).add_to(map_object)


def _build_incident_map(df: pd.DataFrame, mode: str) -> folium.Map:
    map_object = _base_map(df)
    _add_dark_tiles(map_object)

    if mode in {"Combined", "Heatmap"}:
        add_heatmap(map_object, df)
    if mode in {"Combined", "Incident clusters"}:
        tooltip_columns = [
            column
            for column in [
                "datetime",
                "crime_type",
                "neighborhood",
                "zip_code",
                "arrest_made",
            ]
            if column in df.columns
        ]
        add_clusters(map_object, df, tooltip_cols=tooltip_columns)
    return map_object


def _map_mode_form(key_prefix: str) -> str:
    state_key = f"{key_prefix}_applied_map_mode"
    st.session_state.setdefault(state_key, "Heatmap")
    with st.form(f"{key_prefix}_map_controls", border=False):
        selected_mode = st.segmented_control(
            "Map mode",
            MAP_MODES,
            default=st.session_state[state_key],
            required=True,
            key=f"{key_prefix}_map_mode_draft",
            help="Choose from the geographic layers supported by the existing map.",
            width="stretch",
        )
        submitted = st.form_submit_button(
            "Update map",
            type="primary",
            icon=":material/map:",
        )
    if submitted and selected_mode:
        st.session_state[state_key] = selected_mode
    return st.session_state[state_key]


def _render_incident_map(
    df: pd.DataFrame,
    *,
    mode: str,
    height: int,
    key: str,
) -> None:
    map_df, sampled = _sample_map_data(df)
    if sampled:
        st.caption(
            f"Showing a deterministic sample of {MAX_MAP_POINTS:,} from "
            f"{len(df):,} mapped incidents for frontend performance."
        )
    try:
        map_object = _build_incident_map(map_df, mode)
        st_folium(
            map_object,
            width=None,
            height=height,
            key=key,
            returned_objects=[],
        )
    except Exception as error:
        render_error_state(
            "Map rendering interrupted",
            "The geographic layer could not be rendered.",
            error,
            "Retry the map or choose a different set of analysis controls.",
        )


def render_map_workspace(df: pd.DataFrame, *, compact: bool = False) -> None:
    """Render map controls, geographic workspace, intelligence, and legend."""
    render_map_header()
    geo_df = _valid_geo_data(df)
    if geo_df.empty:
        render_empty_state(
            "Map data unavailable",
            "No valid latitude and longitude values match the active controls.",
            "Adjust the filters and update the analysis.",
            icon="wrong_location",
        )
        return

    mode = "Heatmap" if compact else _map_mode_form("cw_main")
    if compact:
        _render_incident_map(
            geo_df,
            mode=mode,
            height=430,
            key="cw_command_map",
        )
        return

    map_column, intel_column = st.columns([3, 1], gap="medium")
    with map_column:
        _render_incident_map(
            geo_df,
            mode=mode,
            height=610,
            key=f"cw_incident_map_{mode.lower().replace(' ', '_')}",
        )
    with intel_column:
        with st.container(border=True):
            st.subheader("Selected-area intelligence")
            render_area_snapshot(df)
        with st.container(border=True):
            st.subheader("Layer legend")
            st.markdown(
                """
                - **Heat intensity:** relative density of mapped historical records.
                - **Incident marker:** one historical record with available metadata.
                - **Marker cluster:** a display grouping that expands as the map zooms.
                - **Risk classification:** shown only in model-generated workspaces.
                """
            )

    render_chart_panel(
        "Geographic density matrix",
        (
            "Interactive longitude-latitude bin counts derived from mapped "
            "historical incident coordinates."
        ),
        create_geographic_density_heatmap(geo_df),
        caption=(
            "This density surface summarizes historical source points; it is "
            "not a risk prediction or hotspot-model output."
        ),
        key="cw_geographic_density_heatmap",
    )


def render_crime_map(df: pd.DataFrame) -> None:
    """Backward-compatible crime map renderer."""
    render_map_workspace(df, compact=True)


@st.cache_data(max_entries=4, show_spinner=False)
def _run_dbscan(df: pd.DataFrame):
    """Run the existing DBSCAN class once per filtered dataset."""
    geo_df = _valid_geo_data(df)
    clusterer = CrimeClusterer()
    labels = clusterer.fit_predict(geo_df)
    stats, cluster_count, noise_count = clusterer.get_cluster_stats(
        geo_df,
        labels,
    )
    return stats, int(cluster_count), int(noise_count)


def _cluster_color(risk_value: object) -> str:
    label = str(risk_value)
    if "Critical" in label:
        return COLORS["risk_high"]
    if "High" in label:
        return COLORS["risk_medium"]
    return COLORS["cyan"]


def _build_dbscan_map(stats: pd.DataFrame) -> folium.Map:
    map_object = folium.Map(
        location=[
            stats["center_lat"].median(),
            stats["center_lon"].median(),
        ],
        zoom_start=DEFAULT_ZOOM,
        tiles=None,
        control_scale=True,
    )
    _add_dark_tiles(map_object)
    max_count = max(float(stats["incident_count"].max()), 1.0)
    for row in stats.itertuples(index=False):
        radius = 5 + 17 * (float(row.incident_count) / max_count) ** 0.5
        color = _cluster_color(row.risk_level)
        popup = (
            f"<b>Historical cluster {int(row.cluster_id)}</b><br>"
            f"Records: {int(row.incident_count):,}<br>"
            f"Primary area: {html.escape(str(row.primary_neighborhood))}<br>"
            f"Relative class: {html.escape(str(row.risk_level))}"
        )
        folium.CircleMarker(
            location=[row.center_lat, row.center_lon],
            radius=radius,
            color=color,
            fill=True,
            fill_color=color,
            fill_opacity=0.52,
            weight=1.5,
            popup=folium.Popup(popup, max_width=300),
            tooltip=f"Cluster {int(row.cluster_id)} · {int(row.incident_count):,} records",
        ).add_to(map_object)
    return map_object


def render_hotspot_intelligence(df: pd.DataFrame) -> None:
    """Render DBSCAN outputs without changing clustering parameters or labels."""
    geo_df = _valid_geo_data(df)
    if len(geo_df) < 50:
        render_empty_state(
            "Insufficient geographic records",
            "The existing DBSCAN pipeline needs at least 50 mapped incidents for a useful view.",
            "Broaden the active filters and run the analysis again.",
            icon="location_off",
        )
        return

    try:
        with st.status(
            "Detecting historical spatial concentrations",
            expanded=False,
        ) as status:
            status.write(
                "Running the existing DBSCAN pipeline with its configured parameters."
            )
            stats, cluster_count, noise_count = _run_dbscan(geo_df)
            status.update(
                label="Geographic hotspot intelligence ready",
                state="complete",
                expanded=False,
            )
    except Exception as error:
        render_error_state(
            "Hotspot analysis unavailable",
            "The existing clustering pipeline could not complete.",
            error,
        )
        return

    if stats.empty:
        render_empty_state(
            "No historical clusters detected",
            "DBSCAN did not identify a density-based cluster for the active records.",
            "Broaden the filters or review another geographic period.",
            icon="scatter_plot",
        )
        return

    largest = stats.iloc[0]
    densest = stats.loc[stats["density_score"].idxmax()]
    with st.container(horizontal=True):
        st.metric("Historical clusters", f"{cluster_count:,}", border=True)
        st.metric("Noise records", f"{noise_count:,}", border=True)
        st.metric(
            "Largest cluster",
            f"{int(largest['incident_count']):,}",
            str(largest["primary_neighborhood"]),
            border=True,
        )
        st.metric(
            "Densest cluster",
            f"#{int(densest['cluster_id'])}",
            str(densest["primary_neighborhood"]),
            border=True,
        )

    map_column, detail_column = st.columns([3, 1], gap="medium")
    with map_column:
        st_folium(
            _build_dbscan_map(stats),
            width=None,
            height=590,
            key="cw_dbscan_map",
            returned_objects=[],
        )
    with detail_column:
        with st.container(border=True):
            st.subheader("Cluster interpretation")
            st.write(
                "DBSCAN identifies density-based geographic concentrations "
                "in historical coordinates. Circles represent cluster centers; "
                "their size reflects historical record count."
            )
            st.warning(
                "A historical cluster is not an individual incident, a forecast, "
                "or a declaration that a community is unsafe.",
                icon=":material/info:",
            )
        with st.container(border=True):
            st.subheader("Relative legend")
            st.markdown(
                """
                - **Cyan:** moderate relative concentration
                - **Amber:** high relative concentration
                - **Red:** critical relative concentration
                - **Unclustered records:** reported as DBSCAN noise
                """
            )

    render_chart_panel(
        "Hotspot cluster profile",
        (
            "Historical record volumes for the 20 largest density-based DBSCAN "
            "clusters detected under the active controls."
        ),
        create_hotspot_cluster_chart(stats),
        caption=(
            "Cluster identifiers and concentration bands come directly from "
            "the unchanged DBSCAN pipeline."
        ),
        key="cw_hotspot_cluster_profile",
    )

    st.subheader("Cluster register")
    display = stats[
        [
            "cluster_id",
            "incident_count",
            "primary_neighborhood",
            "density_score",
            "risk_level",
        ]
    ].head(50).copy()
    display.columns = [
        "Cluster ID",
        "Historical records",
        "Primary neighborhood",
        "Density score",
        "Relative concentration",
    ]
    st.dataframe(
        display,
        hide_index=True,
        width="stretch",
        column_config={
            "Cluster ID": st.column_config.NumberColumn(format="%d"),
            "Historical records": st.column_config.NumberColumn(format="%d"),
            "Density score": st.column_config.NumberColumn(format="%.2f"),
        },
        key="cw_cluster_register",
    )
    st.caption(
        f"Showing the 50 largest of {cluster_count:,} detected historical clusters."
    )
