#!/usr/bin/env bash
set -euo pipefail

output=coverage/lcov.info
mkdir -p coverage

true > "$output"

for pkg in packages/*; do
  if [[ -f "$pkg/coverage/lcov.info" ]]; then
    # Rewrite paths in lcov.info to be relative to repo root
    sed "s|^SF:|SF:$pkg/|" "$pkg/coverage/lcov.info" >> "$output"
  fi
done
