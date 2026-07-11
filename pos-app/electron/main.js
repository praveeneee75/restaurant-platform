const { app, BrowserWindow, shell } = require('electron');
const crypto = require('crypto');
const http = require('http');
const net = require('net');
const path = require('path');
const {
  checkedToday,
  isExpired,
  readEntitlement,
  removeEntitlement,
  writeEntitlement
} = require('./licenseStore');

process.env.POS_DESKTOP = '1';
process.env.POS_DESKTOP_LICENSE_TOKEN = crypto.randomBytes(32).toString('hex');
// Packaged POS must use the production license service unless a deliberate
// developer override is supplied. Do not inherit a stale local SAAS_URL.
process.env.SAAS_URL = process.env.KMASTER_SAAS_URL || 'https://api.kmasterpos.com';

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
}

let mainWindow;
let licenseTimer;
let backendStarted = false;
const desktopIconPath = path.join(__dirname, '..', 'build', 'icon.png');

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.unref();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      probe.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
}

function validateDesktopRuntime() {
  const appPath = app.getAppPath();
  if (app.isPackaged && /tmp-pos-install|win-unpacked/i.test(appPath)) {
    throw new Error('This POS is running from a temporary test folder. Install the official K\'Master POS setup package before using it.');
  }
  try {
    require('better-sqlite3');
  } catch (error) {
    const details = String(error?.message || error);
    if (/NODE_MODULE_VERSION|better_sqlite3|bindings/i.test(details)) {
      throw new Error('This POS installation is incomplete or incompatible. Close this app and reinstall the latest official K\'Master POS installer. Your restaurant data is stored separately and will be preserved.');
    }
    throw error;
  }
}

async function startDesktopBackend() {
  if (backendStarted) return;
  validateDesktopRuntime();
  process.env.PORT = String(await findAvailablePort());
  require(path.join(__dirname, '..', 'backend', 'server'));
  backendStarted = true;
}

function backendRequest(method, route, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? Buffer.from(JSON.stringify(body)) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: Number(process.env.PORT),
      path: route,
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-POS-Desktop-Token': process.env.POS_DESKTOP_LICENSE_TOKEN,
        ...(payload ? { 'Content-Length': payload.length } : {})
      },
      timeout: 10000
    }, (res) => {
      let responseBody = '';
      res.on('data', (chunk) => { responseBody += chunk; });
      res.on('end', () => {
        let data;
        try {
          data = JSON.parse(responseBody);
        } catch {
          data = {};
        }
        if (res.statusCode >= 400) {
          const error = new Error(data.message || `License service returned ${res.statusCode}`);
          error.statusCode = res.statusCode;
          error.data = data;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('License service timed out')));
    if (payload) req.write(payload);
    req.end();
  });
}

async function publishRuntimeState(entitlement, reason) {
  await backendRequest('POST', '/desktop/license/state', {
    status: entitlement && !isExpired(entitlement) ? 'ACTIVE' : 'EXPIRED',
    restaurantId: entitlement?.restaurantId || null,
    expiresAt: entitlement?.expiresAt || null,
    reason: reason || null
  });
}

async function showLicensePage(page, message) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const query = message ? `?message=${encodeURIComponent(message)}` : '';
  await mainWindow.loadURL(`http://localhost:${process.env.PORT}/${page}${query}`);
}

async function refreshLicenseOnline() {
  try {
    const refreshed = await backendRequest('POST', '/desktop/license/refresh');
    if (!refreshed.valid) {
      removeEntitlement();
      await publishRuntimeState(null, refreshed.message || 'License is no longer active');
      await showLicensePage('license-expired.html', refreshed.message || 'This POS license is inactive or expired.');
      return { valid: false, online: true };
    }
    const entitlement = writeEntitlement({
      ...refreshed,
      status: 'ACTIVE',
      lastOnlineCheckAt: new Date().toISOString()
    });
    await publishRuntimeState(entitlement);
    return { valid: true, online: true, entitlement };
  } catch (error) {
    if (error.statusCode && error.statusCode < 500) {
      removeEntitlement();
      await publishRuntimeState(null, error.data?.message || error.message);
      await showLicensePage('license-expired.html', error.data?.message || 'This POS license is inactive or expired.');
      return { valid: false, online: true };
    }
    const cached = readEntitlement();
    await publishRuntimeState(cached, 'Offline validation');
    if (!cached || isExpired(cached)) {
      await showLicensePage(cached ? 'license-expired.html' : 'activate.html',
        cached ? 'The cached license has expired. Connect to the internet after renewing it.' : null);
      return { valid: false, online: false };
    }
    return { valid: true, online: false, entitlement: cached };
  }
}

async function resolveStartupPage(health) {
  const cached = readEntitlement();
  if (!health.activeRestaurantId || !cached || cached.restaurantId !== health.activeRestaurantId) {
    await publishRuntimeState(null, 'Activation required');
    return 'activate.html';
  }
  if (isExpired(cached)) {
    await publishRuntimeState(cached, 'Cached license expired');
    return 'license-expired.html';
  }
  await publishRuntimeState(cached);
  if (!checkedToday(cached)) {
    const result = await refreshLicenseOnline();
    if (!result.valid) return result.online || cached ? 'license-expired.html' : 'activate.html';
  }
  return 'login.html';
}

function waitForServer(port, timeoutMs = 15000) {
  const startedAt = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/health`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve({ success: false });
          }
        });
      });
      req.on('error', () => {
        if (Date.now() - startedAt > timeoutMs) {
          reject(new Error('POS backend did not start in time'));
          return;
        }
        setTimeout(check, 300);
      });
      req.setTimeout(1000, () => req.destroy());
    };
    check();
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 700,
    title: "K'Master POS",
    icon: desktopIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;

  try {
    const health = await waitForServer(process.env.PORT);
    const startPage = await resolveStartupPage(health);
    await win.loadURL(`http://localhost:${process.env.PORT}/${startPage}`);
  } catch (err) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h2>K'Master POS could not start</h2><p>${err.message}</p>`)}`);
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('did-navigate', async (_event, url) => {
    if (!url.includes('/activation-complete.html')) return;
    const result = await refreshLicenseOnline();
    if (result.valid) await showLicensePage('login.html');
  });

  clearInterval(licenseTimer);
  licenseTimer = setInterval(async () => {
    const cached = readEntitlement();
    if (!cached || isExpired(cached)) {
      await publishRuntimeState(cached, 'License expired');
      await showLicensePage(cached ? 'license-expired.html' : 'activate.html',
        cached ? 'Your POS license has expired.' : null);
      return;
    }
    if (!checkedToday(cached)) await refreshLicenseOnline();
  }, 15 * 60 * 1000);
}

app.whenReady().then(async () => {
  if (!hasLock) return;
  try {
    await startDesktopBackend();
    await createWindow();
  } catch (error) {
    const win = new BrowserWindow({ width: 760, height: 420, autoHideMenuBar: true, icon: desktopIconPath });
    mainWindow = win;
    const message = String(error?.message || error).replace(/[&<>"']/g, (value) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[value]));
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<main style="font:16px Segoe UI;padding:32px;max-width:680px"><h2>K'Master POS needs repair</h2><p>${message}</p><p>Close this window and install the latest official POS installer from the owner portal. Do not launch a copy from a temporary or extracted folder.</p></main>`)}`);
  }
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  clearInterval(licenseTimer);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendStarted) createWindow();
});
