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
that cost a debugging round on 2026-10-25). It prints the steps it cannot automate: pi login, and herdr's own extension file. It also installs
the `pi-web-search` package if it is missing.

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
| `extensions/custom-header.ts` | replaces the startup header with the Athena owl-in-omega mark | **local design**, generated from `design/` — see below |
| `extensions/web-fetch/` | URL → clean markdown | |
| `web-search.json` | which model `web_search` uses | see *Web search* below |
| `extensions/bash-guard/` | prompts on risky bash; hard-blocks catastrophic bash in subagents | **local changes, see below** |
| `extensions/browser/` | Playwright headless Chromium, off until `/browser on` | |
| `extensions/observational-memory/` | tiered session memory: parallel observers → ledger → deterministic compaction; a consolidator writes `<project>/.memory/<sessionId>/` | **off by default**, `/om on` per session. **local patch, see below** |
| `extensions/subagents/` | async subagents: spawn pi children in herdr/tmux panes, steer results back (`subagent`, `subagent_message`, `ask_question`) | **herdr port, see below** |
| `design/` | the art: `athena_owl.py` (draws it), `emit-header.py` (regenerates the extension), `athena_preview.py` (renders it with colours) | not synced — design-time only |
| `skills/analyze-sessions/` | cost / prompt / session queries over `~/.pi/agent/sessions` | stdlib Python |
| `skills/pdf-reader/` | read PDFs | `uv` venv |
| `skills/youtube-transcript/` | YouTube title + transcript | needs `yt-dlp`, `ffmpeg` |
| `skills/web-debug/` | playbook for driving the browser tools | |

## Custom header

`extensions/custom-header.ts` replaces pi's built-in startup header. This one is **not a copy of
upstream's** — amos's version paints a large box-drawing `Π` in theme colours, and that file was
read as the pattern, not taken. The installed mark is a locally drawn one: an owl with pi legs
inside an olive wreath bent into an omega, in braille (30 columns × 13 rows), with
`☙Ω❧ pi · γλαυκῶπις` beneath it.

The palette is hardwired sRGB (sage wreath, darker olive owl, gold eyes and beak) rather than theme
tokens, so it **does not follow light/dark theme changes** — on a light background the sage reads
poorly. That is the design, not an accident.

It costs you the built-in header's keybinding hints and onboarding line. `/builtin-header` restores
the built-in header for the session; delete the file and `/reload` to restore it permanently.

The `ART` and `LABELS` arrays are **generated** — do not hand-edit them. Edit `design/athena_owl.py`
(the pixel-grid drawing), then run:

```bash
python3 design/emit-header.py     # rewrites extensions/custom-header.ts
```

and `/reload` inside pi. `design/athena_preview.py` renders the same mark with its colours in a
terminal without touching pi, which is the fast loop for tweaking the art. `LABELS` is parallel to
`ART` and marks each cell `1` wreath / `2` owl body / `3` face / `0` blank; where a cell mixes groups,
body wins over face and face over wreath — that priority comes from the generator's `max()` key and
is not the obvious order.

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

## Subagents (herdr port)

`extensions/subagents/` is a fork of `amosblomqvist/pi-interactive-subagents` v3.7.2, which was
tmux-only. The multiplexer calls are isolated in `pi-extension/subagents/surface.ts`, so the port
added a herdr backend beside the tmux one rather than replacing it:

- **The backend is picked at runtime** — herdr when `HERDR_ENV=1` and the `herdr` binary are
  present, tmux when `$TMUX` is set, `PI_SUBAGENT_MUX=herdr|tmux` to force one. herdr wins when
  both are present.
- **Splits target the widest pane in the tab** (ties → rightmost) instead of the parent pane.
  herdr halves the split target on every split and has no `select-layout` equivalent, so
  repeatedly splitting the parent would shrink it to nothing. Splitting the widest pane keeps the
  columns even, and herdr redistributes space itself when a pane closes.
- **herdr only splits right or down**, so `left`/`up` are treated as their mirror.
- **New panes are renamed** to the subagent name (`herdr pane rename`) — display-only, best-effort.
- The tmux path is unchanged, including the `even-horizontal` rebalance (`SUBAGENT_TMUX_LAYOUT`).

Verified 2026-10-25 inside a headless herdr session: the repo's surface suite (7/7) and the first
end-to-end lifecycle test — outer pi → subagent pi in a herdr pane → marker file written → result
steered back — both pass. `sync.sh` does not install this fork's deps; to run its tests:

```bash
cd extensions/subagents
npm install        # devDependencies only — nothing is needed at runtime
npm test           # unit
node --test --test-concurrency=1 test/integration/surface.test.ts   # run inside herdr or tmux
```

Not done: sibling subagents talking to **each other**. Only child→parent exists
(`ask_question` / `subagent_message`).

### Cross-harness: the Claude Code path (verified 2026-10-25)

Upstream's fork can run a subagent through the **Claude Code CLI** instead of pi, selected by an
extra frontmatter field. `agents/claude-worker.md` is the first agent here to use it:

```yaml
cli: claude
```

That takes the branch at `pi-extension/subagents/index.ts:1246`, which launches
`claude --dangerously-skip-permissions --plugin-dir <…/subagents/plugin> [--model …] <task>` in the
herdr pane. Completion is detected by the bundled Claude **Stop-hook plugin**
(`plugin/hooks/on-stop.sh`), which writes a sentinel only when the transcript contains exactly one
human message — i.e. the run was genuinely autonomous. Three independent observations confirmed it
end to end: the pane was created and closed by the parent, the child really ran Claude Code (herdr
reported it as `kind: claude` with a live session id, and a marker file it wrote existed on disk),
and the parent received a typed result.

Four things to know before adding more `cli: claude` agents:

- **`model:` is passed verbatim to `claude --model`**, which takes a Claude alias (`opus`, `sonnet`)
  or a full Claude model name — **not** an OpenRouter id. The other bundled agents' `model:` values
  are OpenRouter ids and would be wrong here. Omit the field to inherit Claude's own default.
- **pi's tool allowlist does not apply.** `tools:` is used only on the pi path, and upstream launches
  Claude with `--dangerously-skip-permissions`, so a `cli: claude` agent has *more* latitude than a
  pi agent with a restricted `tools:` list, and the field would be silently ignored.
- **The child's cwd must be a trusted Claude Code project.** The extension launches Claude
  *interactively* (no `-p`), and Claude only skips its workspace-trust dialog in non-interactive
  mode — so an untrusted directory stalls the spawn on a dialog. `~/.claude.json`'s
  `hasTrustDialogAccepted` per project is the field that decides this.
- **The child's Claude transcript is copied** into `~/.pi/agent/sessions/claude-code/`, and its id is
  returned as `claudeSessionId` — so each cross-harness child leaves a durable, resumable record.

## Web search

`web_search` comes from the **`pi-web-search` package**, not an extension folder:
`pi install npm:pi-web-search` (declared under `packages` in `settings.json`). It routes search
through the *model provider's* native search API, so it needs a supported model rather than an
API key of its own — the tool name stays `web_search`, which matters because the bundled
`researcher` subagent whitelists exactly that name.

`web-search.json` picks a dedicated search model, because the conversation default
(`openrouter/deepseek-v4.1-flash`) is served over `openai-completions` and has no native search:

```json
{ "provider": "openrouter", "model": "anthropic/claude-haiku-4.5" }
```

Supported dialects: `anthropic-messages`, `openai-responses`, `deepseek`, `google-generative-ai`,
`xai`, `ollama`. On OpenRouter that means the Anthropic-served models — verified working
(2026-10-25) with `anthropic/claude-haiku-4.5`, which returned a live result. Without a supported
model the tool returns a clear error listing the configured ones; it never silently switches models.

**Google Custom Search is dead.** The previous extension is gone because Google's docs state plainly:
*"The Custom Search JSON API is closed to new customers"* (existing customers until 2027-01-01).
A new GCP project gets `403 "This project does not have the access to Custom Search JSON API"`
no matter how correctly the key, the `cx` and the API enablement are set. Umar's key and `cx` are
still sitting in GCP and can be deleted.

Alternatives researched but not taken: **`pi-web-access`** (801K downloads/month) does zero-config
Exa search with no key at all, plus PDF extraction, YouTube understanding, GitHub cloning and an MCP
server — at 9.8 MB and 9 dependencies, and it would replace `web-fetch` too. OpenRouter's own
`openrouter:web_search` server tool is the cheapest per search ($0.007 Exa, or native passthrough)
but is beta and would need a ~100-line extension.

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
