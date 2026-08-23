#!/usr/bin/env bash
# One command runs the whole stack locally.
#
# Checks its prerequisites first and tells you what is missing, rather than
# failing halfway through with a stack trace. This is deliberate: the person
# running it is the person who has to debug it.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; OFF=$'\033[0m'

missing=0
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '%s✗%s %s is not installed — %s\n' "$RED" "$OFF" "$1" "$2"
    missing=1
  else
    printf '%s✓%s %s\n' "$GREEN" "$OFF" "$1"
  fi
}

printf '\n%sChecking prerequisites%s\n' "$BOLD" "$OFF"
need node    'install Node 22 or newer from https://nodejs.org'
need pnpm    'run: corepack enable && corepack prepare pnpm@10 --activate'
need docker  'install Docker Desktop from https://docs.docker.com/get-docker/ (the Supabase CLI needs it)'
need supabase 'install the Supabase CLI: https://supabase.com/docs/guides/local-development'

if [ "$missing" -ne 0 ]; then
  printf '\n%sInstall what is missing above, then run this again.%s\n\n' "$YELLOW" "$OFF"
  exit 1
fi

if [ ! -f .env.local ]; then
  printf '\n%s→%s No .env.local found. Creating one from .env.example.\n' "$YELLOW" "$OFF"
  cp .env.example .env.local
  printf '  %sFill in the Supabase values that `supabase start` prints below.%s\n' "$DIM" "$OFF"
fi

printf '\n%sInstalling dependencies%s\n' "$BOLD" "$OFF"
pnpm install --frozen-lockfile
git config core.hooksPath .githooks

printf '\n%sStarting Supabase (Postgres, Auth, Storage)%s\n' "$BOLD" "$OFF"
supabase start

printf '\n%sApplying migrations%s\n' "$BOLD" "$OFF"
supabase db reset --no-seed

printf '\n%sBuilding brand assets%s\n' "$BOLD" "$OFF"
pnpm brand:build

printf '\n%sStarting the web app%s\n' "$BOLD" "$OFF"
printf '  Console         %shttp://localhost:3000%s\n' "$BOLD" "$OFF"
printf '  Supabase Studio %shttp://localhost:54323%s\n' "$BOLD" "$OFF"
printf '  Inbucket (mail) %shttp://localhost:54324%s\n' "$BOLD" "$OFF"
printf '\n  Assessments run in a separate worker process. In another terminal:\n'
printf '    %spnpm dev:worker%s\n\n' "$BOLD" "$OFF"

exec pnpm --filter @vibefycode/web dev
