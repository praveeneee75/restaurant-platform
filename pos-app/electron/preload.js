const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('posDesktop', Object.freeze({
  isDesktop: true,
  printHtml: (html) => ipcRenderer.invoke('pos:print-html', html),
  savePdf: (html, fileName) => ipcRenderer.invoke('pos:save-pdf', { html, fileName }),
  startPrintWorker: (restaurantId) => ipcRenderer.invoke('pos:start-print-worker', String(restaurantId || ''))
}));
