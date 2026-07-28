#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"

MODULE_NAME=$(basename "$PWD")
echo "==> Setting up module '$MODULE_NAME'..."

# modules.config.json
if [ ! -f modules.config.json ] && [ -f modules.config.json.example ]; then
  cp modules.config.json.example modules.config.json
  echo "  Copied modules.config.json.example to modules.config.json"
fi

# Every component's setup.sh. A component setup is usually an optional data
# pipeline (python venv, .env), so a failure is reported but does not stop the
# other components.
FAILED=""
for script in */setup.sh; do
  [ -f "$script" ] || continue
  component=$(dirname "$script")
  echo ""
  echo "  --> $MODULE_NAME/$component..."
  if ! bash "$script"; then
    echo "  !! $MODULE_NAME/$component setup failed (continuing)"
    FAILED="$FAILED $component"
  fi
done

echo ""
if [ -n "$FAILED" ]; then
  echo "Module '$MODULE_NAME' setup finished, failed components:$FAILED"
  exit 1
fi

echo "Module '$MODULE_NAME' setup complete."
