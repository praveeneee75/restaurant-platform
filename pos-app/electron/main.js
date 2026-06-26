const { app, BrowserWindow, shell } = require('electron');
const http = require('http');
const path = require('path');

process.env.PORT = process.env.PORT || '3000';
process.env.POS_DESKTOP = '1';

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  require(path.join(__dirname, '..', 'backend', 'server'));
}

let mainWindow;

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
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow = win;

  try {
    const health = await waitForServer(process.env.PORT);
    const startPage = health.activeRestaurantId ? 'login.html' : 'activate.html';
    await win.loadURL(`http://localhost:${process.env.PORT}/${startPage}`);
  } catch (err) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h2>K'Master POS could not start</h2><p>${err.message}</p>`)}`);
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  if (hasLock) createWindow();
});

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
});

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
