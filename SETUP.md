# SETUP — reproducing this pi setup on a fresh machine

**macOS-first**, Linux-supported. Written to be followed by a human *or* an LLM agent.

> **If you are an LLM agent reading this on a new machine:** read this whole file before running
> anything. Work through [Order of operations](#order-of-operations) one step at a time, running each
> step's *verify* command and checking the output before moving on. **Ask the human for every secret**
> (OpenRouter key, any login) rather than inventing one, and never write a key into this repo.
> Sections 4–6 contain the traps that cost the most time — the ones marked **silent** fail without an
> error message, which is why they are called out.

---

## 1. What this repo is, and what it does not reproduce

This is one person's **pi** configuration: extensions, skills, global `AGENTS.md`, agent definitions
and the settings that tie them together. `sync.sh` copies it into `~/.pi/agent`.

**Scope, stated plainly: this repo covers pi, and nothing about the harness layer around it.** Every
`cli: claude` agent in here needs herdr, herdr's integrations, and Claude Code to be installed
separately — none of that is in this repo, and none of it is copied by `sync.sh`. If you only run
`sync.sh` you get pi with a delegation system that cannot delegate.

Not here, by design: any credential (`auth.json`, browser profile, web-search key — see
`.gitignore`), the vault these agents are usually pointed at, and the config of Claude Code,
opencode or Hermes.

## 2. Requirements

### Required

| Tool | Why | macOS |
|---|---|---|
| **pi** | this config's target | `curl -fsSL https://pi.dev/install.sh \| sh`, or `npm i -g --ignore-scripts @earendil-works/pi-coding-agent` (needs Node ≥ 22.19) |
| **herdr** | every subagent spawns into a herdr pane | `curl -fsSL https://herdr.dev/install.sh \| sh` — the project's own install guide says Linux and macOS |
| **python3** | the Claude subagent's `Stop` hook parses JSON with it | `xcode-select --install`, or `brew install python` |
| **jq** | `sync.sh` and several skills shell out to it | `brew install jq` |
| **uv** | creates the pdf-reader venv | `brew install uv` |
| **git, curl, rsync** | clone, install, sync | preinstalled on macOS |

### Optional

`ffmpeg` + `yt-dlp` (youtube-transcript skill) · `tmux` (fallback multiplexer; the extension keeps a
tmux backend) · Claude Code, opencode, Hermes (only if you want cross-harness agents) ·
`node` if you install pi via npm.

**Playwright's Chromium is installed by `sync.sh` itself** if the browser extension is present —
it uses the vendored `playwright-core` CLI so the browser matches the library version. It downloads
~150 MB.

### macOS notes (verified, not assumed)

- **No `wl-clipboard` needed.** pi's clipboard code branches per platform: on `darwin` it shells out
  to `pbcopy`. The `wl-copy` dependency is Linux/Wayland-only and does not apply here.
- **Config paths are the same as Linux**, including `~/.config/herdr/config.toml` — herdr's own agent
  guide states Linux and macOS explicitly.
- **`sync.sh` is bash 3.2-safe** (checked for `mapfile`/`declare -A`/`${v,,}` — none used), so
  macOS's stock `/bin/bash` is fine. If you have Homebrew bash, `env bash` picks it up anyway.
- **`python3` is load-bearing and easy to miss.** The Claude subagent's completion is signalled by a
  `Stop` hook that parses JSON with `python3`. Without it the hook never fires, and the parent waits
  forever with no error — see trap 6.

## 3. Order of operations

### Step 1 — system tools

```bash
brew install jq uv node            # uv + node may already be present
xcode-select --install             # if python3 is missing
python3 --version && jq --version  # verify
```

### Step 2 — pi, and authenticate it

```bash
curl -fsSL https://pi.dev/install.sh | sh
pi --version
pi    # then run /login openrouter inside pi, or set OPENROUTER_API_KEY
```

The key is written to `~/.pi/agent/auth.json` (mode 600) and is deliberately not in this repo.
**Verify:** `~/.pi/agent/auth.json` exists and is mode 600.

### Step 3 — clone and sync

```bash
git clone https://github.com/<you>/pi-setup.git ~/Documents/pi-setup
cd ~/Documents/pi-setup
PI_SYNC_SETTINGS=1 ./sync.sh
```

**`PI_SYNC_SETTINGS=1` is not optional if you want this machine's model choices.** Without it
`sync.sh` deliberately leaves `settings.json` alone, so you get pi's own defaults instead of
`deepseek/deepseek-v4.1-flash` and the observational-memory block — and nothing tells you.

`sync.sh` is idempotent and copies only files this repo owns; it never touches `auth.json`,
`models-store.json`, `sessions/`, or herdr's own extension file.

**Verify:** `ls ~/.pi/agent/extensions/` shows subagents, observational-memory, bash-guard, browser,
web-fetch, prompt-snippets; `~/.pi/agent/settings.json` contains `deepseek/deepseek-v4.1-flash`.

### Step 4 — herdr (required for any subagent to work)

See [§5 Herdr and subagent spawning](#5-herdr-and-subagent-spawning) for the config file and the
integration commands. Minimum:

```bash
herdr --version
herdr integration install pi        # lifecycle state — without this, see trap 4
herdr integration status            # verify
```

### Step 5 — optional harnesses for cross-harness agents

The three `claude-*` agents launch the **Claude Code CLI** as a child process. Only do this if you
want them:

```bash
# Claude Code, then authenticate
herdr integration install claude
```

Also required for those agents: the `ponytail` skill in Claude Code (trap 5) and a **trusted
Claude Code project directory** (trap 3).

### Step 6 — reload

**pi caches its extensions in memory.** After `sync.sh`, run `/reload` inside pi, or start a new
session. A running session keeps the old code and will happily spawn children through the pre-edit
path — this is trap 1 and it is the single most misleading failure in this repo.

## 4. Configuration reference

### `settings.json`

`~/.pi/agent/settings.json` holds the default provider/model, the observational-memory model choices,
hidden thinking, and `packages` (`npm:pi-web-search`). Copied only with `PI_SYNC_SETTINGS=1`.

### Agent definitions

`extensions/subagents/agents/*.md` — markdown with YAML frontmatter. These are read **fresh on every
spawn**, so adding or editing one needs no reload.

| Field | Meaning |
|---|---|
| `name` | the identifier other agents use |
| `description` | shown in listings |
| `tools` | pi tool allowlist — **pi children only**; on a `cli: claude` agent this is now a loud error, because pi tool names are not Claude Code's and an unknown name is accepted silently |
| `model` | the model. **Path-dependent:** for a pi child this is an OpenRouter id; for a `cli: claude` child it is passed straight to `claude --model`, so it must be a Claude alias (`opus`, `sonnet`, `haiku`) or a full Claude model name. An OpenRouter id there breaks the launch |
| `cli` | `claude` launches the Claude Code CLI instead of pi |
| `claude-permissions` | `readonly` — replaces `--dangerously-skip-permissions` with an explicit allowlist: read tools plus `git diff/log/show/status`, with MCP connectors disabled. **Prefix rules**, so the agent must run bare `git log` in its own cwd; `git -C <path> log` is denied |
| `timeout-seconds` | ceiling on the child's runtime |
| `subagent_agents` | grants the spawning toolset, limited to the listed agents (pi children) |
| `auto-exit` | pi child exits itself when finished |
| `interactive` | for a CLI child, an explicit `true` keeps the parent waiting when the child blocks |
| `cwd` | working directory; also what a `cli: claude` child needs for its permission rules to match |
| `system-prompt` | `append` or `replace` (pi path) |

### Timeouts, and where they apply

The default ceiling applies **only to `cli:` children** — a CLI child that never signals completion
has no other way out. A pi child signals both success and failure through its own session files, so
it gets no ceiling unless its agent sets `timeout-seconds`. Do not "helpfully" apply the default to
pi children too: that loses the result of any long run.

## 5. Herdr and subagent spawning

### Config file

`~/.config/herdr/config.toml` (Linux **and** macOS; `%APPDATA%\herdr\config.toml` on Windows). Herdr
works without one. The contents used here:

```toml
onboarding = false

[ui]
status_indicators = "symbols"

[ui.toast]
delivery = "herdr"

[theme]
name = "gruvbox"
auto_switch = false
```

`herdr --default-config` prints the full default file if you want to see everything available.
`herdr server reload-config` applies edits to a running server. Don't invent keys — the reference is
<https://herdr.dev/docs/configuration/>.

### Integrations — the part that makes blocked detection work

```bash
herdr integration install pi        # → ~/.pi/agent/extensions/herdr-agent-state.ts
herdr integration install claude    # → ~/.claude/hooks/herdr-agent-state.sh
herdr integration install opencode  # → ~/.config/opencode/plugins/herdr-agent-state.js
herdr integration install hermes    # → ~/.hermes/plugins/herdr-agent-state/__init__.py
herdr integration status            # each line should read "current (vN)"
```

These files are **managed by herdr** — reinstalling or updating overwrites them, so put custom hooks
beside them, never in them. `sync.sh` deliberately does not touch them.

**Why it matters:** the pi subagents extension detects a *blocked* CLI child by reading herdr's
per-pane agent state (`herdr agent get`). With no integration there is no state to read, so the fix
degrades silently into a long timeout.

### What the extension needs

| Requirement | Consequence if missing |
|---|---|
| pi started **inside** herdr (so `HERDR_ENV=1` and `herdr` on `PATH`) | spawning fails with *"No supported terminal multiplexer found"* |
| `HERDR_ENV=1` | backend selection cannot pick herdr |
| `herdr` on `PATH` | same as above |

Backend selection: herdr when `HERDR_ENV=1` and `herdr` is on `PATH`; tmux when `$TMUX` is set;
herdr wins if both. `PI_SUBAGENT_MUX=herdr|tmux` forces one.

### Spawning behaviour worth knowing

- New panes are **splits off the widest pane in the current tab** (ties → rightmost), *not* the
  parent pane. herdr halves the split target on each split and has no `select-layout` equivalent, so
  repeatedly splitting the parent would shrink it to nothing.
- herdr only splits right or down, so `left`/`up` are treated as their mirror.
- New panes are renamed to the subagent name, display-only and best-effort.
- The caller's focus is preserved.

### Completion and blocked detection

- **Completion:** pi children write a sentinel through their own session file; `cli: claude` children
  are signalled by the plugin's `Stop` hook writing a sentinel file, which requires **`python3`**.
  A screen sentinel and an `.exit` sidecar are also checked, and completion is checked *before*
  agent state so a stale `blocked` reading cannot mask a finished child.
- **Blocked:** two consecutive `blocked` readings, sampled every fourth tick — about **8 s**, not
  instant. The debounce exists so one stale sample cannot abandon a working child. On detection the
  parent reports the block and **leaves the pane open** rather than killing it.

### Verify the whole path

```bash
herdr integration status                 # pi/claude/... "current"
herdr agent list                         # shows each pane's agent kind and state
```

Then, from a pi session running inside herdr, spawn something trivial (`scout` is read-only and
cheap) and confirm a pane appears, a result comes back, and the pane closes itself.

### Install herdr's skill so agents can drive it

Herdr ships a skill that teaches an agent to control panes:

```bash
npx skills add herdrdev/herdr --skill herdr -g
```

Source of truth if the CLI route doesn't apply: <https://raw.githubusercontent.com/herdrdev/herdr/master/skills/herdr/SKILL.md>.

## 6. Traps

Ordered by how much time they waste. **Silent** means no error message.

1. **A running pi session holds the old extensions in memory** — **silent**. After `sync.sh` you must
   `/reload` or start a new session. Otherwise spawns use the pre-edit code, which presents as
   "my fix didn't work" while the files on disk are correct. The giveaway is an *artefact* — a file
   that should have been refused appearing anyway.
2. **`sync.sh` skips `settings.json` unless `PI_SYNC_SETTINGS=1`** — **silent**. The machine then
   runs pi's defaults, not these ones.
3. **A `cli: claude` child needs a trusted Claude Code project** — otherwise it stalls on the
   workspace-trust dialog. The child is launched *interactively* (no `-p`), and Claude Code only
   skips that dialog in non-interactive mode. Trust status lives per project in `~/.claude.json`
   (`hasTrustDialogAccepted`). Looks like a hang, not an error.
4. **herdr integrations are per-agent, not per-herdr** — **silent**. Installing herdr alone gives you
   panes but no lifecycle state, so blocked detection quietly degrades to a timeout.
5. **The `ponytail` skill is a Claude Code skill, not part of pi** — a `cli: claude` reviewer that is
   told to use it will lose that lens if `~/.claude/skills/ponytail` is absent.
6. **`python3` missing breaks the Claude child's completion silently** — the `Stop` hook can't parse
   its JSON input, so no sentinel is ever written and the parent waits. No error anywhere.
7. **`model:` means different things on different paths** — an OpenRouter id in a `cli: claude` agent
   is passed to `claude --model` and fails. Pi-path agents want OpenRouter ids; claude-path agents
   want Claude aliases.
8. **`tools:` on a `cli: claude` agent** — now a deliberate loud error rather than a silent no-op.
   The two name spaces differ, and Claude Code accepts an unknown tool name without complaint,
   producing a child with *no* tools.
9. **A permissive rule in `~/.claude/settings.json` survives a restricted mode** — under
   `--permission-mode dontAsk` the user's own allow rules still apply. On the machine this came from,
   that included `Bash(ssh root@<host> *)`, so a nominally read-only reviewer could still reach a
   server. Consider `--setting-sources project` or `--restricted` (both untested here).
10. **`herdr` blocks nested launches by design** — never tell someone to run `herdr` from inside one
    of its own panes.
11. **Don't reuse `git -C` in a read-only claude agent** — the allow rules are prefix rules, so
    `git -C /path log` is denied while `git log` (run in the agent's own cwd) is allowed.
12. **Vendored forks carry devDependencies but no lockfile.** `sync.sh` skips `npm install` for
    packages with no runtime `dependencies`, which is why `~/.pi/agent` stays small. To run the
    subagents fork's own tests, install in `extensions/subagents` (dev-only, nothing needed at
    runtime).

## 7. Is this set up correctly?

- [ ] `pi --version` works and `/login openrouter` succeeded
- [ ] `PI_SYNC_SETTINGS=1 ./sync.sh` ran, and `~/.pi/agent/settings.json` names `deepseek-v4.1-flash`
- [ ] `/reload` has been run in any session that predates the sync
- [ ] `herdr --version` works and `herdr integration status` shows `current` lines
- [ ] a trivial `scout` spawn from inside herdr returns a result and closes its pane
- [ ] (cross-harness only) `claude` runs, `~/.claude/skills/ponytail` exists, and the project dir is trusted

## 8. Authoritative sources

Prefer these over anything written above if they disagree:

- Herdr — agent guide <https://herdr.dev/agent-guide.md>, docs <https://herdr.dev/docs/>, install <https://herdr.dev/docs/install/>, configuration <https://herdr.dev/docs/configuration/>, agents & integrations <https://herdr.dev/docs/agents/>
- pi — <https://pi.dev/docs/>
- Upstreams this repo vendors or forks: see `UPSTREAM.md`
