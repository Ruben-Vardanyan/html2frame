#!/bin/bash
# html2frame (macOS): double-click in Finder to start. The first start checks this Mac and asks about the icons
# (src/setup.js, D21). html2frame then runs in this window: Quit in the panel, or closing the window, stops it.
# First time only, if macOS says it cannot verify the file: System Settings → Privacy & Security → Open Anyway
# (macOS 15 and later), or right-click → Open → Open (macOS 12–14).
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
	# Finder starts a login shell without Homebrew's PATH on some Macs
	for p in /opt/homebrew/bin /usr/local/bin; do [ -x "$p/node" ] && export PATH="$p:$PATH"; done
fi
# keep the version in step with "engines" in package.json
if ! command -v node >/dev/null 2>&1; then
	echo
	echo "  [!!] Node.js is missing. Please install Node.js 20 or newer from https://nodejs.org (the LTS version),"
	echo "       then start html2frame again."
	echo
	read -r -p "  Press Enter to close."
	exit 1
fi
if ! node src/start.js; then
	read -r -p "  Press Enter to close."
	exit 1
fi
echo "  html2frame has stopped. You can close this window."
