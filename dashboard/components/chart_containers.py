"""Chart presentation helpers for the CipherWatch frontend."""

from __future__ import annotations

import streamlit as st

from dashboard.styles.design_tokens import CHART_COLORS, COLORS


def style_plotly_figure(fig, *, height: int | None = None):
    """Apply the frontend chart theme without changing chart data."""
    if fig is None:
        return None

    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor="rgba(0,0,0,0)",
        plot_bgcolor="rgba(5,10,15,0.35)",
        colorway=CHART_COLORS,
        font=dict(
            family="Inter, Segoe UI, sans-serif",
            color=COLORS["text_secondary"],
            size=12,
        ),
        title=dict(
            font=dict(
                family="Inter, Segoe UI, sans-serif",
                color=COLORS["text"],
                size=16,
            ),
            x=0,
            xanchor="left",
        ),
        hoverlabel=dict(
            bgcolor=COLORS["surface_elevated"],
            bordercolor=COLORS["border"],
            font=dict(color=COLORS["text"]),
        ),
        legend=dict(
            bgcolor="rgba(0,0,0,0)",
            font=dict(color=COLORS["text_secondary"]),
        ),
        margin=dict(t=54, r=20, b=48, l=54),
        height=height,
    )
    fig.update_xaxes(
        gridcolor="rgba(148,163,184,0.10)",
        linecolor=COLORS["border"],
        tickfont=dict(color=COLORS["text_secondary"]),
        title_font=dict(color=COLORS["text_secondary"]),
        zeroline=False,
    )
    fig.update_yaxes(
        gridcolor="rgba(148,163,184,0.10)",
        linecolor=COLORS["border"],
        tickfont=dict(color=COLORS["text_secondary"]),
        title_font=dict(color=COLORS["text_secondary"]),
        zeroline=False,
    )
    return fig


def render_chart_panel(
    title: str,
    description: str,
    fig,
    *,
    caption: str | None = None,
    empty_message: str = "Chart data is unavailable for the active filters.",
    key: str | None = None,
) -> None:
    """Render a chart within a consistent analytical panel."""
    with st.container(border=True, key=key):
        st.subheader(title)
        st.caption(description)
        if fig is None:
            st.info(empty_message, icon=":material/query_stats:")
            return
        st.plotly_chart(style_plotly_figure(fig), width="stretch")
        if caption:
            st.caption(caption)
