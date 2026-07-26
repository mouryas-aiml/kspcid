"""Backward-compatible informational callouts using the CipherWatch system."""

from __future__ import annotations

import html

import streamlit as st


def render_predictions_callout() -> None:
    """Direct users to the explicit predictive-intelligence workflow."""
    st.info(
        "Open **Predictive intelligence** to generate model outputs through an "
        "explicit action.",
        icon=":material/model_training:",
    )

def render_info_box(
    title: str,
    message: str,
    icon: str = "info",
) -> None:
    """Render a generic design-system callout."""
    symbol = "i" if icon == "info" else "◇"
    st.html(
        f"""
        <section class="cw-state" role="note">
            <span class="cw-state__icon" aria-hidden="true">{symbol}</span>
            <div>
                <h3>{html.escape(title)}</h3>
                <p>{html.escape(message)}</p>
            </div>
        </section>
        """
    )
