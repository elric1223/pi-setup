/**
 * Surface layer — the terminal multiplexer this extension drives.
 *
 * Everything the extension does to a pane goes through the small API in this
 * file: create/split a pane, type a command into it, read its screen, close
 * it, and poll for exit. Keeping the multiplexer calls isolated here means
 * index.ts stays testable without a multiplexer running.
 *
 * Two backends are supported and chosen at runtime:
 *   - herdr  when `HERDR_ENV=1` and the `herdr` binary is on PATH
 *   - tmux   when `$TMUX` is set and the `tmux` binary is on PATH
 *
 * `PI_SUBAGENT_MUX=herdr|tmux` forces one. herdr wins when both are present
 * (a tmux-inside-herdr nest is deliberate, but the panes belong to herdr).
 *
 * Panes are identified by backend-native ids (herdr `w1:p2`, tmux `%12`).
 * Splits default to the parent pi pane so they follow the agent rather than
 * the user's focus.
 */
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const execFileAsync = promisify(execFile);

// ── Availability ──

export type MuxBackend = "herdr" | "tmux";

const commandAvailability = new Map<string, boolean>();

function hasCommand(command: string): boolean {
  if (commandAvailability.has(command)) {
    return commandAvailability.get(command)!;
  }

  let available = false;
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "ignore" });
    available = true;
  } catch {
    available = false;
  }

  commandAvailability.set(command, available);
  return available;
}

/**
 * True when running inside a herdr-managed pane with the herdr binary on PATH.
 * `HERDR_ENV=1` is injected by herdr into every process it spawns.
 */
function isHerdrAvailable(): boolean {
  return process.env.HERDR_ENV === "1" && hasCommand("herdr");
}

/**
 * True when running inside tmux with the tmux binary on PATH.
 * `TMUX` is set by tmux in every process it spawns (shell or pane).
 */
export function isTmuxAvailable(): boolean {
  return !!process.env.TMUX && hasCommand("tmux");
}

function muxPreference(): MuxBackend | null {
  const pref = (process.env.PI_SUBAGENT_MUX ?? "").trim().toLowerCase();
  if (pref === "herdr" || pref === "tmux") return pref;
  return null;
}

export function getMuxBackend(): MuxBackend | null {
  const pref = muxPreference();
  if (pref === "herdr") return isHerdrAvailable() ? "herdr" : null;
  if (pref === "tmux") return isTmuxAvailable() ? "tmux" : null;

  if (isHerdrAvailable()) return "herdr";
  if (isTmuxAvailable()) return "tmux";
  return null;
}

export function isMuxAvailable(): boolean {
  return getMuxBackend() !== null;
}

export function muxSetupHint(): string {
  const pref = muxPreference();
  if (pref === "herdr") return "Start pi inside herdr.";
  if (pref === "tmux") return "Start pi inside tmux (`tmux new -A -s pi 'pi'`).";
  return "Start pi inside herdr, or inside tmux (`tmux new -A -s pi 'pi'`).";
}

function requireMuxBackend(): MuxBackend {
  const backend = getMuxBackend();
  if (!backend) {
    throw new Error(`No supported terminal multiplexer found. ${muxSetupHint()}`);
  }
  return backend;
}

// ── Shell helpers ──

export function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── tmux backend ──

/**
 * tmux layout applied to the subagent window to keep panes evenly sized.
 * Switchable: "even-horizontal" (equal columns, matches Ctrl+b Alt+1),
 * "main-vertical" (big main pane + tiled column), "tiled" (grid).
 */
const SUBAGENT_TMUX_LAYOUT = "even-horizontal";

let rebalanceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Re-balance subagent panes so repeated splits don't leave them lopsided.
 * tmux halves the target pane on every split and dumps freed space onto a
 * neighbor on close, so without this panes drift to wildly uneven widths.
 * Applies SUBAGENT_TMUX_LAYOUT to the parent pi window. Debounced so a burst
 * of parallel spawns or staggered exits collapses into a single layout call,
 * and non-fatal: a cosmetic resize must never break spawning or watching.
 *
 * herdr needs no equivalent: spawns target the widest pane (see
 * herdrWidestPane) and herdr redistributes space itself when a pane closes.
 */
function rebalanceSurfaces(hintPane?: string): void {
  if (getMuxBackend() !== "tmux") return;
  // Prefer the parent pi pane (stable; survives a closing subagent pane).
  const target = process.env.TMUX_PANE ?? hintPane;
  if (!target) return;
  if (rebalanceTimer) clearTimeout(rebalanceTimer);
  rebalanceTimer = setTimeout(() => {
    rebalanceTimer = null;
    try {
      // -t <pane> resolves to that pane's window; does not change focus.
      execFileSync("tmux", ["select-layout", "-t", target, SUBAGENT_TMUX_LAYOUT], {
        encoding: "utf8",
      });
    } catch {
      // Pane/window may be gone; balancing is best-effort.
    }
  }, 120);
}

/**
 * Create a new tmux split in the given direction from an optional source pane.
 * Returns the new pane id (e.g. `%12`).
 */
function tmuxCreateSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  void name; // tmux panes are not named; the pi process inside shows its own title.

  const args = ["split-window", "-d"];
  if (direction === "left" || direction === "right") {
    args.push("-h");
  } else {
    args.push("-v");
  }
  if (direction === "left" || direction === "up") {
    args.push("-b");
  }
  if (fromSurface) {
    args.push("-t", fromSurface);
  }
  args.push("-P", "-F", "#{pane_id}");

  const pane = execFileSync("tmux", args, { encoding: "utf8" }).trim();
  if (!pane.startsWith("%")) {
    throw new Error(`Unexpected tmux split-window output: ${pane}`);
  }

  rebalanceSurfaces(pane);
  return pane;
}

function tmuxSendCommand(surface: string, command: string): void {
  execFileSync("tmux", ["send-keys", "-t", surface, "-l", command], { encoding: "utf8" });
  execFileSync("tmux", ["send-keys", "-t", surface, "Enter"], { encoding: "utf8" });
}

function tmuxReadScreen(surface: string, lines: number): string {
  return execFileSync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    {
      encoding: "utf8",
    },
  );
}

async function tmuxReadScreenAsync(surface: string, lines: number): Promise<string> {
  const { stdout } = await execFileAsync(
    "tmux",
    ["capture-pane", "-p", "-t", surface, "-S", `-${Math.max(1, lines)}`],
    { encoding: "utf8" },
  );
  return stdout;
}

function tmuxCloseSurface(surface: string): void {
  execFileSync("tmux", ["kill-pane", "-t", surface], { encoding: "utf8" });
  rebalanceSurfaces();
}

// ── herdr backend ──

function herdrExec(args: string[]): string {
  return execFileSync("herdr", args, { encoding: "utf8" });
}

/**
 * Pick the widest pane in the tab containing `paneId` (ties → rightmost).
 *
 * herdr halves the split target on every split, so repeatedly splitting one
 * pane would shrink it to nothing. Splitting the widest pane instead keeps the
 * columns roughly even — the herdr equivalent of tmux's `even-horizontal`
 * rebalance above. Best-effort: falls back to the caller pane on any failure.
 */
function herdrWidestPane(paneId: string): string | null {
  try {
    const out = JSON.parse(herdrExec(["pane", "layout", "--pane", paneId]));
    const panes: any[] = out?.result?.layout?.panes ?? [];
    let best: any = null;
    for (const pane of panes) {
      if (!best) {
        best = pane;
        continue;
      }
      const width = pane?.rect?.width ?? 0;
      const bestWidth = best?.rect?.width ?? 0;
      if (width > bestWidth || (width === bestWidth && (pane?.rect?.x ?? 0) > (best?.rect?.x ?? 0))) {
        best = pane;
      }
    }
    return best?.pane_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a new herdr pane: a split off the widest pane in the parent pi's tab,
 * so new panes follow the agent rather than the user's focus, and no single
 * pane is halved repeatedly.
 *
 * herdr only splits right or down, so `left`/`up` are treated as their mirror.
 * Returns the new pane id (e.g. `w1:p2`).
 */
function herdrCreateSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  const dir = direction === "left" ? "right" : direction === "up" ? "down" : direction;
  const parent = process.env.HERDR_PANE_ID;
  const target = fromSurface ?? (parent ? herdrWidestPane(parent) ?? parent : null);

  const args = ["pane", "split", "--direction", dir, "--no-focus", "--cwd", process.cwd()];
  if (target) {
    args.push("--pane", target);
  }

  let out: string;
  try {
    out = herdrExec(args);
  } catch (error: any) {
    throw new Error(`herdr pane split failed: ${error?.message ?? String(error)}`);
  }

  const pane = JSON.parse(out)?.result?.pane?.pane_id;
  if (typeof pane !== "string" || pane === "") {
    throw new Error(`Unexpected herdr pane split output: ${out}`);
  }

  // Label the pane so the sidebar shows which subagent owns it. Display-only
  // and best-effort — never let a cosmetic rename break a spawn.
  try {
    herdrExec(["pane", "rename", pane, name]);
  } catch {}

  return pane;
}

/**
 * Type a command into a herdr pane and submit it. Sent literally, then
 * submitted with Enter, so special characters are not interpreted as keys.
 */
function herdrSendCommand(surface: string, command: string): void {
  herdrExec(["pane", "send-text", surface, command]);
  herdrExec(["pane", "send-keys", surface, "Enter"]);
}

function herdrReadScreen(surface: string, lines: number): string {
  return herdrExec([
    "pane",
    "read",
    surface,
    "--source",
    "recent-unwrapped",
    "--lines",
    String(Math.max(1, lines)),
    "--format",
    "text",
  ]);
}

async function herdrReadScreenAsync(surface: string, lines: number): Promise<string> {
  const { stdout } = await execFileAsync(
    "herdr",
    [
      "pane",
      "read",
      surface,
      "--source",
      "recent-unwrapped",
      "--lines",
      String(Math.max(1, lines)),
      "--format",
      "text",
    ],
    { encoding: "utf8" },
  );
  return stdout;
}

function herdrCloseSurface(surface: string): void {
  herdrExec(["pane", "close", surface]);
}

// ── herdr agent state ──

export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export interface AgentState {
  status: AgentStatus;
  /** Which harness herdr thinks it is ("pi", "claude", …). */
  agent?: string;
  /** Terminal title — herdr keeps it in sync with what the agent is showing. */
  detail?: string;
}

/**
 * herdr's own view of the agent occupying a pane.
 *
 * This is exactly the signal file- and screen-based completion detection cannot
 * see. An agent waiting on a question is `blocked`, not stopped: it never
 * writes a completion marker and never prints the sentinel, so polling files
 * cannot tell "still working" apart from "waiting for a human" — and the second
 * case waits forever. herdr already distinguishes them per pane.
 *
 * herdr-only (the tmux backend has no equivalent). Returns null — never throws —
 * when unavailable, when no agent is detected in the pane, or on any error.
 * Callers must read null as "unknown", never as a state.
 */
export async function getAgentState(surface: string): Promise<AgentState | null> {
  if (getMuxBackend() !== "herdr") return null;

  try {
    const { stdout } = await execFileAsync("herdr", ["agent", "get", surface], {
      encoding: "utf8",
    });
    const agent = JSON.parse(stdout)?.result?.agent;
    const status = agent?.agent_status;
    if (typeof status !== "string") return null;

    return {
      status: status as AgentStatus,
      ...(typeof agent?.agent === "string" ? { agent: agent.agent } : {}),
      ...(typeof agent?.terminal_title_stripped === "string" && agent.terminal_title_stripped !== ""
        ? { detail: agent.terminal_title_stripped }
        : {}),
    };
  } catch {
    // No agent in the pane yet, pane gone, herdr unavailable — all "unknown".
    return null;
  }
}

// ── Surface primitives ──

/**
 * Create a new pane for a subagent and return its backend-native id.
 */
export function createSurface(name: string): string {
  requireMuxBackend();
  return getMuxBackend() === "herdr"
    ? herdrCreateSplit(name, "right")
    : tmuxCreateSplit(name, "right", process.env.TMUX_PANE);
}

/**
 * Create a new split in the given direction from an optional source pane.
 * Returns the backend-native pane id.
 */
export function createSurfaceSplit(
  name: string,
  direction: "left" | "right" | "up" | "down",
  fromSurface?: string,
): string {
  requireMuxBackend();
  return getMuxBackend() === "herdr"
    ? herdrCreateSplit(name, direction, fromSurface)
    : tmuxCreateSplit(name, direction, fromSurface);
}

/**
 * Send a command string to a pane and execute it.
 */
export function sendCommand(surface: string, command: string): void {
  requireMuxBackend();
  if (getMuxBackend() === "herdr") {
    herdrSendCommand(surface, command);
  } else {
    tmuxSendCommand(surface, command);
  }
}

/**
 * Send a long command to a pane by writing it to a script file first.
 * This avoids terminal line-wrapping issues that break commands exceeding the
 * pane's column width when sent character-by-character via sendCommand.
 *
 * By default the script is written to a temp directory, but callers can pass a
 * stable path (for example under session artifacts) so the exact invocation is
 * preserved for debugging.
 *
 * Returns the script path.
 */
export function sendLongCommand(
  surface: string,
  command: string,
  options?: { scriptPath?: string; scriptPreamble?: string },
): string {
  const scriptPath =
    options?.scriptPath ??
    join(
      tmpdir(),
      "pi-subagent-scripts",
      `cmd-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.sh`,
    );
  mkdirSync(dirname(scriptPath), { recursive: true });

  const scriptParts = ["#!/bin/bash"];
  if (options?.scriptPreamble) {
    scriptParts.push(options.scriptPreamble.trimEnd());
  }
  scriptParts.push(command);

  writeFileSync(scriptPath, scriptParts.join("\n") + "\n", {
    mode: 0o755,
  });
  sendCommand(surface, `bash ${shellEscape(scriptPath)}`);
  return scriptPath;
}

/**
 * Read the screen contents of a pane (sync).
 */
export function readScreen(surface: string, lines = 50): string {
  requireMuxBackend();
  return getMuxBackend() === "herdr"
    ? herdrReadScreen(surface, lines)
    : tmuxReadScreen(surface, lines);
}

/**
 * Read the screen contents of a pane (async).
 */
export async function readScreenAsync(surface: string, lines = 50): Promise<string> {
  requireMuxBackend();
  return getMuxBackend() === "herdr"
    ? herdrReadScreenAsync(surface, lines)
    : tmuxReadScreenAsync(surface, lines);
}

/**
 * Close a pane.
 */
export function closeSurface(surface: string): void {
  requireMuxBackend();
  if (getMuxBackend() === "herdr") {
    herdrCloseSurface(surface);
  } else {
    tmuxCloseSurface(surface);
  }
}

// ── Exit polling ──

export interface PollResult {
  /** How the subagent exited */
  reason: "done" | "sentinel" | "error" | "blocked" | "timeout";
  /** Shell exit code (from sentinel). 0 for file-based exits. */
  exitCode: number;
  /** Error message if reason is "error" (auto-retry exhausted, provider overload, etc.) */
  errorMessage?: string;
  /** What herdr saw, when reason is "blocked". */
  blocked?: AgentState;
}

/**
 * Interpret an `.exit` sidecar payload (written by the error path in
 * subagent-done.ts). Centralized so both the fast and slow paths in
 * pollForExit decode the payload the same way. Clean completions write no
 * sidecar and are detected via the terminal sentinel instead.
 *
 * Note: ask_question does NOT write a `.exit` sidecar — it keeps the session
 * open and signals the parent via a separate `.ask` file (see deliverPendingQuestion).
 */
function interpretExitSidecar(data: any): PollResult {
  if (data?.type === "error") {
    const errorMessage =
      typeof data.errorMessage === "string" && data.errorMessage.trim() !== ""
        ? data.errorMessage
        : "Subagent exited with stopReason=error (no errorMessage in sidecar).";
    return { reason: "error", exitCode: 1, errorMessage };
  }
  return { reason: "done", exitCode: 0 };
}

export const __pollForExitTest__ = { interpretExitSidecar };

/**
 * Poll until the subagent exits. Checks for a `.exit` sidecar file first
 * (written by the error path), falling back to the terminal sentinel for
 * clean-completion and crash detection.
 *
 * Two ways out exist for a child that never signals completion, both opt-in so
 * existing behaviour is unchanged when they are not passed:
 *
 *  - `stopWhenBlocked` — return as soon as herdr reports the pane's agent
 *    `blocked`. A blocked agent has not stopped, so no completion signal is
 *    coming; without this the caller waits forever (verified 2026-10-25).
 *  - `timeoutMs` — a hard ceiling, so "still running" is a returned outcome
 *    rather than a hang, whatever the cause.
 */
export async function pollForExit(
  surface: string,
  signal: AbortSignal,
  options: {
    interval: number;
    sessionFile?: string;
    sentinelFile?: string;
    onTick?: (elapsed: number) => void;
    /** Hard ceiling on the wait. Omit to wait indefinitely (legacy behaviour). */
    timeoutMs?: number;
    /**
     * Treat `blocked` as terminal. Only for children with no in-band way to ask
     * the parent: a pi child answers `ask_question` through its `.ask` file, so
     * for it blocked is a normal intermediate state and this must stay off.
     */
    stopWhenBlocked?: boolean;
    /** Poll herdr agent state every N ticks (default 4, i.e. ~4s at interval 1000). */
    statusEveryTicks?: number;
    /** Consecutive `blocked` samples before giving up (default 2), so one stale
     *  sample cannot abandon a child that is actually working. */
    blockedSamples?: number;
  },
): Promise<PollResult> {
  const start = Date.now();
  const statusEveryTicks = Math.max(1, options.statusEveryTicks ?? 4);
  const blockedSamplesNeeded = Math.max(1, options.blockedSamples ?? 2);
  let blockedSeen = 0;
  let tick = 0;

  for (;;) {
    if (signal.aborted) {
      throw new Error("Aborted while waiting for subagent to finish");
    }

    // Fast path: check for .exit sidecar file (written by the error path)
    if (options.sessionFile) {
      try {
        const exitFile = `${options.sessionFile}.exit`;
        if (existsSync(exitFile)) {
          const data = JSON.parse(readFileSync(exitFile, "utf-8"));
          rmSync(exitFile, { force: true });
          return interpretExitSidecar(data);
        }
      } catch {}
    }

    // Check Claude sentinel file (written by plugin Stop hook)
    if (options.sentinelFile) {
      try {
        if (existsSync(options.sentinelFile)) {
          return { reason: "sentinel", exitCode: 0 };
        }
      } catch {}
    }

    // Slow path: read terminal screen for sentinel (crash detection)
    try {
      const screen = await readScreenAsync(surface, 5);
      const match = screen.match(/__SUBAGENT_DONE_(\d+)__/);
      if (match) {
        return { reason: "sentinel", exitCode: parseInt(match[1], 10) };
      }
    } catch {
      // Surface may have been destroyed — check if .exit file appeared in the meantime
      if (options.sessionFile) {
        try {
          const exitFile = `${options.sessionFile}.exit`;
          if (existsSync(exitFile)) {
            const data = JSON.parse(readFileSync(exitFile, "utf-8"));
            rmSync(exitFile, { force: true });
            return interpretExitSidecar(data);
          }
        } catch {}
      }
    }

    const elapsed = Math.floor((Date.now() - start) / 1000);
    options.onTick?.(elapsed);

    if (options.timeoutMs != null && Date.now() - start >= options.timeoutMs) {
      return { reason: "timeout", exitCode: 0 };
    }

    if (options.stopWhenBlocked) {
      tick += 1;
      if (tick % statusEveryTicks === 0) {
        const state = await getAgentState(surface);
        if (state?.status === "blocked") {
          blockedSeen += 1;
          if (blockedSeen >= blockedSamplesNeeded) {
            return { reason: "blocked", exitCode: 0, blocked: state };
          }
        } else {
          blockedSeen = 0;
        }
      }
    }

    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) return reject(new Error("Aborted"));
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      }, options.interval);
      function onAbort() {
        clearTimeout(timer);
        reject(new Error("Aborted"));
      }
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}
