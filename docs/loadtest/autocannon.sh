#!/usr/bin/env bash
# Autocannon ramp for the signup-burst load test (the no-tools-beyond-npm option).
# Point it at a THROWAWAY test session — never a live one.
#
#   SID       (required)  — a test session id (node docs/loadtest/session.js create)
#   BASE_URL  (default https://anr.makinitmag.com)
#   PATH      (default /api/session/info?s=$SID)
#
# Usage:  SID=lt123abc bash docs/loadtest/autocannon.sh
#
# It ramps concurrency 10 -> 50 -> 100 (30s each). Read the summary:
#   - "2xx" should be ~100% (any sustained non-2xx = the outage pattern is reachable)
#   - "Latency p99" should stay well under 10000 ms (the serverless function limit)

set -euo pipefail
BASE="${BASE_URL:-https://anr.makinitmag.com}"
: "${SID:?Set SID=<test session id>  (create one: node docs/loadtest/session.js create)}"
PATH_="${PATH_OVERRIDE:-/api/session/info?s=$SID}"
URL="$BASE$PATH_"

command -v autocannon >/dev/null 2>&1 || { echo "Install autocannon first:  npm i -g autocannon"; exit 1; }

echo "Target: $URL"
for C in 10 50 100; do
  echo
  echo "======== concurrency $C, 30s ========"
  autocannon -c "$C" -d 30 "$URL"
done
echo
echo "PASS = non-2xx ~0 and p99 latency well under 10s at every level."
echo "Watch Vercel Functions/Logs (504s?) and Neon Monitoring (connections vs pool ceiling) while it runs."
