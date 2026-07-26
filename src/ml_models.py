"""Machine Learning models for crime prediction."""
import pandas as pd
import streamlit as st
import sys
from pathlib import Path

# Add project root to path
project_root = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(project_root))

from config.settings import (
    DBSCAN_EPS, DBSCAN_MIN_SAMPLES,
    RANDOM_FOREST_ESTIMATORS, RANDOM_FOREST_MAX_DEPTH,
    GRADIENT_BOOST_ESTIMATORS, GRADIENT_BOOST_LEARNING_RATE, GRADIENT_BOOST_MAX_DEPTH
)


class CrimeClusterer:
    """DBSCAN clustering for spatial hotspot detection."""
    
    def __init__(self, eps=DBSCAN_EPS, min_samples=DBSCAN_MIN_SAMPLES):
        self.eps = eps
        self.min_samples = min_samples
        self.model = None
        self.scaler = None
    
    def fit_predict(self, df):
        """Fit DBSCAN and return cluster assignments."""
        try:
            from sklearn.cluster import DBSCAN
            from sklearn.preprocessing import StandardScaler
            
            coords = df[["latitude", "longitude"]].values
            self.scaler = StandardScaler()
            coords_scaled = self.scaler.fit_transform(coords)
            
            self.model = DBSCAN(eps=self.eps, min_samples=self.min_samples)
            return self.model.fit_predict(coords_scaled)
        
        except ImportError:
            raise ImportError("scikit-learn is required for clustering. Install with: pip install scikit-learn")
    
    def get_cluster_stats(self, df, clusters):
        """Calculate statistics for each cluster."""
        df_copy = df.copy()
        df_copy["cluster"] = clusters
        
        n_clusters = len(set(clusters)) - (1 if -1 in clusters else 0)
        n_noise = list(clusters).count(-1)
        
        cluster_stats = []
        for cluster_id in range(n_clusters):
            cluster_data = df_copy[df_copy["cluster"] == cluster_id]
            
            top_neighborhood = "Unknown"
            if "neighborhood" in cluster_data.columns and len(cluster_data) > 0:
                mode_values = cluster_data["neighborhood"].mode()
                if len(mode_values) > 0:
                    top_neighborhood = mode_values[0]
            
            cluster_stats.append({
                "cluster_id": cluster_id,
                "incident_count": len(cluster_data),
                "center_lat": cluster_data["latitude"].mean(),
                "center_lon": cluster_data["longitude"].mean(),
                "primary_neighborhood": top_neighborhood,
                "density_score": len(cluster_data) / (
                    cluster_data["latitude"].std() + cluster_data["longitude"].std() + 0.001
                )
            })
        
        cluster_df = pd.DataFrame(cluster_stats).sort_values("incident_count", ascending=False)
        
        # Add risk levels
        cluster_df["risk_level"] = pd.cut(
            cluster_df["incident_count"],
            bins=[0, cluster_df["incident_count"].quantile(0.33), 
                  cluster_df["incident_count"].quantile(0.67), 
                  cluster_df["incident_count"].max()],
            labels=["🟡 Moderate", "🟠 High", "🔴 Critical"]
        )
        
        return cluster_df, n_clusters, n_noise


class NeighborhoodRiskPredictor:
    """Random Forest for neighborhood risk classification."""
    
    def __init__(self, n_estimators=RANDOM_FOREST_ESTIMATORS, max_depth=RANDOM_FOREST_MAX_DEPTH):
        self.n_estimators = n_estimators
        self.max_depth = max_depth
        self.model = None
        self.accuracy = None
    
    def prepare_features(self, df):
        """Engineer features for neighborhood risk prediction."""
        neighborhood_data = df.dropna(subset=["neighborhood"]).copy()
        
        # Feature engineering
        neighborhood_data["hour"] = neighborhood_data["datetime"].dt.hour
        neighborhood_data["day_of_week"] = neighborhood_data["datetime"].dt.dayofweek
        neighborhood_data["month"] = neighborhood_data["datetime"].dt.month
        
        # Aggregate by neighborhood
        neighborhood_risk = neighborhood_data.groupby("neighborhood").agg({
            "hour": "mean",
            "day_of_week": "mean",
            "month": "mean"
        }).reset_index()
        
        # Add incident counts
        incident_counts = neighborhood_data.groupby("neighborhood").size().reset_index(name="total_incidents")
        neighborhood_risk = neighborhood_risk.merge(incident_counts, on="neighborhood")
        
        # Create risk categories
        neighborhood_risk["risk_category"] = pd.cut(
            neighborhood_risk["total_incidents"],
            bins=[0, neighborhood_risk["total_incidents"].quantile(0.50), 
                  neighborhood_risk["total_incidents"].quantile(0.80), 
                  neighborhood_risk["total_incidents"].max()],
            labels=[0, 1, 2]
        )
        
        return neighborhood_risk
    
    def train(self, X_train, y_train, X_test, y_test):
        """Train the Random Forest model."""
        try:
            from sklearn.ensemble import RandomForestClassifier
            
            self.model = RandomForestClassifier(
                n_estimators=self.n_estimators,
                max_depth=self.max_depth,
                random_state=42
            )
            self.model.fit(X_train, y_train)
            self.accuracy = self.model.score(X_test, y_test)
            return self.accuracy
        
        except ImportError:
            raise ImportError("scikit-learn is required. Install with: pip install scikit-learn")
    
    def predict(self, X):
        """Make predictions."""
        if self.model is None:
            raise ValueError("Model must be trained before making predictions")
        return self.model.predict(X)
    
    def get_feature_importance(self):
        """Return feature importance DataFrame."""
        if self.model is None:
            raise ValueError("Model must be trained first")
        
        return pd.DataFrame({
            "Feature": ["Hour of Day", "Day of Week", "Month", "Total Incidents"],
            "Importance": self.model.feature_importances_
        }).sort_values("Importance", ascending=False)


class TimeLocationRiskClassifier:
    """Gradient Boosting for time-location risk prediction."""
    
    def __init__(self, n_estimators=GRADIENT_BOOST_ESTIMATORS, 
                 learning_rate=GRADIENT_BOOST_LEARNING_RATE, 
                 max_depth=GRADIENT_BOOST_MAX_DEPTH):
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.model = None
        self.train_accuracy = None
        self.test_accuracy = None
        self.le_weekday = None
        self.le_neighborhood = None
    
    def prepare_features(self, df):
        """Prepare features for risk classification."""
        try:
            from sklearn.preprocessing import LabelEncoder
            
            ml_data = df.dropna(subset=["hour", "weekday", "neighborhood"]).copy()
            
            # Group and count
            risk_features = ml_data.groupby(["hour", "weekday", "neighborhood"]).size().reset_index(name="incident_count")
            
            # Create risk categories FIRST
            risk_features["risk"] = pd.cut(
                risk_features["incident_count"],
                bins=[0, risk_features["incident_count"].quantile(0.60), 
                      risk_features["incident_count"].quantile(0.85), 
                      risk_features["incident_count"].max()],
                labels=["Low", "Medium", "High"]
            )
            
            # Encode categorical variables
            self.le_weekday = LabelEncoder()
            self.le_neighborhood = LabelEncoder()
            
            risk_features["weekday_encoded"] = self.le_weekday.fit_transform(risk_features["weekday"])
            risk_features["neighborhood_encoded"] = self.le_neighborhood.fit_transform(risk_features["neighborhood"])
            
            # FIXED: Don't use incident_count as a feature since risk is derived from it
            # Instead, add time-based features
            risk_features["is_night"] = (risk_features["hour"] >= 20) | (risk_features["hour"] <= 5)
            risk_features["is_evening"] = (risk_features["hour"] >= 18) & (risk_features["hour"] < 22)
            risk_features["is_weekend"] = risk_features["weekday"].isin(["Saturday", "Sunday"])
            
            return risk_features
        
        except ImportError:
            raise ImportError("scikit-learn is required. Install with: pip install scikit-learn")
    
    def train(self, X_train, y_train, X_test, y_test):
        """Train the Gradient Boosting model."""
        try:
            from sklearn.ensemble import GradientBoostingClassifier
            
            self.model = GradientBoostingClassifier(
                n_estimators=self.n_estimators,
                learning_rate=self.learning_rate,
                max_depth=self.max_depth,
                random_state=42
            )
            self.model.fit(X_train, y_train)
            self.train_accuracy = self.model.score(X_train, y_train)
            self.test_accuracy = self.model.score(X_test, y_test)
            return self.train_accuracy, self.test_accuracy
        
        except ImportError:
            raise ImportError("scikit-learn is required. Install with: pip install scikit-learn")
    
    def predict(self, X):
        """Make predictions."""
        if self.model is None:
            raise ValueError("Model must be trained before making predictions")
        return self.model.predict(X)
    
    def get_feature_importance(self):
        """Return feature importance DataFrame."""
        if self.model is None:
            raise ValueError("Model must be trained first")
        
        return pd.DataFrame({
            "Feature": ["Hour of Day", "Day of Week", "Neighborhood", "Is Night", "Is Evening", "Is Weekend"],
            "Importance": self.model.feature_importances_
        }).sort_values("Importance", ascending=False)


class CrimeCountPredictor:
    """Gradient Boosting Regressor for predicting actual crime counts."""
    
    def __init__(self, n_estimators=100, learning_rate=0.1, max_depth=4):
        self.n_estimators = n_estimators
        self.learning_rate = learning_rate
        self.max_depth = max_depth
        self.model = None
        self.train_score = None
        self.test_score = None
        self.train_mae = None
        self.test_mae = None
        self.le_weekday = None
        self.le_neighborhood = None
    
    def prepare_features(self, df):
        """Prepare features for crime count prediction."""
        try:
            from sklearn.preprocessing import LabelEncoder
            
            ml_data = df.dropna(subset=["hour", "weekday", "neighborhood"]).copy()
            
            # Group and count incidents
            crime_counts = ml_data.groupby(["hour", "weekday", "neighborhood"]).size().reset_index(name="incident_count")
            
            # Calculate historical averages by time and location
            hourly_avg = ml_data.groupby("hour").size().mean()
            neighborhood_avg = ml_data.groupby("neighborhood").size().mean()
            
            # Add historical context features
            crime_counts["hour_avg"] = crime_counts["hour"].map(
                ml_data.groupby("hour").size().to_dict()
            ) / len(crime_counts["hour"].unique())
            
            crime_counts["neighborhood_avg"] = crime_counts["neighborhood"].map(
                ml_data.groupby("neighborhood").size().to_dict()
            ) / len(crime_counts["neighborhood"].unique())
            
            # Encode categorical variables
            self.le_weekday = LabelEncoder()
            self.le_neighborhood = LabelEncoder()
            
            crime_counts["weekday_encoded"] = self.le_weekday.fit_transform(crime_counts["weekday"])
            crime_counts["neighborhood_encoded"] = self.le_neighborhood.fit_transform(crime_counts["neighborhood"])
            
            # Time-based features
            crime_counts["is_night"] = ((crime_counts["hour"] >= 20) | (crime_counts["hour"] <= 5)).astype(int)
            crime_counts["is_evening"] = ((crime_counts["hour"] >= 18) & (crime_counts["hour"] < 22)).astype(int)
            crime_counts["is_weekend"] = crime_counts["weekday"].isin(["Saturday", "Sunday"]).astype(int)
            crime_counts["is_rush_hour"] = crime_counts["hour"].isin([7, 8, 9, 17, 18, 19]).astype(int)
            
            return crime_counts
        
        except ImportError:
            raise ImportError("scikit-learn is required. Install with: pip install scikit-learn")
    
    def train(self, X_train, y_train, X_test, y_test):
        """Train the Gradient Boosting Regressor."""
        try:
            from sklearn.ensemble import GradientBoostingRegressor
            from sklearn.metrics import mean_absolute_error, r2_score
            
            self.model = GradientBoostingRegressor(
                n_estimators=self.n_estimators,
                learning_rate=self.learning_rate,
                max_depth=self.max_depth,
                random_state=42
            )
            self.model.fit(X_train, y_train)
            
            # Calculate R² scores
            self.train_score = self.model.score(X_train, y_train)
            self.test_score = self.model.score(X_test, y_test)
            
            # Calculate MAE (Mean Absolute Error)
            train_pred = self.model.predict(X_train)
            test_pred = self.model.predict(X_test)
            self.train_mae = mean_absolute_error(y_train, train_pred)
            self.test_mae = mean_absolute_error(y_test, test_pred)
            
            return self.train_score, self.test_score, self.train_mae, self.test_mae
        
        except ImportError:
            raise ImportError("scikit-learn is required. Install with: pip install scikit-learn")
    
    def predict(self, X):
        """Predict crime counts."""
        if self.model is None:
            raise ValueError("Model must be trained before making predictions")
        return self.model.predict(X)
    
    def get_feature_importance(self):
        """Return feature importance DataFrame."""
        if self.model is None:
            raise ValueError("Model must be trained first")
        
        return pd.DataFrame({
            "Feature": ["Hour", "Day of Week", "Neighborhood", "Hour Avg", "Neighborhood Avg", 
                       "Is Night", "Is Evening", "Is Weekend", "Is Rush Hour"],
            "Importance": self.model.feature_importances_
        }).sort_values("Importance", ascending=False)