# Contactos automáticos de WhatsApp en Nexo

Nexo importa **los contactos que Baileys/WhatsApp realmente expone**, no toda la agenda Android. No se hace scraping ni se solicitan permisos adicionales.

## Fuentes

* Sincronización inicial o incremental: `messaging-history.set.contacts`.
* Cambios mientras Nexo está conectado: `contacts.upsert` y `contacts.update`.
* Sólo se aceptan cuentas **INPUT**. No se indexan contactos de OUTPUT.
* Sólo se aceptan JID individuales `@s.whatsapp.net` y `@lid`; grupos, estados y canales se descartan.
* Un `@lid` sin vínculo a un teléfono permanece opaco: nunca se deduce su número.

## Almacenamiento y permisos

Los contactos se almacenan separadamente por el UUID de la cuenta INPUT en
`<NEXO_DATA_DIR>/contacts.json`, con escritura atómica. Es almacenamiento
local del plugin (incluso si el archivo de mensajes principal utiliza Neon).
Sólo se conservan JID, número cuando WhatsApp lo proporciona, nombre
guardado, push name, nombre verificado y procedencia temporal. No se guardan
fotos, biografías, tokens o contenidos de mensajes. Al desvincular una
cuenta se borran sus contactos.

**Los contactos no son identidades autorizadas a interactuar con Codex**.
Tampoco se sincronizan como personas globales de SOL automáticamente,
porque SOL Core crea entidades de plugin de visibilidad familiar por defecto
y eso podría filtrar la agenda de una cuenta a otros miembros de la casa.
Una eventual promoción a Persona deberá respetar un propietario y permiso
explícitos.

## Consulta

* `GET /api/contacts?q=Juan&accountId=<UUID>&limit=100` devuelve contactos,
  cantidad total y cuentas INPUT disponibles.
* `GET /api/contacts/status` devuelve cantidad por cuenta.
* Herramientas de lectura MCP: `list_whatsapp_contacts` y
  `whatsapp_contacts_status`.

El servicio HTTP está pensado para el acceso local interno de Nexo; no se
debe publicar la API en Internet. La búsqueda conserva la procedencia
`accountId` y no fusiona personas sólo por compartir nombre.

## Límites

WhatsApp/Baileys puede no entregar el catálogo completo, especialmente en
sesiones vinculadas ya existentes. La agenda se puebla con los eventos que
se reciban tras instalar esta versión; una reinstalación de sesión o una
sincronización posterior pueden ofrecer más contactos. No se fuerzan
reconexiones ni se alteran credenciales de WhatsApp.
