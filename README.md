# pi-setup

My [pi](https://pi.dev) agent configuration, kept in git so the same setup can be reproduced on
another machine (work computer) rather than re-assembled by hand.

Most of this is copied from [amosblomqvist/pi-config](https://github.com/amosblomqvist/pi-config)
and its sibling repos — see `UPSTREAM.md` for what came from where and what was changed locally.

## Apply on a machine

```bash
git clone <this repo> ~/Documents/pi-setup
~/Documents/pi-setup/sync.sh
```

`sync.sh` copies into `~/.pi/agent`, installs extension npm deps, creates the `pdf-reader` venv
with `uv`, and downloads the Playwright browser **with the locally installed
`playwright-core`** (`npx playwright install` fetches the latest and silently mismatches —
that cost a debugging round on 2026-10-25). It prints the steps it cannot automate: pi login,
the Google Custom Search key for `web-search`, and herdr's own extension file.

It never touches:

| Path | Why |
|---|---|
| `~/.pi/agent/auth.json` | API keys |
| `~/.pi/agent/models-store.json` | per-machine model cache |
| `~/.pi/agent/sessions/` | session history |
| `~/.pi/agent/extensions/herdr-agent-state.ts` | managed by `herdr`, overwritten on its updates |

`settings.json` holds the model choice, which is per machine — `PI_SYNC_SETTINGS=1 sync.sh` copies
it, plain `sync.sh` leaves the existing one alone.

## What is here

| Path | What | Notes |
|---|---|---|
| `AGENTS.md` | global instructions, applies in every project | points at `~/Documents/ob_notes`; kept short because every session pays for it |
| `settings.json` | pi settings | model, changelog version |
| `extensions/ask-user-question.ts` | the agent asks a question in a UI popup | |
| `extensions/prompt-snippets/` | toggle reusable rules onto a message (`alt+s`) | |
| `extensions/web-search/` | Google Custom Search | needs credentials, not in git |
| `extensions/web-fetch/` | URL → clean markdown | |
| `extensions/bash-guard/` | prompts on risky bash; hard-blocks catastrophic bash in subagents | **local changes, see below** |
| `extensions/browser/` | Playwright headless Chromium, off until `/browser on` | |
| `extensions/observational-memory/` | tiered session memory: parallel observers → ledger → deterministic compaction; a consolidator writes `<project>/.memory/<sessionId>/` | **off by default**, `/om on` per session. **local patch, see below** |
| `skills/analyze-sessions/` | cost / prompt / session queries over `~/.pi/agent/sessions` | stdlib Python |
| `skills/pdf-reader/` | read PDFs | `uv` venv |
| `skills/youtube-transcript/` | YouTube title + transcript | needs `yt-dlp`, `ffmpeg` |
| `skills/web-debug/` | playbook for driving the browser tools | |

## Local changes to upstream

`extensions/bash-guard/index.ts` is not vanilla. Two changes, both to stop it fighting this
machine's workflow while keeping the guard meaningful:

1. **No prompt on every `git` command.** Upstream prompts on any git invocation plus shell
   redirections (`>`, `>>`), bare pipes, `<`, `sed -i`… In a vault that commits on a session
   branch, that is a prompt per command. Only the high-risk git subcommands prompt now
   (`rm`, `clean -f`, `reset --hard`, `checkout/restore .`, `push --force`, `reflog expire`,
   `gc --prune`), and the redirection / bare-pipe / input-redirection rules are gone.
   `curl|sh` / `wget|sh` and `curl … |` still have their own rules.
2. **Bug fix: git global options no longer evade the rules.** Upstream took the subcommand from
   `rest[0]`, so `git -C /path clean -f` read sub `-C` and skipped every check. Confirmed by
   running it against the unpatched file (it ran), then fixed by skipping git's global options
   and their values. Verified after the fix: `git -C … status` runs, `git -C … clean -f` blocks.

The subagent hard-block list is unchanged — that half is the valuable one, since spawned
subagents have no UI to prompt at.

## observational-memory configuration

Configured in `settings.json` under `observational-memory`. The workers are chosen for **tool
reliability, not price** — the observer's only output is repeated `record_observations` calls, and
the consolidator drives `read`/`write`/`edit`/`grep` over `.memory/`. A worker with weak tool
calling fails silently: the chunk is simply never remembered.

| Slot | Model | Cost |
|---|---|---|
| `observer` | `nvidia/nemotron-3.5-lightning:free` | free |
| `observerFallback` | `inclusionai/ling-3.0-flash` | $0.021 / $0.063 per M tokens |
| `consolidator` | `deepseek/deepseek-v4-flash-0731` | $0.044 / $0.133 per M tokens |

**Local patch (`observerFallback` does not exist upstream).** A free SKU that 404s or 429s would
otherwise lose that slice of conversation silently — the observer's failure path writes an *empty
but valid* result file, so the ledger cannot tell "nothing worth recording" from "the model never
ran". `src/config.ts` gains an optional `models.observerFallback`, and `src/hooks/observer-trigger.ts`
tries it once when the primary exits non-zero (an empty result from a *successful* run is not
retried — that is a legitimately empty chunk, and retrying would double the spend). A toast
names both models when the switch happens.

Verified 2026-10-25 by driving the worker directly: the free model emitted 5 well-formed
observations at `$0`, the fallback model emitted 6 at `$0.00013`, an invalid model id exited `1`
(proving the signal the retry keys on), and the repo's own suite still passes (`98 passed`,
`tsc --noEmit` clean). **Not yet exercised:** the retry firing inside a live session — that needs a
real >10k-token session with `/om on`.

## Not here (deliberately)

- `pi-dictate` — Voxtype already does system-wide dictation on this machine.
- `pi-interactive-subagents` — **pinned to a later session**, and it will be ported to herdr
  panes rather than used tmux-only. Running pi inside tmux inside a herdr pane works today as an
  interim.
- `deprecated/filechanges` — `git diff` already covers reviewing what pi changed.
