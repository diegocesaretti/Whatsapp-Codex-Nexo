# Agenda de contactos · Nexo 0.11.8

En la interfaz web de Nexo, abrí **Contactos** (http://127.0.0.1:3210/#contacts).

## Lo que podés hacer

- Buscar por nombre, alias o número y filtrar por cuenta INPUT
- Distinguir si el contacto vino de WhatsApp, de un archivo o de ambas fuentes
- Importar archivos CSV y vCard (.vcf) con selección explícita de cuenta
- Consultar el resultado: incorporados, actualizados, duplicados evitados y descartados
- Elegir prefijo del país para teléfonos locales (predeterminado +54)

El importador admite columnas como "Nombre", "Teléfono", "Celular", "Name", "Phone 1 - Value", y vCards estándar con FN y TEL. Admite hasta 3 MiB y 20.000 filas, para impedir importaciones accidentales gigantes.

## Deduplicación

La referencia de identidad dentro de cada agenda INPUT es **el número normalizado** (sin +, espacios, paréntesis ni guiones). No se fusionan personas por nombre. Si el mismo número aparece en varios registros de un archivo, se importa una sola vez. Si ya estaba en Nexo por WhatsApp, se unen los orígenes y se conserva el nombre de contacto guardado en WhatsApp, mientras el nombre del archivo queda disponible como metadato. El registro sigue perteneciendo a la cuenta INPUT seleccionada.

Los números locales reciben un prefijo opcional, pero Nexo nunca deduce códigos de área o el marcador argentino de móvil "9" que el archivo no traiga. Si hay dos teléfonos con formatos nacionales realmente distintos, puede ser necesario corregir el prefijo en el archivo para evitar falsos duplicados o fusiones erróneas.

**No se envían mensajes y no se habilitan permisos de Codex al importar.** Tampoco se crea automáticamente una persona global de SOL: eso requeriría una decisión de visibilidad/permisos separada.

## API interna

- GET /api/contacts?q=...&accountId=...&limit=60&offset=0
- GET /api/contacts/status
- POST /api/contacts/import con application/json: {"accountId":"UUID","fileName":"lista.csv","content":"...","countryCode":"54"}

Nexo debe mantenerse accesible solamente desde loopback o una capa de acceso autenticada. El importador requiere JSON y valida el origen del navegador para evitar cargas desde otras páginas.
