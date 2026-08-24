import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderAdminPage } from "./ui.js";

test("admin page renders desktop-aware copy and syntactically valid embedded JavaScript", () => {
  const html = renderAdminPage();
  assert.match(html, /CODEX NEXO · WINDOWS · v0\.7/);
  assert.match(html, /múltiples INPUT observados/);
  assert.match(html, /Conversación bidireccional con Codex/);
  assert.match(html, /identidades habilitadas/);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script): script is string => Boolean(script));
  assert.ok(scripts.length >= 2);
  scripts.forEach((script, index) => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: `admin-inline-${index + 1}.js` }));
  });
});
