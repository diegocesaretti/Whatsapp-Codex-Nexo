import assert from "node:assert/strict";
import test from "node:test";
import { environmentWithCodexPath, windowsCodexCandidates } from "./codex-cli.js";

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
  const originalPlatform = process.platform;
  const env = environmentWithCodexPath("/opt/codex/bin/codex", { PATH: "/usr/bin" });
  const pathValue = env.PATH ?? env.Path ?? "";
  assert.ok(pathValue.includes("/opt/codex/bin"));
  assert.ok(pathValue.includes("/usr/bin"));
  assert.ok(originalPlatform);
});
