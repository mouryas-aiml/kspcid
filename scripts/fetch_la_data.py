"""Template for pulling Los Angeles crime data via the Socrata API.

Steps:
1) Create a free Socrata app token: https://support.socrata.com/hc/en-us/articles/360000906688-Create-and-Manage-Your-Application-Tokens
2) Identify the dataset ID on data.lacity.org (e.g., '2nrs-mtv8' or similar for crime incidents; verify current ID).
3) Use `sodapy` or `requests` to query with date filters; save to CSV in data/.
"""

from pathlib import Path

def main():
    print("This is a template. Fill in the dataset ID and token, then fetch & save to data/.")
    out = Path(__file__).resolve().parents[1]/"data"/"la_crime_raw.csv"
    print(f"Would save to: {out}")

if __name__ == "__main__":
    main()
