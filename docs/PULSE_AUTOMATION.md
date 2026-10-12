# Nexo: canal dedicado para SOL Pulse

Desde Nexo 0.11.7 existe un endpoint separado del envío manual:

`POST http://127.0.0.1:3210/api/automation/pulse/send`

## Permisos requeridos

Configurar por el gestor oficial de SOL, nunca en Git:

- `pulseEnabled = true` / `NEXO_PULSE_ENABLED=true` (desactivado por defecto).
- `pulseToken` / `NEXO_PULSE_TOKEN` (secreto de 32 caracteres o más).
- `pulseTo` / `NEXO_PULSE_TO` (número de destinatario permitido).

El número debe estar además en la lista de contactos autorizados de la conversación OUTPUT de Nexo. El token debe coincidir con `PULSE_NEXO_AUTOMATION_TOKEN` en el plugin Pulse; es **distinto** del token de ingesta entre Pulse y BWA 3D.

Ejemplo de cuerpo del request:

```json
{
  "automation": "sol_pulse",
  "eventId": "evento-00000001",
  "text": "SOL Pulse · Aviso de prueba autorizado",
  "to": "5491100000000"
}
```

Se exige `Authorization: Bearer <token>`. El servidor verifica estado habilitado, destino permitido, prefijo y longitud del mensaje, clave de evento, límite de 12 envíos por día y duplicados persistidos por `BridgeStore.hasOutboundReason`. Los eventos con el mismo identificador no se reenvían tras reinicios.

**No se utiliza** `confirmedByUser=true` del endpoint manual para los mensajes automáticos. El permiso se puede revocar deshabilitando `pulseEnabled` o retirando el token.

Nexo confirma aceptación del envío, no entrega ni lectura en el teléfono. SOL Pulse maneja estados `accepted` y `uncertain` para que cualquier error se revise antes de intentar otro envío.
