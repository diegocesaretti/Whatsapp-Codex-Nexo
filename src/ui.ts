import { augmentCodexStatusUi } from "./ui-codex-status.js";
import { augmentIdentityUi } from "./ui-identities.js";
import { renderAdminPage as renderV4 } from "./ui-v4.js";

export function renderAdminPage(): string {
  const base = renderV4()
    .replace("CODEX NEXO · WHATSAPP · v0.4", "CODEX NEXO · WINDOWS · v0.7.5")
    .replace(
      "Varias cuentas INPUT observadas, una cuenta OUTPUT para Codex y una Conversación bidireccional con Codex que puede responder automáticamente mediante el worker residente.",
      "Nexo puede ejecutarse como aplicación de Windows o daemon local. Mantiene múltiples INPUT observados, una cuenta OUTPUT para Codex y conversación bidireccional con identidades humanas.",
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
  return augmentCodexStatusUi(augmentIdentityUi(base));
}
