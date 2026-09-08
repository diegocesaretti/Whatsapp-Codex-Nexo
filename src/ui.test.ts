import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { renderAdminPage } from "./ui.js";

test("admin page renders complete v5 navigation and syntactically valid embedded JavaScript", () => {
  const html = renderAdminPage();
  assert.match(html, />Resumen</);
  assert.match(html, />Cuentas</);
  assert.match(html, />Personas</);
  assert.match(html, />Codex</);
  assert.match(html, /data-nav="archive"/);
  assert.match(html, />Archivo</);
  assert.match(html, />Configuración</);
  assert.match(html, /id="advanced-form"/);
  assert.match(html, /Iniciar Nexo con Windows/);
  assert.match(html, /data-person-edit=/);
  assert.match(html, /\/api\/messages\/search/);
  assert.match(html, /\/api\/messages\/recent/);
  assert.match(html, /gpt-5\.6-sol/);
  assert.match(html, /replace\(\/\\D\/g/);
  assert.match(html, /split\(\/\\s\+\//);

  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter((script): script is string => Boolean(script));
  assert.ok(scripts.length >= 2);
  scripts.forEach((script, index) => {
    assert.doesNotThrow(() => new vm.Script(script, { filename: `admin-inline-${index + 1}.js` }));
  });
});
