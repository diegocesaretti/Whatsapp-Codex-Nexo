import assert from "node:assert/strict";
import test from "node:test";
import { preferredOfficialCodexPath } from "./codex-cli-preference.js";

test("explicit Codex override wins over discovered official bundles", () => {
  assert.equal(preferredOfficialCodexPath({
    explicit: "C:\\Tools\\codex.exe",
    desktopBundles: [{
      directory: "C:\\Desktop",
      cliPath: "C:\\Desktop\\codex.exe",
      complete: true,
      missingFiles: [],
      modifiedAtMs: 2,
    }],
  }), "C:\\Tools\\codex.exe");
});

test("complete official Desktop bundle is preferred before AppX/global fallbacks", () => {
  assert.equal(preferredOfficialCodexPath({
    desktopBundles: [
      { directory: "old", cliPath: "old\\codex.exe", complete: false, missingFiles: ["x"], modifiedAtMs: 3 },
      { directory: "new", cliPath: "new\\codex.exe", complete: true, missingFiles: [], modifiedAtMs: 2 },
    ],
    appxPackages: [{
      version: "1",
      packageFullName: "OpenAI.Codex",
      installLocation: "appx",
      cliPath: "appx\\codex.exe",
      codeModeHostPath: "appx\\codex-code-mode-host.exe",
      sandboxSetupPath: "appx\\codex-windows-sandbox-setup.exe",
      commandRunnerPath: "appx\\codex-command-runner.exe",
    }],
  }), "new\\codex.exe");
});

test("complete AppX bundle is used when no complete Desktop cache exists", () => {
  assert.equal(preferredOfficialCodexPath({
    desktopBundles: [],
    appxPackages: [{
      version: "1",
      packageFullName: "OpenAI.Codex",
      installLocation: "appx",
      cliPath: "appx\\codex.exe",
      codeModeHostPath: "appx\\codex-code-mode-host.exe",
      sandboxSetupPath: "appx\\codex-windows-sandbox-setup.exe",
      commandRunnerPath: "appx\\codex-command-runner.exe",
    }],
  }), "appx\\codex.exe");
});
