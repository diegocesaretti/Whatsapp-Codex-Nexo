# SOL Agent ↔ Nexo por WhatsApp (experimental)

Esta función **no está activada en la instalación actual**. No crea otro bot: reutiliza la cuenta OUTPUT autorizada y el trabajador Codex de Nexo.

## Comandos recibidos del propietario

El parser determinista `src/sol-agent-command.ts` se ejecuta **antes de Codex** y solamente para un único mensaje nuevo del canal OUTPUT autorizado. No toma órdenes de mensajes archivados, otros chats, adjuntos o respuestas del modelo.

Para habilitarlo en un **entorno aislado**, hacen falta todas estas condiciones: `NEXO_SOL_AGENT_COMMANDS_ENABLED=true`; `NEXO_SOL_AGENT_OWNER_PHONE` fijado por el administrador; número incluido en la lista OUTPUT y en una identidad Nexo `owner` habilitada para conversar con Codex; Nexo instalado bajo un miembro SOL propietario activo; permiso `mcp.invoke.submit` explícitamente aprobado; SOL Core con [PR #119](https://github.com/diegocesaretti/SOL/pull/119) y SOL Agent con [PR #117](https://github.com/diegocesaretti/SOL/pull/117). No basta configurar solo Nexo.

Comandos aceptados:

- `/agente misiones` y `/agente propuestas`
- `/agente crear negocio Investigar retrasos en la cola de producción y proponer prioridades.`
- `/agente crear hogar Revisar anomalías persistentes en los dispositivos del hogar.`
- `/agente pausar mission-abc123`
- `/agente reanudar mission-abc123`
- `/agente despertar mission-abc123`
- `/agente evaluar mission-abc123 123e4567-e89b-12d3-a456-426614174000 útil`

Nexo dirige estos comandos a `/v1/plugin-api/mcp/tools/invoke-read` para consultas y a `/v1/plugin-api/mcp/tools/invoke-submit` para cambios **del estado interno de misiones**, exclusivamente. No comparte `mcp.invoke.submit` con su catálogo MCP visible al modelo: el razonamiento de Codex nunca es prueba de autorización para modificar objetivos.

## Avisos proactivos

Nexo ofrece un segundo canal independiente de Morning Brief:

`POST http://127.0.0.1:3210/api/automation/sol-agent/notify`

Solo puede utilizarse tras activar `NEXO_SOL_AGENT_NOTIFY_ENABLED=true`, configurar su token secreto propio (`NEXO_SOL_AGENT_NOTIFY_TOKEN`, 24+ caracteres), y fijar `NEXO_SOL_AGENT_OWNER_PHONE` autorizado. SOL Agent debe tener el mismo secreto cargado como `SOL_AGENT_NEXO_NOTIFY_TOKEN` y su opción de notificación activada. No se incluyen secretos en el repositorio.

Restricciones de Nexo:
- Loopback HTTP; token diferente del de Morning Brief.
- Destinatario **propietario fijo**, comprobado contra identidad Nexo y allowlist OUTPUT; el remitente no puede suministrar `to`.
- Solo propuestas de prioridad alta, máximo 900 caracteres, y horario 08:00–20:59 de Buenos Aires.
- Como máximo un aviso por día, persistido mediante el registro de auditoría de salida, más un candado de concurrencia en el proceso.
- Desactivado de origen. No se exponen nuevas herramientas `send_whatsapp`, y el envío interactivo conserva la confirmación humana existente.

## Dependencias y seguridad

La función requiere tres revisiones separadas: [SOL Agent PR #117](https://github.com/diegocesaretti/SOL/pull/117), [SOL Core PR #119](https://github.com/diegocesaretti/SOL/pull/119) y [Nexo PR #42](https://github.com/diegocesaretti/Whatsapp-Codex-Nexo/pull/42). El razonamiento con Codex desde SOL Agent depende también del [Core PR #118](https://github.com/diegocesaretti/SOL/pull/118).

Antes de fusionar o instalar: comprobar los permisos de miembro y hogar con pruebas E2E, replay/duplicados, desconexiones de WhatsApp, comportamiento al reiniciar Nexo, privacidad de datos comerciales y una instalación aislada con procedimiento de reversión. **Las pruebas unitarias no autorizan despliegue al HTPC**.

Baileys es una integración no oficial de WhatsApp; mantener los mensajes proactivos muy limitados para no generar spam ni problemas en la cuenta.
