import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isRetryableWindowsReplaceError, writeTextAtomic } from "./atomic-file.js";

test("classifies transient Windows file replacement errors", () => {
  for (const code of ["EPERM", "EACCES", "EBUSY", "EEXIST", "ENOTEMPTY"]) {
    assert.equal(isRetryableWindowsReplaceError(Object.assign(new Error(code), { code })), true);
  }
  assert.equal(isRetryableWindowsReplaceError(Object.assign(new Error("bad"), { code: "EINVAL" })), false);
});

test("falls back to a direct overwrite after repeated Windows rename failures", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-atomic-"));
  const path = join(root, "accounts.json");
  try {
    await writeFile(path, "old\n", "utf8");
    let attempts = 0;
    await writeTextAtomic(path, "new\n", {
      renameFile: async () => {
        attempts += 1;
        throw Object.assign(new Error("locked"), { code: "EPERM" });
      },
      wait: async () => undefined,
    });
    assert.equal(attempts, 6);
    assert.equal(await readFile(path, "utf8"), "new\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
