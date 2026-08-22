import { renderAdminPage as renderV4 } from "./ui-v4.js";

export function renderAdminPage(): string {
  return renderV4()
    .replace("CODEX NEXO · WHATSAPP · v0.4", "CODEX NEXO · WHATSAPP · v0.5")
    .replace(
      "Varias cuentas INPUT observadas, una cuenta OUTPUT para Codex y una Conversación bidireccional con Codex que puede responder automáticamente mediante el worker residente.",
      "Varias cuentas INPUT observadas, una cuenta OUTPUT para Codex y una conversación bidireccional con worker residente. El OUTPUT autorizado también acepta fotos, audios, documentos y videos mediante el inbox multimodal local.",
    )
    .replace(
      "Storage, Windows, conversación OUTPUT, worker residente y resumen LLM.",
      "Storage, Windows, conversación OUTPUT, worker residente, inbox multimodal y resumen LLM.",
    );
}
