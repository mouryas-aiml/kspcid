"""Configuration settings for the Crime Dashboard."""

# Map settings
MAX_MAP_POINTS = 100_000
DEFAULT_ZOOM = 11
MAP_TILES = "cartodbpositron"

# ML Model parameters
# Calibrated against the bundled 2,000-row-per-year Bengaluru synthetic sample.
DBSCAN_EPS = 0.05
DBSCAN_MIN_SAMPLES = 10

RANDOM_FOREST_ESTIMATORS = 100
RANDOM_FOREST_MAX_DEPTH = 5

GRADIENT_BOOST_ESTIMATORS = 100
GRADIENT_BOOST_LEARNING_RATE = 0.1
GRADIENT_BOOST_MAX_DEPTH = 4

# Data thresholds
MIN_CLUSTERING_POINTS = 50
MIN_NEIGHBORHOOD_PREDICTION_POINTS = 100
MIN_RISK_ASSESSMENT_POINTS = 200
MIN_PREDICTION_DATA = 50

# UI settings
DEFAULT_YEAR = 2024
ACCENT_COLOR = "#00d4ff"

# Dataset contract
DATA_FOLDER = "processed"
DATA_FILES = ["bengaluru_synthetic_crime_2020_2024.csv"]
DATA_FILE_ENV = "CIPHERWATCH_DATA_FILE"
DATASET_REQUIRED_COLUMNS = {
    "datetime",
    "crime_type",
    "neighborhood",
    "latitude",
    "longitude",
    "incident_id",
    "is_synthetic",
    "generation_version",
}
BENGALURU_BOUNDS = {
    "latitude": (12.7, 13.3),
    "longitude": (77.3, 78.0),
}
