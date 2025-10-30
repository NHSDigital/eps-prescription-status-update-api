#!/usr/bin/env python3
import csv
from pathlib import Path
import argparse

COL_ODS_CODE = "pharmacyODSCode"
READY_TO_COLLECT_PSU_COUNT = "ready_to_collect_psu_count"


def main():
    parser = argparse.ArgumentParser(
        description="Merge ready_to_collect_psu_count into status report by ODS code."
    )
    parser.add_argument(
        "date_suffix", help="Date suffix in format YYYY-MM-DD, e.g. 2025-10-28"
    )
    args = parser.parse_args()

    date = args.date_suffix
    sent_dist_path = Path(
        f"data/Prescription_Notifications_Sent_Distribution_Repor-{date}.csv"
    )
    status_path = Path(f"data/Prescription_Notifications_Status_Report-{date}.csv")
    output_path = Path(
        f"data/Prescription_Notifications_Status_Report_merged-{date}.csv"
    )

    # Read sent distribution file into dict: ODS_CODE -> ready_to_collect_psu_count
    sent_dist = {}
    with sent_dist_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sent_dist[row[COL_ODS_CODE]] = row[READY_TO_COLLECT_PSU_COUNT]

    # Read status file, replace ready_to_collect_psu_count where ODS_CODE matches
    with status_path.open(newline="", encoding="utf-8") as f_in, output_path.open(
        "w", newline="", encoding="utf-8"
    ) as f_out:
        reader = csv.DictReader(f_in)
        fieldnames = reader.fieldnames
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()
        for row in reader:
            ods = row[COL_ODS_CODE]
            if ods in sent_dist:
                row[READY_TO_COLLECT_PSU_COUNT] = sent_dist[ods]
            writer.writerow(row)

    print(f"Merged file written to {output_path}")


if __name__ == "__main__":
    main()
