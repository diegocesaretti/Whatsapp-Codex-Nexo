import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderAdminPage } from "./ui.js";

test("admin page renders syntactically valid embedded JavaScript", () => {
  const html = renderAdminPage();
  assert.match(html, /Varias cuentas INPUT observadas/);
  assert.match(html, /Conversación bidireccional con Codex/);
  assert.match(html, /Números autorizados/);
  const match = html.match(/<script>([\s\S]*?)<\/script>/i);
  const script = match?.[1];
  assert.ok(script);
  assert.doesNotThrow(() => new vm.Script(script, { filename: "admin-inline.js" }));
});
