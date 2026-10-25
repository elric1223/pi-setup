# Where each piece came from

| Local path | Upstream | Commit/version | Modified locally? |
|---|---|---|---|
| `extensions/ask-user-question.ts` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `extensions/prompt-snippets/` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `extensions/web-fetch/` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `extensions/bash-guard/` | amosblomqvist/pi-config | cloned 2026-10-25 | **yes** — see README "Local changes to upstream" |
| `extensions/browser/` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `skills/analyze-sessions/` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `skills/pdf-reader/` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `skills/web-debug/` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `skills/youtube-transcript/` | amosblomqvist/pi-config | cloned 2026-10-25 | no |
| `extensions/observational-memory/` | amosblomqvist/pi-observational-memory | cloned 2026-10-25, v0.1.0 | **yes** — `models.observerFallback` + one retry on non-zero exit, see README |
| `extensions/subagents/` | amosblomqvist/pi-interactive-subagents | cloned 2026-10-25, v3.7.2 | **yes** — herdr backend added to the surface layer; see README "Subagents (herdr port)" |

Upstream is a "copy the pieces you want" repo, not a package — it has no releases to track.
`pi-interactive-subagents` was read and **not** vendored initially because it was tmux-only; it is
now vendored with a herdr backend added (2026-10-25).

Removed 2026-10-25: `extensions/web-search/` (amosblomqvist) — Google closed the Custom Search
JSON API to new customers. Replaced by the `pi-web-search` package + `web-search.json`.

pi version this was verified against: **v1.4.0**. Upstream's subagents repo still declares
`@mariozechner/*` v0.65 peer deps; pi 1.4.0 aliases the old package scope and
`@sinclair/typebox` onto its bundled modules (`dist/core/extensions/virtual-modules.js`), which is
why both generations of extension load.
