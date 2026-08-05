#!/bin/bash
# Double-click starter for macOS: installs on first run, starts the viewer, opens the browser.
# First open of a downloaded copy: right-click this file and choose Open (Gatekeeper warning).
cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo "Node.js is not installed yet. Opening nodejs.org: download the LTS installer,"
  echo "run it with the default options, then double-click this file again."
  open "https://nodejs.org"
  read -r -p "Press return to close this window."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "First run: downloading the viewer's components. This runs once and takes a few minutes."
  npm install || { read -r -p "npm install failed. Press return to close."; exit 1; }
fi

# Open the browser only once the server actually answers, never onto a dead error page.
(
  for _ in $(seq 1 120); do
    if curl -sf -o /dev/null "http://127.0.0.1:3810"; then
      open "http://localhost:3810"
      exit 0
    fi
    sleep 1
  done
) &

echo "Starting CBCTScope. Leave this window open while reading; press Ctrl-C or close it to stop."
npm run dev
