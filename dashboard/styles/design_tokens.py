"""CipherWatch frontend design tokens.

This module contains presentation constants only. Analytical code must not import
from it.
"""

COLORS = {
    "background": "#050A0F",
    "background_secondary": "#08111A",
    "surface": "#0B1722",
    "surface_elevated": "#0D1B27",
    "surface_hover": "#102333",
    "border": "#193446",
    "border_soft": "rgba(75, 220, 255, 0.15)",
    "cyan": "#22D3EE",
    "cyan_bright": "#00E5FF",
    "blue": "#3B82F6",
    "purple": "#8B5CF6",
    "success": "#22C55E",
    "warning": "#F59E0B",
    "critical": "#EF4444",
    "risk_high": "#FF3B5C",
    "risk_medium": "#FFB020",
    "risk_low": "#22C55E",
    "text": "#E6F1F7",
    "text_secondary": "#94A3B8",
    "text_muted": "#64748B",
}

CHART_COLORS = [
    COLORS["cyan"],
    COLORS["blue"],
    COLORS["purple"],
    COLORS["success"],
    COLORS["warning"],
    COLORS["risk_high"],
    "#14B8A6",
]

RISK_COLORS = {
    "Low": COLORS["risk_low"],
    "Lower Risk": COLORS["risk_low"],
    "Medium": COLORS["risk_medium"],
    "Moderate Risk": COLORS["risk_medium"],
    "High": COLORS["risk_high"],
    "Higher Risk": COLORS["risk_high"],
    "Critical Risk": COLORS["critical"],
}

APP_NAME = "CipherWatch"
FULL_TITLE = (
    "CipherWatch — AI Crime Intelligence & Threat Analytics "
    "for Karnataka State Police"
)
SUBTITLE = (
    "AI-Powered Crime Pattern Detection, Risk Assessment and "
    "Public Safety Intelligence"
)
APP_VERSION = "2.0.0"
