import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverDesktopCodexBundles,
  environmentWithCodexPath,
  windowsCodexCandidates,
} from "./codex-cli.js";

test("Windows Codex discovery includes the common npm global shim", () => {
  const candidates = windowsCodexCandidates({
    APPDATA: "C:\\Users\\diego\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\diego\\AppData\\Local",
    USERPROFILE: "C:\\Users\\diego",
  });
  assert.ok(candidates.some((item) => item.source === "npm-global" && /AppData[\\/]Roaming[\\/]npm[\\/]codex\.cmd$/i.test(item.path)));
  assert.ok(candidates.some((item) => item.source === "winget" && /WinGet[\\/]Links[\\/]codex\.exe$/i.test(item.path)));
});

test("explicit NEXO_CODEX_PATH is the first Windows discovery candidate", () => {
  const candidates = windowsCodexCandidates({
    NEXO_CODEX_PATH: "C:\\Tools\\Codex\\codex.cmd",
    APPDATA: "C:\\Users\\diego\\AppData\\Roaming",
  });
  assert.equal(candidates[0]?.source, "env");
  assert.match(candidates[0]?.path ?? "", /Codex[\\/]codex\.cmd$/i);
});

test("resolved Codex directory is prepended to the child PATH", () => {
  const env = environmentWithCodexPath("/opt/codex/bin/codex", { PATH: "/usr/bin" });
  const pathValue = env.PATH ?? env.Path ?? "";
  assert.ok(pathValue.includes("/opt/codex/bin"));
  assert.ok(pathValue.includes("/usr/bin"));
});

test("complete Codex Desktop bundle is preferred over an incomplete cached version", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-codex-bundle-"));
  try {
    const localAppData = join(root, "Local");
    const binRoot = join(localAppData, "OpenAI", "Codex", "bin");
    const incomplete = join(binRoot, "oldhash");
    const complete = join(binRoot, "newhash");
    await mkdir(incomplete, { recursive: true });
    await mkdir(complete, { recursive: true });
    await writeFile(join(incomplete, "codex.exe"), "old", "utf8");
    await writeFile(join(complete, "codex.exe"), "new", "utf8");
    await writeFile(join(complete, "codex-code-mode-host.exe"), "host", "utf8");

    const bundles = await discoverDesktopCodexBundles({ LOCALAPPDATA: localAppData });
    assert.equal(bundles.length, 2);
    assert.equal(bundles[0]?.complete, true);
    assert.match(bundles[0]?.cliPath ?? "", /newhash[\\/]codex\.exe$/i);
    assert.match(bundles[0]?.codeModeHostPath ?? "", /newhash[\\/]codex-code-mode-host\.exe$/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex plugin appserver bundle is discovered as a complete fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-codex-plugin-"));
  try {
    const plugin = join(root, ".codex", "plugins", ".plugin-appserver");
    await mkdir(plugin, { recursive: true });
    await writeFile(join(plugin, "codex.exe"), "cli", "utf8");
    await writeFile(join(plugin, "codex-code-mode-host.exe"), "host", "utf8");

    const bundles = await discoverDesktopCodexBundles({ USERPROFILE: root });
    assert.equal(bundles.length, 1);
    assert.equal(bundles[0]?.complete, true);
    assert.equal(bundles[0]?.directory, plugin);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop helper path is exported when it sits beside codex.exe", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-codex-env-"));
  try {
    const cli = join(root, "codex.exe");
    const host = join(root, "codex-code-mode-host.exe");
    await writeFile(cli, "cli", "utf8");
    await writeFile(host, "host", "utf8");
    const env = environmentWithCodexPath(cli, { PATH: "base" });
    assert.equal(env.CODEX_CODE_MODE_HOST_PATH, host);
    assert.ok((env.PATH ?? env.Path ?? "").includes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
