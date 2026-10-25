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

## Not here (deliberately)

- `pi-dictate` — Voxtype already does system-wide dictation on this machine.
- `pi-interactive-subagents` — **pinned to a later session**, and it will be ported to herdr
  panes rather than used tmux-only. Running pi inside tmux inside a herdr pane works today as an
  interim.
- `pi-observational-memory` — next phase; needs a model choice for its two workers first.
- `deprecated/filechanges` — `git diff` already covers reviewing what pi changed.
