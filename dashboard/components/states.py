"""Reusable CipherWatch loading, empty, warning, and error states."""

from __future__ import annotations

import html
import traceback

import streamlit as st


STATE_SYMBOLS = {
    "search_off": "⌕",
    "wrong_location": "⌖",
    "location_off": "⌖",
    "scatter_plot": "∷",
    "model_training": "◇",
    "data_alert": "!",
    "shield_question": "?",
    "pending_actions": "◷",
    "analytics": "∿",
    "schedule": "◷",
    "query_stats": "∿",
}


def render_empty_state(
    title: str,
    message: str,
    action: str,
    icon: str = "search_off",
) -> None:
    """Render an accessible empty-state panel."""
    symbol = STATE_SYMBOLS.get(icon, "◇")
    st.html(
        f"""
        <section class="cw-state cw-state--empty" role="status">
            <span class="cw-state__icon" aria-hidden="true">{html.escape(symbol)}</span>
            <div>
                <h3>{html.escape(title)}</h3>
                <p>{html.escape(message)}</p>
                <span class="cw-state__action">{html.escape(action)}</span>
            </div>
        </section>
        """
    )


def render_error_state(
    title: str,
    message: str,
    error: Exception | None = None,
    action: str = "Retry the operation or adjust the active controls.",
) -> None:
    """Render a user-safe error with optional developer details."""
    st.html(
        f"""
        <section class="cw-state cw-state--error" role="alert">
            <span class="cw-state__icon" aria-hidden="true">!</span>
            <div>
                <h3>{html.escape(title)}</h3>
                <p>{html.escape(message)}</p>
                <span class="cw-state__action">{html.escape(action)}</span>
            </div>
        </section>
        """
    )
    if error is not None:
        with st.expander(
            "Developer diagnostics",
            icon=":material/bug_report:",
            expanded=False,
        ):
            st.code(
                "".join(
                    traceback.format_exception(
                        type(error),
                        error,
                        error.__traceback__,
                    )
                )
            )


def render_responsible_ai_notice(compact: bool = False) -> None:
    """Render the responsible-use disclosure required for predictive views."""
    message = (
        "CipherWatch provides analytical estimates based on historical "
        "reported-crime data. Predictions may reflect reporting patterns, data "
        "quality limitations, demographic bias, geographic imbalance, and "
        "historical enforcement practices. Results must be reviewed by qualified "
        "human decision-makers and must not be used as the sole basis for "
        "enforcement or individual-level decisions."
    )
    class_name = "cw-ethics cw-ethics--compact" if compact else "cw-ethics"
    st.html(
        f"""
        <aside class="{class_name}" role="note" aria-label="Responsible AI notice">
            <span class="cw-ethics__icon" aria-hidden="true">◈</span>
            <div>
                <strong>Responsible-use protocol</strong>
                <p>{html.escape(message)}</p>
            </div>
        </aside>
        """
    )


def render_loading_message(stage: str, detail: str) -> None:
    """Render branded progress copy without fabricating a percentage."""
    st.html(
        f"""
        <section class="cw-loading" role="status" aria-live="polite">
            <span class="cw-loader" aria-hidden="true"></span>
            <div>
                <strong>{html.escape(stage)}</strong>
                <p>{html.escape(detail)}</p>
            </div>
        </section>
        """
    )
