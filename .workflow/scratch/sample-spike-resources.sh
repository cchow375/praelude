#!/usr/bin/env bash
# Samples %CPU and RSS (KB) once per second for a given PID, for a given duration.
# Usage: sample-spike-resources.sh <pid> <label> <duration_secs> <out_file>
set -euo pipefail
pid="$1"
label="$2"
duration="$3"
out="$4"

echo "ts_s,label,pid,cpu_pct,rss_kb" > "$out"
for ((i=0; i<duration; i++)); do
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "sample-spike-resources: pid $pid ($label) exited early at t=${i}s" >&2
    break
  fi
  line=$(ps -o %cpu=,rss= -p "$pid" | tr -s ' ')
  cpu=$(echo "$line" | awk '{print $1}')
  rss=$(echo "$line" | awk '{print $2}')
  echo "${i},${label},${pid},${cpu},${rss}" >> "$out"
  sleep 1
done
echo "sample-spike-resources: wrote $out"
