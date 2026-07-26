"""Visualization creation functions."""
import plotly.express as px
from config.settings import ACCENT_COLOR


def neonize(fig):
    """Apply cyberpunk blue theme to Plotly figures."""
    fig.update_layout(
        template="plotly_dark",
        paper_bgcolor="rgba(10,14,39,0.8)",
        plot_bgcolor="rgba(10,20,40,0.6)",
        margin=dict(t=40, r=20, b=30, l=20),
        font=dict(family="'Courier New', monospace", color=ACCENT_COLOR, size=11),
        hoverlabel=dict(bgcolor="rgba(0,20,40,.95)", font=dict(color=ACCENT_COLOR)),
        title=dict(font=dict(color=ACCENT_COLOR, size=16)),
        xaxis=dict(gridcolor="rgba(0,136,204,0.2)", color="#66b3ff", linecolor="#0088cc"),
        yaxis=dict(gridcolor="rgba(0,136,204,0.2)", color="#66b3ff", linecolor="#0088cc"),
    )
    fig.update_traces(marker=dict(color=ACCENT_COLOR, line=dict(color="#0088cc", width=1)))
    return fig


def create_hourly_chart(df):
    """Create crime by hour bar chart."""
    if "hour" not in df.columns:
        return None
    
    hour_counts = df.groupby("hour").size().reset_index(name="incidents").sort_values("hour")
    fig = px.bar(hour_counts, x="hour", y="incidents", title="Incidents by Hour")
    fig = neonize(fig)
    fig.update_xaxes(title="Hour")
    fig.update_yaxes(title="Incidents", separatethousands=True)
    return fig


def create_day_of_week_chart(df):
    """Create crime by day of week bar chart."""
    if "weekday" not in df.columns:
        return None
    
    order = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
    dow_counts = df.groupby("weekday").size().reindex(order).fillna(0).reset_index(name="incidents")
    fig = px.bar(dow_counts, x="weekday", y="incidents", title="Incidents by Day of Week")
    fig = neonize(fig)
    fig.update_xaxes(title="")
    fig.update_yaxes(title="Incidents", separatethousands=True)
    return fig


def create_monthly_trend_chart(df):
    """Create monthly trend line chart."""
    if "month" not in df.columns:
        return None
    
    monthly = df.groupby("month").size().reset_index(name="incidents").sort_values("month")
    fig = px.line(monthly, x="month", y="incidents", markers=True, title="Incidents per Month")
    fig = neonize(fig)
    fig.update_xaxes(title="")
    fig.update_yaxes(title="Incidents", separatethousands=True)
    return fig


def create_top_crimes_chart(df):
    """Create top 10 crime types horizontal bar chart."""
    if "crime_type" not in df.columns:
        return None
    
    top10 = df.groupby("crime_type").size().sort_values(ascending=False).head(10).reset_index(name="incidents")
    fig = px.bar(top10, x="incidents", y="crime_type", orientation="h", title="Top 10 Crime Types")
    fig = neonize(fig)
    fig.update_layout(xaxis_title="Incidents", yaxis_title="")
    return fig


def create_cluster_chart(cluster_df):
    """Create DBSCAN cluster visualization."""
    fig = px.bar(
        cluster_df.head(10),
        x="cluster_id",
        y="incident_count",
        color="risk_level",
        title="Top ML-Detected Crime Hotspot Clusters",
        labels={"cluster_id": "Cluster ID", "incident_count": "Incidents"},
        color_discrete_map={"🟡 Moderate": "#ffaa00", "🟠 High": "#ff6b00", "🔴 Critical": "#ff3333"}
    )
    return neonize(fig)


def create_feature_importance_chart(feature_importance_df, title="Feature Importance"):
    """Create feature importance bar chart."""
    fig = px.bar(
        feature_importance_df,
        x="Importance",
        y="Feature",
        orientation="h",
        title=title
    )
    return neonize(fig)


def create_risk_by_hour_chart(hourly_risk_df):
    """Create risk by hour chart with color coding."""
    fig = px.bar(
        hourly_risk_df,
        x="hour",
        y="incidents",
        color="risk_level",
        title="Crime Risk by Hour",
        color_discrete_map={"Low": ACCENT_COLOR, "Medium": "#ffaa00", "High": "#ff3333"}
    )
    return neonize(fig)


def create_risk_by_day_chart(daily_risk_df):
    """Create risk by day chart with color coding."""
    fig = px.bar(
        daily_risk_df,
        x="weekday",
        y="incidents",
        color="risk_level",
        title="Crime Risk by Day",
        color_discrete_map={"Low": ACCENT_COLOR, "Medium": "#ffaa00", "High": "#ff3333"}
    )
    fig = neonize(fig)
    fig.update_xaxes(tickangle=45)
    return fig


def create_high_risk_hours_chart(high_risk_hours_df):
    """Create high-risk hours bar chart."""
    fig = px.bar(
        high_risk_hours_df,
        x="hour",
        y="high_risk_count",
        title="Number of High-Risk Scenarios by Hour"
    )
    fig = neonize(fig)
    fig.update_traces(marker_color="#ff3333")
    return fig