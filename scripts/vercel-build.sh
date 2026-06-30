#!/usr/bin/env bash
# Vercel deploy-step migration (Tier 1.1 — recurrence prevention).
#
# Heavy/destructive migration work runs HERE, at build time, not on the request/boot
# path (the boot-path-scaling-with-rows pattern caused the multi-day outage). It is
# gated: only runs when DATABASE_URL is visible at build time. If it isn't, we skip
# loudly — the boot path still applies migrations safely (advisory-locked, light only).
#
# Invoked from vercel.json `buildCommand` (kept short there: the schema caps it at 256).
set -e

if [ -n "$DATABASE_URL" ]; then
  node migrate.js --run-heavy
else
  echo "[build] DATABASE_URL not visible at build time — skipping deploy-step migration;"
  echo "[build] boot path will apply migrations safely (advisory-locked, light only)."
  echo "[build] To enable deploy-step migrations, scope DATABASE_URL to Build in Vercel env settings."
fi
