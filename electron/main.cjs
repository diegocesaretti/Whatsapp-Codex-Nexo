const { app, BrowserWindow, Menu, Tray, dialog, shell } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const util = require('node:util');
const { pathToFileURL } = require('node:url');
const { parse: parseDotenv } = require('dotenv');

const PORT = Number(process.env.NEXO_WHATSAPP_PORT || 3210);
const HOST = process.env.NEXO_WHATSAPP_HOST || '127.0.0.1';
const BASE_URL = `http://${HOST}:${PORT}`;
const BACKGROUND = process.argv.includes('--background');

let mainWindow;
let tray;
let quitRequested = false;
let backendStopped = false;
let backendOwned = false;
let backendModule;
let healthTimer;
let desktopLogPath;
let desktopLoggingInstalled = false;

// A packaged Windows GUI process may inherit stdout/stderr handles that are
// already closed. Node turns writes to those handles into an EPIPE 'error'
// event which is fatal when nobody listens for it. Never let diagnostic output
// take down Nexo.
for (const stream of [process.stdout, process.stderr]) {
  if (!stream || typeof stream.on !== 'function') continue;
  stream.on('error', (error) => {
    if (error && (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED')) return;
    // Streams are only diagnostic channels in the desktop host. Other stream
    // errors are deliberately ignored here; application errors are logged by
    // console/error handling below and by the backend itself.
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => showMainWindow());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stringifyLogArg(value) {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return value.stack || value.message;
  return util.inspect(value, { depth: 6, colors: false, breakLength: 180, compact: true });
}

function appendDesktopLog(level, args) {
  if (!desktopLogPath) return;
  try {
    const line = `${new Date().toISOString()} [${level}] ${args.map(stringifyLogArg).join(' ')}\n`;
    fs.appendFileSync(desktopLogPath, line, 'utf8');
  } catch {
    // Logging must never become a failure path for the application.
  }
}

function installDesktopLogging() {
  if (desktopLoggingInstalled) return;
  desktopLoggingInstalled = true;

  const logsDir = path.join(app.getPath('userData'), 'logs');
  desktopLogPath = path.join(logsDir, 'nexo.log');
  try {
    fs.mkdirSync(logsDir, { recursive: true });
    if (fs.existsSync(desktopLogPath) && fs.statSync(desktopLogPath).size > 5 * 1024 * 1024) {
      const previous = `${desktopLogPath}.1`;
      try { fs.rmSync(previous, { force: true }); } catch {}
      try { fs.renameSync(desktopLogPath, previous); } catch {}
    }
  } catch {
    desktopLogPath = undefined;
  }

  process.env.NEXO_LOG_FILE = desktopLogPath || '';
  const original = {
    log: console.log.bind(console),
    info: console.info.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
    debug: console.debug.bind(console),
  };

  const replace = (name, level) => {
    console[name] = (...args) => {
      appendDesktopLog(level, args);
      // Development still benefits from a real terminal. Packaged Windows
      // builds intentionally avoid stdout/stderr entirely because those handles
      // may be absent or broken.
      if (!app.isPackaged) {
        try { original[name](...args); } catch {}
      }
    };
  };

  replace('log', 'INFO');
  replace('info', 'INFO');
  replace('warn', 'WARN');
  replace('error', 'ERROR');
  replace('debug', 'DEBUG');
  appendDesktopLog('INFO', [`Nexo desktop logging started · ${process.platform} · packaged=${app.isPackaged}`]);
}

async function isHealthy(timeoutMs = 900) {
  try {
    const response = await fetch(`${BASE_URL}/health`, { signal: AbortSignal.timeout(timeoutMs), cache: 'no-store' });
    if (!response.ok) return false;
    const body = await response.json();
    return Boolean(body && body.ok);
  } catch {
    return false;
  }
}

function isNonEmptyDirectory(directory) {
  try {
    return fs.statSync(directory).isDirectory() && fs.readdirSync(directory).length > 0;
  } catch {
    return false;
  }
}

function legacyRoots() {
  const roots = [];
  const add = (value) => {
    if (!value) return;
    const resolved = path.resolve(value);
    if (!roots.some((item) => item.toLowerCase() === resolved.toLowerCase())) roots.push(resolved);
  };
  add(process.env.NEXO_LEGACY_ROOT);
  add(process.cwd());
  add(path.join(os.homedir(), 'Whatsapp-Codex-Nexo'));
  if (process.platform === 'win32') add(path.join(path.parse(process.execPath).root, 'Whatsapp-Codex-Nexo'));
  return roots;
}

function readDesktopConfig(configPath) {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8')) || {};
  } catch {
    return {};
  }
}

function writeDesktopConfig(configPath, config) {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  const temporary = `${configPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, configPath);
}

function databaseUrlFromFile(filePath) {
  try {
    if (!fs.statSync(filePath).isFile()) return undefined;
    const values = parseDotenv(fs.readFileSync(filePath));
    return values.NEXO_DATABASE_URL?.trim() || values.DATABASE_URL?.trim() || undefined;
  } catch {
    return undefined;
  }
}

function discoverLegacyDatabaseUrl(root) {
  const candidates = [
    path.join(root, '.env'),
    path.join(path.dirname(root), 'SOL', '.env'),
    path.join(path.dirname(root), 'sol', '.env'),
  ];
  for (const candidate of candidates) {
    const value = databaseUrlFromFile(candidate);
    if (value) return { value, source: candidate };
  }
  return undefined;
}

function configurePackagedEnvironment() {
  if (!app.isPackaged) return;

  const userData = app.getPath('userData');
  const dataDir = path.join(userData, 'data');
  const desktopConfigPath = path.join(userData, 'desktop-config.json');
  const desktopConfig = readDesktopConfig(desktopConfigPath);

  let legacyRoot = desktopConfig.legacyRoot && fs.existsSync(desktopConfig.legacyRoot)
    ? path.resolve(desktopConfig.legacyRoot)
    : undefined;
  if (!legacyRoot) {
    legacyRoot = legacyRoots().find((root) => isNonEmptyDirectory(path.join(root, '.data')) || fs.existsSync(path.join(root, '.env')));
  }

  if (!isNonEmptyDirectory(dataDir) && legacyRoot && isNonEmptyDirectory(path.join(legacyRoot, '.data'))) {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.cpSync(path.join(legacyRoot, '.data'), dataDir, { recursive: true, force: false, errorOnExist: false });
  }

  process.env.NEXO_WHATSAPP_DATA_DIR ||= dataDir;
  process.env.NEXO_DESKTOP_EXE = process.execPath;
  process.env.NEXO_DESKTOP_APP = '1';

  if (!process.env.NEXO_DATABASE_URL && !process.env.DATABASE_URL) {
    if (desktopConfig.databaseUrl) {
      process.env.NEXO_DATABASE_URL = desktopConfig.databaseUrl;
    } else if (legacyRoot) {
      const discovered = discoverLegacyDatabaseUrl(legacyRoot);
      if (discovered) {
        process.env.NEXO_DATABASE_URL = discovered.value;
        desktopConfig.databaseUrl = discovered.value;
        desktopConfig.databaseSource = discovered.source;
      }
    }
  }

  if (legacyRoot) desktopConfig.legacyRoot = legacyRoot;
  desktopConfig.version = 1;
  writeDesktopConfig(desktopConfigPath, desktopConfig);

  // Keep transitional Windows startup support working: the existing API resolves
  // scripts/windows/nexo-tray.ps1 from cwd, and electron-builder places that
  // compatibility shim under resources/scripts/windows.
  process.chdir(process.resourcesPath);
}

function splashHtml(message = 'Iniciando Nexo…') {
  return `<!doctype html><meta charset="utf-8"><title>Nexo</title><style>html,body{height:100%;margin:0;background:#0b0d10;color:#f5f7fa;font-family:Inter,Segoe UI,system-ui,sans-serif}.wrap{height:100%;display:grid;place-items:center}.card{width:min(520px,calc(100% - 48px));padding:32px;border:1px solid #2a3038;border-radius:20px;background:#14171c}.brand{font-size:13px;color:#949ca8;letter-spacing:.12em}.title{font-size:36px;font-weight:800;margin:8px 0 12px}.muted{color:#949ca8;line-height:1.5}.pulse{display:inline-block;width:10px;height:10px;border-radius:50%;background:#54d68a;margin-right:8px;box-shadow:0 0 0 0 rgba(84,214,138,.5);animation:p 1.4s infinite}@keyframes p{70%{box-shadow:0 0 0 10px rgba(84,214,138,0)}100%{box-shadow:0 0 0 0 rgba(84,214,138,0)}}</style><div class="wrap"><div class="card"><div class="brand">CODEX NEXO · WINDOWS</div><div class="title">Nexo</div><div class="muted"><span class="pulse"></span>${message}</div></div></div>`;
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 840,
    minWidth: 900,
    minHeight: 620,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    title: 'Nexo',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  void mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml())}`);
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.on('close', (event) => {
    if (quitRequested) return;
    event.preventDefault();
    mainWindow.hide();
  });
  if (!BACKGROUND) mainWindow.once('ready-to-show', () => mainWindow.show());
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createMainWindow();
  mainWindow.show();
  mainWindow.restore();
  mainWindow.focus();
}

async function loadDashboardWhenReady() {
  for (;;) {
    if (await isHealthy()) {
      if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(BASE_URL);
      return;
    }
    await sleep(750);
  }
}

async function startEmbeddedBackend() {
  if (await isHealthy()) return;
  configurePackagedEnvironment();
  const entry = app.isPackaged
    ? path.join(app.getAppPath(), 'dist', 'index.js')
    : path.resolve(__dirname, '..', 'dist', 'index.js');
  backendOwned = true;
  backendModule = await import(pathToFileURL(entry).href);
}

function requestQuit({ relaunch = false } = {}) {
  if (relaunch) app.relaunch();
  quitRequested = true;
  app.quit();
}

async function createTray() {
  const icon = await app.getFileIcon(process.execPath, { size: 'small' });
  tray = new Tray(icon);
  tray.setToolTip('Nexo · iniciando');
  const rebuild = async () => {
    const healthy = await isHealthy();
    tray.setToolTip(healthy ? 'Nexo · conectado' : 'Nexo · iniciando / reconectando');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Abrir Nexo', click: () => showMainWindow() },
      { label: healthy ? 'Estado: conectado' : 'Estado: iniciando / reconectando', enabled: false },
      { type: 'separator' },
      { label: 'Reiniciar Nexo', click: () => requestQuit({ relaunch: true }) },
      { label: 'Abrir carpeta de logs', click: () => { if (desktopLogPath) void shell.showItemInFolder(desktopLogPath); } },
      { label: 'Salir', click: () => requestQuit() },
    ]));
  };
  tray.on('double-click', () => showMainWindow());
  await rebuild();
  healthTimer = setInterval(() => void rebuild(), 10_000);
}

async function boot() {
  createMainWindow();
  await createTray();
  const externalAlreadyRunning = await isHealthy();
  void loadDashboardWhenReady();
  if (externalAlreadyRunning) return;
  try {
    await startEmbeddedBackend();
  } catch (error) {
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    console.error('[desktop] backend startup failed', error);
    if (mainWindow && !mainWindow.isDestroyed()) {
      await mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml('No se pudo iniciar el motor de Nexo. Revisá el diagnóstico mostrado por Windows.'))}`);
    }
    dialog.showErrorBox('Nexo no pudo iniciar', detail.slice(0, 4000));
  }
}

if (gotLock) {
  app.whenReady().then(() => {
    installDesktopLogging();
    return boot();
  });
  app.on('activate', () => showMainWindow());
  app.on('window-all-closed', () => undefined);
  app.on('before-quit', (event) => {
    if (backendStopped || !backendOwned || !backendModule?.shutdownNexo) return;
    event.preventDefault();
    backendStopped = true;
    if (healthTimer) clearInterval(healthTimer);
    Promise.resolve(backendModule.shutdownNexo('ELECTRON', false))
      .catch((error) => console.error('[desktop] graceful shutdown failed', error))
      .finally(() => app.quit());
  });
}
