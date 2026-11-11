/**
 * Electron main process: starts the embedded server (same code as `npm start`), shows the
 * dashboard in a window and keeps running in the tray, so the phone can keep using it.
 *
 * Security: the window runs the dashboard with contextIsolation, no Node integration, a sandboxed
 * renderer and a restricted preload for Discord settings. It can only navigate to our own server,
 * and links to anywhere else open in the system browser.
 */

import { cpSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { publishMigratedFolder } from '@gt7/core';
import { parseConfig, type RunningServer, StartServerError, startServer } from '@gt7/server';
import { BRAND_SURFACE, isLanguage, PRODUCT_NAME, WS_PATH } from '@gt7/shared';
import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  Menu,
  type MenuItemConstructorOptions,
  nativeImage,
  type Rectangle,
  screen,
  session,
  shell,
  Tray,
} from 'electron';
import { translateMessage } from '../../web/src/lib/messages.ts';
import { DesktopDiscord } from './discord.ts';
import { initLog, log, logFilePath } from './log.ts';
import { errorHtml, splashHtml, toDataUrl } from './pages.ts';
import {
  bundledMcpStdio,
  bundledWebDist,
  electronUserDataDir,
  isInternalUrl,
  isOpenableExternally,
  parsePageAction,
  serverUrl,
} from './paths.ts';
import { type DesktopState, readDesktopState, writeDesktopState } from './state-file.ts';
import { fitWindowState, MIN_SIZE, type WindowState } from './window-state.ts';

const BG = BRAND_SURFACE;
/** Barra de título própria (Windows): botões nativos pintados com o tema. Altura = --titlebar-h do CSS. */
const TITLEBAR = { height: 36, color: '#080d13', symbolColor: '#a9b7c4' } as const;
const LOGIN_ARGS = ['--hidden'];
const START_HIDDEN = process.argv.includes('--hidden');

// Own folder for Chromium's files; the history stays in the shared data folder (see paths.ts).
app.setName(PRODUCT_NAME);
const profileDir = electronUserDataDir();
const previousProfile = electronUserDataDir({}, true);
let profileMigrationError: unknown;
try {
  if (!existsSync(profileDir) && existsSync(previousProfile)) {
    publishMigratedFolder(profileDir, (staging) => {
      for (const entry of ['desktop-state.json', 'Local Storage']) {
        const source = join(previousProfile, entry);
        if (existsSync(source)) cpSync(source, join(staging, entry), { recursive: true });
      }
    });
  }
} catch (error) {
  profileMigrationError = error;
}
app.setPath('userData', profileDir);
app.setAppUserModelId('com.lucas.bonoengineer');
const STATE_FILE = join(app.getPath('userData'), 'desktop-state.json');
initLog(join(app.getPath('userData'), 'logs', 'desktop.log'));
if (profileMigrationError) log(`falha ao copiar preferências anteriores: ${profileMigrationError}`);

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let running: RunningServer | null = null;
let serverUrlNow: string | null = null;
let serverPort = 0;
let serverHost = '127.0.0.1';
let phoneUrl: string | null = null;
let quitting = false;
let booting = false;
let state: DesktopState = readDesktopState(STATE_FILE);
const uiText = (message: string, ...values: unknown[]) =>
  translateMessage(state.language ?? 'pt-BR', message, ...values);

// A stray exception (a bad UDP packet, a closed socket) must not end a session in the middle of
// a race: log it and keep going, like the CLI does.
process.on('unhandledRejection', (reason) =>
  log(`promessa rejeitada sem tratamento: ${String(reason)}`),
);
process.on('uncaughtException', (err) => log(`exceção não tratada: ${err.stack ?? err}`));

function assetPath(name: string): string {
  return join(__dirname, name);
}

const discord = new DesktopDiscord(
  join(app.getPath('userData'), 'discord-radio.json'),
  join(bundledWebDist(__dirname), 'radio'),
  () => {
    if (!serverUrlNow) return null;
    const url = new URL(serverUrlNow);
    url.protocol = 'ws:';
    url.pathname = WS_PATH;
    url.hash = '';
    return url;
  },
  (status) => {
    if (win && !win.isDestroyed() && inServerPage(win.webContents.getURL()))
      win.webContents.send('bono:discord:status', status);
  },
);

function checkLocalSender(event: Electron.IpcMainInvokeEvent): void {
  const frame = event.senderFrame;
  if (
    !win ||
    event.sender !== win.webContents ||
    !frame ||
    frame.parent ||
    !inServerPage(frame.url) ||
    !serverUrlNow ||
    frame.origin !== new URL(serverUrlNow).origin
  )
    throw new Error(uiText('Abra as configurações no aplicativo Bono.'));
}

function registerDesktopHandlers(): void {
  const actions = {
    get: () => discord.get(),
    save: (settings: unknown) => discord.save(settings),
    'set-enabled': (enabled: unknown) => discord.setEnabled(enabled),
    'set-voice': (pack: unknown) => discord.setVoice(pack),
    test: () => discord.test(),
    'stop-test': () => discord.resume(),
    remove: () => discord.remove(),
  };
  for (const [name, action] of Object.entries(actions)) {
    ipcMain.handle(`bono:discord:${name}`, (event, input: unknown) => {
      checkLocalSender(event);
      return action(input);
    });
  }
  ipcMain.handle('bono:language', (event, language: unknown) => {
    checkLocalSender(event);
    if (!isLanguage(language) || language === state.language) return;
    state = { ...state, language };
    writeDesktopState(STATE_FILE, state);
    refreshTrayTooltip();
  });
  ipcMain.handle('bono:language:get', (event) => {
    checkLocalSender(event);
    return state.language;
  });
}

// ---------------------------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------------------------

function saveWindowState(): void {
  const w = win;
  if (!w || w.isDestroyed() || w.isMinimized() || w.isFullScreen()) return;
  const b: Rectangle = w.getNormalBounds();
  const next: WindowState = {
    x: b.x,
    y: b.y,
    width: b.width,
    height: b.height,
    maximized: w.isMaximized(),
  };
  state = { ...state, window: next };
  writeDesktopState(STATE_FILE, state);
}

function debounce(fn: () => void, ms: number): () => void {
  let t: NodeJS.Timeout | null = null;
  return () => {
    if (t) clearTimeout(t);
    t = setTimeout(fn, ms);
  };
}

function inServerPage(url: string): boolean {
  return serverPort > 0 && isInternalUrl(url, serverPort, serverHost);
}

function hardenWebContents(w: BrowserWindow): void {
  const wc = w.webContents;
  async function setFullscreen(enabled: boolean): Promise<void> {
    // Use the page's fullscreen state on the dashboard so the on-screen control tracks F11/Esc.
    const url = wc.getURL();
    if (inServerPage(url)) {
      const command = enabled
        ? 'document.documentElement.requestFullscreen().then(() => true)'
        : 'document.fullscreenElement ? document.exitFullscreen().then(() => true) : false';
      const handled = await wc.executeJavaScript(command, true).catch(() => false);
      if (handled || w.isDestroyed() || wc.getURL() !== url) return;
    }
    w.setFullScreen(enabled);
  }

  // Links that want a new window, and navigation away from our server, go to the system browser.
  wc.setWindowOpenHandler(({ url }) => {
    if (isOpenableExternally(url) && !inServerPage(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    const action = parsePageAction(url);
    if (action) {
      event.preventDefault();
      if (action === 'retry') void boot();
      else void quitApp();
      return;
    }
    if (inServerPage(url)) return;
    event.preventDefault();
    if (isOpenableExternally(url)) void shell.openExternal(url);
  });
  wc.on('will-attach-webview', (event) => event.preventDefault());
  wc.on('did-fail-load', (_e, code, description, failedUrl, isMainFrame) => {
    // -3 = aborted (a navigation replaced by another one): not an error.
    if (!isMainFrame || code === -3 || failedUrl.startsWith('data:')) return;
    log(`falha ao carregar ${failedUrl}: ${description} (${code})`);
    showError('Não consegui abrir o painel do servidor local.', `${description} (${code})`);
  });
  // The window keeps its fixed title (the dashboard's own <title> would replace it).
  w.on('page-title-updated', (e) => e.preventDefault());

  // No menu bar, so the few shortcuts that matter are handled here.
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const ctrl = input.control || input.meta;
    if (input.key === 'F5' || (ctrl && !input.shift && input.key.toLowerCase() === 'r')) {
      event.preventDefault();
      wc.reload();
    } else if (input.key === 'F11') {
      event.preventDefault();
      if (!input.isAutoRepeat) void setFullscreen(!w.isFullScreen());
    } else if (input.key === 'Escape' && w.isFullScreen()) {
      event.preventDefault();
      if (!input.isAutoRepeat) void setFullscreen(false);
    } else if (ctrl && (input.key === '=' || input.key === '+')) {
      event.preventDefault();
      wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 4));
    } else if (ctrl && input.key === '-') {
      event.preventDefault();
      wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
    } else if (ctrl && input.key === '0') {
      event.preventDefault();
      wc.setZoomLevel(0);
    } else if (!app.isPackaged && ctrl && input.shift && input.key.toLowerCase() === 'i') {
      wc.toggleDevTools();
    }
  });
}

function createWindow(): BrowserWindow {
  const fit = fitWindowState(
    state.window,
    screen.getAllDisplays().map((d) => d.workArea),
  );
  const w = new BrowserWindow({
    title: PRODUCT_NAME,
    width: fit.width,
    height: fit.height,
    ...(fit.x !== undefined && fit.y !== undefined ? { x: fit.x, y: fit.y } : {}),
    minWidth: MIN_SIZE.width,
    minHeight: MIN_SIZE.height,
    backgroundColor: BG,
    icon: nativeImage.createFromPath(assetPath('icon.png')),
    autoHideMenuBar: true,
    ...(process.platform === 'win32'
      ? { titleBarStyle: 'hidden' as const, titleBarOverlay: { ...TITLEBAR } }
      : {}),
    show: false,
    webPreferences: {
      preload: assetPath('preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  w.removeMenu();
  if (fit.maximized) w.maximize();
  hardenWebContents(w);

  const persist = debounce(saveWindowState, 400);
  w.on('resize', persist);
  w.on('move', persist);
  w.on('maximize', persist);
  w.on('unmaximize', persist);

  w.on('close', (event) => {
    if (quitting) return;
    saveWindowState();
    if (tray) {
      // Closing the window only hides it: the server keeps running for the phone.
      event.preventDefault();
      w.hide();
      if (!state.trayHintShown) {
        state = { ...state, trayHintShown: true };
        writeDesktopState(STATE_FILE, state);
        balloon(
          uiText(
            'O app continua em segundo plano (ícone perto do relógio). Clique nele para abrir.',
          ),
        );
      }
    }
  });
  w.on('closed', () => {
    if (win === w) win = null;
  });
  return w;
}

function showWindow(): void {
  if (!win || win.isDestroyed()) {
    win = createWindow();
    void loadCurrent(win);
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/** Re-creating the window after it was destroyed: show whatever state the app is in. */
async function loadCurrent(w: BrowserWindow): Promise<void> {
  if (serverUrlNow) await w.loadURL(serverUrlNow);
  else await w.loadURL(toDataUrl(splashHtml(state.language)));
}

function showError(message: string, detail?: string): void {
  if (!win || win.isDestroyed()) win = createWindow();
  const page = errorHtml(
    {
      message,
      ...(detail ? { detail } : {}),
      ...(logFilePath() ? { logFile: logFilePath() as string } : {}),
    },
    state.language,
  );
  void win.loadURL(toDataUrl(page));
  win.show(); // an error is worth interrupting the "start hidden" mode
}

// ---------------------------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------------------------

async function refreshPhoneUrl(): Promise<void> {
  const r = running;
  if (!r) {
    phoneUrl = null;
    return;
  }
  if (r.server) {
    phoneUrl = r.server.lan.preferredUrl();
    return;
  }
  // Attached to an instance that is already running (e.g. `npm start`): ask it.
  try {
    const res = await fetch(`${serverUrl(serverHost, r.port)}api/status`, {
      signal: AbortSignal.timeout(2000),
    });
    const body = (await res.json()) as { lanUrls?: string[] };
    phoneUrl = body.lanUrls?.[0] ?? null;
  } catch {
    phoneUrl = null;
  }
}

async function stopServer(): Promise<void> {
  discord.stop();
  const r = running;
  running = null;
  serverUrlNow = null;
  serverPort = 0;
  if (!r) return;
  await Promise.race([r.stop(), new Promise((resolve) => setTimeout(resolve, 6000))]);
}

/** pt-BR sentence for the error page (the CLI hints about --port make no sense in a window). */
function friendlyStartError(e: unknown): string {
  if (e instanceof StartServerError) {
    if (e.kind === 'port-busy') {
      return 'Não encontrei uma porta livre para o servidor. Feche outros programas que usem a rede e tente de novo.';
    }
    return `O servidor não conseguiu iniciar: ${e.message}`;
  }
  return 'Algo deu errado ao iniciar o servidor.';
}

async function boot(): Promise<void> {
  if (booting || quitting) return;
  booting = true;
  try {
    await stopServer();
    if (!win || win.isDestroyed()) win = createWindow();
    await win.loadURL(toDataUrl(splashHtml(state.language)));
    if (!START_HIDDEN || !tray) win.show();

    // Same code and same zero-config rules as `npm start`; the window is the "browser".
    const base = parseConfig(['--no-open'], process.env);
    const cfg = {
      ...base,
      webDist: bundledWebDist(__dirname),
      // Installed app: MCP clients run this bundle with our own .exe (no repo, no tsx here).
      mcpStdioScript: bundledMcpStdio(__dirname),
    };
    const r = await startServer({ config: cfg });
    running = r;
    serverHost = r.config.host;
    serverPort = r.port;
    for (const w of r.warnings) log(`aviso: ${w}`);
    log(
      r.attached
        ? `usando o ${PRODUCT_NAME} que já estava aberto na porta ${r.port}`
        : `servidor em ${r.url} (dados em ${r.config.dataDir})${r.portNote ? `; ${r.portNote}` : ''}`,
    );
    await refreshPhoneUrl();

    // The dashboard registers a service worker for the phone/PWA; inside the app it would only
    // risk serving an older build after an update, so it is cleared on every start.
    await session.defaultSession
      .clearStorageData({ storages: ['serviceworkers', 'cachestorage'] })
      .catch(() => {});

    serverUrlNow = serverUrl(serverHost, r.port, r.config.token);
    await win.loadURL(serverUrlNow);
    discord.resume();
    if (!START_HIDDEN || !tray) win.show();
  } catch (e) {
    const msg = friendlyStartError(e);
    log(`erro ao iniciar: ${(e as Error).stack ?? e}`);
    showError(
      msg,
      e instanceof StartServerError && e.kind !== 'port-busy' ? undefined : (e as Error).message,
    );
  } finally {
    booting = false;
    refreshTrayTooltip();
  }
}

// ---------------------------------------------------------------------------------------------
// Tray
// ---------------------------------------------------------------------------------------------

const autoStartTarget = () => ({
  // The portable build runs from a temp folder: its real exe path is in this variable.
  path: process.env.PORTABLE_EXECUTABLE_FILE ?? process.execPath,
  args: LOGIN_ARGS,
});

function autoStartEnabled(): boolean {
  try {
    return app.getLoginItemSettings(autoStartTarget()).openAtLogin;
  } catch {
    return false;
  }
}

function setAutoStart(on: boolean): void {
  app.setLoginItemSettings({ openAtLogin: on, ...autoStartTarget() });
}

/** Windows notification-area balloon (other platforms have no equivalent here). */
function balloon(content: string): void {
  if (process.platform === 'win32') {
    tray?.displayBalloon({ iconType: 'info', title: PRODUCT_NAME, content });
  }
}

function buildTrayMenu(): Menu {
  const items: MenuItemConstructorOptions[] = [
    { label: uiText('Abrir {0}', PRODUCT_NAME), click: showWindow },
    phoneUrl
      ? {
          label: uiText('Copiar endereço para acesso remoto'),
          click: () => {
            clipboard.writeText(phoneUrl as string);
            balloon(uiText('Endereço copiado: {0}', phoneUrl));
          },
        }
      : { label: uiText('Endereço para acesso remoto indisponível'), enabled: false },
    { type: 'separator' },
    {
      label: uiText('Iniciar com o Windows'),
      type: 'checkbox',
      checked: autoStartEnabled(),
      // Registering the dev Electron binary as a login item would be wrong.
      enabled: app.isPackaged,
      click: (item) => setAutoStart(item.checked),
    },
    { type: 'separator' },
    { label: uiText('Sair'), click: () => void quitApp() },
  ];
  return Menu.buildFromTemplate(items);
}

function refreshTrayTooltip(): void {
  if (!tray) return;
  tray.setToolTip(
    phoneUrl ? `${PRODUCT_NAME}\n${uiText('Acesso remoto: {0}', phoneUrl)}` : PRODUCT_NAME,
  );
}

function createTray(): void {
  try {
    tray = new Tray(nativeImage.createFromPath(assetPath('tray.png')));
  } catch (e) {
    log(`sem ícone na bandeja: ${(e as Error).message}`);
    tray = null;
    return;
  }
  tray.setToolTip(PRODUCT_NAME);
  tray.on('click', showWindow);
  tray.on('double-click', showWindow);
  tray.on('right-click', () => tray?.popUpContextMenu(buildTrayMenu()));
  // Network interfaces change (Wi-Fi reconnects): keep the phone address fresh.
  setInterval(() => {
    void refreshPhoneUrl().then(refreshTrayTooltip);
  }, 30_000).unref();
}

// ---------------------------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------------------------

async function quitApp(): Promise<void> {
  if (quitting) return;
  quitting = true;
  log('encerrando');
  saveWindowState();
  try {
    await stopServer();
  } catch (e) {
    log(`erro ao encerrar: ${(e as Error).message}`);
  }
  tray?.destroy();
  tray = null;
  app.exit(0);
}

function lockdownSession(): void {
  // Only our own server may ask for anything; the few permissions the dashboard can use are
  // fullscreen and writing to the clipboard (copy buttons).
  const allowed = new Set(['fullscreen', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(allowed.has(permission) && inServerPage(wc.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((wc, permission) => {
    return allowed.has(permission) && !!wc && inServerPage(wc.getURL());
  });
}

if (!app.requestSingleInstanceLock()) {
  // Another copy is already running: it gets 'second-instance' and just focuses its window.
  app.exit(0);
} else {
  app.on('second-instance', () => showWindow());
  // Closing the window hides it; the app only ends from the tray menu ("Sair").
  app.on('window-all-closed', () => {});
  app.on('activate', () => showWindow());
  app.on('before-quit', (event) => {
    event.preventDefault();
    void quitApp();
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    lockdownSession();
    registerDesktopHandlers();
    createTray();
    log(`iniciado (Electron ${process.versions.electron}, Node ${process.versions.node})`);
    await boot();
  });
}
