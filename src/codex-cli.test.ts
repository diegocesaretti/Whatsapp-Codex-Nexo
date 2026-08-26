import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  REQUIRED_CODEX_WINDOWS_BUNDLE_FILES,
  codexAppxResourceCandidates,
  discoverDesktopCodexBundles,
  environmentForCodex,
  environmentWithCodexPath,
  parseCodexAppxPackageLines,
  windowsCodexCandidates,
} from "./codex-cli.js";

async function writeCompleteBundle(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true });
  for (const file of REQUIRED_CODEX_WINDOWS_BUNDLE_FILES) {
    await writeFile(join(directory, file), file, "utf8");
  }
}

test("Windows fallback candidates preserve npm, WinGet, Scoop and local-bin order", () => {
  const candidates = windowsCodexCandidates({
    APPDATA: "C:\\Users\\diego\\AppData\\Roaming",
    LOCALAPPDATA: "C:\\Users\\diego\\AppData\\Local",
    USERPROFILE: "C:\\Users\\diego",
  });
  const sources = candidates.map((item) => item.source);
  assert.equal(sources[0], "npm-global");
  assert.ok(sources.indexOf("winget") > sources.indexOf("npm-global"));
  assert.ok(sources.indexOf("scoop") > sources.indexOf("winget"));
  assert.ok(sources.indexOf("local-bin") > sources.indexOf("scoop"));
});

test("explicit NEXO_CODEX_PATH is the first declared Windows candidate", () => {
  const candidates = windowsCodexCandidates({
    NEXO_CODEX_PATH: "C:\\Tools\\Codex\\codex.exe",
    APPDATA: "C:\\Users\\diego\\AppData\\Roaming",
  });
  assert.equal(candidates[0]?.source, "env");
  assert.match(candidates[0]?.path ?? "", /Codex[\\/]codex\.exe$/i);
});

test("resolved Codex directory is prepended to the child PATH", () => {
  const env = environmentWithCodexPath("/opt/codex/bin/codex", { PATH: "/usr/bin" });
  const pathValue = env.PATH ?? env.Path ?? "";
  assert.ok(pathValue.includes("/opt/codex/bin"));
  assert.ok(pathValue.includes("/usr/bin"));
});

test("Microsoft Store package resource candidates do not hard-code the versioned WindowsApps folder", () => {
  const installLocation = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.818.5345.0_x64__2p2nqsd0c76g0";
  const candidates = codexAppxResourceCandidates(installLocation);
  assert.match(candidates.cliPath, /OpenAI\.Codex_26\.818\.5345\.0_x64__2p2nqsd0c76g0[\\/]app[\\/]resources[\\/]codex\.exe$/i);
  assert.match(candidates.codeModeHostPath, /app[\\/]resources[\\/]codex-code-mode-host\.exe$/i);
  assert.match(candidates.commandRunnerPath, /app[\\/]resources[\\/]codex-command-runner\.exe$/i);
  assert.match(candidates.sandboxSetupPath, /app[\\/]resources[\\/]codex-windows-sandbox-setup\.exe$/i);
});

test("parses complete OpenAI.Codex AppX package locations", () => {
  const root = "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.818.5345.0_x64__2p2nqsd0c76g0";
  const resources = `${root}\\app\\resources`;
  const output = `26.818.5345.0\tOpenAI.Codex_26.818.5345.0_x64__2p2nqsd0c76g0\t${root}\t${resources}\\codex.exe\t${resources}\\codex-code-mode-host.exe\t${resources}\\codex-windows-sandbox-setup.exe\t${resources}\\codex-command-runner.exe`;
  const packages = parseCodexAppxPackageLines(output);
  assert.equal(packages.length, 1);
  assert.equal(packages[0]?.version, "26.818.5345.0");
  assert.match(packages[0]?.cliPath ?? "", /codex\.exe$/i);
  assert.match(packages[0]?.codeModeHostPath ?? "", /codex-code-mode-host\.exe$/i);
  assert.match(packages[0]?.commandRunnerPath ?? "", /codex-command-runner\.exe$/i);
  assert.match(packages[0]?.sandboxSetupPath ?? "", /codex-windows-sandbox-setup\.exe$/i);
});

test("complete local Codex bundle is preferred over newer incomplete cached versions", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-codex-bundle-"));
  try {
    const localAppData = join(root, "Local");
    const binRoot = join(localAppData, "OpenAI", "Codex", "bin");
    const incomplete = join(binRoot, "newer-incomplete");
    const complete = join(binRoot, "d0097be4feba73d0");
    await mkdir(incomplete, { recursive: true });
    await writeFile(join(incomplete, "codex.exe"), "cli", "utf8");
    await writeFile(join(incomplete, "codex-code-mode-host.exe"), "host", "utf8");
    await writeCompleteBundle(complete);

    const bundles = await discoverDesktopCodexBundles({ LOCALAPPDATA: localAppData });
    assert.equal(bundles.length, 2);
    assert.equal(bundles[0]?.complete, true);
    assert.match(bundles[0]?.directory ?? "", /d0097be4feba73d0$/i);
    assert.deepEqual(bundles[0]?.missingFiles, []);
    assert.equal(bundles[1]?.complete, false);
    assert.ok(bundles[1]?.missingFiles.includes("codex-command-runner.exe"));
    assert.ok(bundles[1]?.missingFiles.includes("codex-windows-sandbox-setup.exe"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("bundle without code mode host is rejected as incomplete", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-codex-incomplete-"));
  try {
    const bundle = join(root, "bundle");
    await mkdir(bundle, { recursive: true });
    await writeFile(join(bundle, "codex.exe"), "cli", "utf8");
    await writeFile(join(bundle, "codex-command-runner.exe"), "runner", "utf8");
    await writeFile(join(bundle, "codex-windows-sandbox-setup.exe"), "sandbox", "utf8");
    const bundles = await discoverDesktopCodexBundles({ LOCALAPPDATA: join(root, "missing") });
    assert.equal(bundles.length, 0);

    const localAppData = join(root, "Local");
    const cached = join(localAppData, "OpenAI", "Codex", "bin", "bundle");
    await mkdir(cached, { recursive: true });
    await writeFile(join(cached, "codex.exe"), "cli", "utf8");
    await writeFile(join(cached, "codex-command-runner.exe"), "runner", "utf8");
    await writeFile(join(cached, "codex-windows-sandbox-setup.exe"), "sandbox", "utf8");
    const discovered = await discoverDesktopCodexBundles({ LOCALAPPDATA: localAppData });
    assert.equal(discovered[0]?.complete, false);
    assert.ok(discovered[0]?.missingFiles.includes("codex-code-mode-host.exe"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("complete bundle exposes CLI and tools through the worker environment", async () => {
  const root = await mkdtemp(join(tmpdir(), "nexo-codex-env-"));
  try {
    await writeCompleteBundle(root);
    const env = environmentForCodex({
      available: true,
      source: "desktop-app",
      checkedAt: new Date(0).toISOString(),
      path: join(root, "codex.exe"),
      bundleDir: root,
      codeModeHostPath: join(root, "codex-code-mode-host.exe"),
      codeModeHostAvailable: true,
      commandRunnerPath: join(root, "codex-command-runner.exe"),
      commandRunnerAvailable: true,
      sandboxSetupPath: join(root, "codex-windows-sandbox-setup.exe"),
      sandboxSetupAvailable: true,
      toolsAvailable: true,
    }, { PATH: "base" });
    assert.equal(env.CODEX_CODE_MODE_HOST_PATH, join(root, "codex-code-mode-host.exe"));
    assert.ok((env.PATH ?? env.Path ?? "").includes(root));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
