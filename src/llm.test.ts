import assert from "node:assert/strict";
import test from "node:test";
import { defaultSummaryAfter } from "./llm.js";

test("default summary window looks back the configured number of days", () => {
  const now = new Date("2026-08-21T23:00:00.000Z");
  assert.equal(defaultSummaryAfter(now, 3), "2026-08-18T23:00:00.000Z");
  assert.equal(defaultSummaryAfter(now, 7), "2026-08-14T23:00:00.000Z");
});
