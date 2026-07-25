#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
official_dir="$script_dir/official"
opencity_station_dir="$official_dir/opencity/police_station_locations"
opencity_crime_dir="$official_dir/opencity/karnataka_crime_data_2025"
ksp_dir="$official_dir/ksp/monthly_crime_reviews"
kaggle_dir="$script_dir/third_party/kaggle/fir_details_karnataka_police_v2"

mkdir -p "$opencity_station_dir" "$opencity_crime_dir"
mkdir -p "$ksp_dir/2023" "$ksp_dir/2024" "$ksp_dir/2025" "$ksp_dir/2026"
mkdir -p "$kaggle_dir"

download() {
  local url="$1"
  local destination="$2"

  if [[ -s "$destination" ]]; then
    echo "SKIP  $destination"
    return
  fi

  echo "GET   $destination"
  curl -L --fail --silent --show-error --retry 3 --retry-delay 2 \
    --user-agent "KPSCID-Data-Archive/1.0" \
    "$url" \
    -o "$destination.part"
  mv "$destination.part" "$destination"
}

# OpenCity/CKAN metadata snapshots.
download \
  "https://data.opencity.in/api/3/action/package_show?id=police-station-locations" \
  "$opencity_station_dir/package_metadata.json"
download \
  "https://data.opencity.in/api/3/action/package_show?id=karnataka-crime-data-2025" \
  "$opencity_crime_dir/package_metadata.json"

# OpenCity police station, outpost, and railway-police station locations.
download \
  "https://data.opencity.in/dataset/1fe7e205-d00e-437e-b43d-6237f065dc2d/resource/9f99ef79-3231-4c9a-8a9d-c8940198489a/download/9181e6ed-6164-430b-8b10-238ad7b8ab45.kml" \
  "$opencity_station_dir/karnataka_police_stations.kml"
download \
  "https://data.opencity.in/dataset/1fe7e205-d00e-437e-b43d-6237f065dc2d/resource/b862cdc0-bf08-4706-9788-4f712d27f950/download/63a601fc-41a6-4e01-aad0-b053c67b392e.kml" \
  "$opencity_station_dir/bengaluru_urban_police_stations.kml"
download \
  "https://data.opencity.in/dataset/1fe7e205-d00e-437e-b43d-6237f065dc2d/resource/54736692-b8ed-49f2-8cfc-cac4daf1be89/download/c367208f-88ba-4392-b787-aaa449be5683.kml" \
  "$opencity_station_dir/karnataka_police_outposts.kml"
download \
  "https://data.opencity.in/dataset/1fe7e205-d00e-437e-b43d-6237f065dc2d/resource/59423322-eae5-4ee8-b7d5-db176d8077d8/download/74612016-6f67-4184-a160-6b3a8d3a012b.kml" \
  "$opencity_station_dir/bengaluru_urban_police_outposts.kml"
download \
  "https://data.opencity.in/dataset/1fe7e205-d00e-437e-b43d-6237f065dc2d/resource/a4781424-8b8e-4b0f-b15b-dc8afaf24d51/download/fe3f24fc-6c17-4080-afea-d44f3867c834.kml" \
  "$opencity_station_dir/karnataka_railway_police_stations.kml"
download \
  "https://data.opencity.in/dataset/1fe7e205-d00e-437e-b43d-6237f065dc2d/resource/c67ce000-ea40-4a55-b2e2-a415323efcd5/download/f95e18cf-a4c1-4dc1-88c4-fea9ab833c98.kml" \
  "$opencity_station_dir/bengaluru_urban_railway_police_stations.kml"

# OpenCity structured Karnataka crime resources for 2025.
download \
  "https://data.opencity.in/dataset/41789466-ddbc-4ea2-8e07-b48521a7f638/resource/58b06cd1-0da0-480a-8163-4cdef26a7e15/download/crime-review-december-modified-2025.pdf" \
  "$opencity_crime_dir/crime_review_december_2025.pdf"
download \
  "https://data.opencity.in/dataset/41789466-ddbc-4ea2-8e07-b48521a7f638/resource/91859ec9-0bcd-4f78-aa37-7fa1346eac36/download/ka-ipc-crimes-2025.csv" \
  "$opencity_crime_dir/ipc_bns_crimes_karnataka_2025.csv"
download \
  "https://data.opencity.in/dataset/41789466-ddbc-4ea2-8e07-b48521a7f638/resource/1deed581-a702-4a97-8053-e192df394b97/download/ka-sll-crimes-2025.csv" \
  "$opencity_crime_dir/special_local_laws_karnataka_2025.csv"
download \
  "https://data.opencity.in/dataset/41789466-ddbc-4ea2-8e07-b48521a7f638/resource/fc969b38-08e1-4ec6-bb5d-208dad998026/download/ka-crimes-women-children-scssts.csv" \
  "$opencity_crime_dir/crimes_women_children_sc_st_karnataka_2025.csv"
download \
  "https://data.opencity.in/dataset/41789466-ddbc-4ea2-8e07-b48521a7f638/resource/90ef5e20-0e55-41d9-8a63-aceff7205d61/download/ka-district-wise-2025.csv" \
  "$opencity_crime_dir/district_commissionerate_crimes_karnataka_2025.csv"
download \
  "https://data.opencity.in/dataset/41789466-ddbc-4ea2-8e07-b48521a7f638/resource/4c0dd0f9-4384-458f-926f-14b68688376c/download/crime_review_for_the_month_of_december_2025_9.csv" \
  "$opencity_crime_dir/crime_review_tables_december_2025.csv"

# Snapshot of the official source page used to discover monthly reports.
download \
  "https://ksp.karnataka.gov.in/new-page/Monthly%20Crime%20Review/en" \
  "$official_dir/ksp/monthly_crime_review_source_page.html"

# Karnataka State Police monthly crime review PDFs.
declare -a ksp_reports=(
  "2023|01|https://ksp.karnataka.gov.in/storage/pdf-files/JANUARY%20REVIEW%20-%202023.pdf"
  "2023|02|https://ksp.karnataka.gov.in/storage/pdf-files/FEBRUARY%20REVIEW%20%20-%202023.pdf"
  "2023|03|https://ksp.karnataka.gov.in/storage/pdf-files/MARCH%20REVIEW%20-%202023.pdf"
  "2023|04|https://ksp.karnataka.gov.in/storage/pdf-files/APRIL%20REVIEW%20-%202023.pdf"
  "2023|05|https://ksp.karnataka.gov.in/storage/pdf-files/MAY%20REVIEW%20-%202023.pdf"
  "2023|06|https://ksp.karnataka.gov.in/storage/pdf-files/JUNE%20REVIEW%20-%202023.pdf"
  "2023|07|https://ksp.karnataka.gov.in/storage/pdf-files/JULY%20REVIEW%202023.pdf"
  "2023|08|https://ksp.karnataka.gov.in/storage/pdf-files/AUGUST%20REVIEW%20-%202023.pdf"
  "2023|09|https://ksp.karnataka.gov.in/storage/pdf-files/SEPTEMBER%20REVIEW%20-%202023.pdf"
  "2023|10|https://ksp.karnataka.gov.in/storage/pdf-files/OCTOBER%20REVIEW%20-%202023.pdf"
  "2023|11|https://ksp.karnataka.gov.in/storage/pdf-files/NOVEMBER%20-%20REVIEW%20-%202023.pdf"
  "2023|12|https://ksp.karnataka.gov.in/storage/pdf-files/DECEMBER%20REVIEW%20-%202023.pdf"
  "2024|01|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20JANUARY%20-%202024.pdf"
  "2024|02|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20FEBRUARY%20-%202024.pdf"
  "2024|03|https://ksp.karnataka.gov.in/storage/pdf-files/MARCH%20-%20REVIEW%20-%202024-1.pdf"
  "2024|04|https://ksp.karnataka.gov.in/storage/pdf-files/APRIL%20REVIEW-1.pdf"
  "2024|05|https://ksp.karnataka.gov.in/storage/pdf-files/MAY%20REVIEW%202024.pdf"
  "2024|06|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20JUNE%20-%202024.pdf"
  "2024|07|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20JULY%20-%202024.pdf"
  "2024|08|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20AUGUST%20-%202024.pdf"
  "2024|09|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20SEPTEMBER%20-%202024.pdf"
  "2024|10|https://ksp.karnataka.gov.in/storage/pdf-files/OCTOBER%20-%20REVIEW%20-%202024-1.pdf"
  "2024|11|https://ksp.karnataka.gov.in/storage/pdf-files/NOVEMBER%20REVIEW%20-%202024.pdf"
  "2024|12|https://ksp.karnataka.gov.in/storage/pdf-files/DECEMBER%20REVIEW%20-%202024.pdf"
  "2025|01|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20JANUARY%20-%202025.pdf"
  "2025|02|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20FEBRUARY%20-%202025.pdf"
  "2025|03|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20MARCH%20-%202025.pdf"
  "2025|04|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20APRIL%20-%202025.pdf"
  "2025|05|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20MAY%20-%202025-1.pdf"
  "2025|06|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20JUNE%20-%202025.pdf"
  "2025|07|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20JULY%20-%202025.pdf"
  "2025|08|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20AUGUST%20-%202025.pdf"
  "2025|09|https://ksp.karnataka.gov.in/storage/pdf-files/SEPTEMBER%20-%20REVIEW%20-%202025.pdf"
  "2025|10|https://ksp.karnataka.gov.in/storage/pdf-files/OCTOBER%20-%20REVIEW%20-%202025.pdf"
  "2025|11|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20NOVEMBER-2025.pdf"
  "2025|12|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20DECEMBER%20-Modified%202025.pdf"
  "2026|01|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20JANUARY%20-%202026.pdf"
  "2026|02|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20FEBRUARY%20-%202026.pdf"
  "2026|03|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20MARCH%20-%202026.pdf"
  "2026|04|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20APRIL%20-%202026.pdf"
  "2026|05|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20MAY%20-%202026.pdf"
  "2026|06|https://ksp.karnataka.gov.in/storage/pdf-files/CRIME%20REVIEW%20-%20JUNE%20-%202026.pdf"
)

for report in "${ksp_reports[@]}"; do
  IFS="|" read -r year month url <<< "$report"
  download "$url" "$ksp_dir/$year/crime_review_${year}_${month}.pdf"
done

# Third-party public Kaggle mirror discovered during source research.
download \
  "https://www.kaggle.com/api/v1/datasets/view/vanshangaria/fir-details-karnataka-police" \
  "$kaggle_dir/kaggle_metadata.json"
download \
  "https://www.kaggle.com/api/v1/datasets/download/vanshangaria/fir-details-karnataka-police?datasetVersionNumber=2" \
  "$kaggle_dir/fir_details_karnataka_police_v2.zip"

if [[ ! -s "$kaggle_dir/FIR_Details_Data.csv" ]]; then
  echo "UNZIP $kaggle_dir/FIR_Details_Data.csv"
  unzip -n "$kaggle_dir/fir_details_karnataka_police_v2.zip" -d "$kaggle_dir"
fi

echo "Download archive is complete."
