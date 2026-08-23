import { augmentIdentityUi } from "./ui-identities.js";
import { renderAdminPage as renderV4 } from "./ui-v4.js";

export function renderAdminPage(): string {
  const base = renderV4()
    .replace("CODEX NEXO · WHATSAPP · v0.4", "CODEX NEXO · WHATSAPP · v0.6")
    .replace(
      "Varias cuentas INPUT observadas, una cuenta OUTPUT para Codex y una Conversación bidireccional con Codex que puede responder automáticamente mediante el worker residente.",
      "Varias cuentas INPUT observadas, una cuenta OUTPUT para Codex y una conversación bidireccional con identidades humanas. Los INPUT vinculados se autorizan por defecto y podés asignar nombre, apodo, rol y permisos por persona.",
    )
    .replace(
      "Storage, Windows, conversación OUTPUT, worker residente y resumen LLM.",
      "Storage, Windows, identidades, conversación OUTPUT, worker residente, inbox multimodal y resumen LLM.",
    )
    .replace(
      "Sólo chats directos de Números autorizados. INPUT sigue siendo no confiable.",
      "Sólo chats directos de identidades habilitadas. La allowlist numérica se deriva automáticamente; INPUT sigue siendo no confiable.",
    )
    .replace(
      "Invoca tu Codex CLI autenticado y mantiene una sesión por número autorizado.",
      "Invoca tu Codex CLI autenticado y mantiene una sesión por persona/número autorizado.",
    );
  return augmentIdentityUi(base);
}
