#!/usr/bin/env bash
# Apply this pi config to ~/.pi/agent on this machine.
# Idempotent: copies only files this repo owns. Never touches auth.json,
# models-store.json, sessions/, or herdr's own extension file.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
AGENT="${PI_AGENT_DIR:-$HOME/.pi/agent}"

echo "repo  : $REPO"
echo "target: $AGENT"
mkdir -p "$AGENT/extensions" "$AGENT/skills" "$AGENT/agents"

rsync -a --exclude node_modules --exclude .profile --exclude auth.json \
	"$REPO/extensions/" "$AGENT/extensions/"
rsync -a --exclude .venv --exclude __pycache__ "$REPO/skills/" "$AGENT/skills/"
cp "$REPO/AGENTS.md" "$AGENT/AGENTS.md"

# web-search model selection (only meaningful with the pi-web-search package below)
if [ -f "$REPO/web-search.json" ]; then
	cp "$REPO/web-search.json" "$AGENT/web-search.json"
	echo "web-search.json: copied"
fi

# pi-web-search is a package, so it is declared in settings.json, not copied as a folder.
# Installing here keeps a fresh machine working without a manual step.
if ! pi list 2>/dev/null | grep -q "pi-web-search"; then
	echo "pi install: npm:pi-web-search"
	pi install npm:pi-web-search
fi

# settings.json holds the model choice, which is per machine. Copy only on request.
if [ "${PI_SYNC_SETTINGS:-0}" = "1" ]; then
	cp "$REPO/settings.json" "$AGENT/settings.json"
	echo "settings.json: copied (PI_SYNC_SETTINGS=1)"
else
	echo "settings.json: left alone (set PI_SYNC_SETTINGS=1 to copy)"
fi

# Extension-local deps. Only packages with runtime `dependencies` need
# node_modules; vendored forks that carry devDependencies for their own test
# suites (observational-memory, subagents) would otherwise pull a whole
# toolchain into ~/.pi/agent for nothing.
for pkg in "$AGENT"/extensions/*/package.json; do
	[ -e "$pkg" ] || continue
	dir=$(dirname "$pkg")
	if [ -d "$dir/node_modules" ]; then
		continue
	fi
	deps=$(jq -r '.dependencies // {} | length' "$pkg" 2>/dev/null || echo 0)
	if [ "$deps" = "0" ]; then
		echo "deps: none, skipping npm install: $dir"
		continue
	fi
	echo "npm install: $dir"
	(cd "$dir" && npm install --silent)
done

# pdf-reader needs its own venv (uv, not pip)
if [ -f "$AGENT/skills/pdf-reader/requirements.txt" ] && [ ! -d "$AGENT/skills/pdf-reader/.venv" ]; then
	echo "uv venv: pdf-reader"
	uv venv "$AGENT/skills/pdf-reader/.venv"
	uv pip install --python "$AGENT/skills/pdf-reader/.venv/bin/python" \
		-r "$AGENT/skills/pdf-reader/requirements.txt"
fi

# Playwright's browser must match the installed playwright-core version, so use the
# local CLI — `npx playwright install` fetches the latest and silently mismatches.
if [ -f "$AGENT/extensions/browser/node_modules/playwright-core/cli.js" ]; then
	if ! ls -d "$HOME"/.cache/ms-playwright/chromium_headless_shell-* >/dev/null 2>&1; then
		echo "playwright chromium: installing"
		(cd "$AGENT/extensions/browser" && node node_modules/playwright-core/cli.js install chromium)
	fi
fi

cat <<'MANUAL'
Manual steps this script cannot do:
  1. pi auth: /login openrouter (writes ~/.pi/agent/auth.json). web_search uses a model from
     this account, so it needs no search API key of its own.
  2. herdr manages ~/.pi/agent/extensions/herdr-agent-state.ts itself.
Then run /reload inside pi.
MANUAL
