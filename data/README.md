# Crime Data Documentation

This directory contains the Los Angeles crime dataset used for analysis and machine learning predictions.

## 📁 Folder Structure

```
data/
├── raw/                    # Original, unprocessed data
│   └── (original CSV files from LA Open Data)
├── processed/              # Cleaned and processed data
│   └── cleaned_crime.csv   # Main dataset used by dashboard
└── README.md              # This file
```

## 📊 Dataset Overview

### Source
- **Provider**: City of Los Angeles Open Data Portal
- **Dataset**: Crime Data from 2020 to Present
- **URL**: [LA Open Data - Crime Data](https://data.lacity.org/Public-Safety/Crime-Data-from-2020-to-Present/2nrs-mtv8)
- **License**: Public Domain
- **Last Updated**: Check LA Open Data portal for latest version

### Size & Scope
- **Total Records**: 1,004,991 crime incidents
- **Time Range**: January 2020 - November 2025
- **Geographic Coverage**: 77 neighborhoods in Los Angeles
- **File Size**: ~200MB (compressed), ~500MB (uncompressed)

## 🗂️ Data Schema

### Required Columns (in processed/cleaned_crime.csv)

| Column | Data Type | Description | Example |
|--------|-----------|-------------|---------|
| `datetime` | datetime | Date and time of incident | 2024-03-15 14:30:00 |
| `date` | date | Date only (if datetime not available) | 2024-03-15 |
| `time` | time | Time only (if datetime not available) | 14:30:00 |
| `hour` | int | Hour of day (0-23) | 14 |
| `weekday` | string | Day of week | Friday |
| `month` | string | Year-Month | 2024-03 |
| `year` | int | Year | 2024 |
| `latitude` | float | Latitude coordinate | 34.0522 |
| `longitude` | float | Longitude coordinate | -118.2437 |
| `crime_type` | string | Type of crime | BURGLARY |
| `neighborhood` | string | Neighborhood name | Hollywood |
| `zip_code` | string | ZIP code | 90028 |
| `arrest_made` | boolean | Whether arrest was made | True/False |

### Optional Columns
- `victim_age`: Age of victim
- `victim_sex`: Gender of victim  
- `weapon_used`: Type of weapon (if applicable)
- `premise_type`: Location type (residence, street, etc.)
- `status`: Investigation status

## 🔧 Data Processing Pipeline

### Raw to Processed

The data undergoes the following transformations:

1. **Date/Time Parsing**
   - Combine separate date and time columns into single `datetime`
   - Extract `hour`, `weekday`, `month`, `year` features
   - Handle multiple time formats (HH:MM:SS, HH:MM)

2. **Coordinate Cleaning**
   - Remove invalid coordinates (0, 0)
   - Remove coordinates outside LA county bounds
   - Handle missing latitude/longitude

3. **Text Standardization**
   - Uppercase crime types for consistency
   - Trim whitespace from all string columns
   - Standardize neighborhood names

4. **Feature Engineering**
   - Create time-based flags: `is_night`, `is_evening`, `is_weekend`, `is_rush_hour`
   - Calculate historical averages by neighborhood and time
   - Encode categorical variables for ML models

5. **Data Quality**
   - Remove duplicate records
   - Handle missing values appropriately
   - Validate data types

## 📈 Data Statistics

```
Total Incidents: 1,004,991
Time Period: 2020-01-01 to 2025-11-17
Neighborhoods: 77
Unique Crime Types: 100+
Average Daily Incidents: 550
```

### Top 5 Crime Types
1. Battery - Simple Assault
2. Theft from Vehicle
3. Burglary from Vehicle
4. Identity Theft
5. Vandalism

### Geographic Distribution
- **Most Incidents**: Central LA, Hollywood, Downtown
- **Least Incidents**: Harbor areas, Mountain communities
- **Hotspot Clusters**: 150+ identified via DBSCAN

## 🔄 Data Updates

### Updating the Dataset

To refresh with latest data from LA Open Data:

1. **Download new data:**
   ```bash
   # Visit: https://data.lacity.org/Public-Safety/Crime-Data-from-2020-to-Present/2nrs-mtv8
   # Export as CSV
   # Save to data/raw/
   ```

2. **Run processing script:**
   ```bash
   python scripts/data_cleaning.py
   ```

3. **Verify processed data:**
   ```bash
   python scripts/validate_data.py
   ```

### Data Refresh Schedule
- **Recommended**: Monthly updates to capture recent trends
- **LA Portal Updates**: Daily (crime reports may be delayed by 7-10 days)

## ⚠️ Data Limitations

### Known Issues
1. **Reporting Delay**: Incidents may be reported 7-10 days after occurrence
2. **Geographic Accuracy**: Some coordinates are approximated to protect victim privacy
3. **Missing Data**: Not all fields are populated for every incident
4. **Crime Classification**: Some crimes may be reclassified during investigation

### Ethical Considerations
- **Privacy**: Personal identifying information has been removed
- **Bias**: Crime data reflects reported crimes, not all crimes that occur
- **Usage**: This data should be used for analysis and prevention, not profiling

## 🔒 Data Security

- ✅ No personally identifiable information (PII) included
- ✅ Victim information anonymized
- ✅ Exact addresses truncated to block-level
- ✅ Public domain data - safe to share

## 📖 Usage in Dashboard

The dashboard loads data using the following priority:

1. `data/processed/cleaned_crime.csv` (primary)
2. `data/processed/sample_la_crime_2024.csv` (fallback)

Configure data paths in `config/settings.py`:
```python
DATA_FILES = ["cleaned_crime.csv", "sample_la_crime_2024.csv"]
```

## 🔗 Related Resources

- [LA Open Data Portal](https://data.lacity.org/)
- [Crime Data Documentation](https://data.lacity.org/Public-Safety/Crime-Data-from-2020-to-Present/2nrs-mtv8)
- [LAPD Crime Statistics](https://www.lapdonline.org/office-of-the-chief-of-police/office-of-operations/detective-bureau/crime-stats/)
- [LA Times Crime Database](https://www.latimes.com/crime)

## 📧 Questions?

For questions about:
- **Data source**: Contact LA Open Data Portal
- **Data processing**: See `scripts/data_cleaning.py`
- **Dashboard usage**: See main README.md
- **Project questions**: Contact repository owner

---

*Last updated: November 2025*
*Dataset version: LA Crime 2020-2025*