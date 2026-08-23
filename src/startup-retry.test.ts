import assert from "node:assert/strict";
import test from "node:test";
import {
  isTransientStartupError,
  retryTransientStartup,
  startupRetryDelayMs,
  transientStartupCode,
} from "./startup-retry.js";

test("classifies DNS and network startup failures as transient", () => {
  const dns = Object.assign(new Error("getaddrinfo ENOTFOUND ep-example.neon.tech"), { code: "ENOTFOUND" });
  assert.equal(transientStartupCode(dns), "ENOTFOUND");
  assert.equal(isTransientStartupError(dns), true);
  assert.equal(isTransientStartupError(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), true);
  assert.equal(isTransientStartupError(new Error("password authentication failed")), false);
  assert.equal(isTransientStartupError(new Error("schema whatsapp_nexo is missing")), false);
});

test("retry delay backs off and caps at the final interval", () => {
  assert.equal(startupRetryDelayMs(1), 2_000);
  assert.equal(startupRetryDelayMs(2), 5_000);
  assert.equal(startupRetryDelayMs(5), 60_000);
  assert.equal(startupRetryDelayMs(20), 60_000);
});

test("retries transient failure without exiting the process", async () => {
  let calls = 0;
  const sleeps: number[] = [];
  const logs: string[] = [];
  const value = await retryTransientStartup("Neon", async () => {
    calls += 1;
    if (calls < 3) throw Object.assign(new Error("getaddrinfo ENOTFOUND neon"), { code: "ENOTFOUND" });
    return "ok";
  }, {
    delaysMs: [1, 2],
    sleep: async (ms) => { sleeps.push(ms); },
    log: (line) => logs.push(line),
  });

  assert.equal(value, "ok");
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [1, 2]);
  assert.match(logs.at(-1) ?? "", /recovered after 2 transient failure/);
});

test("does not retry configuration or authentication errors", async () => {
  let calls = 0;
  await assert.rejects(
    retryTransientStartup("Neon", async () => {
      calls += 1;
      throw new Error("password authentication failed");
    }, { sleep: async () => undefined }),
    /password authentication failed/,
  );
  assert.equal(calls, 1);
});
