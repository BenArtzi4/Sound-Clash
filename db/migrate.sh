#!/usr/bin/env bash
# Apply all migrations in db/migrations/ to a Postgres database, in order.
#
# Usage:
#   ./db/migrate.sh "postgres://user:pass@host:port/db"
#
# Phase 1 placeholder: the migrations/ directory is empty until Phase 3.
# This script intentionally exits 0 if no migrations exist yet, so CI passes.

set -euo pipefail

DATABASE_URL="${1:-${DATABASE_URL:-}}"

if [[ -z "$DATABASE_URL" ]]; then
  echo "Usage: $0 <DATABASE_URL>" >&2
  echo "Or set DATABASE_URL env var." >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MIGRATIONS_DIR="$SCRIPT_DIR/migrations"

shopt -s nullglob
migrations=("$MIGRATIONS_DIR"/*.sql)

if [[ ${#migrations[@]} -eq 0 ]]; then
  echo "No migrations found in $MIGRATIONS_DIR (Phase 3 will add them)."
  exit 0
fi

# Sort to enforce numeric prefix ordering (BSD/GNU sort compatible).
IFS=$'\n' sorted=($(LC_ALL=C sort <<<"${migrations[*]}"))
unset IFS

echo "Applying ${#sorted[@]} migration(s) to target..."
for f in "${sorted[@]}"; do
  echo "→ $(basename "$f")"
  psql --set ON_ERROR_STOP=1 --quiet "$DATABASE_URL" -f "$f"
done

echo "✓ Migrations applied."
