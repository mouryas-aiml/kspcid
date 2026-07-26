"""Frontend-only analytical charts built from existing CipherWatch data.

The helpers in this module aggregate already-loaded incident records or
already-generated model outputs. They do not alter preprocessing, features,
estimators, parameters, predictions, or stored data.
"""

from __future__ import annotations

import calendar

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from sklearn.metrics import confusion_matrix

from dashboard.styles.design_tokens import COLORS


DAY_ORDER = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]

HEATMAP_SCALE = [
    [0.0, "#050A0F"],
    [0.18, "#0B2534"],
    [0.42, "#0E7490"],
    [0.68, "#22D3EE"],
    [0.84, "#F59E0B"],
    [1.0, "#FF3B5C"],
]


def create_geographic_density_heatmap(df: pd.DataFrame):
    """Create an interactive longitude/latitude density grid."""
    required = {"latitude", "longitude"}
    if not required.issubset(df.columns):
        return None
    geo = df.dropna(subset=list(required))
    if geo.empty:
        return None
    fig = go.Figure(
        go.Histogram2d(
            x=geo["longitude"],
            y=geo["latitude"],
            nbinsx=42,
            nbinsy=42,
            colorscale=HEATMAP_SCALE,
            colorbar=dict(title="Synthetic<br>records"),
            hovertemplate=(
                "Longitude bin: %{x}<br>Latitude bin: %{y}<br>"
                "Synthetic records: %{z}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Geographic incident-density grid")
    fig.update_xaxes(title="Longitude")
    fig.update_yaxes(title="Latitude", scaleanchor="x", scaleratio=1)
    return fig


def create_day_hour_heatmap(df: pd.DataFrame):
    """Create an observed weekday-by-hour incident matrix."""
    required = {"weekday", "hour"}
    if not required.issubset(df.columns):
        return None
    observed = df.dropna(subset=list(required))
    if observed.empty:
        return None
    matrix = (
        observed.groupby(["weekday", "hour"])
        .size()
        .unstack(fill_value=0)
        .reindex(index=DAY_ORDER, columns=range(24), fill_value=0)
    )
    fig = go.Figure(
        go.Heatmap(
            z=matrix.values,
            x=matrix.columns,
            y=matrix.index,
            colorscale=HEATMAP_SCALE,
            colorbar=dict(title="Synthetic<br>records"),
            hovertemplate=(
                "Day: %{y}<br>Hour: %{x}:00<br>"
                "Synthetic records: %{z}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Observed activity by weekday and hour")
    fig.update_xaxes(title="Hour of day", dtick=2)
    fig.update_yaxes(title="")
    return fig


def create_month_year_heatmap(df: pd.DataFrame):
    """Create a month-by-year matrix from observed record timestamps."""
    if "datetime" not in df.columns or df["datetime"].dropna().empty:
        return None
    dated = df.dropna(subset=["datetime"]).copy()
    dated["analysis_year"] = dated["datetime"].dt.year
    dated["analysis_month"] = dated["datetime"].dt.month
    matrix = (
        dated.groupby(["analysis_year", "analysis_month"])
        .size()
        .unstack(fill_value=0)
        .reindex(columns=range(1, 13), fill_value=0)
    )
    fig = go.Figure(
        go.Heatmap(
            z=matrix.values,
            x=[calendar.month_abbr[month] for month in matrix.columns],
            y=[str(year) for year in matrix.index],
            colorscale=HEATMAP_SCALE,
            colorbar=dict(title="Synthetic<br>records"),
            hovertemplate=(
                "Month: %{x}<br>Year: %{y}<br>"
                "Synthetic records: %{z}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Observed month-by-year volume matrix")
    fig.update_xaxes(title="Month")
    fig.update_yaxes(title="Year", type="category")
    return fig


def create_neighborhood_crime_heatmap(
    df: pd.DataFrame,
    *,
    max_neighborhoods: int = 12,
    max_categories: int = 12,
):
    """Create an observed neighborhood-by-crime-category matrix."""
    required = {"neighborhood", "crime_type"}
    if not required.issubset(df.columns):
        return None
    observed = df.dropna(subset=list(required))
    if observed.empty:
        return None
    neighborhoods = (
        observed["neighborhood"].value_counts().head(max_neighborhoods).index
    )
    categories = observed["crime_type"].value_counts().head(max_categories).index
    subset = observed[
        observed["neighborhood"].isin(neighborhoods)
        & observed["crime_type"].isin(categories)
    ]
    matrix = pd.crosstab(
        subset["neighborhood"],
        subset["crime_type"],
    ).reindex(index=neighborhoods, columns=categories, fill_value=0)
    fig = go.Figure(
        go.Heatmap(
            z=matrix.values,
            x=matrix.columns,
            y=matrix.index,
            colorscale=HEATMAP_SCALE,
            colorbar=dict(title="Synthetic<br>records"),
            hovertemplate=(
                "Neighborhood: %{y}<br>Crime category: %{x}<br>"
                "Synthetic records: %{z}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Observed neighborhood and category concentration")
    fig.update_xaxes(title="Crime category", tickangle=-35)
    fig.update_yaxes(title="Neighborhood")
    return fig


def create_daily_trend_chart(df: pd.DataFrame):
    """Create observed daily counts with a seven-day moving average."""
    if "datetime" not in df.columns or df["datetime"].dropna().empty:
        return None
    daily = (
        df.dropna(subset=["datetime"])
        .assign(analysis_date=lambda frame: frame["datetime"].dt.floor("D"))
        .groupby("analysis_date")
        .size()
        .rename("Synthetic records")
        .asfreq("D", fill_value=0)
        .reset_index()
    )
    daily["7-day moving average"] = (
        daily["Synthetic records"].rolling(7, min_periods=1).mean()
    )
    fig = go.Figure()
    fig.add_trace(
        go.Bar(
            x=daily["analysis_date"],
            y=daily["Synthetic records"],
            name="Observed daily records",
            marker_color="rgba(59,130,246,0.40)",
            hovertemplate=(
                "Date: %{x|%d %b %Y}<br>"
                "Synthetic records: %{y}<extra></extra>"
            ),
        )
    )
    fig.add_trace(
        go.Scatter(
            x=daily["analysis_date"],
            y=daily["7-day moving average"],
            name="7-day moving average",
            mode="lines",
            line=dict(color=COLORS["cyan"], width=2.5),
            hovertemplate=(
                "Date: %{x|%d %b %Y}<br>"
                "7-day average: %{y:.1f}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Observed daily incident trend", barmode="overlay")
    fig.update_xaxes(title="Date")
    fig.update_yaxes(title="Synthetic records")
    return fig


def create_hotspot_cluster_chart(stats: pd.DataFrame):
    """Create an observed DBSCAN cluster-volume profile."""
    required = {"cluster_id", "incident_count", "risk_level"}
    if stats.empty or not required.issubset(stats.columns):
        return None
    top = stats.nlargest(20, "incident_count").sort_values("incident_count")
    top = top.copy()
    top["cluster_label"] = top["cluster_id"].map(
        lambda value: f"Cluster {int(value)}"
    )
    top["relative_concentration"] = top["risk_level"].astype(str)
    color_map = {
        label: (
            COLORS["risk_high"]
            if "Critical" in label
            else COLORS["warning"]
            if "High" in label
            else COLORS["cyan"]
        )
        for label in top["relative_concentration"].unique()
    }
    return px.bar(
        top,
        x="incident_count",
        y="cluster_label",
        orientation="h",
        color="relative_concentration",
        title="Largest DBSCAN synthetic clusters",
        labels={
            "incident_count": "Synthetic records",
            "cluster_label": "",
            "relative_concentration": "Relative concentration",
        },
        color_discrete_map=color_map,
        hover_data={
            "primary_neighborhood": True,
            "density_score": ":.2f",
            "cluster_id": False,
        },
    )


def create_risk_distribution_chart(risk_features: pd.DataFrame):
    """Compare density-derived target classes with model classifications."""
    required = {"risk", "predicted_risk"}
    if risk_features.empty or not required.issubset(risk_features.columns):
        return None
    distribution = (
        risk_features[["risk", "predicted_risk"]]
        .rename(
            columns={
                "risk": "Synthetic density-derived class",
                "predicted_risk": "Model-predicted class",
            }
        )
        .melt(var_name="series", value_name="risk_level")
        .groupby(["series", "risk_level"], observed=True)
        .size()
        .reset_index(name="scenarios")
    )
    return px.bar(
        distribution,
        x="risk_level",
        y="scenarios",
        color="series",
        barmode="group",
        category_orders={"risk_level": ["Low", "Medium", "High"]},
        title="Risk-level distribution",
        labels={
            "risk_level": "Risk level",
            "scenarios": "Grouped scenarios",
            "series": "",
        },
        color_discrete_map={
            "Synthetic density-derived class": COLORS["blue"],
            "Model-predicted class": COLORS["purple"],
        },
    )


def create_confusion_matrix_heatmap(y_true, y_pred):
    """Create a held-out classification confusion matrix."""
    labels = ["Low", "Medium", "High"]
    matrix = confusion_matrix(y_true, y_pred, labels=labels)
    annotation = np.asarray(
        [[str(int(value)) for value in row] for row in matrix]
    )
    fig = go.Figure(
        go.Heatmap(
            z=matrix,
            x=labels,
            y=labels,
            text=annotation,
            texttemplate="%{text}",
            colorscale=HEATMAP_SCALE,
            colorbar=dict(title="Held-out<br>scenarios"),
            hovertemplate=(
                "Actual class: %{y}<br>Predicted class: %{x}<br>"
                "Held-out scenarios: %{z}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Held-out risk-classification confusion matrix")
    fig.update_xaxes(title="Model-predicted class")
    fig.update_yaxes(title="Actual density-derived class", autorange="reversed")
    return fig


def create_feature_correlation_heatmap(count_features: pd.DataFrame):
    """Create a correlation matrix from existing regression feature rows."""
    columns = [
        "hour",
        "weekday_encoded",
        "neighborhood_encoded",
        "hour_avg",
        "neighborhood_avg",
        "is_night",
        "is_evening",
        "is_weekend",
        "is_rush_hour",
        "incident_count",
    ]
    available = [column for column in columns if column in count_features.columns]
    if len(available) < 2:
        return None
    labels = {
        "hour": "Hour",
        "weekday_encoded": "Weekday",
        "neighborhood_encoded": "Neighborhood",
        "hour_avg": "Hour average",
        "neighborhood_avg": "Neighborhood average",
        "is_night": "Night",
        "is_evening": "Evening",
        "is_weekend": "Weekend",
        "is_rush_hour": "Rush hour",
        "incident_count": "Observed count",
    }
    correlation = count_features[available].corr().rename(
        index=labels,
        columns=labels,
    )
    fig = go.Figure(
        go.Heatmap(
            z=correlation.values,
            x=correlation.columns,
            y=correlation.index,
            zmin=-1,
            zmax=1,
            colorscale=[
                [0.0, "#3B82F6"],
                [0.5, "#08111A"],
                [1.0, "#FF3B5C"],
            ],
            colorbar=dict(title="Pearson<br>correlation"),
            hovertemplate=(
                "%{y} vs %{x}<br>Correlation: %{z:.3f}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Existing regression-feature correlation matrix")
    fig.update_xaxes(tickangle=-35)
    return fig


def create_residual_distribution_chart(y_true, y_pred):
    """Create a held-out regression residual distribution."""
    residuals = np.asarray(y_true, dtype=float) - np.asarray(y_pred, dtype=float)
    residual_frame = pd.DataFrame(
        {"residual": residuals, "type": "Observed minus predicted"}
    )
    fig = px.histogram(
        residual_frame,
        x="residual",
        nbins=18,
        title="Held-out count-prediction residuals",
        labels={"residual": "Residual (observed minus predicted)"},
        color_discrete_sequence=[COLORS["cyan"]],
    )
    fig.add_vline(
        x=0,
        line_dash="dash",
        line_color=COLORS["text_muted"],
        annotation_text="No error",
    )
    return fig


def create_model_performance_chart(risk: dict, count: dict):
    """Show train/test scores for the two active, task-specific models."""
    fig = make_subplots(
        rows=1,
        cols=2,
        subplot_titles=(
            "Risk classifier accuracy",
            "Crime-count regressor R²",
        ),
    )
    score_colors = [COLORS["blue"], COLORS["cyan"]]
    fig.add_trace(
        go.Bar(
            x=["Training", "Held-out test"],
            y=[risk["train_accuracy"], risk["test_accuracy"]],
            marker_color=score_colors,
            name="Accuracy",
            text=[
                f"{risk['train_accuracy']:.3f}",
                f"{risk['test_accuracy']:.3f}",
            ],
            textposition="outside",
            hovertemplate="%{x}<br>Accuracy: %{y:.3f}<extra></extra>",
        ),
        row=1,
        col=1,
    )
    fig.add_trace(
        go.Bar(
            x=["Training", "Held-out test"],
            y=[count["train_r2"], count["test_r2"]],
            marker_color=score_colors,
            name="R²",
            text=[f"{count['train_r2']:.3f}", f"{count['test_r2']:.3f}"],
            textposition="outside",
            hovertemplate="%{x}<br>R²: %{y:.3f}<extra></extra>",
        ),
        row=1,
        col=2,
    )
    fig.update_layout(
        title="Task-specific model performance overview",
        showlegend=False,
    )
    fig.update_yaxes(range=[0, 1.08], row=1, col=1)
    fig.update_yaxes(range=[0, 1.08], row=1, col=2)
    return fig
