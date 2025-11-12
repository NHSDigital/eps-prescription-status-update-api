#!/usr/bin/env python3
import csv
from pathlib import Path
import argparse

COL_ODS_CODE = "pharmacyODSCode"
READY_TO_COLLECT_PSU_COUNT = "ready_to_collect_psu_count"
TOTAL_NOTIFICATIONS = "total notifications"
NOTIFICATIONS_REQUESTED_COUNT = "notifications_requested_count"


def main():
    parser = argparse.ArgumentParser(
        description="Merge ready_to_collect_psu_count and total notifications into status report by ODS code."
    )
    parser.add_argument(
        "date_suffix", help="Date suffix in format YYYY-MM-DD, e.g. 2025-10-28"
    )
    args = parser.parse_args()

    date = args.date_suffix
    sent_dist_path = Path(
        f"data/Prescription_Notifications_Sent_Distribution_Repor-{date}.csv"
    )
    freq_dist_path = Path(
        f"data/Notification_Frequency_Distribution-{date}.csv"
    )
    status_path = Path(f"data/Prescription_Notifications_Status_Report-{date}.csv")
    output_path = Path(
        f"data/Prescription_Notifications_Status_Report_final-{date}.csv"
    )

    # Read ready_to_collect_psu_count by ODS code
    sent_dist = {}
    with sent_dist_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sent_dist[row[COL_ODS_CODE].upper()] = row[READY_TO_COLLECT_PSU_COUNT]

    # Read total notifications by ODS code
    freq_dist = {}
    freq_dist_rows = {}
    with freq_dist_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            ods_upper = row[COL_ODS_CODE].upper()
            freq_dist[ods_upper] = row[TOTAL_NOTIFICATIONS]
            freq_dist_rows[ods_upper] = row

    # Read status file, replace ready_to_collect_psu_count and
    # notifications_requested_count where ODS_CODE matches
    # Track which frequency distribution codes we've processed
    processed_freq_codes = set()

    with status_path.open(newline="", encoding="utf-8") as f_in, output_path.open(
        "w", newline="", encoding="utf-8"
    ) as f_out:
        reader = csv.DictReader(f_in)
        fieldnames = reader.fieldnames
        writer = csv.DictWriter(f_out, fieldnames=fieldnames)
        writer.writeheader()

        # Process existing rows from status file
        for row in reader:
            ods = row[COL_ODS_CODE]
            ods_upper = ods.upper()

            # Uppercase the ODS code in the output
            row[COL_ODS_CODE] = ods_upper

            if ods_upper in sent_dist:
                row[READY_TO_COLLECT_PSU_COUNT] = sent_dist[ods_upper]
            if ods_upper in freq_dist:
                row[NOTIFICATIONS_REQUESTED_COUNT] = freq_dist[ods_upper]
                processed_freq_codes.add(ods_upper)
            else:
                row[NOTIFICATIONS_REQUESTED_COUNT] = "0"
            writer.writerow(row)
f_out.close()
    print(f"Merged file written to {output_path}")


if __name__ == "__main__":
    main()
