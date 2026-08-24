# Nexo para Windows

Nexo 0.7 introduce una primera capa de aplicación de escritorio sin reescribir el motor TypeScript existente.

## Arquitectura

```text
Nexo.exe (Electron)
├─ ventana nativa
│  └─ UI existente servida por 127.0.0.1:3210
├─ tray de Windows
├─ single-instance / modo background
└─ backend Nexo embebido
   ├─ WhatsApp / Baileys
   ├─ identidades
   ├─ Neon
   ├─ Codex resident worker
   ├─ multimedia
   └─ API local para MCP
```

La aplicación conserva la API HTTP local para que la transición no rompa MCP ni automatizaciones existentes.

## Compatibilidad con el Nexo actual

Si `http://127.0.0.1:3210/health` ya responde cuando se abre la aplicación, la ventana se conecta al daemon existente y no intenta iniciar un segundo backend.

Cuando la aplicación instalada inicia su backend propio por primera vez:

1. usa `%APPDATA%\\Nexo\\data` como directorio persistente;
2. busca instalaciones anteriores de `Whatsapp-Codex-Nexo`;
3. si el destino todavía está vacío, copia `.data` (sesiones WhatsApp, settings, worker sessions, inbox, etc.);
4. intenta descubrir la URL de Neon desde la configuración anterior;
5. guarda la URL descubierta únicamente en `%APPDATA%\\Nexo\\desktop-config.json` para que la app deje de depender del repo o de SOL.

`desktop-config.json` es un archivo local de usuario y puede contener la URL privada de PostgreSQL. No debe copiarse a Git ni compartirse.

## Comportamiento de ventana y tray

- Doble clic en Nexo abre la ventana.
- Cerrar la ventana la oculta; Nexo continúa en tray.
- El tray muestra estado conectado/iniciando.
- `Reiniciar Nexo` relanza toda la aplicación.
- `Salir` hace shutdown limpio de WhatsApp, worker y PostgreSQL antes de cerrar.
- Sólo puede existir una instancia de la GUI.
- `--background` inicia la aplicación sin abrir la ventana, pensado para Inicio con Windows.

## Build local

Para probar la app desde el repo:

```powershell
pnpm install
pnpm desktop:dev
```

Para generar la carpeta empaquetada:

```powershell
pnpm desktop:dir
```

Para producir instalador y versión portable x64:

```powershell
pnpm desktop:dist
```

Los artefactos se generan bajo `release/`.

## GitHub Actions

`.github/workflows/windows-desktop.yml` ejecuta en `windows-latest`:

1. tests;
2. typecheck;
3. validación sintáctica del host Electron;
4. compilación TypeScript;
5. `electron-builder` para NSIS y portable;
6. publicación de los `.exe` como artifact del workflow.

## Estado de la migración

Esta versión deliberadamente reutiliza la UI web actual dentro de una ventana nativa. Eso permite validar primero instalación, persistencia, WhatsApp, Neon, tray y ciclo de vida.

Las siguientes etapas pueden reemplazar gradualmente la UI por navegación propia de desktop y finalmente empaquetar también el launcher MCP, sin cambiar la capa de datos ni las sesiones WhatsApp.
