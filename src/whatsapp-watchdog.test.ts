import test from "node:test";
import assert from "node:assert/strict";
import { WhatsappManager } from "./whatsapp-manager.js";

function linkedAccount(id = "account-1") {
  return {
    id,
    label: "Observed WhatsApp",
    role: "input",
    enabled: true,
    createdAt: new Date().toISOString(),
    linkedAt: new Date().toISOString(),
  } as any;
}

function runtime(overrides: Record<string, unknown> = {}) {
  return {
    accountId: "account-1",
    state: "error",
    reconnectAttempt: 1,
    updatedAt: new Date(),
    manualStop: false,
    reconnectBlocked: false,
    generation: 1,
    queue: Promise.resolve(),
    receivedMessages: 0,
    storedMessages: 0,
    historyMessages: 0,
    ...overrides,
  };
}

test("watchdog starts a linked account that has no resident session", async () => {
  const manager = new WhatsappManager({ listAccounts: async () => [linkedAccount()] } as any);
  const started: string[] = [];
  (manager as any).start = async (id: string) => {
    started.push(id);
    return { accountId: id, state: "connecting" };
  };

  const result = await manager.reconcileLinkedAccounts();
  assert.deepEqual(started, ["account-1"]);
  assert.equal(result.restarted, 1);
  assert.equal(result.blocked, 0);
});

test("watchdog retries a recoverable error session with no reconnect timer", async () => {
  const manager = new WhatsappManager({ listAccounts: async () => [linkedAccount()] } as any);
  (manager as any).sessions.set("account-1", runtime());
  let started = 0;
  (manager as any).start = async () => {
    started += 1;
    return { accountId: "account-1", state: "connecting" };
  };

  const result = await manager.reconcileLinkedAccounts();
  assert.equal(started, 1);
  assert.equal(result.restarted, 1);
});

test("watchdog does not retry terminal or manually stopped sessions", async () => {
  const store = { listAccounts: async () => [linkedAccount("blocked"), linkedAccount("manual")] };
  const manager = new WhatsappManager(store as any);
  (manager as any).sessions.set("blocked", runtime({
    accountId: "blocked",
    state: "error",
    reconnectBlocked: true,
  }));
  (manager as any).sessions.set("manual", runtime({
    accountId: "manual",
    state: "idle",
    manualStop: true,
  }));
  let started = 0;
  (manager as any).start = async () => {
    started += 1;
    return { accountId: "x", state: "connecting" };
  };

  const result = await manager.reconcileLinkedAccounts();
  assert.equal(started, 0);
  assert.equal(result.blocked, 2);
});
