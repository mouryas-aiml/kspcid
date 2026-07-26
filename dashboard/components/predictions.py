"""CipherWatch prediction and model-intelligence presentation workflows."""

from __future__ import annotations

import html

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st
from sklearn.metrics import (
    f1_score,
    mean_squared_error,
    precision_score,
    recall_score,
)
from sklearn.model_selection import train_test_split

from config.settings import MIN_PREDICTION_DATA, MIN_RISK_ASSESSMENT_POINTS
from dashboard.components.analytical_charts import (
    create_confusion_matrix_heatmap,
    create_feature_correlation_heatmap,
    create_model_performance_chart,
    create_residual_distribution_chart,
    create_risk_distribution_chart,
)
from dashboard.components.chart_containers import (
    render_chart_panel,
    style_plotly_figure,
)
from dashboard.components.states import (
    render_empty_state,
    render_error_state,
    render_responsible_ai_notice,
)
from dashboard.styles.design_tokens import COLORS, RISK_COLORS
from src.ml_models import CrimeCountPredictor, TimeLocationRiskClassifier
from src.visualizations import (
    create_feature_importance_chart,
    create_high_risk_hours_chart,
)


CLASSIFICATION_FEATURES = [
    "hour",
    "weekday_encoded",
    "neighborhood_encoded",
    "is_night",
    "is_evening",
    "is_weekend",
]

REGRESSION_FEATURES = [
    "hour",
    "weekday_encoded",
    "neighborhood_encoded",
    "hour_avg",
    "neighborhood_avg",
    "is_night",
    "is_evening",
    "is_weekend",
    "is_rush_hour",
]

DAY_ORDER = [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
]


def _validate_prediction_data(df: pd.DataFrame) -> str | None:
    required = {"hour", "weekday", "neighborhood"}
    if not required.issubset(df.columns):
        return "Required time and neighborhood features are unavailable."
    if len(df) < MIN_PREDICTION_DATA:
        return (
            f"At least {MIN_PREDICTION_DATA} incidents are required for "
            "predictive intelligence."
        )
    return None


@st.cache_data(max_entries=4, show_spinner=False)
def run_risk_pipeline(df: pd.DataFrame) -> dict:
    """Execute the existing classification pipeline with its original split."""
    classifier = TimeLocationRiskClassifier()
    risk_features = classifier.prepare_features(df)
    X = risk_features[CLASSIFICATION_FEATURES]
    y = risk_features["risk"]
    if len(X) < 50 or y.nunique() < 2:
        raise ValueError(
            "At least 50 grouped scenarios and two risk categories are required."
        )

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.25,
        random_state=42,
        stratify=y,
    )
    train_accuracy, test_accuracy = classifier.train(
        X_train,
        y_train,
        X_test,
        y_test,
    )
    test_predictions = classifier.predict(X_test)
    risk_features = risk_features.copy()
    risk_features["predicted_risk"] = classifier.predict(X)
    high_risk = risk_features[
        risk_features["predicted_risk"] == "High"
    ].sort_values("incident_count", ascending=False)

    return {
        "classifier": classifier,
        "risk_features": risk_features,
        "high_risk": high_risk,
        "train_accuracy": float(train_accuracy),
        "test_accuracy": float(test_accuracy),
        "y_test": y_test,
        "test_predictions": test_predictions,
        "feature_importance": classifier.get_feature_importance(),
    }


@st.cache_data(max_entries=4, show_spinner=False)
def run_count_pipeline(df: pd.DataFrame) -> dict:
    """Execute the existing crime-count regression pipeline on demand."""
    regressor = CrimeCountPredictor()
    count_features = regressor.prepare_features(df)
    if len(count_features) < 50:
        raise ValueError(
            "At least 50 grouped scenarios are required for count prediction."
        )
    X = count_features[REGRESSION_FEATURES]
    y = count_features["incident_count"]
    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y,
        test_size=0.25,
        random_state=42,
    )
    train_r2, test_r2, train_mae, test_mae = regressor.train(
        X_train,
        y_train,
        X_test,
        y_test,
    )
    test_predictions = regressor.predict(X_test)
    count_features = count_features.copy()
    count_features["predicted_incident_count"] = regressor.predict(X)
    return {
        "regressor": regressor,
        "count_features": count_features,
        "train_r2": float(train_r2),
        "test_r2": float(test_r2),
        "train_mae": float(train_mae),
        "test_mae": float(test_mae),
        "test_rmse": float(
            mean_squared_error(y_test, test_predictions) ** 0.5
        ),
        "y_test": y_test,
        "test_predictions": test_predictions,
        "feature_importance": regressor.get_feature_importance(),
    }


def _pipeline_status(label: str):
    return st.status(
        label,
        expanded=False,
        state="running",
    )


def _risk_card(
    risk: str,
    *,
    neighborhood: str,
    weekday: str,
    hour: int,
) -> None:
    color = RISK_COLORS.get(risk, COLORS["cyan"])
    symbol = {"High": "▲", "Medium": "◆", "Low": "●"}.get(risk, "◇")
    explanation = {
        "High": "Elevated model class for the selected synthetic pattern.",
        "Medium": "Moderate model class for the selected synthetic pattern.",
        "Low": "Lower relative model class for the selected synthetic pattern.",
    }.get(risk, "Model output available for the selected scenario.")
    st.html(
        f"""
        <section class="cw-state" role="status"
                 style="border-color:{color}55;background:{color}0D">
            <span class="cw-state__icon"
                  style="color:{color};background:{color}14"
                  aria-hidden="true">{html.escape(symbol)}</span>
            <div>
                <div class="cw-section-kicker">Model-generated risk level</div>
                <h2 style="color:{color}!important">{html.escape(risk.upper())} RISK</h2>
                <p>{html.escape(explanation)}</p>
                <span class="cw-state__action">
                    {html.escape(neighborhood)} · {html.escape(weekday)} · {hour:02d}:00
                </span>
            </div>
        </section>
        """
    )


def _scenario_form(df: pd.DataFrame) -> tuple[bool, str, str, int]:
    neighborhoods = sorted(df["neighborhood"].dropna().unique().tolist())
    weekdays = [
        day for day in DAY_ORDER if day in set(df["weekday"].dropna())
    ]
    hours = sorted(int(hour) for hour in df["hour"].dropna().unique())

    with st.form("cw_risk_scenario_form", border=True):
        st.markdown("#### Prediction scenario")
        st.caption(
            "Inputs are submitted together. The model does not run while you "
            "are selecting values."
        )
        neighborhood = st.selectbox(
            "Police station area",
            neighborhoods,
            help="Choose an area represented in the synthetic dataset.",
        )
        weekday = st.selectbox(
            "Day of week",
            weekdays,
            help="Choose the day for the risk scenario.",
        )
        hour = st.selectbox(
            "Hour",
            hours,
            format_func=lambda value: f"{value:02d}:00",
            help="Choose the hour for the risk scenario.",
        )
        submitted = st.form_submit_button(
            "Execute risk assessment",
            type="primary",
            icon=":material/security:",
            width="stretch",
        )
    return submitted, neighborhood, weekday, int(hour)


def _predict_scenario(
    risk_result: dict,
    count_result: dict | None,
    *,
    neighborhood: str,
    weekday: str,
    hour: int,
) -> dict:
    classifier = risk_result["classifier"]
    scenario_features = pd.DataFrame(
        [
            {
                "hour": hour,
                "weekday_encoded": classifier.le_weekday.transform(
                    [weekday]
                )[0],
                "neighborhood_encoded": classifier.le_neighborhood.transform(
                    [neighborhood]
                )[0],
                "is_night": hour >= 20 or hour <= 5,
                "is_evening": 18 <= hour < 22,
                "is_weekend": weekday in {"Saturday", "Sunday"},
            }
        ],
        columns=CLASSIFICATION_FEATURES,
    )
    risk = str(classifier.predict(scenario_features)[0])

    observed_match = risk_result["risk_features"].query(
        "hour == @hour and weekday == @weekday and neighborhood == @neighborhood"
    )
    historical_count = (
        int(observed_match.iloc[0]["incident_count"])
        if not observed_match.empty
        else None
    )
    predicted_count = None
    if count_result is not None:
        regression_match = count_result["count_features"].query(
            "hour == @hour and weekday == @weekday and neighborhood == @neighborhood"
        )
        if not regression_match.empty:
            X = regression_match.iloc[[0]][REGRESSION_FEATURES]
            predicted_count = float(
                count_result["regressor"].predict(X)[0]
            )

    top_factors = (
        risk_result["feature_importance"]
        .head(3)["Feature"]
        .astype(str)
        .tolist()
    )
    return {
        "risk": risk,
        "neighborhood": neighborhood,
        "weekday": weekday,
        "hour": hour,
        "historical_count": historical_count,
        "predicted_count": predicted_count,
        "top_factors": top_factors,
        "test_accuracy": risk_result["test_accuracy"],
    }


def _render_scenario_result(result: dict) -> None:
    _risk_card(
        result["risk"],
        neighborhood=result["neighborhood"],
        weekday=result["weekday"],
        hour=result["hour"],
    )
    metric_one, metric_two = st.columns(2)
    metric_one.metric(
        "Synthetic baseline",
        (
            f"{result['historical_count']:,} records"
            if result["historical_count"] is not None
            else "No exact baseline"
        ),
        "Generated grouped count",
        border=True,
        help="Synthetic grouped records for the exact selected scenario.",
    )
    metric_two.metric(
        "Predicted incident count",
        (
            f"{result['predicted_count']:.1f}"
            if result["predicted_count"] is not None
            else "Not available"
        ),
        "Model-generated estimate",
        border=True,
        help=(
            "Shown only when the existing regression pipeline has an exact "
            "synthetic feature row for this scenario."
        ),
    )
    with st.container(border=True):
        st.subheader("Supporting model factors")
        st.write(
            "Top global feature influences: "
            + ", ".join(f"**{factor}**" for factor in result["top_factors"])
            + "."
        )
        st.caption(
            f"Classification test accuracy: "
            f"{result['test_accuracy'] * 100:.1f}%. This is an overall "
            "evaluation metric, not scenario-level confidence."
        )
    st.warning(
        "This output is a demonstration derived from synthetic incident "
        "patterns. It is not evidence about a real area and must not be used "
        "for operational decisions.",
        icon=":material/gavel:",
    )


def render_risk_assessment(df: pd.DataFrame) -> None:
    """Render an explicit, two-column scenario assessment workflow."""
    issue = _validate_prediction_data(df)
    if issue:
        render_empty_state(
            "Risk assessment unavailable",
            issue,
            "Broaden the analysis controls and try again.",
            icon="model_training",
        )
        return
    if len(df) < MIN_RISK_ASSESSMENT_POINTS:
        render_empty_state(
            "Insufficient records",
            f"At least {MIN_RISK_ASSESSMENT_POINTS} incidents are required.",
            "Broaden the active filters before executing an assessment.",
            icon="data_alert",
        )
        return

    form_column, result_column = st.columns([1, 1.35], gap="large")
    with form_column:
        submitted, neighborhood, weekday, hour = _scenario_form(df)
    if submitted:
        try:
            with _pipeline_status(
                "Running the existing risk-assessment pipeline"
            ) as status:
                status.write("Preparing synthetic time-location features.")
                risk_result = run_risk_pipeline(df)
                status.write("Evaluating the selected scenario.")
                try:
                    count_result = run_count_pipeline(df)
                except Exception:
                    count_result = None
                st.session_state["cw_risk_assessment_result"] = (
                    _predict_scenario(
                        risk_result,
                        count_result,
                        neighborhood=neighborhood,
                        weekday=weekday,
                        hour=hour,
                    )
                )
                status.update(
                    label="Risk assessment complete",
                    state="complete",
                    expanded=False,
                )
        except Exception as error:
            with result_column:
                render_error_state(
                    "Risk assessment interrupted",
                    "The existing model pipeline could not evaluate the scenario.",
                    error,
                )

    with result_column:
        result = st.session_state.get("cw_risk_assessment_result")
        if result:
            _render_scenario_result(result)
        else:
            render_empty_state(
                "Assessment not yet executed",
                "Choose a represented police station area, day, and hour.",
                "Select Execute risk assessment to generate a model output.",
                icon="shield_question",
            )
    render_responsible_ai_notice(compact=True)


def _render_high_risk_table(high_risk: pd.DataFrame) -> None:
    if high_risk.empty:
        st.success(
            "The model did not classify a grouped scenario as high risk for "
            "the active filters.",
            icon=":material/verified_user:",
        )
        return
    display = high_risk.head(25)[
        [
            "hour",
            "weekday",
            "neighborhood",
            "incident_count",
            "predicted_risk",
        ]
    ].copy()
    display.columns = [
        "Hour",
        "Day",
        "Neighborhood",
        "Synthetic records",
        "Model-generated risk",
    ]
    st.dataframe(
        display,
        hide_index=True,
        width="stretch",
        key="cw_high_risk_register",
        column_config={
            "Hour": st.column_config.NumberColumn(format="%02d:00"),
            "Synthetic records": st.column_config.NumberColumn(format="%d"),
        },
    )
    st.caption(
        f"Showing {min(len(high_risk), 25):,} of {len(high_risk):,} "
        "model-classified high-risk scenarios."
    )


def _render_risk_classification(result: dict) -> None:
    high_risk = result["high_risk"]
    risk_features = result["risk_features"]
    with st.container(horizontal=True):
        st.metric(
            "Training accuracy",
            f"{result['train_accuracy'] * 100:.1f}%",
            "Model evaluation",
            border=True,
        )
        st.metric(
            "Test accuracy",
            f"{result['test_accuracy'] * 100:.1f}%",
            "Held-out scenarios",
            border=True,
        )
        st.metric(
            "Grouped scenarios",
            f"{len(risk_features):,}",
            "Model input rows",
            border=True,
        )
        st.metric(
            "High-risk scenarios",
            f"{len(high_risk):,}",
            "Model-generated",
            border=True,
        )

    render_chart_panel(
        "Risk-level distribution",
        (
            "Comparison of synthetic density-derived target classes and "
            "model-generated classes for the same grouped scenarios."
        ),
        create_risk_distribution_chart(risk_features),
        caption=(
            "The synthetic class is derived from incident-count quantiles; "
            "the predicted class is the unchanged classifier output."
        ),
        key="cw_risk_distribution_panel",
    )

    st.subheader("Highest recorded model-classified scenarios")
    _render_high_risk_table(high_risk)
    if high_risk.empty:
        return

    hour_summary = (
        high_risk.groupby("hour").size().reset_index(name="high_risk_count")
    )
    hour_chart = create_high_risk_hours_chart(hour_summary)

    day_summary = (
        high_risk.groupby("weekday").size().reindex(DAY_ORDER, fill_value=0)
        .reset_index(name="high_risk_count")
    )
    day_chart = px.bar(
        day_summary,
        x="weekday",
        y="high_risk_count",
        labels={
            "weekday": "Day of week",
            "high_risk_count": "Model-classified high-risk scenarios",
        },
        title="Model-generated high-risk scenarios by day",
        color_discrete_sequence=[COLORS["purple"]],
    )

    chart_one, chart_two = st.columns(2, gap="medium")
    with chart_one:
        render_chart_panel(
            "Risk by time of day",
            "Distribution of model-classified high-risk grouped scenarios.",
            hour_chart,
            key="cw_risk_hour_panel",
        )
    with chart_two:
        render_chart_panel(
            "Risk by day of week",
            "Model-generated classifications grouped by recorded weekday.",
            day_chart,
            key="cw_risk_day_panel",
        )

    location = (
        high_risk.groupby("neighborhood")
        .agg(
            historical_records=("incident_count", "sum"),
            high_risk_scenarios=("predicted_risk", "count"),
        )
        .reset_index()
        .sort_values("historical_records", ascending=False)
        .head(15)
    )
    location_chart = px.bar(
        location.sort_values("historical_records"),
        x="historical_records",
        y="neighborhood",
        orientation="h",
        title="Synthetic records within model-classified scenarios",
        labels={
            "historical_records": "Synthetic records",
            "neighborhood": "Neighborhood",
        },
        color_discrete_sequence=[COLORS["cyan"]],
    )
    render_chart_panel(
        "Location risk intelligence",
        "Synthetic record volume within scenarios classified as high risk.",
        location_chart,
        caption=(
            "This chart combines a synthetic count with a model-generated "
            "scenario class; it does not classify a community or individual."
        ),
        key="cw_risk_location_panel",
    )


def _temporal_heatmap(high_risk: pd.DataFrame):
    if high_risk.empty:
        return None
    heatmap_data = (
        high_risk.groupby(["weekday", "hour"])
        .size()
        .reset_index(name="count")
    )
    pivot = heatmap_data.pivot(
        index="weekday",
        columns="hour",
        values="count",
    ).fillna(0)
    pivot = pivot.reindex(DAY_ORDER)
    fig = go.Figure(
        data=go.Heatmap(
            z=pivot.values,
            x=pivot.columns,
            y=pivot.index,
            colorscale=[
                [0, "#08111A"],
                [0.35, "#164E63"],
                [0.68, "#F59E0B"],
                [1, "#FF3B5C"],
            ],
            colorbar=dict(title="Model-classified<br>scenarios"),
            hovertemplate=(
                "Day: %{y}<br>Hour: %{x}:00<br>"
                "High-risk scenarios: %{z}<extra></extra>"
            ),
        )
    )
    fig.update_layout(title="Model-generated temporal risk matrix")
    return fig


def _render_count_predictions(result: dict) -> None:
    count_features = result["count_features"]
    with st.container(horizontal=True):
        st.metric(
            "Test R²",
            f"{result['test_r2']:.3f}",
            "Held-out variance explained",
            border=True,
        )
        st.metric(
            "Test MAE",
            f"{result['test_mae']:.2f}",
            "Average absolute error",
            border=True,
        )
        st.metric(
            "Test RMSE",
            f"{result['test_rmse']:.2f}",
            "Larger-error penalty",
            border=True,
        )
        st.metric(
            "Prediction rows",
            f"{len(count_features):,}",
            "Grouped scenarios",
            border=True,
        )

    display = count_features.sort_values(
        "predicted_incident_count",
        ascending=False,
    ).head(25)[
        [
            "hour",
            "weekday",
            "neighborhood",
            "incident_count",
            "predicted_incident_count",
        ]
    ].copy()
    display.columns = [
        "Hour",
        "Day",
        "Neighborhood",
        "Synthetic grouped count",
        "Predicted incident count",
    ]
    st.subheader("Predicted count register")
    st.dataframe(
        display,
        hide_index=True,
        width="stretch",
        key="cw_count_prediction_register",
        column_config={
            "Hour": st.column_config.NumberColumn(format="%02d:00"),
            "Synthetic grouped count": st.column_config.NumberColumn(
                format="%d"
            ),
            "Predicted incident count": st.column_config.NumberColumn(
                format="%.2f"
            ),
        },
    )

    comparison = px.scatter(
        count_features,
        x="incident_count",
        y="predicted_incident_count",
        color="neighborhood",
        title="Synthetic baseline vs model-generated estimate",
        labels={
            "incident_count": "Synthetic grouped count",
            "predicted_incident_count": "Predicted incident count",
            "neighborhood": "Neighborhood",
        },
        color_discrete_sequence=px.colors.qualitative.Safe,
    )
    min_value = float(
        min(
            count_features["incident_count"].min(),
            count_features["predicted_incident_count"].min(),
        )
    )
    max_value = float(
        max(
            count_features["incident_count"].max(),
            count_features["predicted_incident_count"].max(),
        )
    )
    comparison.add_shape(
        type="line",
        x0=min_value,
        y0=min_value,
        x1=max_value,
        y1=max_value,
        line=dict(color=COLORS["text_muted"], dash="dash"),
    )
    render_chart_panel(
        "Count prediction comparison",
        "Observed values and model-generated estimates are explicitly separated.",
        comparison,
        key="cw_count_comparison_panel",
    )
    render_chart_panel(
        "Held-out residual distribution",
        (
            "Distribution of observed minus predicted counts for the unchanged "
            "held-out regression split."
        ),
        create_residual_distribution_chart(
            result["y_test"],
            result["test_predictions"],
        ),
        caption=(
            "Values near zero indicate closer estimates; negative values mean "
            "the prediction exceeded the observed count."
        ),
        key="cw_count_residual_panel",
    )


def render_predictive_intelligence(df: pd.DataFrame) -> None:
    """Render lazy, explicit classification and regression intelligence."""
    issue = _validate_prediction_data(df)
    if issue:
        render_empty_state(
            "Predictive intelligence unavailable",
            issue,
            "Broaden the active analysis controls.",
            icon="model_training",
        )
        return

    view = st.segmented_control(
        "Predictive intelligence view",
        ["Risk classification", "Crime-count regression", "Temporal risk matrix"],
        default="Risk classification",
        required=True,
        key="cw_predictive_view",
        width="stretch",
    )
    action_key = {
        "Risk classification": "cw_generate_risk_intelligence",
        "Crime-count regression": "cw_generate_count_intelligence",
        "Temporal risk matrix": "cw_generate_temporal_intelligence",
    }[view]
    if st.button(
        "Generate predictive intelligence",
        type="primary",
        icon=":material/model_training:",
        key=f"{action_key}_button",
    ):
        st.session_state[action_key] = True

    if not st.session_state.get(action_key, False):
        render_empty_state(
            "Prediction not yet generated",
            "The active view runs only after an explicit action.",
            "Select Generate predictive intelligence to run the existing pipeline.",
            icon="pending_actions",
        )
        render_responsible_ai_notice(compact=True)
        return

    try:
        if view == "Crime-count regression":
            with _pipeline_status(
                "Running the existing crime-count regression pipeline"
            ) as status:
                result = run_count_pipeline(df)
                status.update(
                    label="Crime-count intelligence ready",
                    state="complete",
                    expanded=False,
                )
            _render_count_predictions(result)
        else:
            with _pipeline_status(
                "Running the existing risk-classification pipeline"
            ) as status:
                result = run_risk_pipeline(df)
                status.update(
                    label="Risk intelligence ready",
                    state="complete",
                    expanded=False,
                )
            if view == "Risk classification":
                _render_risk_classification(result)
            else:
                render_chart_panel(
                    "Combined temporal risk pattern",
                    (
                        "Day-hour matrix of model-classified high-risk grouped "
                        "scenarios."
                    ),
                    _temporal_heatmap(result["high_risk"]),
                    caption=(
                        "Synthetic records and model-generated classifications "
                        "are aggregated by time only; no individual is assessed."
                    ),
                    key="cw_temporal_risk_panel",
                )
                if not result["high_risk"].empty:
                    top = result["high_risk"].head(5)
                    st.subheader("Highest recorded model-classified combinations")
                    for row in top.itertuples(index=False):
                        st.info(
                            f"**{row.neighborhood}** · {row.weekday} · "
                            f"{int(row.hour):02d}:00 · "
                            f"{int(row.incident_count):,} synthetic records",
                            icon=":material/radar:",
                        )
    except Exception as error:
        render_error_state(
            "Predictive intelligence interrupted",
            "The selected existing model pipeline could not complete.",
            error,
        )
    render_responsible_ai_notice(compact=True)


def _render_metric_explanations() -> None:
    with st.expander(
        "Evaluation metric guide",
        icon=":material/menu_book:",
        expanded=False,
    ):
        st.markdown(
            """
            - **Accuracy:** percentage of correct risk classifications.
            - **Precision:** reliability of positive classifications.
            - **Recall:** ability to identify relevant cases.
            - **F1 score:** balance between precision and recall.
            - **R²:** proportion of variance explained by the regression model.
            - **MAE:** average absolute prediction error.
            - **RMSE:** error metric that penalizes larger errors.

            These metrics do not establish fairness, causality, certainty, or
            operational validity.
            """
        )


def render_model_intelligence(df: pd.DataFrame) -> None:
    """Render on-demand classification and regression evaluation details."""
    issue = _validate_prediction_data(df)
    if issue:
        render_empty_state(
            "Model intelligence unavailable",
            issue,
            "Broaden the active analysis controls.",
            icon="query_stats",
        )
        return

    if st.button(
        "Run model evaluation",
        type="primary",
        icon=":material/query_stats:",
        key="cw_run_model_evaluation",
    ):
        st.session_state["cw_model_evaluation_ready"] = True

    if not st.session_state.get("cw_model_evaluation_ready", False):
        render_empty_state(
            "Model evaluation not yet run",
            "Evaluation metrics are generated only after an explicit action.",
            "Select Run model evaluation to use the existing model pipelines.",
            icon="analytics",
        )
        _render_metric_explanations()
        return

    try:
        with _pipeline_status("Evaluating existing model pipelines") as status:
            risk = run_risk_pipeline(df)
            count = run_count_pipeline(df)
            status.update(
                label="Model intelligence ready",
                state="complete",
                expanded=False,
            )
    except Exception as error:
        render_error_state(
            "Model evaluation interrupted",
            "The existing model pipelines could not complete evaluation.",
            error,
        )
        return

    render_chart_panel(
        "Train and held-out performance",
        (
            "Task-specific train/test scores for the active classifier and "
            "regressor. Accuracy and R² describe different tasks and are not "
            "a cross-model ranking."
        ),
        create_model_performance_chart(risk, count),
        key="cw_model_performance_overview",
    )

    weighted_precision = precision_score(
        risk["y_test"],
        risk["test_predictions"],
        average="weighted",
        zero_division=0,
    )
    weighted_recall = recall_score(
        risk["y_test"],
        risk["test_predictions"],
        average="weighted",
        zero_division=0,
    )
    weighted_f1 = f1_score(
        risk["y_test"],
        risk["test_predictions"],
        average="weighted",
        zero_division=0,
    )

    st.subheader("Gradient Boosting risk classifier")
    with st.container(horizontal=True):
        st.metric(
            "Test accuracy",
            f"{risk['test_accuracy'] * 100:.1f}%",
            "Held-out data",
            border=True,
        )
        st.metric(
            "Weighted precision",
            f"{weighted_precision * 100:.1f}%",
            "Held-out data",
            border=True,
        )
        st.metric(
            "Weighted recall",
            f"{weighted_recall * 100:.1f}%",
            "Held-out data",
            border=True,
        )
        st.metric(
            "Weighted F1",
            f"{weighted_f1 * 100:.1f}%",
            "Held-out data",
            border=True,
        )

    risk_importance = create_feature_importance_chart(
        risk["feature_importance"],
        "Gradient Boosting classifier feature importance",
    )
    render_chart_panel(
        "Risk model feature importance",
        "Global feature influence reported by the existing classifier.",
        risk_importance,
        key="cw_risk_feature_importance",
    )
    render_chart_panel(
        "Risk-classification confusion matrix",
        (
            "Actual synthetic density-derived classes versus model "
            "predictions on the held-out evaluation split."
        ),
        create_confusion_matrix_heatmap(
            risk["y_test"],
            risk["test_predictions"],
        ),
        caption=(
            "Diagonal cells are correct classifications; off-diagonal cells "
            "show class confusion."
        ),
        key="cw_risk_confusion_matrix",
    )

    st.subheader("Gradient Boosting crime-count regressor")
    with st.container(horizontal=True):
        st.metric(
            "Test R²",
            f"{count['test_r2']:.3f}",
            "Held-out data",
            border=True,
        )
        st.metric(
            "Test MAE",
            f"{count['test_mae']:.2f}",
            "Average absolute error",
            border=True,
        )
        st.metric(
            "Test RMSE",
            f"{count['test_rmse']:.2f}",
            "Penalizes larger errors",
            border=True,
        )
        st.metric(
            "Training R²",
            f"{count['train_r2']:.3f}",
            "Training data",
            border=True,
        )

    count_importance = create_feature_importance_chart(
        count["feature_importance"],
        "Gradient Boosting regressor feature importance",
    )
    render_chart_panel(
        "Count model feature importance",
        "Global feature influence reported by the existing regressor.",
        count_importance,
        key="cw_count_feature_importance",
    )
    diagnostic_one, diagnostic_two = st.columns(2, gap="medium")
    with diagnostic_one:
        render_chart_panel(
            "Regression feature correlation",
            (
                "Pearson correlations across the existing engineered input "
                "features and observed grouped count."
            ),
            create_feature_correlation_heatmap(count["count_features"]),
            caption=(
                "Correlation is descriptive and does not establish causation."
            ),
            key="cw_regression_feature_correlation",
        )
    with diagnostic_two:
        render_chart_panel(
            "Regression residuals",
            (
                "Observed minus predicted counts for the unchanged held-out "
                "evaluation split."
            ),
            create_residual_distribution_chart(
                count["y_test"],
                count["test_predictions"],
            ),
            caption=(
                "The dashed zero line represents exact agreement."
            ),
            key="cw_model_residual_distribution",
        )
    _render_metric_explanations()
    render_responsible_ai_notice(compact=True)


def render_ml_predictions(fdf: pd.DataFrame) -> None:
    """Backward-compatible entry point for predictive intelligence."""
    render_predictive_intelligence(fdf)


def render_ml_risk_assessment(fdf: pd.DataFrame) -> None:
    """Backward-compatible entry point for risk assessment."""
    render_risk_assessment(fdf)
