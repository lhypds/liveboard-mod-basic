#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Copied .env.example to .env"
fi

# Ask for a .env value that has none. Already-filled keys are left alone, and
# with no terminal to ask on (ssh deploy, CI) it reports instead of hanging.
ask_env() {
  local key="$1" hint="$2" value
  if grep -q "^$key=..*" .env; then
    echo "$key is already set."
    return 0
  fi
  if [ ! -t 0 ]; then
    echo "$key is not set in $PWD/.env — fill it in and re-run this script."
    return 0
  fi
  echo "$hint"
  read -r -p "$key (press Enter to skip): " value || value=""
  if [ -z "$value" ]; then
    echo "Skipped — $key left empty."
    return 0
  fi
  # Rewrite in place so comments and key order in .env survive. The value goes
  # through the environment, so | / & \ and friends need no escaping.
  if grep -q "^$key=" .env; then
    VALUE="$value" awk -v k="$key" \
      '$0 ~ "^" k "=" && !done { print k "=" ENVIRON["VALUE"]; done=1; next } { print }' \
      .env > .env.tmp
    mv .env.tmp .env
  else
    echo "$key=$value" >> .env
  fi
  echo "Saved $key to .env"
}

# The card needs a running sc bridge to talk to; nothing about the CLI runs on this machine.
ask_env VITE_SC_BRIDGE_URL \
  "URL of the sc bridge — the server that runs the \`sc\` CLI, e.g. http://10.0.0.2:8787"

URL=$(grep -E "^VITE_SC_BRIDGE_URL=..*" .env | head -1 | cut -d= -f2- || true)
if [ -z "$URL" ]; then
  echo "Without it the Chat card has nowhere to talk to, and says so on screen."
  exit 0
fi

echo "sc bridge: $URL"
if command -v curl > /dev/null 2>&1; then
  if [ "$(curl -s -m 5 -o /dev/null -w "%{http_code}" "$URL/healthz" || true)" = "200" ]; then
    echo "  reachable."
  else
    # Not fatal: the board still builds, and the card says so on screen when it cannot connect.
    echo "  no answer from $URL/healthz — check the bridge is up and reachable from here."
  fi
fi
