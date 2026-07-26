from typing import Optional
import folium
from folium.plugins import HeatMap, MarkerCluster

def add_heatmap(m, df, lat_col='latitude', lon_col='longitude', radius=10, blur=15, min_opacity=0.3):
    points = df[[lat_col, lon_col]].dropna().values.tolist()
    if not points:
        return m
    HeatMap(points, radius=radius, blur=blur, min_opacity=min_opacity).add_to(m)
    return m

def add_clusters(m, df, lat_col='latitude', lon_col='longitude', tooltip_cols=None):
    mc = MarkerCluster().add_to(m)
    tooltip_cols = tooltip_cols or []
    for _, r in df.dropna(subset=[lat_col, lon_col]).iterrows():
        tip = "<br>".join([f"<b>{c}:</b> {r[c]}" for c in tooltip_cols if c in r])
        folium.Marker(location=[r[lat_col], r[lon_col]], tooltip=tip if tip else None).add_to(mc)
    return m
