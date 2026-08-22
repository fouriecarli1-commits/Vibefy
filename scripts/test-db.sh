#!/usr/bin/env bash
# Ephemeral Postgres for the row-level-security tests.
#
# The RLS policies are the difference between a multi-tenant product and a data
# breach, so they are tested against a real Postgres rather than mocked. This
# boots a throwaway cluster on a Unix socket — no Docker, no port conflicts, no
# shared state between runs.
#
#   scripts/test-db.sh start   boot the cluster and apply shim + migrations
#   scripts/test-db.sh stop    shut it down
#   scripts/test-db.sh reset   drop and recreate the database
#   scripts/test-db.sh dsn     print the connection string
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="${VIBEFY_TEST_PGROOT:-$ROOT/.tmp/pg}"
DATA_DIR="$RUN_DIR/data"
SOCKET_DIR="$RUN_DIR/socket"
LOG_FILE="$RUN_DIR/postgres.log"
DB_NAME="vibefy_test"

find_pg_bin() {
  if command -v pg_ctl >/dev/null 2>&1 && command -v initdb >/dev/null 2>&1; then
    dirname "$(command -v pg_ctl)"
    return
  fi
  for dir in /usr/lib/postgresql/*/bin /usr/local/pgsql/bin /opt/homebrew/opt/postgresql*/bin; do
    if [ -x "$dir/pg_ctl" ]; then echo "$dir"; return; fi
  done
  echo ""
}

# Postgres refuses to run as root. In containers and CI images that run as root
# (which is most of them), drop to an unprivileged account that owns the data
# directory and re-exec. The socket stays world-accessible so the test process,
# whatever user it runs as, can still connect.
if [ "$(id -u)" -eq 0 ]; then
  PG_ACCOUNT="${VIBEFY_TEST_PGUSER:-postgres}"
  if id "$PG_ACCOUNT" >/dev/null 2>&1; then
    mkdir -p "$RUN_DIR"
    chown -R "$PG_ACCOUNT" "$RUN_DIR"
    exec su -s /bin/bash "$PG_ACCOUNT" -c "$(printf '%q ' "$0" "$@")"
  fi
  echo "Refusing to run Postgres as root and no '$PG_ACCOUNT' account exists." >&2
  echo "Create one, or set VIBEFY_TEST_PGUSER to an existing unprivileged user." >&2
  exit 1
fi

PG_BIN="$(find_pg_bin)"
if [ -z "$PG_BIN" ]; then
  echo "Postgres server binaries not found (need initdb and pg_ctl)." >&2
  echo "  macOS:  brew install postgresql@16" >&2
  echo "  Debian: sudo apt-get install postgresql-16" >&2
  exit 1
fi

dsn() { echo "postgresql:///$DB_NAME?host=$SOCKET_DIR"; }

is_running() {
  "$PG_BIN/pg_ctl" -D "$DATA_DIR" status >/dev/null 2>&1
}

start() {
  mkdir -p "$SOCKET_DIR"
  if [ ! -s "$DATA_DIR/PG_VERSION" ]; then
    mkdir -p "$DATA_DIR"
    "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust --no-sync >/dev/null
  fi
  if ! is_running; then
    "$PG_BIN/pg_ctl" -D "$DATA_DIR" -l "$LOG_FILE" \
      -o "-c listen_addresses='' -k $SOCKET_DIR -c fsync=off -c synchronous_commit=off -c full_page_writes=off" \
      -w start >/dev/null
  fi
  if ! "$PG_BIN/psql" -h "$SOCKET_DIR" -U postgres -lqt 2>/dev/null | cut -d'|' -f1 | grep -qw "$DB_NAME"; then
    "$PG_BIN/createdb" -h "$SOCKET_DIR" -U postgres "$DB_NAME"
  fi
  apply
}

apply() {
  local psql="$PG_BIN/psql -v ON_ERROR_STOP=1 -q -h $SOCKET_DIR -U postgres -d $DB_NAME"
  $psql -f "$ROOT/supabase/shim/local-postgres-shim.sql" >/dev/null
  for migration in "$ROOT"/supabase/migrations/*.sql; do
    if ! $psql -f "$migration"; then
      echo "Migration failed: $(basename "$migration")" >&2
      exit 1
    fi
  done
}

stop() {
  if is_running; then "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate -w stop >/dev/null; fi
}

reset() {
  if is_running; then
    "$PG_BIN/dropdb" -h "$SOCKET_DIR" -U postgres --if-exists "$DB_NAME"
    "$PG_BIN/createdb" -h "$SOCKET_DIR" -U postgres "$DB_NAME"
    apply
  else
    start
  fi
}

case "${1:-start}" in
  start) start; echo "$(dsn)" ;;
  stop)  stop ;;
  reset) reset; echo "$(dsn)" ;;
  dsn)   dsn ;;
  apply) apply ;;
  *) echo "usage: $0 {start|stop|reset|apply|dsn}" >&2; exit 2 ;;
esac
