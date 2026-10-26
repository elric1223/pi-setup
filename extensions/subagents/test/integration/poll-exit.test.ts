/**
 * Integration tests for pollForExit's escape hatches.
 *
 * These cover the two ways a child that never signals completion used to wedge
 * the caller forever. Found 2026-10-25: a `cli: claude` subagent that is waiting
 * on a question shows as `blocked`, not stopped — Claude Code's Stop hook never
 * fires, so no sentinel is written and no screen marker is printed, and
 * `pollForExit` had no deadline. The parent waited indefinitely.
 *
 *   - `timeoutMs`        — a plain deadline; works on any backend.
 *   - `stopWhenBlocked`  — herdr's per-pane agent state. herdr-only, and faked
 *                          here with `herdr pane report-agent` so the test needs
 *                          no real agent and no LLM call.
 *
 * Run inside herdr or tmux:  npm run test:integration
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pollForExit, getAgentState } from "../../pi-extension/subagents/surface.ts";
import {
  getAvailableBackends,
  createTestEnv,
  cleanupTestEnv,
  createTrackedSurfaceSplit,
  closeSurface,
  untrackSurface,
  sendCommand,
  sleep,
  uniqueId,
  trackTempFile,
  type TestEnv,
} from "./harness.ts";

const backends = getAvailableBackends();
const isHerdr = (backend: string) => backend === "herdr";

if (backends.length === 0) {
  console.log("⚠️  No multiplexer available — skipping pollForExit integration tests");
}

/** Tell herdr that `pane` hosts an agent in `state`, the way a real integration does. */
function reportAgentState(pane: string, state: string): void {
  execFileSync(
    "herdr",
    [
      "pane",
      "report-agent",
      "--source",
      "test:fake",
      "--agent",
      "claude",
      "--state",
      state,
      pane,
    ],
    { stdio: "ignore" },
  );
}

for (const backend of backends) {
  describe(`pollForExit [${backend}]`, { timeout: 60_000 }, () => {
    let env: TestEnv;

    before(() => {
      env = createTestEnv();
    });

    after(() => {
      cleanupTestEnv(env);
    });

    it("returns timeout instead of waiting forever when no completion signal arrives", async () => {
      const surface = createTrackedSurfaceSplit(env, "poll-timeout", "right");
      sendCommand(surface, "sleep 300"); // never exits, writes nothing
      await sleep(1500);

      const started = Date.now();
      const result = await pollForExit(surface, new AbortController().signal, {
        interval: 300,
        timeoutMs: 2500,
      });
      const elapsed = Date.now() - started;

      assert.equal(result.reason, "timeout");
      assert.ok(elapsed >= 2000, `should have waited for the deadline (waited ${elapsed}ms)`);
      assert.ok(elapsed < 15_000, `should not overshoot the deadline (waited ${elapsed}ms)`);

      closeSurface(surface);

      untrackSurface(env, surface);
    });

    it("completion still wins over a blocked reading (ordering)", async () => {
      // A pane that reports blocked AND already has its sentinel must be read as
      // finished — completion is checked before agent state, so a stale or
      // concurrent `blocked` cannot mask a real result.
      const surface = createTrackedSurfaceSplit(env, "poll-order", "right");
      const sentinel = join(tmpdir(), `pi-subagent-sentinel-${uniqueId()}`);
      writeFileSync(sentinel, "done");
      trackTempFile(env, sentinel);
      if (isHerdr(backend)) reportAgentState(surface, "blocked");
      await sleep(500);

      const result = await pollForExit(surface, new AbortController().signal, {
        interval: 300,
        sentinelFile: sentinel,
        stopWhenBlocked: true,
        statusEveryTicks: 1,
        blockedSamples: 1,
        timeoutMs: 20_000,
      });

      assert.equal(result.reason, "sentinel");

      closeSurface(surface);

      untrackSurface(env, surface);
    });

    if (isHerdr("herdr")) {
      describe("blocked detection [herdr]", { timeout: 60_000 }, () => {
        it("returns blocked when herdr reports the pane's agent as blocked, and only when asked", async () => {
          const surface = createTrackedSurfaceSplit(env, "poll-blocked", "right");
          reportAgentState(surface, "blocked");
          await sleep(1000);

          const state = await getAgentState(surface);
          assert.equal(state?.status, "blocked", "herdr should report the faked state");

          // Opted in → stops promptly instead of waiting for a signal that will
          // never come.
          const optedIn = await pollForExit(surface, new AbortController().signal, {
            interval: 300,
            stopWhenBlocked: true,
            statusEveryTicks: 1,
            blockedSamples: 1,
            timeoutMs: 20_000,
          });
          assert.equal(optedIn.reason, "blocked");
          assert.equal(optedIn.blocked?.status, "blocked");
          assert.equal(optedIn.blocked?.agent, "claude");

          // Not opted in → `blocked` must be ignored, because that is what keeps
          // pi children (whose ask_question flow relies on staying open) working.
          const optedOut = await pollForExit(surface, new AbortController().signal, {
            interval: 300,
            timeoutMs: 2500,
          });
          assert.equal(optedOut.reason, "timeout");

          closeSurface(surface);

          untrackSurface(env, surface);
        });

        it("tolerates a pane with no agent at all (unknown, not blocked)", async () => {
          const surface = createTrackedSurfaceSplit(env, "poll-noagent", "right");
          await sleep(1000);

          assert.equal(await getAgentState(surface), null);

          const result = await pollForExit(surface, new AbortController().signal, {
            interval: 300,
            stopWhenBlocked: true,
            statusEveryTicks: 1,
            blockedSamples: 1,
            timeoutMs: 2500,
          });
          assert.equal(result.reason, "timeout");

          closeSurface(surface);

          untrackSurface(env, surface);
        });
      });
    } else {
      describe("blocked detection [tmux]", { timeout: 60_000 }, () => {
        it("has no agent-state view, so blocked never triggers", async () => {
          const surface = createTrackedSurfaceSplit(env, "poll-tmux", "right");
          await sleep(1000);

          assert.equal(await getAgentState(surface), null);

          const result = await pollForExit(surface, new AbortController().signal, {
            interval: 300,
            stopWhenBlocked: true,
            statusEveryTicks: 1,
            blockedSamples: 1,
            timeoutMs: 2500,
          });
          assert.equal(result.reason, "timeout");

          closeSurface(surface);

          untrackSurface(env, surface);
        });
      });
    }
  });
}
