"""Central CipherWatch stylesheet."""

from __future__ import annotations

import streamlit as st

from dashboard.styles.design_tokens import COLORS


def apply_custom_css() -> None:
    """Apply the presentation-only CipherWatch design system."""
    st.html(
        f"""
        <style>
        /* 01. Design tokens */
        :root {{
            --cw-bg: {COLORS["background"]};
            --cw-bg-2: {COLORS["background_secondary"]};
            --cw-panel: {COLORS["surface"]};
            --cw-card: {COLORS["surface_elevated"]};
            --cw-card-hover: {COLORS["surface_hover"]};
            --cw-border: {COLORS["border"]};
            --cw-border-soft: {COLORS["border_soft"]};
            --cw-cyan: {COLORS["cyan"]};
            --cw-cyan-bright: {COLORS["cyan_bright"]};
            --cw-blue: {COLORS["blue"]};
            --cw-purple: {COLORS["purple"]};
            --cw-success: {COLORS["success"]};
            --cw-warning: {COLORS["warning"]};
            --cw-critical: {COLORS["critical"]};
            --cw-risk-high: {COLORS["risk_high"]};
            --cw-risk-medium: {COLORS["risk_medium"]};
            --cw-risk-low: {COLORS["risk_low"]};
            --cw-text: {COLORS["text"]};
            --cw-text-2: {COLORS["text_secondary"]};
            --cw-muted: {COLORS["text_muted"]};
            --cw-radius: 14px;
            --cw-radius-sm: 9px;
            --cw-shadow: 0 18px 44px rgba(0, 0, 0, 0.24);
            --cw-font: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
            --cw-mono: "IBM Plex Mono", "JetBrains Mono", Consolas, monospace;
        }}

        /* 02. Typography */
        html, body, .stApp, [data-testid="stAppViewContainer"] {{
            font-family: var(--cw-font);
        }}

        h1, h2, h3, h4, h5, h6 {{
            color: var(--cw-text) !important;
            font-family: var(--cw-font) !important;
            letter-spacing: -0.015em;
            text-shadow: none !important;
        }}

        h1 {{ font-size: clamp(1.75rem, 2.8vw, 2.25rem) !important; }}
        h2 {{ font-size: clamp(1.35rem, 2vw, 1.75rem) !important; }}
        h3 {{ font-size: 1.1rem !important; }}

        p, li, label, [data-testid="stCaptionContainer"] {{
            color: var(--cw-text-2);
        }}

        code, kbd, .cw-mono, [data-testid="stMetricValue"] {{
            font-family: var(--cw-mono) !important;
        }}

        a {{
            color: var(--cw-cyan);
            text-underline-offset: 3px;
        }}

        /* 03. Page shell */
        .stApp {{
            color: var(--cw-text);
            background-color: var(--cw-bg);
            background-image:
                linear-gradient(rgba(34, 211, 238, 0.025) 1px, transparent 1px),
                linear-gradient(90deg, rgba(34, 211, 238, 0.025) 1px, transparent 1px),
                radial-gradient(circle at 82% 10%, rgba(59, 130, 246, 0.10), transparent 28%);
            background-size: 42px 42px, 42px 42px, 100% 100%;
        }}

        [data-testid="stAppViewContainer"] > .main .block-container {{
            max-width: 1680px;
            padding: 1.25rem 1.75rem 2.25rem;
        }}

        [data-testid="stHeader"] {{
            background: rgba(5, 10, 15, 0.86);
            border-bottom: 1px solid var(--cw-border-soft);
            backdrop-filter: blur(14px);
        }}

        #MainMenu, footer {{
            visibility: hidden;
        }}

        /* 04. Sidebar */
        [data-testid="stSidebar"] {{
            background: linear-gradient(180deg, #07111a 0%, #050a0f 100%);
            border-right: 1px solid var(--cw-border);
        }}

        [data-testid="stSidebarContent"] {{
            padding-top: 0.75rem;
        }}

        .cw-brand {{
            position: relative;
            display: grid;
            grid-template-columns: 46px 1fr;
            gap: 0.75rem;
            align-items: center;
            padding: 0.85rem;
            margin-bottom: 0.5rem;
            border: 1px solid var(--cw-border-soft);
            border-radius: var(--cw-radius);
            background: linear-gradient(145deg, rgba(13, 27, 39, 0.96), rgba(8, 17, 26, 0.92));
            overflow: hidden;
        }}

        .cw-brand::after {{
            content: "";
            position: absolute;
            inset: auto 0 0;
            height: 1px;
            background: linear-gradient(90deg, transparent, var(--cw-cyan), transparent);
        }}

        .cw-logo {{
            width: 44px;
            height: 44px;
            display: grid;
            place-items: center;
            border: 1px solid rgba(34, 211, 238, 0.5);
            border-radius: 12px;
            color: var(--cw-cyan-bright);
            background: rgba(34, 211, 238, 0.08);
            box-shadow: inset 0 0 18px rgba(34, 211, 238, 0.09);
        }}

        .cw-logo-mark {{
            position: relative;
            width: 24px;
            height: 28px;
            display: block;
            background: currentColor;
            clip-path: polygon(50% 0, 94% 16%, 86% 70%, 50% 100%, 14% 70%, 6% 16%);
            animation: cw-shield-breathe 3.8s ease-in-out infinite;
        }}

        .cw-logo-mark::before {{
            content: "";
            position: absolute;
            inset: 2px;
            background: var(--cw-panel);
            clip-path: inherit;
        }}

        .cw-logo-mark::after {{
            content: "";
            position: absolute;
            width: 7px;
            height: 7px;
            left: 8.5px;
            top: 8px;
            border: 1px solid var(--cw-cyan-bright);
            border-radius: 50%;
            box-shadow: 0 7px 0 -2px var(--cw-cyan-bright);
        }}

        .cw-radar-mark {{
            position: relative;
            width: 15px;
            height: 15px;
            display: inline-block;
            border: 1px solid currentColor;
            border-radius: 50%;
        }}

        .cw-radar-mark::before {{
            content: "";
            position: absolute;
            inset: 3px;
            border: 1px solid currentColor;
            border-radius: 50%;
        }}

        .cw-radar-mark::after {{
            content: "";
            position: absolute;
            width: 7px;
            height: 1px;
            left: 7px;
            top: 7px;
            background: currentColor;
            transform: rotate(-35deg);
            transform-origin: left center;
            animation: cw-radar-sweep 2.8s linear infinite;
        }}

        .cw-brand h1 {{
            margin: 0 !important;
            font-size: 1.03rem !important;
            letter-spacing: 0.01em;
        }}

        .cw-brand p {{
            margin: 0.15rem 0 0;
            font-family: var(--cw-mono);
            font-size: 0.66rem;
            letter-spacing: 0.08em;
            color: var(--cw-muted);
            text-transform: uppercase;
        }}

        .cw-sidebar-label {{
            margin: 1rem 0 0.35rem;
            color: var(--cw-muted);
            font: 600 0.68rem/1.4 var(--cw-mono);
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }}

        .st-key-cw_navigation [role="radiogroup"] {{
            gap: 0.3rem;
        }}

        .st-key-cw_navigation [role="radiogroup"] label {{
            min-height: 42px;
            padding: 0.5rem 0.65rem;
            border: 1px solid transparent;
            border-radius: 9px;
            transition: background-color 160ms ease, border-color 160ms ease;
        }}

        .st-key-cw_navigation [role="radiogroup"] label:hover {{
            background: rgba(34, 211, 238, 0.055);
            border-color: var(--cw-border-soft);
        }}

        .st-key-cw_navigation [role="radiogroup"] label:has(input:checked) {{
            color: var(--cw-cyan);
            border-color: rgba(34, 211, 238, 0.28);
            border-left: 3px solid var(--cw-cyan);
            background: linear-gradient(90deg, rgba(34, 211, 238, 0.12), rgba(34, 211, 238, 0.025));
            box-shadow: 0 0 22px rgba(34, 211, 238, 0.05);
        }}

        .cw-system-grid {{
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 0.45rem;
            margin-top: 0.55rem;
        }}

        .cw-system-cell {{
            padding: 0.55rem;
            border: 1px solid var(--cw-border-soft);
            border-radius: var(--cw-radius-sm);
            background: rgba(13, 27, 39, 0.58);
        }}

        .cw-system-cell span {{
            display: block;
            color: var(--cw-muted);
            font: 500 0.61rem/1.4 var(--cw-mono);
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }}

        .cw-system-cell strong {{
            display: flex;
            align-items: center;
            gap: 0.35rem;
            margin-top: 0.2rem;
            color: var(--cw-text);
            font-size: 0.73rem;
        }}

        /* 05. Header and hero */
        .cw-topbar {{
            position: sticky;
            top: 3.15rem;
            z-index: 20;
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            padding: 0.65rem 0.85rem;
            margin-bottom: 0.9rem;
            border: 1px solid var(--cw-border-soft);
            border-radius: 12px;
            background: rgba(8, 17, 26, 0.89);
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.18);
            backdrop-filter: blur(14px);
        }}

        .cw-breadcrumb {{
            color: var(--cw-muted);
            font: 500 0.7rem/1.4 var(--cw-mono);
            letter-spacing: 0.08em;
            text-transform: uppercase;
        }}

        .cw-breadcrumb strong {{ color: var(--cw-cyan); }}

        .cw-telemetry {{
            display: flex;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 0.5rem 1rem;
            color: var(--cw-text-2);
            font: 500 0.69rem/1.4 var(--cw-mono);
        }}

        .cw-telemetry b {{ color: var(--cw-text); font-weight: 600; }}

        .cw-hero {{
            position: relative;
            padding: clamp(1.25rem, 3vw, 2rem);
            margin-bottom: 1rem;
            border: 1px solid rgba(34, 211, 238, 0.22);
            border-radius: 18px;
            background:
                radial-gradient(circle at 86% 20%, rgba(34, 211, 238, 0.12), transparent 25%),
                linear-gradient(125deg, rgba(13, 27, 39, 0.98), rgba(8, 17, 26, 0.95));
            box-shadow: var(--cw-shadow);
            overflow: hidden;
        }}

        .cw-hero::before {{
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            width: 38%;
            height: 2px;
            background: linear-gradient(90deg, var(--cw-cyan), transparent);
        }}

        .cw-hero__eyebrow {{
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.75rem;
            color: var(--cw-cyan);
            font: 600 0.7rem/1.4 var(--cw-mono);
            letter-spacing: 0.13em;
            text-transform: uppercase;
        }}

        .cw-hero h1 {{
            max-width: 950px;
            margin: 0 !important;
            font-size: clamp(1.8rem, 3.3vw, 2.75rem) !important;
            line-height: 1.13;
        }}

        .cw-hero p {{
            max-width: 820px;
            margin: 0.75rem 0 0;
            color: var(--cw-text-2);
            font-size: 0.98rem;
            line-height: 1.65;
        }}

        .cw-page-heading {{
            margin: 0.6rem 0 1.1rem;
        }}

        .cw-page-heading h1 {{
            margin-bottom: 0.25rem !important;
        }}

        .cw-page-heading p {{
            max-width: 850px;
            margin: 0;
            color: var(--cw-text-2);
        }}

        /* 06. Cards and containers */
        [data-testid="stVerticalBlockBorderWrapper"] {{
            border-color: var(--cw-border-soft) !important;
            border-radius: var(--cw-radius) !important;
            background: linear-gradient(145deg, rgba(13, 27, 39, 0.88), rgba(8, 17, 26, 0.82));
            box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
            transition: transform 180ms ease, border-color 180ms ease, box-shadow 180ms ease;
        }}

        [data-testid="stVerticalBlockBorderWrapper"]:hover {{
            transform: translateY(-2px);
            border-color: rgba(34, 211, 238, 0.25) !important;
            box-shadow: 0 16px 34px rgba(0, 0, 0, 0.18), 0 0 24px rgba(34, 211, 238, 0.025);
        }}

        .cw-section-kicker {{
            color: var(--cw-cyan);
            font: 600 0.68rem/1.4 var(--cw-mono);
            letter-spacing: 0.12em;
            text-transform: uppercase;
        }}

        .cw-panel-title {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 1rem;
            margin-bottom: 0.7rem;
        }}

        .cw-panel-title h2, .cw-panel-title h3 {{ margin: 0 !important; }}

        /* 07. KPI components */
        [data-testid="stMetric"] {{
            min-width: 190px;
            min-height: 126px;
            padding: 1rem !important;
            border-color: var(--cw-border-soft) !important;
            border-radius: var(--cw-radius) !important;
            background: linear-gradient(145deg, rgba(13, 27, 39, 0.96), rgba(8, 17, 26, 0.92));
            box-shadow: 0 10px 24px rgba(0, 0, 0, 0.14);
            transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
        }}

        [data-testid="stMetric"]:hover {{
            border-color: rgba(34, 211, 238, 0.3) !important;
            background: var(--cw-card-hover);
            transform: translateY(-2px);
            box-shadow: 0 14px 30px rgba(0, 0, 0, 0.19), 0 0 22px rgba(34, 211, 238, 0.035);
        }}

        [data-testid="stMetricLabel"] {{
            color: var(--cw-text-2);
            font-size: 0.74rem;
            letter-spacing: 0.04em;
        }}

        [data-testid="stMetricValue"] {{
            color: var(--cw-text);
            font-size: clamp(1.55rem, 2.4vw, 2rem);
            letter-spacing: -0.04em;
            animation: cw-counter-enter 520ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
        }}

        [data-testid="stMetricDelta"] {{
            font-size: 0.72rem;
        }}

        /* 08. Forms and filters */
        [data-testid="stForm"] {{
            padding: 0.9rem;
            border-color: var(--cw-border-soft);
            border-radius: var(--cw-radius);
            background: rgba(8, 17, 26, 0.56);
        }}

        [data-baseweb="select"] > div,
        [data-baseweb="input"] > div,
        [data-testid="stDateInput"] > div > div {{
            min-height: 42px;
            color: var(--cw-text);
            border-color: var(--cw-border) !important;
            background: rgba(5, 10, 15, 0.78) !important;
        }}

        [data-baseweb="select"] > div:focus-within,
        [data-baseweb="input"] > div:focus-within {{
            border-color: var(--cw-cyan) !important;
            box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.14);
        }}

        .cw-filter-summary {{
            display: flex;
            flex-wrap: wrap;
            gap: 0.4rem;
            margin: 0.6rem 0 0.35rem;
        }}

        .cw-chip {{
            display: inline-flex;
            align-items: center;
            gap: 0.35rem;
            padding: 0.3rem 0.55rem;
            border: 1px solid rgba(34, 211, 238, 0.2);
            border-radius: 999px;
            color: var(--cw-text-2);
            background: rgba(34, 211, 238, 0.06);
            font: 500 0.66rem/1.3 var(--cw-mono);
        }}

        .cw-chip b {{ color: var(--cw-cyan); font-weight: 600; }}

        /* 09. Buttons */
        .stButton > button,
        .stDownloadButton > button,
        .stFormSubmitButton > button {{
            min-height: 42px;
            border-radius: 9px;
            border-color: var(--cw-border);
            color: var(--cw-text);
            background: var(--cw-card);
            font-weight: 650;
            box-shadow: none;
            transition: border-color 150ms ease, background-color 150ms ease, transform 150ms ease;
        }}

        .stButton > button:hover,
        .stDownloadButton > button:hover,
        .stFormSubmitButton > button:hover {{
            border-color: var(--cw-cyan);
            color: var(--cw-cyan-bright);
            background: var(--cw-card-hover);
            transform: translateY(-1px);
        }}

        button[kind^="primary"],
        .stFormSubmitButton button[kind^="primary"] {{
            border-color: rgba(34, 211, 238, 0.55) !important;
            color: #021116 !important;
            background: linear-gradient(135deg, var(--cw-cyan), #38bdf8) !important;
            box-shadow: 0 8px 24px rgba(34, 211, 238, 0.13) !important;
        }}

        button[kind^="primary"]:hover {{
            color: #021116 !important;
            filter: brightness(1.07);
        }}

        button[kind^="primary"] p,
        button[kind^="primary"] [data-testid="stMarkdownContainer"] {{
            color: #021116 !important;
        }}

        /* 10. Tabs and segmented controls */
        [data-baseweb="tab-list"] {{
            gap: 0.35rem;
            padding: 0.3rem;
            border: 1px solid var(--cw-border-soft);
            border-radius: 11px;
            background: rgba(8, 17, 26, 0.74);
        }}

        [data-baseweb="tab"] {{
            min-height: 40px;
            border-radius: 8px;
            color: var(--cw-text-2);
        }}

        [data-baseweb="tab"][aria-selected="true"] {{
            color: var(--cw-cyan);
            background: rgba(34, 211, 238, 0.09);
        }}

        [data-testid="stSegmentedControl"] [data-baseweb="button-group"] {{
            padding: 0.2rem;
            border: 1px solid var(--cw-border-soft);
            border-radius: 10px;
            background: rgba(8, 17, 26, 0.72);
        }}

        /* 11. Charts */
        [data-testid="stPlotlyChart"] {{
            overflow: hidden;
            border-radius: 10px;
        }}

        /* 12. Tables */
        [data-testid="stDataFrame"] {{
            overflow: hidden;
            border: 1px solid var(--cw-border-soft);
            border-radius: 10px;
            background: var(--cw-bg-2);
        }}

        /* 13. Maps */
        iframe[title="streamlit_folium.st_folium"] {{
            border: 1px solid var(--cw-border-soft) !important;
            border-radius: 12px;
            box-shadow: 0 16px 34px rgba(0, 0, 0, 0.22);
        }}

        .cw-map-legend {{
            display: grid;
            gap: 0.55rem;
            margin-top: 0.65rem;
        }}

        .cw-legend-item {{
            display: flex;
            gap: 0.55rem;
            align-items: flex-start;
            color: var(--cw-text-2);
            font-size: 0.76rem;
        }}

        .cw-legend-mark {{
            flex: 0 0 auto;
            width: 11px;
            height: 11px;
            margin-top: 0.25rem;
            border: 2px solid currentColor;
            border-radius: 50%;
        }}

        .cw-legend-mark--pulse {{
            animation: cw-location-pulse 2.6s ease-out infinite;
        }}

        /* 14. Alerts and status */
        [data-testid="stAlert"] {{
            border: 1px solid var(--cw-border-soft);
            border-radius: 10px;
            background: rgba(13, 27, 39, 0.8);
        }}

        .cw-status-pill {{
            display: inline-flex;
            align-items: center;
            gap: 0.42rem;
            padding: 0.32rem 0.58rem;
            border: 1px solid rgba(34, 197, 94, 0.25);
            border-radius: 999px;
            color: #86efac;
            background: rgba(34, 197, 94, 0.08);
            font: 600 0.66rem/1.2 var(--cw-mono);
            letter-spacing: 0.04em;
            text-transform: uppercase;
        }}

        .cw-status-dot {{
            width: 7px;
            height: 7px;
            border-radius: 50%;
            background: currentColor;
            box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.10);
        }}

        .cw-status-dot--active {{
            color: var(--cw-success);
            animation: cw-pulse 2.4s ease-in-out infinite;
        }}

        /* 15. Loading states */
        .cw-loading {{
            display: flex;
            gap: 0.8rem;
            align-items: center;
            padding: 0.85rem 1rem;
            border: 1px solid var(--cw-border-soft);
            border-radius: var(--cw-radius);
            background: rgba(13, 27, 39, 0.84);
        }}

        .cw-loading strong {{ color: var(--cw-text); }}
        .cw-loading p {{ margin: 0.2rem 0 0; font-size: 0.82rem; }}

        .cw-loader {{
            position: relative;
            flex: 0 0 auto;
            width: 25px;
            height: 25px;
            border: 2px solid rgba(34, 211, 238, 0.18);
            border-top-color: var(--cw-cyan);
            border-radius: 50%;
            animation: cw-loader-spin 1s linear infinite;
        }}

        .cw-loader::after {{
            content: "";
            position: absolute;
            inset: 5px;
            border: 1px solid rgba(34, 211, 238, 0.38);
            border-radius: 50%;
        }}

        @keyframes cw-pulse {{
            0%, 100% {{ opacity: 0.55; box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.08); }}
            50% {{ opacity: 1; box-shadow: 0 0 0 7px rgba(34, 197, 94, 0.02); }}
        }}

        @keyframes cw-radar-sweep {{
            from {{ transform: rotate(-35deg); }}
            to {{ transform: rotate(325deg); }}
        }}

        @keyframes cw-shield-breathe {{
            0%, 100% {{ filter: drop-shadow(0 0 2px rgba(34, 211, 238, 0.18)); opacity: 0.86; }}
            50% {{ filter: drop-shadow(0 0 7px rgba(34, 211, 238, 0.42)); opacity: 1; }}
        }}

        @keyframes cw-location-pulse {{
            0% {{ box-shadow: 0 0 0 0 currentColor; opacity: 0.95; }}
            70%, 100% {{ box-shadow: 0 0 0 8px transparent; opacity: 0.72; }}
        }}

        @keyframes cw-loader-spin {{
            to {{ transform: rotate(360deg); }}
        }}

        @keyframes cw-counter-enter {{
            from {{ opacity: 0; transform: translateY(5px); }}
            to {{ opacity: 1; transform: translateY(0); }}
        }}

        /* 16. Empty and error states */
        .cw-state {{
            display: flex;
            gap: 1rem;
            align-items: flex-start;
            padding: 1.15rem;
            border: 1px dashed var(--cw-border);
            border-radius: var(--cw-radius);
            background: rgba(8, 17, 26, 0.64);
        }}

        .cw-state__icon {{
            padding: 0.55rem;
            border-radius: 10px;
            color: var(--cw-cyan);
            background: rgba(34, 211, 238, 0.08);
        }}

        .cw-state h3 {{ margin: 0 !important; }}
        .cw-state p {{ margin: 0.3rem 0; }}
        .cw-state__action {{ color: var(--cw-muted); font-size: 0.78rem; }}
        .cw-state--error {{ border-color: rgba(239, 68, 68, 0.34); }}
        .cw-state--error .cw-state__icon {{ color: #fca5a5; background: rgba(239, 68, 68, 0.08); }}

        /* 17. Tooltips */
        [data-baseweb="tooltip"] {{
            color: var(--cw-text);
            border: 1px solid var(--cw-border);
            background: var(--cw-card);
        }}

        /* 18. Responsive breakpoints */
        @media (max-width: 900px) {{
            [data-testid="stAppViewContainer"] > .main .block-container {{
                padding: 1rem 0.9rem 1.75rem;
            }}

            .cw-topbar {{
                position: static;
                align-items: flex-start;
                flex-direction: column;
            }}

            .cw-telemetry {{ justify-content: flex-start; }}
            .cw-hero {{ padding: 1.2rem; }}
            [data-testid="stHorizontalBlock"] {{ flex-wrap: wrap; }}
        }}

        @media (max-width: 640px) {{
            .cw-telemetry {{ display: grid; grid-template-columns: 1fr 1fr; width: 100%; }}
            .cw-system-grid {{ grid-template-columns: 1fr; }}
            [data-testid="stMetric"] {{ min-width: 100%; }}
            .cw-brand {{ grid-template-columns: 40px 1fr; }}
        }}

        /* 19. Accessibility */
        :focus-visible {{
            outline: 2px solid var(--cw-cyan-bright) !important;
            outline-offset: 2px !important;
        }}

        @media (prefers-reduced-motion: reduce) {{
            *, *::before, *::after {{
                scroll-behavior: auto !important;
                animation-duration: 0.001ms !important;
                animation-iteration-count: 1 !important;
                transition-duration: 0.001ms !important;
            }}
        }}

        .cw-ethics {{
            display: flex;
            gap: 0.8rem;
            padding: 1rem;
            margin: 0.8rem 0;
            border: 1px solid rgba(139, 92, 246, 0.25);
            border-radius: var(--cw-radius);
            color: var(--cw-text-2);
            background: rgba(139, 92, 246, 0.055);
        }}

        .cw-ethics__icon {{ color: #c4b5fd; font: 700 1rem/1 var(--cw-mono); }}
        .cw-ethics strong {{ color: var(--cw-text); }}
        .cw-ethics p {{ margin: 0.3rem 0 0; line-height: 1.55; }}
        .cw-ethics--compact p {{ font-size: 0.79rem; }}

        /* 20. Print */
        @media print {{
            [data-testid="stSidebar"], [data-testid="stHeader"], button {{
                display: none !important;
            }}
            .stApp {{ background: #ffffff !important; color: #111827 !important; }}
            .block-container {{ max-width: none !important; padding: 0 !important; }}
            .cw-topbar {{ position: static; box-shadow: none; }}
        }}
        </style>
        """
    )
