"""Compact CipherWatch application footer."""

from __future__ import annotations

import pandas as pd
import streamlit as st

from dashboard.styles.design_tokens import APP_VERSION


def render_footer(df: pd.DataFrame) -> None:
    """Render system status, source disclosure, and export action."""
    st.space("small")
    metadata, action = st.columns([3, 1], vertical_alignment="center")
    with metadata:
        st.caption(
            f"CipherWatch UI v{APP_VERSION} · System operational · "
            "Source: synthetic Bengaluru demonstration dataset · "
            "Human review required for all model outputs"
        )
    with action:
        st.download_button(
            "Export filtered records",
            data=df.to_csv(index=False).encode("utf-8"),
            file_name="cipherwatch_filtered_incidents.csv",
            mime="text/csv",
            icon=":material/download:",
            width="stretch",
            help="Download the currently filtered synthetic records as CSV.",
        )
