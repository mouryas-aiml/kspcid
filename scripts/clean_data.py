import pandas as pd
import numpy as np

EXPECTED_COLUMNS = {
    'date': 'date',
    'time': 'time',
    'crime_type': 'crime_type',
    'neighborhood': 'neighborhood',
    'latitude': 'latitude',
    'longitude': 'longitude',
    'arrest_made': 'arrest_made',
    'zip_code': 'zip_code'
}

PARTS_OF_DAY = {
    'Late Night': range(0, 5),
    'Morning': range(5, 12),
    'Afternoon': range(12, 17),
    'Evening': range(17, 21),
    'Night': range(21, 24),
}

def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    df = df.rename(columns={c: c.strip().lower() for c in df.columns})
    # try to align to expected columns if obvious alternatives exist
    alt = {
        'crime': 'crime_type',
        'ucr_category': 'crime_type',
        'lat': 'latitude',
        'lon': 'longitude',
        'long': 'longitude',
        'zip': 'zip_code',
        'area_name': 'neighborhood',
        'arrest': 'arrest_made',
    }
    for old, new in alt.items():
        if old in df.columns and new not in df.columns:
            df = df.rename(columns={old: new})
    return df

def parse_datetime(df: pd.DataFrame) -> pd.DataFrame:
    # Combine date + time into datetime where possible
    if 'date' in df.columns:
        df['date'] = pd.to_datetime(df['date'], errors='coerce')
    if 'time' in df.columns:
        # some portals store HHMM or HH:MM
        t = pd.to_datetime(df['time'], errors='coerce', format='%H:%M:%S')
        t2 = pd.to_datetime(df['time'], errors='coerce', format='%H:%M')
        df['_time_parsed'] = t.fillna(t2)
    else:
        df['_time_parsed'] = pd.NaT
    df['datetime'] = df['date']
    df.loc[df['_time_parsed'].notna(), 'datetime'] = df['date'] + pd.to_timedelta(df['_time_parsed'].dt.hour.fillna(0), unit='h') + pd.to_timedelta(df['_time_parsed'].dt.minute.fillna(0), unit='m')
    df.drop(columns=['_time_parsed'], inplace=True)
    return df

def derive_fields(df: pd.DataFrame) -> pd.DataFrame:
    df['year'] = df['datetime'].dt.year
    df['month'] = df['datetime'].dt.month
    df['day'] = df['datetime'].dt.day
    df['hour'] = df['datetime'].dt.hour
    df['weekday'] = df['datetime'].dt.day_name()
    df['is_weekend'] = df['weekday'].isin(['Saturday', 'Sunday'])
    # part of day
    def label_hour(h):
        if pd.isna(h):
            return np.nan
        for label, hours in PARTS_OF_DAY.items():
            if int(h) in hours:
                return label
        return 'Unknown'
    df['part_of_day'] = df['hour'].apply(label_hour)
    # coerce booleans
    if 'arrest_made' in df.columns:
        df['arrest_made'] = df['arrest_made'].astype(str).str.lower().isin(['true','1','t','yes','y'])
    return df

def clean(filepath: str) -> pd.DataFrame:
    df = pd.read_csv(filepath)
    df = normalize_columns(df)
    if 'date' not in df.columns:
        raise ValueError('Expected a date column.')
    df = parse_datetime(df)
    df = derive_fields(df)
    # keep common columns if present
    keep = [c for c in ['incident_id','datetime','date','time','crime_type','neighborhood','zip_code','latitude','longitude','arrest_made','weapon_involved','year','month','day','hour','weekday','is_weekend','part_of_day','source_city'] if c in df.columns]
    return df[keep]
