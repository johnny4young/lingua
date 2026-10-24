// QA-only wrapper. No product source edits. Every sensitive route fails closed or is mocked.
import fs from 'node:fs';
import path from 'node:path';
import e from 'electron';
import net from 'node:net';
import tls from 'node:tls';
const ROOT = process.env.LINGUA_SQL_EDITOR_FIXTURE_ROOT;
if (!ROOT || !path.basename(ROOT).startsWith('lingua-sql-input-'))
  throw new Error('Owned synthetic fixture directory required');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'fixture.json'), 'utf8'));
if (manifest.nonce !== process.env.LINGUA_SQL_EDITOR_FIXTURE_NONCE)
  throw new Error('Fixture nonce mismatch');
if (process.versions.electron !== manifest.electron)
  throw new Error('Electron differs from project pin');
const origin = new URL(manifest.origin);
if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1')
  throw new Error('Loopback fixture origin required');
const E = ROOT + '/evidence';
const RT = ROOT + '/profile';
const stats = {
  pid: process.pid,
  nonce: manifest.nonce,
  policy:
    'hidden lab window; clipboard mocked/denied; safeStorage unavailable; no dialogs/protocol registration; loopback only',
  sensitiveOriginalCalls: 0,
  clipboardStubCalls: 0,
  keyringStubCalls: 0,
  deniedClipboardPermissions: 0,
  suppressedShow: 0,
  suppressedFocus: 0,
  dialogCalls: 0,
  blockedNetwork: [],
  protocolAttempts: 0,
  ready: false,
};
const save = () => {
  fs.writeFileSync(
    E + '/containment.json',
    JSON.stringify(
      {
        ...stats,
        userData: e.app.getPath('userData'),
        sessionData: e.app.getPath('sessionData'),
        mockKeychainSwitch: e.app.commandLine.hasSwitch('use-mock-keychain'),
      },
      null,
      2
    )
  );
};
for (const [key, sub] of [
  ['userData', 'user-data'],
  ['sessionData', 'session-data'],
  ['logs', 'logs'],
  ['crashDumps', 'crashes'],
  ['appData', 'app-data'],
])
  e.app.setPath(key, RT + '/' + sub);
if (!e.app.commandLine.hasSwitch('use-mock-keychain'))
  throw new Error('QA refuses launch without --use-mock-keychain');
e.app.commandLine.appendSwitch('proxy-server', manifest.proxy);
e.app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
const replace = (object, key, value) =>
  Object.defineProperty(object, key, { value, writable: true, configurable: true });
for (const key of Object.getOwnPropertyNames(e.clipboard)) {
  if (typeof e.clipboard[key] !== 'function') continue;
  replace(e.clipboard, key, () => {
    stats.clipboardStubCalls++;
    if (key === 'readImage') return e.nativeImage.createEmpty();
    if (key === 'availableFormats') return [];
    if (key === 'has') return false;
    if (key === 'readBuffer') return Buffer.alloc(0);
    if (key === 'readBookmark') return { title: '', url: '' };
    if (key.startsWith('read')) return '';
    return undefined;
  });
}
replace(e.safeStorage, 'isEncryptionAvailable', () => {
  stats.keyringStubCalls++;
  return false;
});
replace(e.safeStorage, 'encryptString', () => {
  throw new Error('QA denies native keyring encryption');
});
replace(e.safeStorage, 'decryptString', () => {
  throw new Error('QA denies native keyring decryption');
});
if (typeof e.safeStorage.getSelectedStorageBackend === 'function')
  replace(e.safeStorage, 'getSelectedStorageBackend', () => 'basic_text');
replace(e.app, 'setAsDefaultProtocolClient', () => {
  stats.protocolAttempts++;
  throw new Error('QA denies persistent protocol registration');
});
replace(e.shell, 'openExternal', async () => {
  throw new Error('QA denies external application launch');
});
replace(e.shell, 'openPath', async () => 'QA denies external path open');
const discard = options =>
  Math.max(
    0,
    (options?.buttons ?? []).findIndex(x => /discard|don.t save|descartar|no guardar/i.test(x))
  );
replace(e.dialog, 'showMessageBox', async (...args) => {
  stats.dialogCalls++;
  return { response: discard(args.at(-1)), checkboxChecked: false };
});
replace(e.dialog, 'showMessageBoxSync', (...args) => {
  stats.dialogCalls++;
  return discard(args.at(-1));
});
replace(e.dialog, 'showOpenDialog', async () => {
  stats.dialogCalls++;
  return { canceled: true, filePaths: [] };
});
replace(e.dialog, 'showSaveDialog', async () => {
  stats.dialogCalls++;
  return { canceled: true };
});
replace(e.dialog, 'showErrorBox', () => {
  stats.dialogCalls++;
});
replace(e.crashReporter, 'start', () => {
  throw new Error('QA denies crash reporter start');
});
const allowed = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const guardConnect = fn =>
  function (...args) {
    const first = args[0];
    const host =
      typeof first === 'object'
        ? (first.host ?? first.servername ?? 'localhost')
        : typeof args[1] === 'string'
          ? args[1]
          : 'localhost';
    if (first?.path && !String(first.path).startsWith(RT + '/'))
      throw new Error('QA denies non-owned Unix socket');
    if (!allowed.has(host)) {
      stats.blockedNetwork.push(String(host));
      throw new Error('QA denies non-loopback network');
    }
    return fn.apply(this, args);
  };
replace(net, 'connect', guardConnect(net.connect));
replace(net, 'createConnection', guardConnect(net.createConnection));
replace(tls, 'connect', guardConnect(tls.connect));

e.app.on('ready', () => {
  const s = e.session.defaultSession;
  const setRequest = s.setPermissionRequestHandler.bind(s),
    setCheck = s.setPermissionCheckHandler.bind(s);
  replace(s, 'setPermissionRequestHandler', () =>
    setRequest((_wc, _permission, cb) => {
      stats.deniedClipboardPermissions++;
      return cb(false);
    })
  );
  replace(s, 'setPermissionCheckHandler', () =>
    setCheck(() => {
      stats.deniedClipboardPermissions++;
      return false;
    })
  );
  s.setPermissionRequestHandler(null);
  s.setPermissionCheckHandler(null);
  try {
    e.app.dock?.hide();
  } catch {}
  stats.ready = true;
  save();
});
e.app.on('browser-window-created', (_event, win) => {
  replace(win, 'show', () => {
    stats.suppressedShow++;
    save();
  });
  replace(win, 'showInactive', () => {
    stats.suppressedShow++;
    save();
  });
  replace(win, 'focus', () => {
    stats.suppressedFocus++;
    save();
  });
  win.webContents.on('dom-ready', () => {
    stats.windowHidden = !win.isVisible();
    stats.currentURL = win.webContents.getURL();
    save();
  });
});
e.app.on('before-quit', save);
process.on('exit', code => {
  stats.exitCode = code;
  try {
    save();
  } catch {}
});
save();
e.app.whenReady().then(() => {
  e.session.defaultSession.webRequest.onBeforeRequest((details, cb) =>
    cb({
      cancel:
        !details.url.startsWith(origin.origin + '/') &&
        !details.url.startsWith('blob:' + origin.origin + '/'),
    })
  );
  const win = new e.BrowserWindow({
    show: false,
    width: 1440,
    height: 960,
    useContentSize: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadURL(origin.href);
});
e.app.on('window-all-closed', () => e.app.quit());
