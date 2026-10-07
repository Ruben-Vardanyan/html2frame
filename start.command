#!/bin/bash
# html2frame control panel (macOS): double-click in Finder to start; it opens http://localhost:5600
# First time only, if macOS says it cannot be opened: right-click → Open, or run `chmod +x start.command`.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
	# Finder starts a login shell without Homebrew's PATH on some Macs
	for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
if ! command -v node >/dev/null 2>&1; then
	echo "Node.js 18 or newer is needed: https://nodejs.org"
	read -r -p "Press Enter to close."
	exit 1
fi
if [ ! -d node_modules/playwright-core ]; then
	echo "First start: installing playwright-core (no browser download)..."
	npm install --omit=dev --no-audit --no-fund || { read -r -p "npm install failed. Press Enter to close."; exit 1; }
fi
node server.js --open
