import assert from "node:assert/strict";
import test from "node:test";
import { dedupeChatNameEntries } from "./nexo-store.js";

test("deduplicates chat/contact metadata by JID before PostgreSQL upsert", () => {
  const result = dedupeChatNameEntries([
    { jid: "5493532555555@s.whatsapp.net", name: "Nombre chat" },
    { jid: "120363000000000000@g.us", name: "Grupo" },
    { jid: "5493532555555@s.whatsapp.net", name: "Nombre contacto" },
    { jid: "", name: "inválido" },
    { jid: "111@s.whatsapp.net", name: "   " },
  ]);

  assert.deepEqual(result, [
    { jid: "5493532555555@s.whatsapp.net", name: "Nombre contacto" },
    { jid: "120363000000000000@g.us", name: "Grupo" },
  ]);
});
