#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

node refresh.mjs

date "+%Y-%m-%d %H:%M" > last_updated.txt
echo "Updated last_updated.txt: $(cat last_updated.txt)"
