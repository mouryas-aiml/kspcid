"""
Model Comparison Script - Find the Best ML Model for Crime Prediction
Run this to test multiple models and see which performs best on YOUR data.

Usage:
    python scripts/model_comparison.py
"""

import pandas as pd
import numpy as np
from pathlib import Path
import sys
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, mean_absolute_error, r2_score
from sklearn.preprocessing import LabelEncoder
import warnings
warnings.filterwarnings('ignore')

# Add project root to path
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

# Import data loader
from src.data_loader import load_crime_data, process_datetime_columns

print("=" * 80)
print("🔬 CRIME PREDICTION MODEL COMPARISON")
print("=" * 80)

# Load data
print("\n📊 Loading data...")
df = load_crime_data()
df = process_datetime_columns(df)
print(f"✅ Loaded {len(df):,} incidents")

# Prepare data
print("\n🔧 Preparing features...")
ml_data = df.dropna(subset=["hour", "weekday", "neighborhood"]).copy()
crime_counts = ml_data.groupby(["hour", "weekday", "neighborhood"]).size().reset_index(name="incident_count")

# Encode features
le_weekday = LabelEncoder()
le_neighborhood = LabelEncoder()
crime_counts["weekday_encoded"] = le_weekday.fit_transform(crime_counts["weekday"])
crime_counts["neighborhood_encoded"] = le_neighborhood.fit_transform(crime_counts["neighborhood"])
crime_counts["is_night"] = ((crime_counts["hour"] >= 20) | (crime_counts["hour"] <= 5)).astype(int)
crime_counts["is_evening"] = ((crime_counts["hour"] >= 18) & (crime_counts["hour"] < 22)).astype(int)
crime_counts["is_weekend"] = crime_counts["weekday"].isin(["Saturday", "Sunday"]).astype(int)
crime_counts["is_rush_hour"] = crime_counts["hour"].isin([7, 8, 9, 17, 18, 19]).astype(int)

print(f"✅ Created {len(crime_counts)} time-location scenarios")

# ============================================================================
# TEST 1: CLASSIFICATION MODELS (Predict Risk Level: High/Medium/Low)
# ============================================================================

print("\n" + "=" * 80)
print("TEST 1: CLASSIFICATION MODELS (Risk Level Prediction)")
print("=" * 80)

# Create risk categories
crime_counts["risk"] = pd.cut(
    crime_counts["incident_count"],
    bins=[0, crime_counts["incident_count"].quantile(0.60), 
          crime_counts["incident_count"].quantile(0.85), 
          crime_counts["incident_count"].max()],
    labels=["Low", "Medium", "High"]
)

X_class = crime_counts[["hour", "weekday_encoded", "neighborhood_encoded", 
                         "is_night", "is_evening", "is_weekend", "is_rush_hour"]]
y_class = crime_counts["risk"]

X_train_c, X_test_c, y_train_c, y_test_c = train_test_split(X_class, y_class, test_size=0.25, random_state=42, stratify=y_class)

classification_models = {
    "Random Forest": None,
    "Gradient Boosting": None,
    "XGBoost": None,
    "LightGBM": None,
    "Logistic Regression": None,
    "SVM": None,
    "Decision Tree": None,
    "KNN": None
}

classification_results = []

# Random Forest
try:
    from sklearn.ensemble import RandomForestClassifier
    model = RandomForestClassifier(n_estimators=100, max_depth=8, random_state=42, n_jobs=-1)
    model.fit(X_train_c, y_train_c)
    y_pred = model.predict(X_test_c)
    classification_results.append({
        "Model": "Random Forest",
        "Train Acc": f"{model.score(X_train_c, y_train_c):.3f}",
        "Test Acc": f"{accuracy_score(y_test_c, y_pred):.3f}",
        "Precision": f"{precision_score(y_test_c, y_pred, average='weighted'):.3f}",
        "Recall": f"{recall_score(y_test_c, y_pred, average='weighted'):.3f}",
        "F1": f"{f1_score(y_test_c, y_pred, average='weighted'):.3f}"
    })
    print("✅ Random Forest")
except Exception as e:
    print(f"❌ Random Forest: {e}")

# Gradient Boosting
try:
    from sklearn.ensemble import GradientBoostingClassifier
    model = GradientBoostingClassifier(n_estimators=100, learning_rate=0.1, max_depth=4, random_state=42)
    model.fit(X_train_c, y_train_c)
    y_pred = model.predict(X_test_c)
    classification_results.append({
        "Model": "Gradient Boosting",
        "Train Acc": f"{model.score(X_train_c, y_train_c):.3f}",
        "Test Acc": f"{accuracy_score(y_test_c, y_pred):.3f}",
        "Precision": f"{precision_score(y_test_c, y_pred, average='weighted'):.3f}",
        "Recall": f"{recall_score(y_test_c, y_pred, average='weighted'):.3f}",
        "F1": f"{f1_score(y_test_c, y_pred, average='weighted'):.3f}"
    })
    print("✅ Gradient Boosting")
except Exception as e:
    print(f"❌ Gradient Boosting: {e}")

# XGBoost
try:
    from xgboost import XGBClassifier
    model = XGBClassifier(n_estimators=100, learning_rate=0.1, max_depth=4, random_state=42, eval_metric='mlogloss')
    model.fit(X_train_c, y_train_c)
    y_pred = model.predict(X_test_c)
    classification_results.append({
        "Model": "XGBoost",
        "Train Acc": f"{model.score(X_train_c, y_train_c):.3f}",
        "Test Acc": f"{accuracy_score(y_test_c, y_pred):.3f}",
        "Precision": f"{precision_score(y_test_c, y_pred, average='weighted'):.3f}",
        "Recall": f"{recall_score(y_test_c, y_pred, average='weighted'):.3f}",
        "F1": f"{f1_score(y_test_c, y_pred, average='weighted'):.3f}"
    })
    print("✅ XGBoost")
except Exception as e:
    print(f"⚠️  XGBoost not installed (pip install xgboost)")

# LightGBM
try:
    from lightgbm import LGBMClassifier
    model = LGBMClassifier(n_estimators=100, learning_rate=0.1, max_depth=4, random_state=42, verbose=-1)
    model.fit(X_train_c, y_train_c)
    y_pred = model.predict(X_test_c)
    classification_results.append({
        "Model": "LightGBM",
        "Train Acc": f"{model.score(X_train_c, y_train_c):.3f}",
        "Test Acc": f"{accuracy_score(y_test_c, y_pred):.3f}",
        "Precision": f"{precision_score(y_test_c, y_pred, average='weighted'):.3f}",
        "Recall": f"{recall_score(y_test_c, y_pred, average='weighted'):.3f}",
        "F1": f"{f1_score(y_test_c, y_pred, average='weighted'):.3f}"
    })
    print("✅ LightGBM")
except Exception as e:
    print(f"⚠️  LightGBM not installed (pip install lightgbm)")

# Logistic Regression
try:
    from sklearn.linear_model import LogisticRegression
    model = LogisticRegression(max_iter=1000, random_state=42)
    model.fit(X_train_c, y_train_c)
    y_pred = model.predict(X_test_c)
    classification_results.append({
        "Model": "Logistic Regression",
        "Train Acc": f"{model.score(X_train_c, y_train_c):.3f}",
        "Test Acc": f"{accuracy_score(y_test_c, y_pred):.3f}",
        "Precision": f"{precision_score(y_test_c, y_pred, average='weighted'):.3f}",
        "Recall": f"{recall_score(y_test_c, y_pred, average='weighted'):.3f}",
        "F1": f"{f1_score(y_test_c, y_pred, average='weighted'):.3f}"
    })
    print("✅ Logistic Regression")
except Exception as e:
    print(f"❌ Logistic Regression: {e}")

# Decision Tree
try:
    from sklearn.tree import DecisionTreeClassifier
    model = DecisionTreeClassifier(max_depth=8, random_state=42)
    model.fit(X_train_c, y_train_c)
    y_pred = model.predict(X_test_c)
    classification_results.append({
        "Model": "Decision Tree",
        "Train Acc": f"{model.score(X_train_c, y_train_c):.3f}",
        "Test Acc": f"{accuracy_score(y_test_c, y_pred):.3f}",
        "Precision": f"{precision_score(y_test_c, y_pred, average='weighted'):.3f}",
        "Recall": f"{recall_score(y_test_c, y_pred, average='weighted'):.3f}",
        "F1": f"{f1_score(y_test_c, y_pred, average='weighted'):.3f}"
    })
    print("✅ Decision Tree")
except Exception as e:
    print(f"❌ Decision Tree: {e}")

# Display Classification Results
print("\n📊 CLASSIFICATION RESULTS:")
print("-" * 100)
results_df = pd.DataFrame(classification_results)
print(results_df.to_string(index=False))

# Find best model
best_idx = results_df['Test Acc'].astype(float).idxmax()
best_model = results_df.iloc[best_idx]['Model']
print(f"\n🏆 BEST CLASSIFICATION MODEL: {best_model} (Test Acc: {results_df.iloc[best_idx]['Test Acc']})")

# ============================================================================
# TEST 2: REGRESSION MODELS (Predict Actual Crime Count)
# ============================================================================

print("\n" + "=" * 80)
print("TEST 2: REGRESSION MODELS (Crime Count Prediction)")
print("=" * 80)

X_reg = crime_counts[["hour", "weekday_encoded", "neighborhood_encoded", 
                       "is_night", "is_evening", "is_weekend", "is_rush_hour"]]
y_reg = crime_counts["incident_count"]

X_train_r, X_test_r, y_train_r, y_test_r = train_test_split(X_reg, y_reg, test_size=0.25, random_state=42)

regression_results = []

# Random Forest Regressor
try:
    from sklearn.ensemble import RandomForestRegressor
    model = RandomForestRegressor(n_estimators=100, max_depth=8, random_state=42, n_jobs=-1)
    model.fit(X_train_r, y_train_r)
    y_pred = model.predict(X_test_r)
    regression_results.append({
        "Model": "Random Forest",
        "Train R²": f"{model.score(X_train_r, y_train_r):.3f}",
        "Test R²": f"{r2_score(y_test_r, y_pred):.3f}",
        "MAE": f"{mean_absolute_error(y_test_r, y_pred):.2f}",
        "RMSE": f"{np.sqrt(np.mean((y_test_r - y_pred)**2)):.2f}"
    })
    print("✅ Random Forest Regressor")
except Exception as e:
    print(f"❌ Random Forest: {e}")

# Gradient Boosting Regressor
try:
    from sklearn.ensemble import GradientBoostingRegressor
    model = GradientBoostingRegressor(n_estimators=100, learning_rate=0.1, max_depth=4, random_state=42)
    model.fit(X_train_r, y_train_r)
    y_pred = model.predict(X_test_r)
    regression_results.append({
        "Model": "Gradient Boosting",
        "Train R²": f"{model.score(X_train_r, y_train_r):.3f}",
        "Test R²": f"{r2_score(y_test_r, y_pred):.3f}",
        "MAE": f"{mean_absolute_error(y_test_r, y_pred):.2f}",
        "RMSE": f"{np.sqrt(np.mean((y_test_r - y_pred)**2)):.2f}"
    })
    print("✅ Gradient Boosting Regressor")
except Exception as e:
    print(f"❌ Gradient Boosting: {e}")

# XGBoost Regressor
try:
    from xgboost import XGBRegressor
    model = XGBRegressor(n_estimators=100, learning_rate=0.1, max_depth=4, random_state=42)
    model.fit(X_train_r, y_train_r)
    y_pred = model.predict(X_test_r)
    regression_results.append({
        "Model": "XGBoost",
        "Train R²": f"{model.score(X_train_r, y_train_r):.3f}",
        "Test R²": f"{r2_score(y_test_r, y_pred):.3f}",
        "MAE": f"{mean_absolute_error(y_test_r, y_pred):.2f}",
        "RMSE": f"{np.sqrt(np.mean((y_test_r - y_pred)**2)):.2f}"
    })
    print("✅ XGBoost Regressor")
except Exception as e:
    print(f"⚠️  XGBoost not installed")

# LightGBM Regressor
try:
    from lightgbm import LGBMRegressor
    model = LGBMRegressor(n_estimators=100, learning_rate=0.1, max_depth=4, random_state=42, verbose=-1)
    model.fit(X_train_r, y_train_r)
    y_pred = model.predict(X_test_r)
    regression_results.append({
        "Model": "LightGBM",
        "Train R²": f"{model.score(X_train_r, y_train_r):.3f}",
        "Test R²": f"{r2_score(y_test_r, y_pred):.3f}",
        "MAE": f"{mean_absolute_error(y_test_r, y_pred):.2f}",
        "RMSE": f"{np.sqrt(np.mean((y_test_r - y_pred)**2)):.2f}"
    })
    print("✅ LightGBM Regressor")
except Exception as e:
    print(f"⚠️  LightGBM not installed")

# Linear Regression
try:
    from sklearn.linear_model import LinearRegression
    model = LinearRegression()
    model.fit(X_train_r, y_train_r)
    y_pred = model.predict(X_test_r)
    regression_results.append({
        "Model": "Linear Regression",
        "Train R²": f"{model.score(X_train_r, y_train_r):.3f}",
        "Test R²": f"{r2_score(y_test_r, y_pred):.3f}",
        "MAE": f"{mean_absolute_error(y_test_r, y_pred):.2f}",
        "RMSE": f"{np.sqrt(np.mean((y_test_r - y_pred)**2)):.2f}"
    })
    print("✅ Linear Regression")
except Exception as e:
    print(f"❌ Linear Regression: {e}")

# Decision Tree Regressor
try:
    from sklearn.tree import DecisionTreeRegressor
    model = DecisionTreeRegressor(max_depth=8, random_state=42)
    model.fit(X_train_r, y_train_r)
    y_pred = model.predict(X_test_r)
    regression_results.append({
        "Model": "Decision Tree",
        "Train R²": f"{model.score(X_train_r, y_train_r):.3f}",
        "Test R²": f"{r2_score(y_test_r, y_pred):.3f}",
        "MAE": f"{mean_absolute_error(y_test_r, y_pred):.2f}",
        "RMSE": f"{np.sqrt(np.mean((y_test_r - y_pred)**2)):.2f}"
    })
    print("✅ Decision Tree Regressor")
except Exception as e:
    print(f"❌ Decision Tree: {e}")

# Display Regression Results
print("\n📊 REGRESSION RESULTS:")
print("-" * 100)
results_df_reg = pd.DataFrame(regression_results)
print(results_df_reg.to_string(index=False))

# Find best model
best_idx_reg = results_df_reg['Test R²'].astype(float).idxmax()
best_model_reg = results_df_reg.iloc[best_idx_reg]['Model']
print(f"\n🏆 BEST REGRESSION MODEL: {best_model_reg} (Test R²: {results_df_reg.iloc[best_idx_reg]['Test R²']}, MAE: {results_df_reg.iloc[best_idx_reg]['MAE']})")

# ============================================================================
# FINAL RECOMMENDATIONS
# ============================================================================

print("\n" + "=" * 80)
print("📋 FINAL RECOMMENDATIONS")
print("=" * 80)

print(f"""
🎯 FOR RISK CLASSIFICATION (High/Medium/Low):
   Best Model: {best_model}
   Test Accuracy: {results_df.iloc[best_idx]['Test Acc']}
   F1 Score: {results_df.iloc[best_idx]['F1']}
   
   ✅ Use this for: Dashboard risk warnings, color-coded maps
   
🎯 FOR CRIME COUNT PREDICTION (Actual Numbers):
   Best Model: {best_model_reg}
   Test R² Score: {results_df_reg.iloc[best_idx_reg]['Test R²']}
   MAE: {results_df_reg.iloc[best_idx_reg]['MAE']} crimes
   
   ✅ Use this for: Resource allocation, staffing predictions
   
💡 RECOMMENDATION:
   - Implement BOTH models in your dashboard
   - Use classification for quick risk assessments
   - Use regression for detailed planning
   - Current models are {'OPTIMAL' if best_model == 'Gradient Boosting' and best_model_reg == 'Gradient Boosting' else 'GOOD but could be better'}
""")

print("\n✅ Model comparison complete!")
print("=" * 80)