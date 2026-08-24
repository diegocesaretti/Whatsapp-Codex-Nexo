import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { discoverDatabaseUrl, normalizeDatabaseSslMode } from "./config.js";

test("discovers DATABASE_URL from sibling SOL .env", async () => {
  const root = await mkdtemp(join(tmpdir(), "wa-nexo-config-"));
  try {
    const nexo = join(root, "Whatsapp-Codex-Nexo");
    const sol = join(root, "SOL");
    await mkdir(nexo, { recursive: true });
    await mkdir(sol, { recursive: true });
    await writeFile(join(sol, ".env"), "DATABASE_URL=postgresql://sol-neon.example/test\n", "utf8");
    const result = discoverDatabaseUrl(nexo, {});
    assert.equal(result.url, "postgresql://sol-neon.example/test");
    assert.equal(result.source, "sol-env");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("NEXO_DATABASE_URL has priority over inherited SOL configuration", async () => {
  const result = discoverDatabaseUrl(process.cwd(), {
    NEXO_DATABASE_URL: "postgresql://nexo.example/test",
    DATABASE_URL: "postgresql://generic.example/test",
  });
  assert.equal(result.url, "postgresql://nexo.example/test");
  assert.equal(result.source, "nexo-env");
});

test("legacy pg sslmode aliases are pinned to verify-full", () => {
  assert.equal(
    normalizeDatabaseSslMode("postgresql://user:pass@example/test?sslmode=require&channel_binding=require"),
    "postgresql://user:pass@example/test?sslmode=verify-full&channel_binding=require",
  );
  assert.equal(
    normalizeDatabaseSslMode("postgresql://example/test?sslmode=verify-full"),
    "postgresql://example/test?sslmode=verify-full",
  );
});
