const { app, BrowserWindow, shell } = require('electron');
const path = require('path');

process.env.PORT = process.env.PORT || '3000';
process.env.POS_DESKTOP = '1';

require(path.join(__dirname, '..', 'backend', 'server'));

function createWindow() {
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

  win.loadURL(`http://localhost:${process.env.PORT}/login.html`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
