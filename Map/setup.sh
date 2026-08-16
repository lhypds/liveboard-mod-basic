#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Copied .env.example to .env"
fi

# The board's build merges every component's VITE_ values into one set and
# aborts when a key holds two different values, so a credential another card
# already has is reused here instead of being asked for twice.
sibling_value() {
  local key="$1" file found
  for file in ../../*/*/.env; do
    # -ef: this component's own .env matches the glob too, and reading it back
    # here would defeat the "is it already set" check in ask_env.
    { [ -f "$file" ] && ! [ "$file" -ef .env ]; } || continue
    found=$(grep -h "^$key=..*" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true)
    if [ -n "$found" ]; then
      echo "$found"
      return 0
    fi
  done
}

# Ask for a .env value that has none. Already-filled keys are left alone, and
# with no terminal to ask on (ssh deploy, CI) it reports instead of hanging.
ask_env() {
  local key="$1" hint="$2" value="${3:-}"
  if grep -q "^$key=..*" .env; then
    echo "$key is already set."
    return 0
  fi
  if [ -n "$value" ]; then
    echo "Taking $key from a component that already has it."
  elif [ ! -t 0 ]; then
    echo "$key is not set in $PWD/.env — fill it in and re-run this script."
    return 0
  else
    echo "$hint"
    read -r -p "$key (press Enter to skip): " value || value=""
  fi
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

# Both values are baked into the browser bundle, so configure them before the
# board build and apply origin restrictions in the provider consoles.
ask_env VITE_MAPBOX_TOKEN \
  "Mapbox public token — the Map basemap. Without it the card only says the token is missing. https://account.mapbox.com/access-tokens/" \
  "$(sibling_value VITE_MAPBOX_TOKEN)"
ask_env VITE_GOOGLE_MAPS_API_KEY \
  "Google Maps API key — the Map address search box, which stays hidden without it. https://console.cloud.google.com/google/maps-apis/credentials" \
  "$(sibling_value VITE_GOOGLE_MAPS_API_KEY)"
