#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

API_URL="http://127.0.0.1:3001"
WEB_URL="http://localhost:5173/"

open_url() {
  if command -v open >/dev/null 2>&1; then
    open "$1"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1 || true
  else
    echo "[PokerCRM] Open $1 in your browser."
  fi
}

command -v node >/dev/null 2>&1 || {
  echo "[PokerCRM] Node.js not found."
  echo "[PokerCRM] Install Node.js >= 22.5 from https://nodejs.org/ and run ./start.sh again."
  exit 1
}

if ! node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 5) ? 0 : 1)'; then
  echo "[PokerCRM] Node.js $(node -v) is too old - Node.js >= 22.5 is required: https://nodejs.org/"
  exit 1
fi

if [ ! -f .env ] && [ -f .env.example ]; then
  echo "[PokerCRM] .env not found - creating from .env.example"
  cp .env.example .env
fi

if [ ! -d node_modules ]; then
  echo "[PokerCRM] node_modules not found - installing dependencies via npm install..."
  npm install
fi

# Once the Vite dev server answers, open the browser (background helper).
(
  if command -v curl >/dev/null 2>&1; then
    for _ in $(seq 1 120); do
      curl -fsS "$WEB_URL" >/dev/null 2>&1 && break
      sleep 0.5
    done
  else
    sleep 5
  fi
  open_url "$WEB_URL"
) &

echo "[PokerCRM] launching dev servers: API $API_URL, UI $WEB_URL"
echo "[PokerCRM] press Ctrl+C to stop"
exec npm run dev
