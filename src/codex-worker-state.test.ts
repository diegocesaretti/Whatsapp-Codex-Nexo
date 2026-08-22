import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { CodexWorkerStateStore } from "./codex-worker-state.js";

test("Codex thread id persists per authorized peer", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-nexo-codex-state-"));
  try {
    const first = new CodexWorkerStateStore(dir);
    await first.setThreadId("5493532000000", "019f0000-1111-2222-3333-444444444444");
    await first.setThreadId("5493532111111", "019f0000-aaaa-bbbb-cccc-dddddddddddd");

    const reopened = new CodexWorkerStateStore(dir);
    assert.equal(await reopened.getThreadId("5493532000000"), "019f0000-1111-2222-3333-444444444444");
    assert.equal(await reopened.getThreadId("5493532111111"), "019f0000-aaaa-bbbb-cccc-dddddddddddd");
    assert.equal(await reopened.count(), 2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
