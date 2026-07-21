const { app, BrowserWindow, dialog, ipcMain, screen, shell } = require('electron');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const net = require('net');
const os = require('os');
const path = require('path');
const { groupPrintableItems } = require('../backend/services/printItemGrouping');
const { buildThermalEscPos, compactKotReferences } = require('./thermalEscPos');
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
let printWorkerTimer;
let activePrintRestaurantId = '';
let printWorkerBusy = false;
let backendStarted = false;
const desktopIconPath = path.join(__dirname, '..', 'build', 'icon.png');
const preloadPath = path.join(__dirname, 'preload.js');

function printableWindow(html, paperWidthMm = null) {
  const fitGuard = `<style data-kmaster-paper-fit>@media print{@page{margin:0}html{width:100%!important;max-width:100%!important;margin:0!important;padding:0!important;overflow:visible!important}body{width:100%!important;max-width:100%!important;margin:0!important;padding:3mm!important;overflow:visible!important}*,*::before,*::after{box-sizing:border-box!important;max-width:100%!important}table{width:100%!important;max-width:100%!important}img,svg,canvas{max-width:100%!important;height:auto!important}th,td,p,span,strong,b{overflow-wrap:anywhere}}</style>`;
  const source = String(html || '');
  const fittedHtml = source.includes('</head>') ? source.replace('</head>', `${fitGuard}</head>`) : `${fitGuard}${source}`;
  // Thermal layout must be rendered at the same physical width that is sent to
  // the driver. Measuring at the old 520 px preview width under-counted wrapped
  // lines; Chromium then paginated the narrower receipt and thermal drivers fed
  // an entire configured page between those fragments.
  const contentWidthPx = paperWidthMm ? Math.ceil(Number(paperWidthMm) * 96 / 25.4) : 520;
  const win = new BrowserWindow({
    show: false,
    width: contentWidthPx,
    height: 240,
    useContentSize: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  return win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fittedHtml)}`).then(() => win);
}

ipcMain.handle('pos:print-html', async (_event, html) => {
  const win = await printableWindow(String(html || ''));
  try {
    await new Promise((resolve, reject) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, reason) => {
        if (success) resolve();
        else reject(new Error(reason || 'Printing was cancelled or failed'));
      });
    });
    return { success: true };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

ipcMain.handle('pos:save-pdf', async (_event, request = {}) => {
  const win = await printableWindow(String(request.html || ''));
  try {
    const owner = mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined;
    const selected = await dialog.showSaveDialog(owner, {
      title: 'Save invoice PDF',
      defaultPath: String(request.fileName || 'invoice.pdf').replace(/[<>:"/\\|?*]/g, '-'),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }]
    });
    if (selected.canceled || !selected.filePath) return { success: false, canceled: true };
    const pdf = await win.webContents.printToPDF({ printBackground: true, pageSize: 'A4' });
    fs.writeFileSync(selected.filePath, pdf);
    return { success: true, filePath: selected.filePath };
  } finally {
    if (!win.isDestroyed()) win.destroy();
  }
});

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

function printEsc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function thermalPrintHtml(job) {
  const payload = typeof job.payload === 'string' ? JSON.parse(job.payload || '{}') : (job.payload || {});
  // Use the printer driver's real printable area. A hard-coded 76 mm body is wider
  // than many nominal 80 mm devices (and every 58 mm device), which clips both edges.
  const thermalPageCss = '@page{margin:0}html{width:100%;margin:0;padding:0}body{width:100%;max-width:100%;margin:0;padding:3mm;overflow:hidden}*{box-sizing:border-box;max-width:100%}';
  if (job.type === 'KOT') {
    const orderType = String(payload.orderType || 'DINE_IN').toUpperCase();
    const orderLabel = orderType === 'DINE_IN' ? 'Dine In' : orderType === 'PARCEL' || orderType === 'TAKEAWAY' ? 'Parcel' : orderType.replaceAll('_', ' ');
    const rows = (payload.items || []).map((item) => `<tr><td>${printEsc(item.name || item.combo_name || 'Item')}</td><td>${printEsc(item.notes || '--')}</td><td>${printEsc(item.quantity || 0)}</td></tr>`).join('');
    const compact = payload.compactSpacing !== false;
    const borderless = String(payload.template || 'CLASSIC').toUpperCase() === 'BORDERLESS';
    return `<!doctype html><html><head><style>${thermalPageCss}html,body{height:auto!important;min-height:0!important}body{color:#000;font:14px 'Arial Narrow',Arial,sans-serif;padding-top:${compact ? '1mm' : '3mm'}}.head{text-align:center;overflow-wrap:anywhere}.head h1{font-size:20px;margin:0}.head p{margin:${compact ? '1px' : '2px'} 0;font-size:15px}.mode{font-size:19px!important;font-weight:800}.table{font-size:20px!important;font-weight:900}.rule{${borderless ? '' : 'border-top:2px dashed #000;'}margin:4px 0}table{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed}th{font-size:13px;${borderless ? '' : 'border-bottom:1px solid #000;'}padding:2px 1px;overflow-wrap:anywhere}td{padding:${compact ? '2px' : '4px'} 1px;vertical-align:top;font-size:15px;overflow-wrap:anywhere;word-break:break-word}th:first-child,td:first-child{width:49%;text-align:left;font-weight:800}th:nth-child(2),td:nth-child(2){width:35%;text-align:center}th:last-child,td:last-child{width:16%;text-align:right;font-weight:800}.footer{text-align:center;${borderless ? '' : 'border-top:2px dashed #000;'}margin-top:4px;padding-top:3px;overflow-wrap:anywhere}</style></head><body><div class="head">${payload.headerText ? `<p>${printEsc(payload.headerText)}</p>` : ''}<h1>KOT</h1><p>${printEsc(new Date(job.created_at || Date.now()).toLocaleString('en-IN'))}</p><p>KOT - ${printEsc(payload.kotReference || payload.kotId || job.ref_id)}</p><p class="mode">${printEsc(orderLabel)}</p>${orderType === 'DINE_IN' && payload.printTable !== false ? `<p class="table">Table No: ${printEsc(payload.tableName || 'Table not assigned')}</p>` : ''}${payload.printCustomer && payload.customerName ? `<p>Customer: ${printEsc(payload.customerName)}</p>` : ''}${payload.printKitchen && payload.kitchen ? `<p>Kitchen: ${printEsc(payload.kitchen)}</p>` : ''}</div><div class="rule"></div><table><thead><tr><th>Item</th><th>Special Note</th><th>Qty.</th></tr></thead><tbody>${rows}</tbody></table>${payload.footerText ? `<div class="footer">${printEsc(payload.footerText)}</div>` : ''}</body></html>`;
  }
  const profile = payload.restaurantProfile || {};
  const printableItems = groupPrintableItems(payload.items);
  const rows = printableItems.map((item, index) => `<tr><td>${index + 1}</td><td>${printEsc(item.name)}</td><td>${printEsc(item.quantity)}</td><td>${Number(item.price || 0).toFixed(2)}</td><td>${(Number(item.quantity || 0) * Number(item.price || 0)).toFixed(2)}</td></tr>`).join('');
  const currency = printEsc(profile.currency || 'INR');
  const grandTotal = Number(payload.payable || 0);
  const taxRate = profile.gstin && profile.showTaxOnBill !== false ? Number(payload.taxRate || 5) : 0;
  const totalTax = taxRate > 0 ? grandTotal * taxRate / (100 + taxRate) : 0;
  const serviceCharge = Number(payload.serviceCharge || 0);
  const taxableValue = Math.max(grandTotal - totalTax - serviceCharge, 0);
  const halfTax = totalTax / 2;
  const lineTotal = printableItems.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.price || 0), 0);
  const discount = Math.max(lineTotal + Number(payload.serviceCharge || 0) - grandTotal, 0);
  const taxSummary = `${serviceCharge > 0 ? `<p><span>Service charge</span><b>${currency} ${serviceCharge.toFixed(2)}</b></p>` : ''}${taxRate > 0 ? `<p><span>Taxable value</span><b>${currency} ${taxableValue.toFixed(2)}</b></p><p><span>CGST @ ${(taxRate / 2).toFixed(2)}%</span><b>${currency} ${halfTax.toFixed(2)}</b></p><p><span>SGST @ ${(taxRate / 2).toFixed(2)}%</span><b>${currency} ${halfTax.toFixed(2)}</b></p><p><span>Total GST</span><b>${currency} ${totalTax.toFixed(2)}</b></p>` : ''}`;
  const template = String(profile.billTemplate || 'BORDERED').toUpperCase();
  const templateCss = template === 'BORDERLESS' ? 'th,td{border:0;border-bottom:1px solid #aaa}.summary{border:0}' : template === 'COMPACT' ? 'body{font-size:9px}th,td{padding:2px 1px;border:0;border-bottom:1px dashed #999}' : '';
  return `<!doctype html><html><head><style>${thermalPageCss}body{color:#000;font:9px Arial,sans-serif;text-align:center;overflow-wrap:anywhere}h1{font-size:14px;margin:0 0 2px;overflow-wrap:anywhere}.profile p{margin:1px 0;overflow-wrap:anywhere}.compliance{font-weight:700}.title{font-size:12px;font-weight:800;border-top:1px solid #000;border-bottom:1px solid #000;margin:5px 0;padding:3px}.meta{display:grid;grid-template-columns:35% minmax(0,65%);text-align:left;border-bottom:1px dashed #000;padding-bottom:4px}.meta span,.meta b{min-width:0;overflow-wrap:anywhere}.meta b{text-align:left}table{width:100%;max-width:100%;border-collapse:collapse;table-layout:fixed;margin-top:4px}th,td{border:1px solid #555;padding:2px 1px;overflow-wrap:anywhere;word-break:break-word}th:nth-child(1),td:nth-child(1){width:7%}th:nth-child(2),td:nth-child(2){width:43%;text-align:left}th:nth-child(3),td:nth-child(3){width:11%}th:nth-child(4),td:nth-child(4){width:18%}th:nth-child(5),td:nth-child(5){width:21%}.summary{border:1px solid #555;border-top:0;padding:3px}.summary p{display:flex;justify-content:space-between;gap:4px;margin:2px 0;text-align:left}.summary p b,.total span:last-child{white-space:nowrap}.total{display:flex;justify-content:space-between;gap:4px;border-top:1px solid #555;padding-top:4px;font-size:12px;font-weight:800}.thanks{border-top:1px dashed #000;margin-top:6px;padding-top:5px;font-weight:800;overflow-wrap:anywhere}${templateCss}</style></head><body><section class="profile"><h1>${printEsc(profile.displayName || profile.legalName || 'Restaurant')}</h1>${profile.legalName && profile.legalName !== profile.displayName ? `<p>${printEsc(profile.legalName)}</p>` : ''}<p>${printEsc([profile.addressLine1, profile.addressLine2, profile.city, profile.state, profile.stateCode ? `Code ${profile.stateCode}` : '', profile.country].filter(Boolean).join(', '))}</p>${profile.printContact !== false ? `<p>${printEsc([profile.phone, profile.email].filter(Boolean).join(' · '))}</p>` : ''}${profile.gstin ? `<p class="compliance">GSTIN: ${printEsc(profile.gstin)}</p>` : ''}${profile.fssaiLicenseNo ? `<p class="compliance">FSSAI: ${printEsc(profile.fssaiLicenseNo)}</p>` : ''}</section><div class="title">${payload.finalBill ? 'FINAL BILL' : (profile.gstin ? 'TAX INVOICE' : 'BILL / RECEIPT')}</div><div class="meta"><span>${payload.finalBill ? 'Bill Ref.' : 'Invoice No.'}</span><b>${printEsc(payload.invoiceNo)}</b><span>Date / Time</span><b>${printEsc(payload.settledAt || '')}</b><span>Order / Table</span><b>${printEsc(`${payload.orderReference || payload.orderId} / ${payload.tableNumber || payload.orderType || ''}`)}</b>${profile.printKotReferences !== false && payload.kotReferences ? `<span>KOT No(s).</span><b>${printEsc(profile.compactKotReferences === false ? payload.kotReferences : compactKotReferences(payload.kotReferences))}</b>` : ''}${profile.printCustomer !== false ? `<span>Customer</span><b>${printEsc(payload.customerName || 'Walk-in customer')}</b>` : ''}${profile.printPayment !== false ? `<span>Payment</span><b>${printEsc(payload.paymentMode || '')}</b>` : ''}${profile.gstin ? `<span>Place of supply</span><b>${printEsc(`${profile.state || 'Tamil Nadu'} (${profile.stateCode || '33'})`)}</b><span>SAC</span><b>${printEsc(profile.sacCode || '996331')}</b><span>Reverse charge</span><b>No</b>` : ''}</div><table><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="summary">${discount > 0 ? `<p><span>Discount</span><b>-${currency} ${discount.toFixed(2)}</b></p>` : ''}${taxSummary}<div class="total"><span>GRAND TOTAL</span><span>${currency} ${grandTotal.toFixed(2)}</span></div></div><div class="thanks">${profile.footerText ? `${printEsc(profile.footerText)}<br>` : ''}${profile.printAuthorisedSignatory !== false ? 'Authorised Signatory' : ''}</div></body></html>`;
}

async function printToConfiguredPrinter(job) {
  const data = buildThermalEscPos(job, groupPrintableItems);
  const connection = String(job.printer_connection || '').trim().toUpperCase();
  const configuredAddress = String(job.printer_address || '').trim();
  if (connection === 'NETWORK' || /^tcp:\/\//i.test(configuredAddress)) {
    const match = configuredAddress.match(/^(?:tcp:\/\/)?([^:/\s]+)(?::(\d+))?$/i);
    if (!match) throw new Error('Network printer address must be an IP/host name, optionally followed by port 9100.');
    await new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: match[1], port: Number(match[2] || 9100), timeout: 8000 }, () => socket.end(data));
      socket.once('error', reject);
      socket.once('timeout', () => socket.destroy(new Error('Network thermal printer timed out')));
      socket.once('close', (hadError) => { if (!hadError) resolve(); });
    });
    return;
  }

  // USB, Bluetooth and Windows printers must receive RAW ESC/POS bytes. Browser
  // printing uses the Windows form height (often A4), which produced the large
  // blank feeds and split receipt footer seen on physical 58/80 mm printers.
  const lookup = new BrowserWindow({ show: false, webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  let printer;
  try {
    const printers = await lookup.webContents.getPrintersAsync();
    const address = String(job.printer_address || '').trim().toLowerCase();
    const configuredName = String(job.printer_name || '').trim().toLowerCase();
    printer = printers.find((item) => String(item.name).toLowerCase() === address)
      || printers.find((item) => String(item.displayName || '').toLowerCase() === address)
      || printers.find((item) => String(item.name).toLowerCase() === configuredName)
      || printers.find((item) => item.isDefault);
    if (!printer) throw new Error('Configured printer was not found in Windows. Search printers again in Admin > Printers.');
  } finally {
    if (!lookup.isDestroyed()) lookup.destroy();
  }
  const tempFile = path.join(os.tmpdir(), `kmaster-print-${process.pid}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.bin`);
  fs.writeFileSync(tempFile, data);
  try {
    await new Promise((resolve, reject) => {
      const rawPrintScript = app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar.unpacked', 'electron', 'rawPrint.ps1')
        : path.join(__dirname, 'rawPrint.ps1');
      if (!fs.existsSync(rawPrintScript)) throw new Error(`Windows RAW print helper is missing: ${rawPrintScript}`);
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', rawPrintScript, '-PrinterName', printer.name, '-DataFile', tempFile], { windowsHide: true });
      let errorText = '';
      child.stderr.on('data', (chunk) => { errorText += chunk; });
      child.once('error', reject);
      child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(errorText.trim() || `Windows RAW print failed (${code})`)));
    });
  } finally {
    try { fs.unlinkSync(tempFile); } catch { /* best-effort cleanup */ }
  }
}

ipcMain.handle('pos:test-printer', async (_event, printer = {}) => {
  const isBill = String(printer.type || '').toUpperCase() === 'BILL';
  const job = {
    type: isBill ? 'BILL' : 'KOT',
    ref_id: 'TEST',
    created_at: new Date().toISOString(),
    printer_name: String(printer.name || ''),
    printer_address: String(printer.address || ''),
    paper_width_mm: Number(printer.paper_width_mm) === 80 ? 80 : 58,
    payload: isBill ? {
      invoiceNo: 'TEST PRINT', orderReference: 'TEST', tableNumber: 'Printer setup', payable: 0,
      restaurantProfile: { displayName: "K'Master POS Printer Test", currency: 'INR' },
      items: [{ name: 'Bill printer connected', quantity: 1, price: 0 }]
    } : {
      kotReference: 'TEST', orderType: 'DINE_IN', tableName: 'Printer setup',
      headerText: "K'Master POS Printer Test", items: [{ name: 'KOT printer connected', quantity: 1, notes: '--' }]
    }
  };
  await printToConfiguredPrinter(job);
  return { success: true };
});

async function processPrintJobs() {
  if (!activePrintRestaurantId || printWorkerBusy || !backendStarted) return;
  printWorkerBusy = true;
  try {
    const result = await backendRequest('GET', `/print-jobs/pending?restaurantId=${encodeURIComponent(activePrintRestaurantId)}`);
    for (const job of result.jobs || []) {
      try {
        await printToConfiguredPrinter(job);
        await backendRequest('POST', '/print-jobs/update', { restaurantId: activePrintRestaurantId, jobId: job.id, status: 'PRINTED' });
      } catch (error) {
        const retryable = Number(job.attempts || 0) < 2;
        await backendRequest('POST', '/print-jobs/update', { restaurantId: activePrintRestaurantId, jobId: job.id, status: retryable ? 'PENDING' : 'FAILED', error: String(error.message || error) });
      }
    }
  } finally {
    printWorkerBusy = false;
  }
}

async function startPrintWorker(restaurantId) {
  const nextRestaurantId = String(restaurantId || '').trim();
  if (!nextRestaurantId) {
    activePrintRestaurantId = '';
    clearInterval(printWorkerTimer);
    return { success: true, active: false };
  }
  activePrintRestaurantId = nextRestaurantId;
  clearInterval(printWorkerTimer);
  printWorkerTimer = setInterval(() => processPrintJobs().catch(() => {}), 1500);
  await processPrintJobs();
  return { success: true, active: true };
}

ipcMain.handle('pos:start-print-worker', async (_event, restaurantId) => {
  return startPrintWorker(restaurantId);
});

async function publishRuntimeState(entitlement, reason) {
  await backendRequest('POST', '/desktop/license/state', {
    status: entitlement && !isExpired(entitlement) ? 'ACTIVE' : 'EXPIRED',
    restaurantId: entitlement?.restaurantId || null,
    expiresAt: entitlement?.expiresAt || null,
    reason: reason || null
  });
  await startPrintWorker(entitlement && !isExpired(entitlement) ? entitlement.restaurantId : '');
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
  const workArea = screen.getPrimaryDisplay().workAreaSize;
  const initialZoom = workArea.width < 1500 || workArea.height < 900 ? 0.8 : 0.9;
  const win = new BrowserWindow({
    width: Math.min(1600, workArea.width),
    height: Math.min(1000, workArea.height),
    minWidth: 1024,
    minHeight: 700,
    title: "K'Master POS",
    icon: desktopIconPath,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: preloadPath
    }
  });
  mainWindow = win;
  win.maximize();
  win.webContents.setZoomFactor(initialZoom);
  win.webContents.on('before-input-event', (event, input) => {
    if (!input.control || input.alt || input.meta || input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const zoomIn = key === '+' || key === '=' || key === 'add';
    const zoomOut = key === '-' || key === 'subtract';
    const zoomReset = key === '0';
    if (!zoomIn && !zoomOut && !zoomReset) return;
    event.preventDefault();
    const current = win.webContents.getZoomFactor();
    const next = zoomReset ? 1 : Math.min(1.5, Math.max(0.5, current + (zoomIn ? 0.1 : -0.1)));
    win.webContents.setZoomFactor(Number(next.toFixed(2)));
  });

  try {
    const health = await waitForServer(process.env.PORT);
    const startPage = await resolveStartupPage(health);
    await win.loadURL(`http://localhost:${process.env.PORT}/${startPage}`);
  } catch (err) {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<h2>K'Master POS could not start</h2><p>${err.message}</p>`)}`);
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
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
  clearInterval(printWorkerTimer);
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && backendStarted) createWindow();
});
