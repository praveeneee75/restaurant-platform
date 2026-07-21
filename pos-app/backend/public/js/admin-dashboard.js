const restaurantId = new URLSearchParams(window.location.search).get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

const user = JSON.parse(localStorage.getItem("user") || "null");
const requestedAdminView = new URLSearchParams(window.location.search).get("view") || "";
const standaloneAdminView = new URLSearchParams(window.location.search).get("standalone") === "1";
const role = String(user?.role || "").toUpperCase();
const adminAllowedRoles = new Set(["OWNER", "MANAGER_1", "MANAGER_2", "CASHIER"]);
if (!user || !adminAllowedRoles.has(role) || (role === "CASHIER" && !["reservations", "items", "invoices"].includes(requestedAdminView))) {
  window.location.replace(`/login.html?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  throw new Error("Admin access required");
}
const actor = { id: user.id, role: user.role || "OWNER" };
if (standaloneAdminView) document.body.classList.add("standalone-admin-view");
document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", () => { localStorage.clear(); window.location.href = "/login.html"; }));
const activeAdminNavLabel = requestedAdminView === "invoices" ? "Invoices" : requestedAdminView === "items" ? "Availability" : "Admin";
document.querySelectorAll(".app-home-nav a").forEach((link) => link.classList.toggle("active", link.textContent.trim() === activeAdminNavLabel));
const state = { admin: {}, network: {}, inventory: {}, modifiers: {}, backups: {}, settings: {}, permissions: {}, devices: {}, reservations: [], expenseCategories: [], latestUpdate: null, commercial: {}, invoices: [] };
const settingQrRequireTablePin = document.getElementById('settingQrRequireTablePin');
const settingQrSessionMinutes = document.getElementById('settingQrSessionMinutes');
const settingQrOrderingEnabled = document.getElementById('settingQrOrderingEnabled');
const settingQrPendingOrderLimit = document.getElementById('settingQrPendingOrderLimit');
const promoCodesTable = document.getElementById('promoCodesTable');
const staffCashSettingsForm = document.getElementById('staffCashSettingsForm');
const staffCashSettingsStatus = document.getElementById('staffCashSettingsStatus');
const discoverPrinters = document.getElementById('discoverPrinters');
const printerDiscoveryStatus = document.getElementById('printerDiscoveryStatus');
const printerDiscoveryResults = document.getElementById('printerDiscoveryResults');
const printerDiscoveryResultsLabel = document.getElementById('printerDiscoveryResultsLabel');

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => Number(value || 0).toFixed(2);
const can = (permission) => (state.permissions.currentPermissions || []).includes(permission) || actor.role === "OWNER";
const moduleEnabled = (code) => (state.admin.enabledModules || []).includes(code);
const todayIso = () => new Date().toISOString().slice(0, 10);
const monthStartIso = () => {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
};

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantId, actor, ...body })
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

function actions(type, id) {
  return `<span class="action-cell"><button class="mini-btn" data-edit-${type}="${id}" type="button">Edit</button><button class="danger-btn" data-delete-${type}="${id}" type="button">Delete</button></span>`;
}

function formatDateTime(value) {
  if (!value) return "";
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text);
  if (Number.isNaN(date.getTime())) return String(value);
  const timeZone = String(state.settings?.settings?.timezone || "Asia/Kolkata");
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone, day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
    }).format(date);
  } catch (_) {
    return date.toLocaleString();
  }
}

function isFutureDate(value) {
  if (!value) return false;
  const text = String(value);
  const time = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(text) ? `${text.replace(" ", "T")}Z` : text).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function userStatusCell(userRow) {
  const locked = isFutureDate(userRow.locked_until);
  const failedAttempts = Number(userRow.failed_login_attempts || 0);
  const parts = [];
  if (Number(userRow.active) === 0) {
    parts.push(`<span class="status-pill danger">Disabled</span>`);
  } else if (locked) {
    parts.push(`<span class="status-pill danger">Locked until ${esc(formatDateTime(userRow.locked_until))}</span>`);
  } else {
    parts.push(`<span class="status-pill success">Active</span>`);
  }
  if (userRow.unlock_requested_at) parts.push(`<span class="status-pill warning">Unlock requested ${esc(formatDateTime(userRow.unlock_requested_at))}</span>`);
  if (failedAttempts > 0 && !locked) parts.push(`<small>${failedAttempts} failed attempt(s)</small>`);
  return `<div class="status-stack">${parts.join("")}</div>`;
}

function fillSelect(element, rows, label = "name") {
  element.innerHTML = rows.map((row) => `<option value="${row.id}">${esc(row[label])}</option>`).join("");
}

function fillSelectWithBlank(element, rows, label = "name", blankLabel = "Not assigned") {
  element.innerHTML = `<option value="">${esc(blankLabel)}</option>` + rows.map((row) => `<option value="${row.id}">${esc(row[label])}</option>`).join("");
}

async function loadAdmin() {
  // Delete actions are implemented as safe deactivation so historical orders
  // keep their foreign-key references. The normal Admin view must nevertheless
  // remove those rows immediately instead of presenting them as editable again.
  state.admin = await fetchJson(`/admin/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`);
  if (window.activeRestaurantName) {
    const restaurantName = state.admin.restaurant?.name || restaurantId;
    activeRestaurantName.textContent = `${restaurantName} active`;
    document.title = `${restaurantName} Admin`;
  }
  if (state.admin.restaurant?.id && state.admin.restaurant.id !== restaurantId) {
    localStorage.setItem("restaurantId", state.admin.restaurant.id);
    window.location.replace(`/admin.html?restaurantId=${encodeURIComponent(state.admin.restaurant.id)}`);
    return;
  }
  renderAdmin();
  applyModuleGuards();
}

// Expire unattended Admin sessions so a terminal is not left logged in indefinitely.
const IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let lastActivityAt = Date.now();
const markActivity = () => { lastActivityAt = Date.now(); };
['click', 'keydown', 'pointermove', 'touchstart'].forEach((name) => window.addEventListener(name, markActivity, { passive: true }));
setInterval(() => {
  if (Date.now() - lastActivityAt < IDLE_TIMEOUT_MS) return;
  localStorage.clear();
  window.location.replace('/login.html?reason=timeout');
}, 30 * 1000);

async function loadInvoiceList() {
  const data = await fetchJson(`/orders/invoices?restaurantId=${encodeURIComponent(restaurantId)}&fromDate=${invoiceFrom.value || ""}&toDate=${invoiceTo.value || ""}&limit=100`);
  state.invoices = data.invoices || [];
  renderInvoices();
}

async function loadInventory() {
  state.inventory = await fetchJson(`/inventory/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`);
  renderInventory();
}

async function loadModifiers() {
  state.modifiers = await fetchJson(`/modifiers/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`);
  renderModifiers();
}

async function loadBackup() {
  state.backups = await fetchJson(`/backup/settings?restaurantId=${encodeURIComponent(restaurantId)}`);
  renderBackup();
}

async function loadSettings() {
  state.settings = await fetchJson(`/settings?restaurantId=${encodeURIComponent(restaurantId)}`);
  renderSettings();
}

async function loadPromoCodes() {
  const data = await fetchJson(`/admin/promo-codes?restaurantId=${encodeURIComponent(restaurantId)}&includeInactive=true`);
  if (!promoCodesTable) return;
  promoCodesTable.innerHTML = (data.promoCodes || []).map((promo) => `<tr><td><strong>${esc(promo.code)}</strong></td><td>${esc(promo.discount_type === 'PERCENT' ? `${promo.discount_value}%` : `INR ${money(promo.discount_value)}`)}${promo.max_discount_amount > 0 ? ` (cap INR ${money(promo.max_discount_amount)})` : ''}</td><td>INR ${money(promo.min_order_amount)}</td><td>${esc(promo.valid_from || 'Any')} - ${esc(promo.valid_to || 'Any')}</td><td>${promo.active ? '<span class="status-pill success">Active</span>' : '<span class="status-pill">Disabled</span>'}</td><td><button type="button" class="mini-btn" data-edit-promo="${promo.id}">Edit</button><button type="button" class="danger-btn" data-delete-promo="${promo.id}">Disable</button></td></tr>`).join('') || '<tr><td colspan="6">No promocodes configured.</td></tr>';
  state.promoCodes = data.promoCodes || [];
}

async function loadPermissions() {
  state.permissions = await fetchJson(`/permissions/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`);
  renderPermissions();
  applyPermissionGuards();
}

async function loadDeviceSessions() {
  if (!can("admin.view")) return;
  state.devices = await fetchJson(`/device-sessions/list?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`);
  renderDeviceSessions();
}

async function loadReservations() {
  const params = new URLSearchParams({ restaurantId });
  if (reservationFrom?.value) params.set("fromDate", reservationFrom.value);
  if (reservationTo?.value) params.set("toDate", reservationTo.value);
  const data = await fetchJson(`/reservations/list?${params.toString()}`);
  state.reservations = data.reservations || [];
  renderReservations();
}

async function loadExpenseCategories() {
  const data = await fetchJson(`/expenses/categories?restaurantId=${encodeURIComponent(restaurantId)}`);
  state.expenseCategories = data.categories || [];
  renderExpenseCategories();
}

async function loadUpdates() {
  const version = await fetchJson("/version");
  const headerVersion = document.getElementById('headerAppVersion');
  if (headerVersion) headerVersion.textContent = `POS ${version.posVersion}`;
  updateCurrentVersion.textContent = `Current version: ${version.posVersion} | Print Agent: ${version.printAgentVersion || "Not detected"}`;
  const logs = await fetchJson(`/updates/logs?restaurantId=${encodeURIComponent(restaurantId)}`).catch(() => ({ logs: [] }));
  updateLogsPanel.innerHTML = (logs.logs || []).map((log) => `<p><strong>${esc(log.status)}</strong> ${esc(log.current_version || "")} -> ${esc(log.target_version || "")}<br><small>${esc(log.message || "")} ${esc(log.created_at || "")}</small></p>`).join("") || "<p>No update logs yet.</p>";
  const latest = await fetchJson(`/updates/check?restaurantId=${encodeURIComponent(restaurantId)}`).catch(() => ({ updateAvailable: false }));
  state.latestUpdate = latest;
}

async function loadCommercial() {
  if (!["OWNER", "MANAGER_2"].includes(actor.role)) {
    commercialStatus.textContent = "Commercial tools require OWNER or MANAGER_2";
    return;
  }
  const params = `restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`;
  const [analytics, reports, journal, fraud, credit, diagnostics, payments] = await Promise.all([
    fetchJson(`/analytics/dashboard?${params}`),
    fetchJson(`/reports/advanced?${params}`),
    fetchJson(`/journal/search?${params}`),
    fetchJson(`/fraud/alerts?${params}`),
    fetchJson(`/credit/aging-report?${params}`),
    fetchJson(`/diagnostics?${params}`),
    fetchJson(`/payments/providers?${params}`)
  ]);
  state.commercial = { analytics, reports, journal, fraud, credit, diagnostics, payments };
  renderCommercial();
}

function auditQuery() {
  const params = new URLSearchParams({ restaurantId, role: actor.role });
  if (auditFromDate.value) params.set("fromDate", auditFromDate.value);
  if (auditToDate.value) params.set("toDate", auditToDate.value);
  if (auditUser.value) params.set("user", auditUser.value);
  if (auditAction.value) params.set("action", auditAction.value);
  if (auditEntityType.value) params.set("entityType", auditEntityType.value);
  if (auditSeverity.value) params.set("severity", auditSeverity.value);
  return params;
}

async function loadAudit() {
  if (!["OWNER", "MANAGER_2"].includes(actor.role)) {
    auditStatus.textContent = "Audit dashboard requires OWNER or MANAGER_2";
    return;
  }
  const summary = await fetchJson(`/audit/compliance-summary?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`);
  const cards = summary.cards || {};
  complianceCards.innerHTML = [
    ["Refunds today", cards.refundsToday],
    ["Voided bills today", cards.voidedBillsToday],
    ["Manual discounts today", cards.manualDiscountsToday],
    ["Non-invoice sales today", cards.nonInvoiceSalesToday],
    ["Failed logins", cards.failedLogins],
    ["Backup restores", cards.backupRestoreEvents]
  ].map(([label, value]) => `<article><h3>${esc(label)}</h3><strong>${value || 0}</strong></article>`).join("");

  const data = await fetchJson(`/audit/logs?${auditQuery().toString()}`);
  auditLogsTable.innerHTML = (data.logs || []).map((log) => `
    <tr>
      <td>${esc(log.created_at)}</td>
      <td>${esc(log.user || log.user_role || "")}</td>
      <td>${esc(log.action)}</td>
      <td>${esc(log.entity_type)} #${esc(log.entity_id || "")}</td>
      <td><small>${esc(log.old_value || "")}</small></td>
      <td><small>${esc(log.new_value || "")}</small></td>
    </tr>
  `).join("") || `<tr><td colspan="6">No audit logs found.</td></tr>`;
  complianceEventsTable.innerHTML = (summary.events || []).concat(data.complianceEvents || []).slice(0, 100).map((event) => `
    <tr>
      <td>${esc(event.created_at)}</td>
      <td>${esc(event.severity)}</td>
      <td>${esc(event.event_type)}</td>
      <td>${esc(event.message)}</td>
      <td>${esc(event.entity_type || "")} #${esc(event.entity_id || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No compliance events found.</td></tr>`;
  auditStatus.textContent = "Audit loaded";
}

async function loadAll() {
  adminStatus.textContent = "Loading workspace...";
  await loadPermissions();
  await loadAdmin();
  state.network = await fetchJson('/network/info').catch(() => ({}));
  renderAdmin();
  if (standaloneAdminView && requestedAdminView) {
    await loadUpdates().catch(() => undefined);
    if (requestedAdminView === "invoices") {
      await loadSettings().catch(() => undefined);
      await loadInvoiceList().catch(() => undefined);
    }
    if (requestedAdminView === "reservations") await loadReservations().catch(() => undefined);
    adminStatus.textContent = "Workspace ready";
    return;
  }
  const loaders = [loadModifiers(), loadBackup(), loadSettings(), loadPromoCodes(), loadUpdates(), loadAudit(), loadDeviceSessions(), loadExpenseCategories(), loadInvoiceList().catch(() => undefined)];
  if (moduleEnabled("INVENTORY")) loaders.push(loadInventory());
  if (moduleEnabled("RESERVATIONS")) loaders.push(loadReservations().catch(() => undefined));
  await Promise.all(loaders);
  adminStatus.textContent = "Workspace ready";
}

function renderAdmin() {
  const { kitchens = [], categories = [], items = [], users = [], tables = [], printers = [] } = state.admin;
  fillSelectWithBlank(kitchenPrinterId, printers.filter((printer) => printer.type === "KITCHEN" || printer.type === "BAR" || printer.type === "TOKEN"), "name", "No KOT printer");
  fillSelect(categoryKitchen, kitchens);
  fillSelect(itemCategory, categories);
  fillSelect(recipeMenuItem, items);
  fillSelect(modifierAssignItem, items);
  fillSelect(comboItem, items);
  fillSelect(reservationTable, tables, "table_name");
  kitchensTable.innerHTML = kitchens.map((k) => `<tr><td>${esc(k.name)}</td><td>${esc(k.printer_name || "Not assigned")}</td><td>${k.active ? "Active" : "Inactive"}</td><td>${actions("kitchen", k.id)}</td></tr>`).join("");
  printersTable.innerHTML = printers.map((printer) => `<tr><td>${esc(printer.name)}</td><td>${esc(printer.type)}</td><td>${esc(printer.connection)}</td><td>${esc(printer.paper_width_mm || 58)} mm</td><td>${esc(printer.address || "")}</td><td>${printer.active ? "Active" : "Inactive"}</td><td><span class="action-cell"><button type="button" class="secondary-btn" data-test-printer="${printer.id}">Test Print</button><button class="mini-btn" data-edit-printer="${printer.id}" type="button">Edit</button><button class="danger-btn" data-delete-printer="${printer.id}" type="button">Delete</button></span></td></tr>`).join("");
  categoriesTable.innerHTML = categories.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.kitchen_name || "Unassigned")}${Number(c.kitchen_active) === 0 ? " (inactive kitchen)" : ""}</td><td>${c.active ? "Active" : "Inactive"}</td><td>${actions("category", c.id)}</td></tr>`).join("");
  const term = (itemSearch?.value || "").toLowerCase();
  itemsTable.innerHTML = items.filter((i) => !term || i.name.toLowerCase().includes(term)).map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.category_name || "")}</td><td>${esc(i.kitchen_name || "")}</td><td>${money(i.price)}</td>${[['allow_dine_in','Dine In'],['allow_parcel','Parcel'],['allow_party_order','Party'],['online_enabled','Online'],['active','Active']].map(([field,label]) => `<td><label class="availability-toggle" title="${label}"><input type="checkbox" data-item-channel="${field}" data-item-id="${i.id}" ${Number(i[field] ?? 1) === 1 ? 'checked' : ''}><span>${label}</span></label></td>`).join('')}<td>${actions("item", i.id)}</td></tr>`).join("");
  usersTable.innerHTML = users.map((u) => {
    const canUnlock = isFutureDate(u.locked_until) || u.unlock_requested_at || Number(u.failed_login_attempts || 0) > 0;
    return `<tr>
      <td>${esc(u.name)}</td>
      <td>${esc(u.username)}</td>
      <td>${esc(u.role)}</td>
      <td>${userStatusCell(u)}</td>
      <td class="action-cell">
        <button class="mini-btn" data-edit-user="${u.id}" type="button">Edit</button>
        ${canUnlock ? `<button class="mini-btn" data-unlock-user="${u.id}" type="button">Unlock</button>` : ""}
        <button class="danger-btn" data-disable-user="${u.id}" type="button">Disable</button>
      </td>
    </tr>`;
  }).join("");
  tablesTable.innerHTML = tables.map((t) => `<tr><td>${esc(t.table_name)}</td><td>${esc(t.status)}</td><td>${actions("table", t.id)}</td></tr>`).join("");
  qrLinksTable.innerHTML = tables.map((t) => {
    const baseUrl = String(state.network.publicQrBaseUrl || 'https://pos.kmasterpos.com').replace(/\/$/, '');
    const url = `${baseUrl}/qr-menu.html?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${t.id}`;
    const enabled = !['0', 0, false, 'false'].includes(state.settings?.qr_ordering_enabled);
    return `<tr><td>${esc(t.table_name)}</td><td>${enabled?`<a href="${url}" target="_blank">${esc(url)}</a>`:'<span>QR ordering disabled</span>'}</td><td class="action-cell">${enabled?`<button type="button" class="mini-btn" data-qr-preview="${encodeURIComponent(url)}" data-qr-table="${esc(t.table_name)}">Preview</button><button type="button" class="secondary-btn" data-qr-print="${encodeURIComponent(url)}" data-qr-table="${esc(t.table_name)}">Print</button>`:''}</td></tr>`;
  }).join("");
}

function qrImageUrl(url) {
  const baseUrl = String(state.network.publicQrBaseUrl || 'https://pos.kmasterpos.com').replace(/\/$/, '');
  return `${baseUrl}/online-ordering/qr-code?url=${encodeURIComponent(url)}`;
}

function showQrPreview(url, tableName) {
  qrLinkPreview.innerHTML = `<header><div><h3>${esc(tableName)} QR code</h3><p>Scan to open the table ordering page.</p></div><button type="button" class="secondary-btn" data-qr-print="${encodeURIComponent(url)}" data-qr-table="${esc(tableName)}">Print</button></header><img src="${qrImageUrl(url)}" alt="QR code for ${esc(tableName)}"><a href="${url}" target="_blank">Open ordering page</a>`;
}

async function printQrCode(url, tableName) {
  const html = `<!doctype html><html><head><title>${esc(tableName)} QR</title><style>@page{margin:8mm}body{font-family:Arial;text-align:center;padding:24px}img{width:320px;height:320px}h1{margin-bottom:4px}p{overflow-wrap:anywhere}</style></head><body><h1>${esc(tableName)}</h1><p>Scan to order</p><img src="${qrImageUrl(url)}"><p>${esc(url)}</p></body></html>`;
  if (window.posDesktop?.printHtml) {
    await window.posDesktop.printHtml(html);
    return;
  }
  const popup = window.open('', '_blank', 'width=520,height=680');
  if (!popup) throw new Error('Printing was blocked. Enable pop-ups and try again.');
  popup.document.write(html);
  popup.document.close();
  popup.onload = () => { popup.focus(); popup.print(); };
}

document.addEventListener('click', (event) => {
  const preview = event.target.closest('[data-qr-preview]');
  const print = event.target.closest('[data-qr-print]');
  if (preview) showQrPreview(decodeURIComponent(preview.dataset.qrPreview), preview.dataset.qrTable);
  if (print) printQrCode(decodeURIComponent(print.dataset.qrPrint), print.dataset.qrTable).catch((error) => alert(error.message));
});

printersTable?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-test-printer]');
  if (!button) return;
  const printer = (state.admin.printers || []).find((row) => String(row.id) === String(button.dataset.testPrinter));
  if (!printer) return;
  if (!window.posDesktop?.testPrinter) return alert('Test Print is available in the installed desktop POS app.');
  button.disabled = true;
  try { await window.posDesktop.testPrinter(printer); alert(`Test page sent to ${printer.name}.`); }
  catch (error) { alert(`Printer test failed: ${error.message}`); }
  finally { button.disabled = false; }
});

function applyModuleGuards() {
  const moduleViews = {
    inventory: "INVENTORY",
    reservations: "RESERVATIONS",
    qr: "QR_ORDERING"
  };
  Object.entries(moduleViews).forEach(([view, code]) => {
    const enabled = moduleEnabled(code);
    document.querySelectorAll(`[data-view="${view}"]`).forEach((el) => { el.style.display = enabled ? "" : "none"; });
    const panel = document.getElementById(`view-${view}`);
    if (panel) panel.style.display = enabled ? "" : "none";
  });
  document.querySelectorAll('a[href="/kds.html"]').forEach((el) => { el.style.display = moduleEnabled("KDS") ? "" : "none"; });
  document.querySelectorAll('a[href="/customer.html"]').forEach((el) => { el.style.display = moduleEnabled("LOYALTY") ? "" : "none"; });
  if (role === "CASHIER") {
    document.querySelectorAll(".admin-nav .nav-group").forEach((el) => { el.style.display = "none"; });
    const reservationsButton = document.querySelector('.nav-btn[data-view="reservations"]');
    const reservationsGroup = reservationsButton?.closest(".nav-group");
    if (reservationsGroup) reservationsGroup.style.display = "";
    if (reservationsButton) reservationsButton.style.display = "";
    document.querySelectorAll(".admin-view").forEach((panel) => { panel.style.display = panel.id === "view-reservations" ? "" : "none"; });
  }
}

function renderReservations() {
  reservationsTable.innerHTML = state.reservations.map((row) => `
    <tr>
      <td>${esc(row.customer_name)}</td>
      <td>${esc(row.phone || "")}</td>
      <td>${esc(row.table_name || row.table_id || "")}</td>
      <td>${esc(row.guest_count || "")}</td>
      <td>${esc(row.reservation_time)}</td>
      <td>${esc(row.status)}</td>
      <td><button class="danger-btn" data-cancel-reservation="${row.id}" type="button">Cancel</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7">No reservations found.</td></tr>`;
}

function renderExpenseCategories() {
  expenseCategory.innerHTML = state.expenseCategories.map((category) => `<option value="${category.id}">${esc(category.name)}</option>`).join("");
}

function renderInventory() {
  const { suppliers = [], ingredients = [], recipes = [], purchaseOrders = [], lowStock = [], supplierPayments = [], supplierBalances = [] } = state.inventory;
  fillSelect(purchaseSupplier, suppliers);
  fillSelect(paymentSupplier, suppliers);
  fillSelect(purchaseIngredient, ingredients);
  fillSelect(stockIngredient, ingredients);
  fillSelect(recipeIngredient, ingredients);
  paymentPurchaseOrder.innerHTML = `<option value="">General supplier payment</option>` + purchaseOrders.map((po) => `<option value="${po.id}">${esc(po.po_number || `PO-${po.id}`)} - ${esc(po.supplier_name || "")}</option>`).join("");
  suppliersTable.innerHTML = suppliers.map((s) => `<tr><td>${esc(s.name)}</td><td>${esc(s.phone || "")}</td><td>${esc(s.email || "")}</td><td>${esc(s.gstin || "")}</td><td>${actions("supplier", s.id)}</td></tr>`).join("");
  ingredientsTable.innerHTML = ingredients.map((i) => `<tr><td>${esc(i.name)}</td><td>${esc(i.unit)}</td><td>${money(i.current_stock)}</td><td>${money(i.low_stock_alert ?? i.low_stock_level)}</td><td>${actions("ingredient", i.id)}</td></tr>`).join("");
  purchaseOrdersTable.innerHTML = purchaseOrders.map((po) => `<tr><td>${esc(po.po_number || `PO-${po.id}`)}</td><td>${esc(po.supplier_name || "")}</td><td>${esc(po.status)}</td><td>${money(po.total_amount)}</td><td>${money(po.paid_amount)}</td><td>${money(po.outstanding_amount)}</td><td>${esc(po.order_date || po.created_at || "")}</td><td><button class="mini-btn" data-receive-po="${po.id}" type="button">Receive</button><button class="danger-btn" data-cancel-po="${po.id}" type="button">Cancel</button></td></tr>`).join("");
  recipesTable.innerHTML = recipes.map((r) => `<tr><td>${esc(r.item_name)}</td><td>${esc(r.ingredient_name)}</td><td>${money(r.quantity_per_item)}</td><td>${esc(r.unit || "")}</td><td><button class="danger-btn" data-delete-recipe="${r.id}" type="button">Delete</button></td></tr>`).join("");
  inventoryLowStock.innerHTML = lowStock.map((i) => `<p>${esc(i.name)}: ${money(i.current_stock)} ${esc(i.unit || "")}</p>`).join("") || "<p>No low stock alerts.</p>";
  supplierBalancePanel.innerHTML = supplierBalances.map((row) => `<p>${esc(row.name)}: outstanding ${money(row.outstanding_amount)} / billed ${money(row.billed_amount)}</p>`).join("") || "<p>No supplier balances.</p>";
  supplierPaymentsPanel.innerHTML = supplierPayments.map((row) => `<p>${esc(row.supplier_name)} ${money(row.amount)} ${esc(row.payment_mode)} <small>${esc(row.po_number || "")}</small></p>`).join("") || "<p>No supplier payments.</p>";
}

function renderModifiers() {
  const { groups = [], modifiers = [], assignments = [], combos = [], comboItems = [] } = state.modifiers;
  fillSelect(modifierOptionGroup, groups);
  fillSelect(modifierAssignGroup, groups);
  modifierGroupsTable.innerHTML = groups.map((g) => `<tr><td>${esc(g.name)}</td><td>${g.min_select}</td><td>${g.max_select}</td><td>${g.required ? "Yes" : "No"}</td><td>${actions("modifier-group", g.id)}</td></tr>`).join("");
  modifierOptionsTable.innerHTML = modifiers.map((m) => `<tr><td>${esc(m.group_name || "")}</td><td>${esc(m.name)}</td><td>${money(m.price_delta)}</td><td>${actions("modifier-option", m.id)}</td></tr>`).join("");
  modifierAssignmentsTable.innerHTML = assignments.map((a) => `<tr><td>${esc(a.item_name)}</td><td>${esc(a.group_name)}</td><td><button class="danger-btn" data-delete-modifier-assignment="${a.id}" type="button">Delete</button></td></tr>`).join("");
  combosTable.innerHTML = combos.map((c) => {
    const included = comboItems.filter((item) => item.combo_id === c.id).map((item) => `${item.item_name} x${item.quantity}`).join(", ");
    return `<tr><td>${esc(c.name)}</td><td>${money(c.price)}</td><td>${esc(included)}</td><td>${actions("combo", c.id)}</td></tr>`;
  }).join("");
}

function renderBackup() {
  const settings = state.backups.settings || {};
  backupEnabled.checked = settings.backup_enabled === "1";
  backupInterval.value = settings.backup_interval_minutes || 60;
  backupFolderPath.value = settings.backup_folder_path || "";
  onedriveFolderPath.value = settings.onedrive_folder_path || "";
  backupStatusPanel.innerHTML = `<p>Last backup: ${esc(settings.last_backup_at || "Never")}</p><p>Last sync: ${esc(settings.last_sync_at || "Never")}</p>`;
  backupLogsPanel.innerHTML = (state.backups.logs || []).map((log) => `<p><strong>${esc(log.type)}</strong> ${esc(log.status)}<br><small>${esc(log.message || "")}</small></p>`).join("") || "<p>No logs yet.</p>";
  backupListTable.innerHTML = (state.backups.backups || []).map((backup) => `<tr><td>${esc(backup.filename)}</td><td>${backup.size}</td><td>${esc(backup.created_at)}</td><td><button data-restore-backup="${esc(backup.filename)}" class="danger-btn" type="button">Restore</button></td></tr>`).join("");
}

function renderPermissions() {
  if (actor.role !== "OWNER") {
    permissionsStatus.textContent = "Only OWNER can edit permissions";
    permissionsMatrixHead.innerHTML = "";
    permissionsMatrixBody.innerHTML = "";
    savePermissionsMatrix.hidden = true;
    return;
  }
  savePermissionsMatrix.hidden = false;
  const roles = state.permissions.roles || [];
  const permissions = state.permissions.permissions || [];
  const matrix = state.permissions.matrix || [];
  const allowed = new Map(matrix.map((row) => [`${row.role}:${row.permission_code}`, Number(row.allowed) === 1]));
  permissionsMatrixHead.innerHTML = `<tr><th>Module</th><th>Permission</th>${roles.map((role) => `<th>${esc(role.name)}</th>`).join("")}</tr>`;
  permissionsMatrixBody.innerHTML = permissions.map((permission) => `
    <tr>
      <td>${esc(permission.module)}</td>
      <td><strong>${esc(permission.code)}</strong><br><small>${esc(permission.description || "")}</small></td>
      ${roles.map((role) => `<td><input type="checkbox" data-permission-role="${esc(role.name)}" data-permission-code="${esc(permission.code)}" ${allowed.get(`${role.name}:${permission.code}`) ? "checked" : ""} ${role.name === "OWNER" ? "disabled" : ""}></td>`).join("")}
    </tr>
  `).join("");
  permissionsStatus.textContent = "Permission matrix loaded";
}

function renderDeviceSessions() {
  deviceSessionsTable.innerHTML = (state.devices.devices || []).map((device) => `
    <tr>
      <td>${esc(device.user_name || device.user_id)}</td>
      <td>${esc(device.role || "")}</td>
      <td>${esc(device.device_name || "")}</td>
      <td>${esc(device.ip_address || "")}</td>
      <td>${esc(device.login_at || "")}</td>
      <td>${esc(device.last_seen_at || "")}</td>
      <td><button class="danger-btn" data-force-logout="${device.id}" type="button">Force Logout</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7">No active devices.</td></tr>`;
  deviceStatus.textContent = "Device sessions loaded";
}

function renderCommercial() {
  const data = state.commercial;
  const analytics = data.analytics || {};
  const reports = data.reports || {};
  commercialAnalytics.innerHTML = `
    <p>Forecast: ${money(analytics.revenueForecast?.forecast || 0)}</p>
    <p>Peak hours: ${(analytics.peakHours || []).map((row) => `${esc(row.hour)} (${row.orders})`).join(", ") || "No data"}</p>
    <p>Alerts: ${(analytics.alerts || []).map((row) => esc(row.message)).join(", ") || "None"}</p>
  `;
  commercialReports.innerHTML = `
    <p>Sales: ${money(reports.profitLoss?.sales || 0)}</p>
    <p>Expenses: ${money(reports.profitLoss?.expenses || 0)}</p>
    <p>Profit: <strong>${money(reports.profitLoss?.profit || 0)}</strong></p>
  `;
  commercialJournal.innerHTML = (data.journal?.journal || []).slice(0, 5).map((row) => `<p>${esc(row.document_type)} ${esc(row.invoice_no || `Order #${row.order_id}`)} ${money(row.total_amount)}</p>`).join("") || "<p>No journal entries.</p>";
  commercialFraud.innerHTML = (data.fraud?.alerts || []).slice(0, 5).map((row) => `<p><strong>${esc(row.severity)}</strong> ${esc(row.message)}</p>`).join("") || "<p>No fraud alerts.</p>";
  commercialCredit.innerHTML = (data.credit?.aging || []).slice(0, 5).map((row) => `<p>${esc(row.customer_name || row.customer_id)}: ${money(row.balance)}</p>`).join("") || "<p>No credit balances.</p>";
  commercialDiagnostics.innerHTML = `
    <p>Database: ${data.diagnostics?.databaseOk ? "OK" : "Check required"}</p>
    <p>Backups: ${esc(data.diagnostics?.backup?.last_backup_at || "Never")}</p>
    <p>Payment providers: ${(data.payments?.providers || []).map((row) => esc(row.provider_code)).join(", ") || "None"}</p>
  `;
  commercialStatus.textContent = "Commercial tools loaded";
}

function renderInvoices() {
  const query = String(invoiceSearch?.value || '').trim().toLowerCase();
  const visibleInvoices = (state.invoices || []).filter((invoice) => !query || [
    invoice.invoice_no,
    invoice.customer_name,
    invoice.customer_phone,
    invoice.table_no,
    invoice.order_type
  ].some((value) => String(value || '').toLowerCase().includes(query)));
  invoicesTable.innerHTML = visibleInvoices.map((invoice) => `
    <tr>
      <td>${esc(invoice.invoice_no || `#${invoice.id}`)}</td>
      <td>${esc(invoice.customer_name || "")}<br><small>${esc(invoice.customer_phone || "")}</small></td>
      <td>${esc(invoice.table_no || "")}</td>
      <td>${esc(invoice.order_type || "")}</td>
      <td>${money(invoice.total_amount)}</td>
      <td>${esc(formatDateTime(invoice.settled_at))}</td>
      <td><button type="button" class="secondary-btn invoice-view" data-invoice-id="${invoice.id}" title="View invoice details">View</button></td>
    </tr>
  `).join("") || `<tr><td colspan="7">No invoices found.</td></tr>`;
  invoiceStatus.textContent = query ? `${visibleInvoices.length} matching invoice(s)` : "Invoices loaded";
}

async function showInvoiceDetail(invoiceId) {
  const panel = document.getElementById('invoiceDetail');
  const data = await fetchJson(`/orders/invoices/${encodeURIComponent(invoiceId)}?restaurantId=${encodeURIComponent(restaurantId)}`);
  const invoice = data.invoice;
  const items = data.items || [];
  const discounts = data.discounts || [];
  const payments = data.payments || [];
  const discountTotal = discounts.reduce((sum, row) => sum + (String(row.value_type || '').toUpperCase() === 'PERCENT'
    ? Number(invoice.total_amount || 0) * Number(row.value || 0) / Math.max(100 - Number(row.value || 0), 1)
    : Number(row.value || 0)), 0);
  const refundedAmount = Number(invoice.refunded_amount || 0);
  const remainingPaid = Math.max(Number(invoice.paid_amount || 0), 0);
  panel.innerHTML = `<header><div><h3>${esc(invoice.invoice_no || `Invoice #${invoice.id}`)}</h3><p class="invoice-detail-meta">${esc(invoice.customer_name || 'Walk-in customer')} · ${esc(invoice.table_no || invoice.order_type || '')} · ${esc(formatDateTime(invoice.settled_at))}</p></div><div class="invoice-detail-actions"><button type="button" class="secondary-btn" id="printInvoice">Print</button><button type="button" class="secondary-btn" id="downloadInvoicePdf">Save PDF</button></div></header><div class="invoice-detail-lines">${items.map(item => `<div class="invoice-detail-line"><span>${esc(item.name)} × ${item.quantity}${item.notes ? `<small>Note: ${esc(item.notes)}</small>` : ''}</span><strong>${money(Number(item.price || 0) * Number(item.quantity || 0))}</strong></div>`).join('') || '<p>No items recorded.</p>'}</div><div class="invoice-detail-total"><span>Total</span><strong>${money(invoice.total_amount)}</strong></div>`;
  panel.hidden = false;
  if (discountTotal > 0) {
    const discountSummary = document.createElement('div');
    discountSummary.className = 'invoice-discount-summary';
    const label = discounts.length === 1 && discounts[0].promo_code ? `Discount applied (${esc(discounts[0].promo_code)})` : 'Discount applied';
    discountSummary.innerHTML = `<div class="invoice-detail-total"><span>${label}</span><strong>-${money(discountTotal)}</strong></div>`;
    panel.querySelector('.invoice-detail-total')?.before(discountSummary);
  }
  if (refundedAmount > 0) {
    const refundSummary = document.createElement('div');
    refundSummary.className = 'invoice-refund-summary';
    refundSummary.innerHTML = `<div class="invoice-detail-total"><span>Refunded</span><strong>-${money(refundedAmount)}</strong></div><div class="invoice-detail-total"><span>Remaining paid</span><strong>${money(remainingPaid)}</strong></div>`;
    panel.appendChild(refundSummary);
  }
  const refund = document.createElement('div');
  const taxRate = Number(state.settings?.tax_rate || 0);
  if (taxRate > 0) {
    const tax = document.createElement('div');
    tax.className = 'invoice-detail-total invoice-tax';
    tax.innerHTML = `<span>${esc(state.settings?.tax_name || 'GST')} included (${taxRate}%)</span><strong>${money(Number(invoice.total_amount || 0) * taxRate / (100 + taxRate))}</strong>`;
    panel.appendChild(tax);
  }
  refund.className = 'invoice-refund';
  refund.innerHTML = '<h4>Refund</h4><p class="invoice-detail-meta">Refund cannot exceed the remaining paid amount.</p><div class="invoice-refund-fields"><input id="refundAmount" type="number" min="0.01" max="' + remainingPaid + '" step="0.01" placeholder="Amount"><select id="refundMode"><option value="CASH">Cash</option><option value="UPI">UPI</option><option value="OWNER_FUND">Owner fund</option></select><input id="refundReason" maxlength="200" placeholder="Reason"></div><button type="button" class="danger-btn" id="refundInvoice">Refund</button><p id="refundStatus"></p>';
  panel.appendChild(refund);
  document.getElementById('printInvoice').onclick = () => printInvoice(invoice, items, discounts, payments).catch((error) => alert(error.message));
  document.getElementById('downloadInvoicePdf').onclick = () => saveInvoicePdf(invoice, items, discounts, payments).catch((error) => alert(error.message));
  const refundButton = document.getElementById('refundInvoice');
  if (refundButton) refundButton.onclick = async () => {
    const amount = Number(document.getElementById('refundAmount').value);
    const status = document.getElementById('refundStatus');
    if (!Number.isFinite(amount) || amount <= 0) { status.textContent = 'Enter a positive refund amount.'; return; }
    if (amount > Number(invoice.paid_amount || 0)) { status.textContent = 'Refund cannot exceed the amount paid.'; return; }
    if (!window.confirm(`Refund ${money(amount)} from this invoice?`)) return;
    try {
      const result = await postJson('/orders/refund', { restaurantId, orderId: invoice.id, amount, refundMode: document.getElementById('refundMode').value, reason: document.getElementById('refundReason').value, refundedByRole: actor.role });
      status.textContent = `${money(result.refundedAmount)} refunded.`;
      await showInvoiceDetail(invoice.id); await loadInvoiceList();
    } catch (err) { status.textContent = err.message; }
  };
}

async function downloadInvoicePdf(invoiceId, invoiceNo) {
  const response = await fetch(`/orders/invoices/${encodeURIComponent(invoiceId)}/pdf?restaurantId=${encodeURIComponent(restaurantId)}`);
  if (!response.ok) {
    let message = 'PDF download failed';
    try { message = (await response.json()).message || message; } catch (_) { /* non-JSON error */ }
    throw new Error(message);
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${String(invoiceNo || `invoice-${invoiceId}`).replace(/[^a-z0-9._-]/gi, '_')}.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function groupInvoicePrintItems(items = []) {
  const grouped = new Map();
  for (const item of items) {
    const modifiers = Array.isArray(item.modifiers) ? [...item.modifiers].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))) : (item.modifiers || []);
    const key = JSON.stringify({ item: item.item_id ?? item.name, name: item.name, price: Number(item.price || 0), notes: String(item.notes || '').trim(), modifiers });
    const existing = grouped.get(key);
    if (existing) existing.quantity += Number(item.quantity || 0);
    else grouped.set(key, { ...item, quantity: Number(item.quantity || 0) });
  }
  return [...grouped.values()];
}

function renderBillTemplatePreview() {
  if (!window.billTemplatePreview || !window.settingBillTemplate) return;
  const template = settingBillTemplate.value || 'BORDERED';
  billTemplatePreview.dataset.template = template;
  billTemplatePreview.innerHTML = `<div class="bill-preview-paper"><strong>${esc((state.settings?.settings || {}).restaurant_display_name || 'RESTAURANT NAME')}</strong><small>TAX INVOICE</small><div class="bill-preview-meta">Invoice: DEMO-0001<br>Date: 19/07/2026<br>Table: A1</div><table><tr><th>Item</th><th>Qty</th><th>Amount</th></tr><tr><td>Sample item</td><td>2</td><td>200.00</td></tr></table><div class="bill-preview-totals"><span>Taxable value</span><b>190.48</b><span>CGST @ 2.50%</span><b>4.76</b><span>SGST @ 2.50%</span><b>4.76</b><span>Grand total</span><b>200.00</b></div></div>`;
}

function renderKotTemplatePreview() {
  if (!window.kotTemplatePreview || !window.settingKotTemplate) return;
  kotTemplatePreview.dataset.template = settingKotTemplate.value === 'BORDERLESS' ? 'BORDERLESS' : 'BORDERED';
  kotTemplatePreview.innerHTML = `<div class="bill-preview-paper"><strong>KOT</strong><small>DINE IN</small><div class="bill-preview-meta">KOT: A12-2<br>Table No: Table 1</div><table><tr><th>Item</th><th>Note</th><th>Qty</th></tr><tr><td>Butter Naan</td><td>No onion</td><td>2</td></tr></table><small>Compact continuous-roll preview</small></div>`;
}

settingBillTemplate?.addEventListener('change', renderBillTemplatePreview);
settingKotTemplate?.addEventListener('change', renderKotTemplatePreview);

saveInvoiceReprintPin?.addEventListener('click', async () => {
  const pin = String(settingInvoiceReprintPin.value || '').trim();
  invoiceReprintPinStatus.textContent = '';
  if (!/^\d{6}$/.test(pin)) { invoiceReprintPinStatus.textContent = 'Enter exactly six digits.'; return; }
  try {
    const result = await postJson('/printer-security/reprint-pin', { restaurantId, actor: { ...actor, name: user.name }, pin });
    settingInvoiceReprintPin.value = '';
    invoiceReprintPinStatus.textContent = result.message;
  } catch (error) { invoiceReprintPinStatus.textContent = error.message; }
});

function invoicePrintHtml(invoice, items, discounts = [], payments = [], reprint = null) {
  const profile = state.settings?.settings || {};
  const billOption = (key) => !['0', 'false', 'off'].includes(String(profile[key] ?? '1').toLowerCase());
  if (!/^\d{14}$/.test(String(profile.fssai_license_no || '').trim())) {
    throw new Error('Configure the restaurant 14-digit FSSAI licence / registration number in Admin → Settings before printing invoices.');
  }
  if (profile.gstin && !/^\d{2}[A-Z0-9]{13}$/i.test(String(profile.gstin).trim())) {
    throw new Error('The GSTIN in Admin → Settings is invalid. Correct it before printing a tax invoice.');
  }
  const currency = profile.currency || 'INR';
  const printableItems = groupInvoicePrintItems(items);
  const lineTotal = printableItems.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const registered = Boolean(String(profile.gstin || '').trim());
  const taxRate = Number(profile.tax_rate || (registered ? 5 : 0));
  const grandTotal = Number(invoice.total_amount || 0);
  const serviceCharge = Number(invoice.service_charge_amount || 0);
  const tax = Number(invoice.tax_amount || 0) || (taxRate > 0 ? grandTotal * taxRate / (100 + taxRate) : 0);
  const subtotal = Math.max(grandTotal - tax - serviceCharge, 0);
  const halfTax = tax / 2;
  const totalQuantity = printableItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const discountTotal = Math.max(lineTotal - grandTotal, 0);
  const rows = printableItems.map((item, index) => `<tr><td>${index + 1}</td><td>${esc(item.name)}${item.notes ? `<small>${esc(item.notes)}</small>` : ''}</td><td>${esc(item.quantity)}</td><td>${Number(item.price || 0).toFixed(2)}</td><td>${(Number(item.price || 0) * Number(item.quantity || 0)).toFixed(2)}</td></tr>`).join('');
  const paymentText = payments.map((payment) => `${payment.method}: ${Number(payment.amount || 0).toFixed(2)}`).join(', ') || invoice.payment_mode || 'CASH';
  const title = `${reprint ? `REPRINT #${Number(reprint.reprintNumber)} · ` : ''}${registered ? 'TAX INVOICE' : 'RECEIPT / BILL'}`;
  const template = String(profile.bill_template || 'BORDERED').toUpperCase();
  const templateCss = template === 'BORDERLESS' ? '.items th,.items td{border:0;border-bottom:1px solid #bbb}.summary{border:0}' : template === 'COMPACT' ? 'body{font-size:9px}.items th,.items td{padding:2px 1px}.meta{grid-template-columns:22mm 1fr}.items th,.items td{border:0;border-bottom:1px dashed #999}' : '';
  const reprintBanner = reprint ? `<div style="border:2px solid #111;padding:3px;margin-bottom:4px;font-size:12px;font-weight:900;text-align:center">REPRINT #${Number(reprint.reprintNumber)}<br><small>${esc(formatDateTime(reprint.reprintedAt))} · ${esc(reprint.reprintedBy || '')}</small></div>` : '';
  const html = `<!doctype html><html><head><title>${esc(invoice.invoice_no || 'Invoice')}</title><style>
    @page{size:auto;margin:1.5mm}html,body{width:auto;max-width:100%;margin:0;padding:0;overflow:hidden}*{box-sizing:border-box;max-width:100%}body{color:#111;font:9px Arial,sans-serif;line-height:1.25;overflow-wrap:anywhere}header{text-align:center}h1{font-size:14px;margin:0 0 2px;text-transform:uppercase;overflow-wrap:anywhere}h2{font-size:12px;margin:5px 0 3px;border-top:1px solid #111;border-bottom:1px solid #111;padding:3px}p{margin:1px 0}.legal{font-weight:700}.meta{display:grid;grid-template-columns:35% minmax(0,65%);gap:2px 3px;border-bottom:1px dashed #111;padding:4px 0}.meta span,.meta b{min-width:0;overflow-wrap:anywhere}.meta b{font-weight:700}.items{width:100%;max-width:100%;table-layout:fixed;border-collapse:collapse;margin-top:4px}.items th,.items td{padding:2px 1px;border:1px solid #555;vertical-align:top;overflow-wrap:anywhere;word-break:break-word}.items th{text-align:center;font-size:8px}.items th:nth-child(1),.items td:nth-child(1){width:7%;text-align:center}.items th:nth-child(2),.items td:nth-child(2){width:43%}.items th:nth-child(3),.items td:nth-child(3){width:11%;text-align:center}.items th:nth-child(4),.items td:nth-child(4){width:18%;text-align:right}.items th:nth-child(5),.items td:nth-child(5){width:21%;text-align:right}.items small{display:block}.summary{border:1px solid #555;border-top:0;padding:3px}.summary p{display:flex;justify-content:space-between;gap:4px}.summary p b{white-space:nowrap}.grand{border-top:1px solid #111;margin-top:3px;padding-top:4px;font-weight:800;font-size:12px}.footer{text-align:center;border-top:1px dashed #111;margin-top:6px;padding-top:5px}.compliance{font-size:8px}${templateCss}@media print{button{display:none}}
  </style></head><body><header><h1>${esc(profile.restaurant_display_name || profile.legal_name || 'Restaurant')}</h1>${profile.legal_name && profile.legal_name !== profile.restaurant_display_name ? `<p class="legal">${esc(profile.legal_name)}</p>` : ''}<p>${esc([profile.address_line_1, profile.address_line_2].filter(Boolean).join(', '))}</p><p>${esc([profile.city, profile.state, profile.state_code ? `Code ${profile.state_code}` : '', profile.country].filter(Boolean).join(', '))}</p>${billOption('bill_print_contact') ? `<p>${profile.phone ? `Mob: ${esc(profile.phone)}` : ''}${profile.email ? ` · ${esc(profile.email)}` : ''}</p>` : ''}${profile.gstin ? `<p><b>GSTIN: ${esc(profile.gstin)}</b></p>` : ''}${profile.fssai_license_no ? `<p><b>FSSAI: ${esc(profile.fssai_license_no)}</b></p>` : ''}<h2>${title}</h2></header>
  <div class="meta"><span>Invoice No.</span><b>${esc(invoice.invoice_no || `#${invoice.id}`)}</b><span>Date / Time</span><b>${esc(formatDateTime(invoice.settled_at))}</b><span>Order / Table</span><b>${esc(`${invoice.order_reference || invoice.id} / ${invoice.table_no || invoice.order_type || ''}`)}</b>${billOption('bill_print_kot_references') && invoice.kot_references ? `<span>KOT No(s).</span><b>${esc(invoice.kot_references)}</b>` : ''}${billOption('bill_print_customer') ? `<span>Customer</span><b>${esc(invoice.customer_name || 'Walk-in customer')}</b>` : ''}<span>Cashier</span><b>${esc(invoice.cashier_name || 'Owner')}</b>${billOption('bill_print_payment') ? `<span>Payment</span><b>${esc(paymentText)}</b>` : ''}${registered ? `<span>Place of supply</span><b>${esc(`${profile.state || 'Tamil Nadu'} (${profile.state_code || '33'})`)}</b><span>SAC</span><b>${esc(profile.sac_code || '996331')}</b><span>Reverse charge</span><b>No</b>` : ''}</div>
  <table class="items"><thead><tr><th>#</th><th>Item</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table><div class="summary"><p><span>Total Qty</span><b>${totalQuantity}</b></p>${discountTotal > 0 ? `<p><span>Discount</span><b>-${currency} ${discountTotal.toFixed(2)}</b></p>` : ''}<p><span>Taxable value</span><b>${currency} ${subtotal.toFixed(2)}</b></p>${serviceCharge > 0 ? `<p><span>Service charge</span><b>${currency} ${serviceCharge.toFixed(2)}</b></p>` : ''}${registered && taxRate > 0 ? `<p><span>CGST @ ${(taxRate / 2).toFixed(2)}%</span><b>${currency} ${halfTax.toFixed(2)}</b></p><p><span>SGST @ ${(taxRate / 2).toFixed(2)}%</span><b>${currency} ${halfTax.toFixed(2)}</b></p><p><span>Total GST</span><b>${currency} ${tax.toFixed(2)}</b></p>` : ''}<p class="grand"><span>GRAND TOTAL</span><b>${currency} ${grandTotal.toFixed(2)}</b></p></div><div class="footer">${profile.bill_footer_text ? `<p><b>${esc(profile.bill_footer_text)}</b></p>` : ''}<p class="compliance">${registered ? 'GST is included in the amounts shown.' : 'This document does not collect GST.'}</p>${billOption('bill_print_authorised_signatory') ? '<p><b>Authorised Signatory</b></p>' : ''}</div></body></html>`;
  return html;
}

async function printInvoice(invoice, items, discounts, payments) {
  let pin = '';
  if (String(actor.role).toUpperCase() === 'CASHIER') {
    pin = window.prompt('Enter the six-digit invoice reprint PIN') || '';
    if (!/^\d{6}$/.test(pin)) throw new Error('A valid six-digit reprint PIN is required');
  }
  const reprint = await postJson(`/orders/invoices/${encodeURIComponent(invoice.id)}/reprint`, { restaurantId, actor: { ...actor, name: user.name }, pin });
  const html = invoicePrintHtml(invoice, items, discounts, payments, reprint);
  if (window.posDesktop?.printHtml) {
    await window.posDesktop.printHtml(html);
    return;
  }
  const printWindow = window.open('', '_blank', 'width=420,height=760');
  if (!printWindow) throw new Error('Printing was blocked. Enable pop-ups and try again.');
  printWindow.document.open(); printWindow.document.write(html); printWindow.document.close();
  printWindow.onload = () => { printWindow.focus(); printWindow.print(); };
}

async function saveInvoicePdf(invoice, items, discounts, payments) {
  if (window.posDesktop?.savePdf) {
    const fileName = `${String(invoice.invoice_no || `invoice-${invoice.id}`).replace(/[^a-z0-9._-]/gi, '_')}.pdf`;
    await window.posDesktop.savePdf(invoicePrintHtml(invoice, items, discounts, payments), fileName);
    return;
  }
  await downloadInvoicePdf(invoice.id, invoice.invoice_no);
}

function findById(rows, id) {
  return (rows || []).find((row) => String(row.id) === String(id));
}

function showView(view) {
  const btn = document.querySelector(`.nav-btn[data-view="${view}"]`);
  if (btn) btn.click();
}

function showInventoryTab(tab) {
  document.querySelectorAll(".inventory-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.inventoryTab === tab));
  document.querySelectorAll(".inventory-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `inventory-${tab}`));
}

function showModifierTab(tab) {
  document.querySelectorAll(".modifier-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.modifierTab === tab));
  document.querySelectorAll(".modifier-panel").forEach((panel) => panel.classList.toggle("active", panel.id === `modifier-${tab}`));
}

function focusFirstInput(form) {
  form?.querySelector("input:not([type='hidden']), select, textarea")?.focus();
  form?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function editKitchen(id) {
  const row = findById(state.admin.kitchens, id);
  if (!row) return;
  showView("kitchens");
  kitchenId.value = row.id;
  kitchenName.value = row.name || "";
  kitchenPrinterId.value = row.printer_id || "";
  kitchenActive.checked = Number(row.active) !== 0;
  focusFirstInput(kitchenForm);
}

function editPrinter(id) {
  const row = findById(state.admin.printers || [], id);
  if (!row) return;
  showView("printers");
  printerId.value = row.id;
  printerName.value = row.name || "";
  printerType.value = row.type || "KITCHEN";
  printerConnection.value = row.connection || "USB";
  printerPaperWidth.value = String(row.paper_width_mm || 58);
  printerAddress.value = row.address || "";
  printerActive.checked = Number(row.active) !== 0;
  focusFirstInput(printerForm);
}

function editCategory(id) {
  const row = findById(state.admin.categories, id);
  if (!row) return;
  showView("categories");
  categoryId.value = row.id;
  categoryName.value = row.name || "";
  categoryKitchen.value = row.kitchen_id || "";
  categoryActive.checked = Number(row.active) !== 0;
  focusFirstInput(categoryForm);
}

function editItem(id) {
  const row = findById(state.admin.items, id);
  if (!row) return;
  showView("items");
  itemId.value = row.id;
  itemName.value = row.name || "";
  itemCategory.value = row.category_id || "";
  itemPrice.value = row.price ?? 0;
  itemOnlineDescription.value = row.online_description || "";
  itemImageUrl.value = row.image_url || "";
  itemVeg.checked = Number(row.is_veg ?? 1) === 1;
  itemDineIn.checked = Number(row.allow_dine_in ?? 1) === 1;
  itemParcel.checked = Number(row.allow_parcel ?? 1) === 1;
  itemPartyOrder.checked = Number(row.allow_party_order ?? 1) === 1;
  itemOnlineEnabled.checked = Number(row.online_enabled ?? 1) === 1;
  itemActive.checked = Number(row.active) !== 0;
  focusFirstInput(itemForm);
}

function editUser(id) {
  const row = findById(state.admin.users, id);
  if (!row) return;
  showView("users");
  userId.value = row.id;
  userName.value = row.name || "";
  userUsername.value = row.username || "";
  userPin.value = "";
  userRole.value = row.role || "WAITER";
  userActive.checked = Number(row.active) !== 0;
  focusFirstInput(userForm);
}

function editTable(id) {
  const row = findById(state.admin.tables, id);
  if (!row) return;
  showView("tables");
  tableId.value = row.id;
  tableName.value = row.table_name || "";
  tableStatus.value = row.status || "AVAILABLE";
  focusFirstInput(tableForm);
}

function editSupplier(id) {
  const row = findById(state.inventory.suppliers, id);
  if (!row) return;
  showView("inventory");
  showInventoryTab("suppliers");
  supplierId.value = row.id;
  supplierName.value = row.name || "";
  supplierPhone.value = row.phone || "";
  supplierEmail.value = row.email || "";
  supplierAddress.value = row.address || "";
  supplierGstin.value = row.gstin || "";
  focusFirstInput(supplierForm);
}

function editIngredient(id) {
  const row = findById(state.inventory.ingredients, id);
  if (!row) return;
  showView("inventory");
  showInventoryTab("ingredients");
  ingredientId.value = row.id;
  ingredientName.value = row.name || "";
  ingredientUnit.value = row.unit || "";
  ingredientLowStock.value = row.low_stock_alert ?? row.low_stock_level ?? 0;
  focusFirstInput(ingredientForm);
}

function editModifierGroup(id) {
  const row = findById(state.modifiers.groups, id);
  if (!row) return;
  showView("modifiers");
  showModifierTab("groups");
  modifierGroupId.value = row.id;
  modifierGroupName.value = row.name || "";
  modifierGroupMin.value = row.min_select ?? 0;
  modifierGroupMax.value = row.max_select ?? 1;
  modifierGroupRequired.checked = Number(row.required) === 1;
  focusFirstInput(modifierGroupForm);
}

function editModifierOption(id) {
  const row = findById(state.modifiers.modifiers, id);
  if (!row) return;
  showView("modifiers");
  showModifierTab("options");
  modifierOptionId.value = row.id;
  modifierOptionGroup.value = row.group_id || "";
  modifierOptionName.value = row.name || "";
  modifierOptionPrice.value = row.price_delta ?? 0;
  focusFirstInput(modifierOptionForm);
}

function editCombo(id) {
  const row = findById(state.modifiers.combos, id);
  const firstItem = (state.modifiers.comboItems || []).find((item) => String(item.combo_id) === String(id));
  if (!row) return;
  showView("modifiers");
  showModifierTab("combos");
  comboId.value = row.id;
  comboName.value = row.name || "";
  comboPrice.value = row.price ?? 0;
  if (firstItem) {
    comboItem.value = firstItem.item_id || "";
    comboItemQty.value = firstItem.quantity || 1;
  }
  focusFirstInput(comboForm);
}

function applyPermissionGuards() {
  const viewPermissions = {
    users: "admin.users.manage",
    inventory: "inventory.view",
    reports: "reports.view_invoice_only",
    devices: "admin.view",
    settings: "admin.settings.manage",
    permissions: "admin.settings.manage",
    backup: "backup.manage",
    audit: "audit.view"
  };
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    const permission = viewPermissions[btn.dataset.view];
    if (permission && !can(permission) && !(permission === "reports.view_invoice_only" && can("reports.view_all"))) {
      btn.hidden = true;
    }
  });
  document.querySelectorAll(".danger-btn").forEach((btn) => {
    if (!can("admin.menu.manage") && !can("inventory.manage")) btn.hidden = true;
  });
  if (!can("reports.export")) exportAuditCsv.hidden = true;
  if (!can("inventory.purchase_orders")) {
    purchaseOrderForm.hidden = true;
    supplierPaymentForm.hidden = true;
  }
  if (!can("admin.settings.manage")) {
    settingsForm.querySelectorAll("input,select,button").forEach((element) => element.disabled = true);
    staffCashSettingsForm.querySelectorAll("input,select,button").forEach((element) => element.disabled = true);
  }
}

function checkedValue(element) {
  return element.checked ? "1" : "0";
}

function setChecked(element, value) {
  element.checked = value === "1" || value === true || value === "true";
}

function renderSettings() {
  const settings = state.settings.settings || {};
  settingRestaurantDisplayName.value = settings.restaurant_display_name || "";
  settingLegalName.value = settings.legal_name || "";
  settingGstin.value = settings.gstin || "";
  settingFssaiLicenseNo.value = settings.fssai_license_no || "";
  settingStateCode.value = settings.state_code || "33";
  settingAddressLine1.value = settings.address_line_1 || "";
  settingAddressLine2.value = settings.address_line_2 || "";
  settingCity.value = settings.city || "";
  settingState.value = settings.state || "";
  settingCountry.value = settings.country || "";
  settingPhone.value = settings.phone || "";
  settingEmail.value = settings.email || "";
  settingCurrency.value = settings.currency || "INR";
  settingTimezone.value = settings.timezone || "Asia/Kolkata";
  settingLogoPath.value = settings.logo_path || "";
  settingDefaultOrderType.value = settings.default_order_type || "DINE_IN";
  setChecked(settingAllowNonInvoiceOrders, settings.allow_non_invoice_orders);
  setChecked(settingAllowDiscount, settings.allow_discount);
  setChecked(settingAllowManualPriceOverride, settings.allow_manual_price_override);
  setChecked(settingAllowRefund, settings.allow_refund);
  setChecked(settingAllowOrderCancel, settings.allow_order_cancel);
  setChecked(settingRequireManagerPinForDiscount, settings.require_manager_pin_for_discount);
  setChecked(settingRequireManagerPinForRefund, settings.require_manager_pin_for_refund);
  setChecked(settingRequireManagerPinForVoid, settings.require_manager_pin_for_void);
  setChecked(settingRequireClockInBeforeOrder, settings.require_clock_in_before_order);
  settingInvoicePrefix.value = settings.invoice_prefix || "INV";
  settingInvoiceResetFrequency.value = settings.invoice_reset_frequency || "DAILY";
  setChecked(settingShowTaxOnBill, settings.show_tax_on_bill);
  settingTaxName.value = settings.tax_name || 'GST';
  settingTaxRate.value = settings.tax_rate || '0';
  settingSacCode.value = settings.sac_code || '996331';
  setChecked(settingShowQrOnBill, settings.show_qr_on_bill);
  setChecked(settingBillPrintContact, settings.bill_print_contact);
  setChecked(settingBillPrintKotReferences, settings.bill_print_kot_references);
  setChecked(settingBillPrintCustomer, settings.bill_print_customer);
  setChecked(settingBillPrintPayment, settings.bill_print_payment);
  setChecked(settingBillPrintAuthorisedSignatory, settings.bill_print_authorised_signatory);
  settingBillFooterText.value = settings.bill_footer_text || 'THANK YOU. VISIT AGAIN.';
  settingBillTemplate.value = settings.bill_template || 'BORDERED';
  settingBillLeftMarginDots.value = settings.bill_left_margin_dots ?? '0';
  settingBillTrailingFeedLines.value = settings.bill_trailing_feed_lines ?? '0';
  settingBillCutMode.value = settings.bill_cut_mode || 'PRINTER_DEFAULT';
  settingBillPrintWidth58.value = settings.bill_print_width_58 ?? '28';
  settingBillPrintWidth80.value = settings.bill_print_width_80 ?? '38';
  settingBillFontType.value = settings.bill_font_type || 'FONT_A';
  settingBillFontSize.value = settings.bill_font_size || 'NORMAL';
  settingBillLineSpacingDots.value = settings.bill_line_spacing_dots ?? '24';
  renderBillTemplatePreview();
  setChecked(settingQrRequireTablePin, settings.qr_require_table_pin === undefined ? true : settings.qr_require_table_pin);
  settingQrSessionMinutes.value = settings.qr_session_minutes || '30';
  setChecked(settingQrOrderingEnabled, settings.qr_ordering_enabled === undefined ? true : settings.qr_ordering_enabled);
  settingQrPendingOrderLimit.value = settings.qr_pending_order_limit || '25';
  settingUpiId.value = settings.upi_id || "";
  setChecked(settingServiceChargeEnabled, settings.service_charge_enabled);
  settingServiceChargePercent.value = settings.service_charge_percent || "0";
  setChecked(settingRoundOffEnabled, settings.round_off_enabled);
  setChecked(settingAutoPrintKot, settings.auto_print_kot);
  setChecked(settingPrintKotOnSave, settings.print_kot_on_save);
  setChecked(settingPrintKotOnSubmit, settings.print_kot_on_submit);
  setChecked(settingAllowKotReprint, settings.allow_kot_reprint);
  settingKotHeaderText.value = settings.kot_header_text || "";
  settingKotFooterText.value = settings.kot_footer_text || "";
  settingKotTemplate.value = settings.kot_template || 'CLASSIC';
  setChecked(settingKotPrintTable, settings.kot_print_table === undefined ? true : settings.kot_print_table);
  setChecked(settingKotPrintCustomer, settings.kot_print_customer);
  setChecked(settingKotPrintKitchen, settings.kot_print_kitchen);
  setChecked(settingKotCompactSpacing, settings.kot_compact_spacing === undefined ? true : settings.kot_compact_spacing);
  settingKotLeftMarginDots.value = settings.kot_left_margin_dots ?? '0';
  settingKotTrailingFeedLines.value = settings.kot_trailing_feed_lines ?? '0';
  settingKotCutMode.value = settings.kot_cut_mode || 'PRINTER_DEFAULT';
  settingKotPrintWidth58.value = settings.kot_print_width_58 ?? '28';
  settingKotPrintWidth80.value = settings.kot_print_width_80 ?? '38';
  settingKotFontType.value = settings.kot_font_type || 'FONT_A';
  settingKotFontSize.value = settings.kot_font_size || 'NORMAL';
  settingKotLineSpacingDots.value = settings.kot_line_spacing_dots ?? '24';
  renderKotTemplatePreview();
  setChecked(settingRequireOpenRegisterForCashPayment, settings.require_open_register_for_cash_payment);
  setChecked(settingAllowCashierRegisterClose, settings.allow_cashier_register_close);
  settingCashDiscrepancyThreshold.value = settings.cash_discrepancy_threshold || "0";
  setChecked(settingMobileAppEnabled, settings.mobile_app_enabled);
  setChecked(settingOnlineOrderEnabled, settings.online_order_enabled);
  settingOnlineStorefrontSlug.value = settings.online_storefront_slug || "";
  settingOnlineTheme.value = settings.online_theme || "CLASSIC";
  settingOnlinePrimaryColor.value = settings.online_primary_color || "#1f7a4d";
  settingOnlineAccentColor.value = settings.online_accent_color || "#f5b44b";
  settingOnlineLogoPath.value = settings.online_logo_path || "";
  const enabledOnlineMethods = new Set(String(settings.online_payment_methods || "UPI,CARD,COD,WALLET,NETBANKING").split(",").map((method) => method.trim().toUpperCase()));
  document.querySelectorAll(".online-payment-method").forEach((input) => { input.checked = enabledOnlineMethods.has(input.value); });
  setChecked(settingOnlineRequireOtp, settings.online_require_otp);
  setChecked(settingOnlineAllowLoyaltyCredit, settings.online_allow_loyalty_credit);
  setChecked(settingOnlineDeliveryEnabled, settings.online_delivery_enabled);
  setChecked(settingOnlineTakeawayEnabled, settings.online_takeaway_enabled);
  settingOnlineMinOrderAmount.value = settings.online_min_order_amount || "0";
  // Customer ordering must never point at the POS machine's local server.
  const publicOrderingBase = String(window.KMASTER_ONLINE_ORDER_URL || 'https://kmasterpos.com/order.html').replace(/\/$/, '');
  const publicOrderingUrl = `${publicOrderingBase}?restaurantId=${encodeURIComponent(restaurantId)}`;
  onlineStorefrontLink.href = publicOrderingUrl;
  const quickLink = document.getElementById('onlineStorefrontQuickLink');
  if (quickLink) quickLink.href = publicOrderingUrl;
  settingsStatus.textContent = "Settings loaded";
}

function collectSettings() {
  return {
    restaurant_display_name: settingRestaurantDisplayName.value,
    legal_name: settingLegalName.value,
    gstin: settingGstin.value,
    fssai_license_no: settingFssaiLicenseNo.value,
    state_code: settingStateCode.value,
    address_line_1: settingAddressLine1.value,
    address_line_2: settingAddressLine2.value,
    city: settingCity.value,
    state: settingState.value,
    country: settingCountry.value,
    phone: settingPhone.value,
    email: settingEmail.value,
    currency: settingCurrency.value,
    timezone: settingTimezone.value,
    logo_path: settingLogoPath.value,
    default_order_type: settingDefaultOrderType.value,
    allow_non_invoice_orders: checkedValue(settingAllowNonInvoiceOrders),
    allow_discount: checkedValue(settingAllowDiscount),
    allow_manual_price_override: checkedValue(settingAllowManualPriceOverride),
    allow_refund: checkedValue(settingAllowRefund),
    allow_order_cancel: checkedValue(settingAllowOrderCancel),
    require_manager_pin_for_discount: checkedValue(settingRequireManagerPinForDiscount),
    require_manager_pin_for_refund: checkedValue(settingRequireManagerPinForRefund),
    require_manager_pin_for_void: checkedValue(settingRequireManagerPinForVoid),
    require_clock_in_before_order: checkedValue(settingRequireClockInBeforeOrder),
    invoice_prefix: settingInvoicePrefix.value,
    invoice_reset_frequency: settingInvoiceResetFrequency.value,
    show_tax_on_bill: checkedValue(settingShowTaxOnBill),
    tax_name: settingTaxName.value.trim() || 'GST',
    tax_rate: settingTaxRate.value || '0',
    sac_code: settingSacCode.value || '996331',
    show_qr_on_bill: checkedValue(settingShowQrOnBill),
    bill_print_contact: checkedValue(settingBillPrintContact),
    bill_print_kot_references: checkedValue(settingBillPrintKotReferences),
    bill_print_customer: checkedValue(settingBillPrintCustomer),
    bill_print_payment: checkedValue(settingBillPrintPayment),
    bill_print_authorised_signatory: checkedValue(settingBillPrintAuthorisedSignatory),
    bill_footer_text: settingBillFooterText.value.trim(),
    bill_template: settingBillTemplate.value,
    bill_left_margin_dots: settingBillLeftMarginDots.value || '0',
    bill_trailing_feed_lines: settingBillTrailingFeedLines.value || '0',
    bill_cut_mode: settingBillCutMode.value,
    bill_print_width_58: settingBillPrintWidth58.value || '28',
    bill_print_width_80: settingBillPrintWidth80.value || '38',
    bill_font_type: settingBillFontType.value,
    bill_font_size: settingBillFontSize.value,
    bill_line_spacing_dots: settingBillLineSpacingDots.value || '24',
    qr_require_table_pin: checkedValue(settingQrRequireTablePin),
    qr_session_minutes: settingQrSessionMinutes.value || '30',
    qr_ordering_enabled: checkedValue(settingQrOrderingEnabled),
    qr_pending_order_limit: settingQrPendingOrderLimit.value || '25',
    upi_id: settingUpiId.value,
    service_charge_enabled: checkedValue(settingServiceChargeEnabled),
    service_charge_percent: settingServiceChargePercent.value,
    round_off_enabled: checkedValue(settingRoundOffEnabled),
    auto_print_kot: checkedValue(settingAutoPrintKot),
    print_kot_on_save: checkedValue(settingPrintKotOnSave),
    print_kot_on_submit: checkedValue(settingPrintKotOnSubmit),
    allow_kot_reprint: checkedValue(settingAllowKotReprint),
    kot_header_text: settingKotHeaderText.value,
    kot_footer_text: settingKotFooterText.value,
    kot_template: settingKotTemplate.value,
    kot_print_table: checkedValue(settingKotPrintTable),
    kot_print_customer: checkedValue(settingKotPrintCustomer),
    kot_print_kitchen: checkedValue(settingKotPrintKitchen),
    kot_compact_spacing: checkedValue(settingKotCompactSpacing),
    kot_left_margin_dots: settingKotLeftMarginDots.value || '0',
    kot_trailing_feed_lines: settingKotTrailingFeedLines.value || '0',
    kot_cut_mode: settingKotCutMode.value,
    kot_print_width_58: settingKotPrintWidth58.value || '28',
    kot_print_width_80: settingKotPrintWidth80.value || '38',
    kot_font_type: settingKotFontType.value,
    kot_font_size: settingKotFontSize.value,
    kot_line_spacing_dots: settingKotLineSpacingDots.value || '24',
    require_open_register_for_cash_payment: checkedValue(settingRequireOpenRegisterForCashPayment),
    allow_cashier_register_close: checkedValue(settingAllowCashierRegisterClose),
    cash_discrepancy_threshold: settingCashDiscrepancyThreshold.value,
    mobile_app_enabled: checkedValue(settingMobileAppEnabled),
    online_order_enabled: checkedValue(settingOnlineOrderEnabled),
    online_storefront_slug: settingOnlineStorefrontSlug.value,
    online_theme: settingOnlineTheme.value,
    online_primary_color: settingOnlinePrimaryColor.value,
    online_accent_color: settingOnlineAccentColor.value,
    online_logo_path: settingOnlineLogoPath.value,
    online_payment_methods: [...document.querySelectorAll(".online-payment-method:checked")].map((input) => input.value).join(","),
    online_require_otp: checkedValue(settingOnlineRequireOtp),
    online_allow_loyalty_credit: checkedValue(settingOnlineAllowLoyaltyCredit),
    online_delivery_enabled: checkedValue(settingOnlineDeliveryEnabled),
    online_takeaway_enabled: checkedValue(settingOnlineTakeawayEnabled),
    online_min_order_amount: settingOnlineMinOrderAmount.value
  };
}

const SETTINGS_KEYS_BY_SECTION = {
  profile: ["restaurant_display_name", "legal_name", "gstin", "fssai_license_no", "state_code", "address_line_1", "address_line_2", "city", "state", "country", "phone", "email", "currency", "timezone", "logo_path"],
  pos: ["default_order_type", "allow_non_invoice_orders", "allow_discount", "allow_manual_price_override", "allow_refund", "allow_order_cancel", "require_manager_pin_for_discount", "require_manager_pin_for_refund", "require_manager_pin_for_void", "require_clock_in_before_order"],
  billing: ["invoice_prefix", "invoice_reset_frequency", "show_tax_on_bill", "tax_name", "tax_rate", "sac_code", "show_qr_on_bill", "qr_require_table_pin", "qr_session_minutes", "qr_ordering_enabled", "qr_pending_order_limit", "upi_id", "service_charge_enabled", "service_charge_percent", "round_off_enabled"],
  "bill-print": ["bill_template", "bill_print_contact", "bill_print_kot_references", "bill_print_customer", "bill_print_payment", "bill_print_authorised_signatory", "bill_footer_text", "bill_left_margin_dots", "bill_trailing_feed_lines", "bill_cut_mode", "bill_print_width_58", "bill_print_width_80", "bill_font_type", "bill_font_size", "bill_line_spacing_dots"],
  kot: ["auto_print_kot", "print_kot_on_save", "print_kot_on_submit", "allow_kot_reprint", "kot_header_text", "kot_footer_text", "kot_template", "kot_print_table", "kot_print_customer", "kot_print_kitchen", "kot_compact_spacing", "kot_left_margin_dots", "kot_trailing_feed_lines", "kot_cut_mode", "kot_print_width_58", "kot_print_width_80", "kot_font_type", "kot_font_size", "kot_line_spacing_dots"],
  online: ["mobile_app_enabled", "online_order_enabled", "online_storefront_slug", "online_theme", "online_primary_color", "online_accent_color", "online_logo_path", "online_payment_methods", "online_require_otp", "online_allow_loyalty_credit", "online_delivery_enabled", "online_takeaway_enabled", "online_min_order_amount"]
};

function collectSettingsSection(section) {
  const allSettings = collectSettings();
  return Object.fromEntries((SETTINGS_KEYS_BY_SECTION[section] || []).map((key) => [key, allSettings[key]]));
}

function clearSettingsFieldError(input) {
  input.removeAttribute("aria-invalid");
  input.classList.remove("field-invalid");
}

function validateSettingsSection(section) {
  if (section !== "profile") return true;
  const checks = [
    [settingGstin, (value) => !value || /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z0-9]Z[A-Z0-9]$/.test(value.toUpperCase()), "GSTIN must be a valid 15-character registration number"],
    [settingFssaiLicenseNo, (value) => !value || /^\d{14}$/.test(value), "FSSAI licence / registration number must contain exactly 14 digits"],
    [settingStateCode, (value) => !value || /^\d{2}$/.test(value), "State code must contain exactly 2 digits"]
  ];
  for (const [input, isValid, message] of checks) {
    clearSettingsFieldError(input);
    if (isValid(input.value.trim())) continue;
    input.setAttribute("aria-invalid", "true");
    input.classList.add("field-invalid");
    settingsStatus.textContent = message;
    input.focus();
    input.select();
    window.appAlert?.(message);
    return false;
  }
  return true;
}

[settingGstin, settingFssaiLicenseNo, settingStateCode].forEach((input) => {
  input.addEventListener("input", () => {
    clearSettingsFieldError(input);
    if (settingsStatus.textContent.startsWith("Save failed:") || settingsStatus.textContent.includes("must ")) {
      settingsStatus.textContent = "Editing settings...";
    }
  });
});

function showSettingsSection(section = "profile") {
  const titles = {
    profile: "Restaurant Profile",
    billing: "Billing",
    promos: "Promo Codes",
    pos: "POS Behaviour",
    kot: "Kitchen / KOT",
    "bill-print": "Bill Configuration",
    online: "Online Ordering"
  };
  document.querySelectorAll("[data-settings-panel]").forEach((panel) => {
    const active = panel.dataset.settingsPanel === section;
    panel.hidden = !active;
    panel.querySelectorAll("input, select, textarea, button").forEach((control) => { control.disabled = !active; });
  });
  const title = document.getElementById("settingsSectionTitle");
  if (title) title.textContent = titles[section] || "Restaurant Settings";
  const actions = document.getElementById("settingsActions");
  if (actions) actions.hidden = section === "promos";
}

document.querySelectorAll(".nav-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach((item) => item.classList.remove("active"));
    document.querySelectorAll(".admin-view").forEach((view) => view.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`view-${btn.dataset.view}`).classList.add("active");
    if (btn.dataset.view === "settings") showSettingsSection(btn.dataset.settingsSection || "profile");
  });
});

document.querySelectorAll("[data-inventory-tab]").forEach((btn) => btn.addEventListener("click", () => showInventoryTab(btn.dataset.inventoryTab)));
document.querySelectorAll("[data-modifier-tab]").forEach((btn) => btn.addEventListener("click", () => showModifierTab(btn.dataset.modifierTab)));

refreshBtn.addEventListener("click", loadAll);
itemSearch.addEventListener("input", renderAdmin);
loadCommercialTools.addEventListener("click", () => loadCommercial().catch((err) => {
  commercialStatus.textContent = err.message;
  alert(err.message);
}));
loadInvoices.addEventListener("click", () => loadInvoiceList().catch((err) => {
  invoiceStatus.textContent = err.message;
  alert(err.message);
}));
searchInvoices?.addEventListener("click", renderInvoices);
invoiceSearch?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  renderInvoices();
});
invoicesTable.addEventListener("click", (event) => {
  const button = event.target.closest("[data-invoice-id]");
  if (!button) return;
  const invoice = state.invoices.find((row) => String(row.id) === String(button.dataset.invoiceId));
  if (!invoice) return;
  showInvoiceDetail(invoice.id).catch((err) => { invoiceStatus.textContent = err.message; });
  return;
  const printWindow = window.open("", "_blank", "width=760,height=900");
  printWindow.document.write(`<html><head><title>${esc(invoice.invoice_no || "Invoice")}</title><style>body{font:16px Arial;padding:32px}h1{margin-bottom:24px}table{width:100%;border-collapse:collapse}td{padding:10px;border-bottom:1px solid #ddd}strong{font-size:20px}</style></head><body><h1>Invoice ${esc(invoice.invoice_no || `#${invoice.id}`)}</h1><table><tr><td>Customer</td><td>${esc(invoice.customer_name || "Walk-in customer")}</td></tr><tr><td>Phone</td><td>${esc(invoice.customer_phone || "")}</td></tr><tr><td>Table</td><td>${esc(invoice.table_no || "")}</td></tr><tr><td>Type</td><td>${esc(invoice.order_type || "")}</td></tr><tr><td>Total</td><td><strong>${money(invoice.total_amount)}</strong></td></tr><tr><td>Settled</td><td>${esc(formatDateTime(invoice.settled_at))}</td></tr></table><script>window.onload=()=>window.print()</script></body></html>`);
  printWindow.document.close();
});
runDisasterCheck.addEventListener("click", async () => {
  const data = await fetchJson(`/disaster/check?restaurantId=${encodeURIComponent(restaurantId)}`);
  commercialStatus.textContent = data.databaseOk ? "Database integrity check passed" : "Database integrity check failed";
});
runDemoReset.addEventListener("click", async () => {
  if (!confirm("Reset demo data for this restaurant?")) return;
  const data = await postJson("/demo/reset", {});
  commercialStatus.textContent = `Demo data ready. Order #${data.orderId}`;
  await Promise.all([loadAdmin(), loadCommercial().catch(() => undefined)]);
});

kitchenForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/admin/kitchens/save", { id: kitchenId.value || null, name: kitchenName.value, printerId: kitchenPrinterId.value || null, active: kitchenActive.checked }); kitchenForm.reset(); kitchenActive.checked = true; await loadAdmin(); });
printerForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/admin/printers/save", { id: printerId.value || null, name: printerName.value, type: printerType.value, connection: printerConnection.value, address: printerAddress.value, paperWidthMm: Number(printerPaperWidth.value || 58), active: printerActive.checked }); printerForm.reset(); printerPaperWidth.value = "58"; printerActive.checked = true; await loadAdmin(); });
discoverPrinters?.addEventListener('click', async () => {
  discoverPrinters.disabled = true;
  printerDiscoveryStatus.textContent = 'Searching nearby printers...';
  try {
    const data = await fetchJson(`/admin/printers/discover?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`);
    printerDiscoveryResults.innerHTML = '<option value="">Select a printer</option>' + (data.printers || []).map((printer) => `<option value="${esc(JSON.stringify(printer))}">${esc(printer.name)} (${esc(printer.connection)})</option>`).join('');
    printerDiscoveryResultsLabel.hidden = !(data.printers || []).length;
    printerDiscoveryStatus.textContent = data.printers?.length ? `${data.printers.length} printer(s) found.` : 'No nearby printers found. Check power, Bluetooth, and network connection.';
  } catch (err) { printerDiscoveryStatus.textContent = err.message; }
  finally { discoverPrinters.disabled = false; }
});
printerDiscoveryResults?.addEventListener('change', () => {
  if (!printerDiscoveryResults.value) return;
  const printer = JSON.parse(printerDiscoveryResults.value);
  printerName.value = printer.name; printerConnection.value = printer.connection; printerAddress.value = printer.address;
});
categoryForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/admin/categories/save", { id: categoryId.value || null, name: categoryName.value, kitchenId: categoryKitchen.value, active: categoryActive.checked }); categoryForm.reset(); categoryActive.checked = true; await loadAdmin(); });
itemForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/admin/items/save", { id: itemId.value || null, name: itemName.value, categoryId: itemCategory.value, price: itemPrice.value, onlineDescription: itemOnlineDescription.value, imageUrl: itemImageUrl.value, isVeg: itemVeg.checked, allowDineIn: itemDineIn.checked, allowParcel: itemParcel.checked, allowPartyOrder: itemPartyOrder.checked, onlineEnabled: itemOnlineEnabled.checked, active: itemActive.checked }); itemForm.reset(); itemDineIn.checked = true; itemParcel.checked = true; itemPartyOrder.checked = true; itemActive.checked = true; itemOnlineEnabled.checked = true; await loadAdmin(); });

itemsTable.addEventListener('change', async (event) => {
  const input = event.target.closest('[data-item-channel]');
  if (!input) return;
  input.disabled = true;
  try {
    await postJson('/admin/items/channels', { id: Number(input.dataset.itemId), field: input.dataset.itemChannel, enabled: input.checked });
    await loadAdmin();
  } catch (error) {
    input.checked = !input.checked;
    adminStatus.textContent = error.message;
  } finally { input.disabled = false; }
});
userForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/admin/users/save", { id: userId.value || null, name: userName.value, username: userUsername.value, pin: userPin.value, role: userRole.value, active: userActive.checked }); userForm.reset(); userActive.checked = true; await loadAdmin(); });
tableForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/tables/save", { id: tableId.value || null, tableName: tableName.value, status: tableStatus.value }); tableForm.reset(); await loadAdmin(); });
reservationForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await postJson("/reservations/save", {
    id: reservationId.value || null,
    customerName: reservationCustomerName.value,
    phone: reservationPhone.value,
    tableId: reservationTable.value,
    guestCount: reservationGuestCount.value,
    reservationTime: reservationTime.value,
    status: reservationStatus.value,
    notes: reservationNotes.value
  });
  reservationForm.reset();
  reservationGuestCount.value = 1;
  await Promise.all([loadReservations(), loadAdmin()]);
});

supplierForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/inventory/suppliers/save", { id: supplierId.value || null, name: supplierName.value, phone: supplierPhone.value, email: supplierEmail.value, address: supplierAddress.value, gstin: supplierGstin.value }); supplierForm.reset(); await loadInventory(); });
ingredientForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/inventory/ingredients/save", { id: ingredientId.value || null, name: ingredientName.value, unit: ingredientUnit.value, lowStockAlert: ingredientLowStock.value }); ingredientForm.reset(); await loadInventory(); });
purchaseOrderForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const payload = { supplierId: purchaseSupplier.value, status: purchaseStatus.value, notes: purchaseNotes.value, items: [{ ingredientId: purchaseIngredient.value, quantity: Number(purchaseQty.value), unitPrice: Number(purchaseUnitCost.value || 0), taxRate: Number(purchaseTaxRate.value || 0) }] };
  const url = purchaseOrderId.value ? "/purchase-orders/update" : "/purchase-orders/create";
  await postJson(url, purchaseOrderId.value ? { id: purchaseOrderId.value, ...payload } : payload);
  purchaseOrderForm.reset();
  await loadInventory();
});
supplierPaymentForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  await postJson("/supplier-payments/add", { supplierId: paymentSupplier.value, purchaseOrderId: paymentPurchaseOrder.value || null, amount: supplierPaymentAmount.value, paymentMode: supplierPaymentMode.value, referenceNo: supplierPaymentReference.value });
  supplierPaymentForm.reset();
  await loadInventory();
});
stockForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const movement = stockMovement.value;
  const url = movement === "PURCHASE" ? "/inventory/stock-in" : "/inventory/stock-out";
  const payload = movement === "PURCHASE"
    ? { ingredientId: stockIngredient.value, quantity: Number(stockQty.value), unitCost: Number(stockUnitCost.value || 0), notes: stockNotes.value }
    : { ingredientId: stockIngredient.value, quantity: Number(stockQty.value), reason: movement, notes: stockNotes.value };
  await postJson(url, payload);
  stockForm.reset();
  await loadInventory();
});
recipeForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/inventory/recipes/save", { itemId: recipeMenuItem.value, ingredientId: recipeIngredient.value, quantityPerItem: recipeQty.value }); recipeForm.reset(); await loadInventory(); });

uploadMenuInventoryTemplate.addEventListener("click", async () => {
  const file = menuInventoryImportFile.files?.[0];
  if (!file) {
    menuInventoryImportStatus.textContent = "Choose an .xlsm or .xlsx template first";
    return;
  }
  try {
    menuInventoryImportStatus.textContent = "Validating and importing template...";
    const res = await fetch(`/imports/menu-inventory/upload?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: await file.arrayBuffer()
    });
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || "Import failed");
    const imported = data.imported || {};
    menuInventoryImportStatus.textContent = `Imported ${imported.items || 0} menu items and ${imported.ingredients || 0} ingredients`;
    menuInventoryImportFile.value = "";
    await Promise.all([loadAdmin(), loadInventory()]);
  } catch (err) {
    menuInventoryImportStatus.textContent = err.message;
    alert(err.message);
  }
});

modifierGroupForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/modifiers/groups/save", { id: modifierGroupId.value || null, name: modifierGroupName.value, minSelect: modifierGroupMin.value, maxSelect: modifierGroupMax.value, required: modifierGroupRequired.checked }); modifierGroupForm.reset(); await loadModifiers(); });
modifierOptionForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/modifiers/options/save", { id: modifierOptionId.value || null, groupId: modifierOptionGroup.value, name: modifierOptionName.value, priceDelta: modifierOptionPrice.value }); modifierOptionForm.reset(); await loadModifiers(); });
modifierAssignForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/modifiers/assign/save", { itemId: modifierAssignItem.value, groupId: modifierAssignGroup.value }); modifierAssignForm.reset(); await loadModifiers(); });
comboForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/combos/save", { id: comboId.value || null, name: comboName.value, price: comboPrice.value, items: [{ itemId: comboItem.value, quantity: Number(comboItemQty.value || 1) }] }); comboForm.reset(); await loadModifiers(); });

settingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    const activeSection = document.querySelector("[data-settings-panel]:not([hidden])")?.dataset.settingsPanel || "profile";
    if (!validateSettingsSection(activeSection)) return;
    settingsStatus.textContent = "Saving settings...";
    state.settings = await postJson("/settings/update", { updatedByRole: actor.role, settings: collectSettingsSection(activeSection) });
    renderSettings();
    await loadBackup();
    settingsStatus.textContent = `${document.getElementById("settingsSectionTitle")?.textContent || "Settings"} saved successfully`;
  } catch (err) {
    settingsStatus.textContent = `Save failed: ${err.message}`;
    alert(err.message);
  }
});

resetSettingsDefaults.addEventListener("click", async () => {
  if (!confirm("Reset restaurant settings to defaults?")) return;
  try {
    state.settings = await postJson("/settings/reset-defaults", { updatedByRole: actor.role });
    renderSettings();
    await loadBackup();
    settingsStatus.textContent = "Defaults restored";
    alert("Defaults restored");
  } catch (err) {
    settingsStatus.textContent = err.message;
    alert(err.message);
  }
});

savePermissionsMatrix.addEventListener("click", async () => {
  if (actor.role !== "OWNER") return;
  const roles = [...new Set([...document.querySelectorAll("[data-permission-role]")].map((input) => input.dataset.permissionRole))].filter((role) => role !== "OWNER");
  for (const role of roles) {
    const permissions = {};
    document.querySelectorAll(`[data-permission-role="${role}"]`).forEach((input) => {
      permissions[input.dataset.permissionCode] = input.checked;
    });
    await postJson("/permissions/update", { role, permissions });
  }
  permissionsStatus.textContent = "Permissions saved";
  alert("Permissions saved");
  await loadPermissions();
});

loadDevices.addEventListener("click", () => loadDeviceSessions().catch((err) => {
  deviceStatus.textContent = err.message;
  alert(err.message);
}));

async function fetchStaffCashReports() {
  if (!["OWNER", "MANAGER_2"].includes(actor.role)) {
    staffCashStatus.textContent = "Reports require OWNER or MANAGER_2";
    return;
  }
  const params = new URLSearchParams({ restaurantId, role: actor.role });
  if (staffCashFrom.value) params.set("fromDate", staffCashFrom.value);
  if (staffCashTo.value) params.set("toDate", staffCashTo.value);
  if (staffCashUserId.value) params.set("userId", staffCashUserId.value);
  const attendance = await fetchJson(`/attendance/report?${params.toString()}`);
  const cash = await fetchJson(`/cash-register/report?${params.toString()}`);
  attendanceReportTable.innerHTML = (attendance.attendance || []).map((row) => `
    <tr>
      <td>${esc(row.user_name || row.user_id)}</td>
      <td>${esc(row.role || "")}</td>
      <td>${esc(row.clock_in_at)}</td>
      <td>${esc(row.clock_out_at || "")}</td>
      <td>${esc(row.status)}</td>
      <td>${esc(row.duration_minutes || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="6">No attendance rows.</td></tr>`;
  cashRegisterReportTable.innerHTML = (cash.sessions || []).map((row) => `
    <tr>
      <td>${esc(row.opened_at)}</td>
      <td>${esc(row.opened_by_name || row.opened_by)}</td>
      <td>${esc(row.closed_at || "")}</td>
      <td>${money(row.opening_cash)}</td>
      <td>${money(row.expected_cash)}</td>
      <td>${money(row.closing_cash)}</td>
      <td>${money(row.cash_difference)}</td>
      <td>${esc(row.status)}</td>
    </tr>
  `).join("") || `<tr><td colspan="8">No cash sessions.</td></tr>`;
  cashMovementReportTable.innerHTML = (cash.movements || []).map((row) => `
    <tr>
      <td>${esc(row.created_at)}</td>
      <td>${esc(row.type)}</td>
      <td>${money(row.amount)}</td>
      <td>${esc(row.reason || "")}</td>
      <td>${esc(row.performed_by_name || row.performed_by || "")}</td>
    </tr>
  `).join("") || `<tr><td colspan="5">No movements.</td></tr>`;
  cashDiscrepancyReportTable.innerHTML = (cash.discrepancies || []).map((row) => `
    <tr>
      <td>${esc(row.id)}</td>
      <td>${money(row.expected_cash)}</td>
      <td>${money(row.closing_cash)}</td>
      <td>${money(row.cash_difference)}</td>
    </tr>
  `).join("") || `<tr><td colspan="4">No discrepancies.</td></tr>`;
  staffCashStatus.textContent = "Reports loaded";
}

loadStaffCashReports.addEventListener("click", () => fetchStaffCashReports().catch((err) => {
  staffCashStatus.textContent = err.message;
  alert(err.message);
}));

backupSettingsForm.addEventListener("submit", async (e) => { e.preventDefault(); await postJson("/backup/settings", { settings: { backup_enabled: backupEnabled.checked ? "1" : "0", backup_interval_minutes: backupInterval.value, backup_folder_path: backupFolderPath.value, onedrive_folder_path: onedriveFolderPath.value } }); alert("Backup settings saved"); await Promise.all([loadBackup(), loadSettings()]); });
runBackupNow.addEventListener("click", async () => { const data = await postJson("/backup/run", {}); alert(data.message || "Backup complete"); await loadBackup(); });
runOneDriveSync.addEventListener("click", async () => { const data = await postJson("/backup/sync", {}); alert(data.message || "Sync complete"); await loadBackup(); });
refreshBackups.addEventListener("click", loadBackup);

checkUpdateNow.addEventListener("click", async () => {
  updateStatus.textContent = "Checking for updates...";
  const data = await fetchJson(`/updates/check?restaurantId=${encodeURIComponent(restaurantId)}`);
  state.latestUpdate = data;
  downloadUpdateNow.disabled = !data.updateAvailable;
  updateStatus.textContent = data.message;
  updateLatestPanel.innerHTML = data.updateAvailable
    ? `<p><strong>${esc(data.latestVersion)}</strong> ${data.mandatoryUpdate ? "Mandatory" : "Optional"}</p><p>${esc(data.releaseNotes || "")}</p><p>${(data.files || []).map((file) => esc(file.file_name)).join(", ")}</p>`
    : `<p>${esc(data.message || "No update available")}</p>`;
  await loadUpdates();
});

downloadUpdateNow.addEventListener("click", async () => {
  if (!state.latestUpdate?.updateAvailable) return;
  const data = await postJson("/updates/download", { version: state.latestUpdate.latestVersion, files: state.latestUpdate.files });
  updateStatus.textContent = `Downloaded to ${data.stagingDir}`;
  await loadUpdates();
});

loadAuditLogs.addEventListener("click", loadAudit);
exportAuditCsv.addEventListener("click", () => {
  if (actor.role !== "OWNER") {
    auditStatus.textContent = "Only OWNER can export audit logs";
    return;
  }
  window.location.href = `/audit/export?${auditQuery().toString()}`;
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.resetForm) {
    const form = document.getElementById(target.dataset.resetForm);
    form?.reset();
    const hidden = form?.querySelector("input[type='hidden']");
    if (hidden) hidden.value = "";
    return;
  }
  const pick = (name) => target.dataset[name];
  const approve = (message, acceptLabel = "Delete") => window.appConfirm(message, { acceptLabel });
  try {
    if (pick("editKitchen")) return editKitchen(pick("editKitchen"));
    if (pick("editPrinter")) return editPrinter(pick("editPrinter"));
    if (pick("editCategory")) return editCategory(pick("editCategory"));
    if (pick("editItem")) return editItem(pick("editItem"));
    if (pick("editUser")) return editUser(pick("editUser"));
    if (pick("editTable")) return editTable(pick("editTable"));
    if (pick("editSupplier")) return editSupplier(pick("editSupplier"));
    if (pick("editIngredient")) return editIngredient(pick("editIngredient"));
    if (pick("editModifierGroup")) return editModifierGroup(pick("editModifierGroup"));
    if (pick("editModifierOption")) return editModifierOption(pick("editModifierOption"));
    if (pick("editCombo")) return editCombo(pick("editCombo"));
    if (pick("editPromo")) {
      const promo = (state.promoCodes || []).find((row) => String(row.id) === String(pick("editPromo")));
      if (promo) {
        promoCodeId.value = promo.id; promoCodeValue.value = promo.code; promoDiscountType.value = promo.discount_type || 'RUPEES'; promoDiscountValue.value = promo.discount_value || 0; promoDiscountCap.value = promo.max_discount_amount || 0; promoMinOrder.value = promo.min_order_amount || 0; promoValidFrom.value = promo.valid_from || ''; promoValidTo.value = promo.valid_to || ''; promoActive.checked = Number(promo.active) === 1; document.querySelector('[data-view="settings"][data-settings-section="promos"]')?.click();
      }
      return;
    }
    if (pick("deleteKitchen")) { if (await approve("Delete this kitchen?")) await postJson("/admin/kitchens/delete", { id: pick("deleteKitchen") }).then(loadAdmin); return; }
    if (pick("deletePrinter")) { if (await approve("Delete this printer?")) await postJson("/admin/printers/delete", { id: pick("deletePrinter") }).then(loadAdmin); return; }
    if (pick("deleteCategory")) { if (await approve("Delete this category?")) await postJson("/admin/categories/delete", { id: pick("deleteCategory") }).then(loadAdmin); return; }
    if (pick("deleteItem")) { if (await approve("Delete this item?")) await postJson("/admin/items/delete", { id: pick("deleteItem") }).then(loadAdmin); return; }
    if (pick("disableUser")) { if (await approve("Disable this user?", "Disable")) await postJson("/admin/users/disable", { id: pick("disableUser") }).then(loadAdmin); return; }
    if (pick("unlockUser")) await postJson("/admin/users/unlock", { id: pick("unlockUser") }).then(loadAdmin);
    if (pick("deleteTable")) { if (await approve("Delete this table?")) await postJson("/tables/delete", { id: pick("deleteTable") }).then(loadAdmin); return; }
    if (pick("cancelReservation") && confirm("Cancel this reservation?")) await postJson("/reservations/cancel", { id: pick("cancelReservation") }).then(loadReservations);
    if (pick("deleteSupplier")) { if (await approve("Delete this supplier?")) await postJson("/inventory/suppliers/delete", { id: pick("deleteSupplier") }).then(loadInventory); return; }
    if (pick("deleteIngredient")) { if (await approve("Delete this ingredient?")) await postJson("/inventory/ingredients/delete", { id: pick("deleteIngredient") }).then(loadInventory); return; }
    if (pick("deleteRecipe")) { if (await approve("Delete this recipe?")) await postJson("/inventory/recipes/delete", { id: pick("deleteRecipe") }).then(loadInventory); return; }
    if (pick("receivePo") && confirm("Receive this purchase order and increase stock?")) await postJson("/purchase-orders/receive", { id: pick("receivePo") }).then(loadInventory);
    if (pick("cancelPo") && confirm("Cancel this purchase order?")) await postJson("/purchase-orders/cancel", { id: pick("cancelPo") }).then(loadInventory);
    if (pick("deleteModifierGroup")) { if (await approve("Delete this modifier group?")) await postJson("/modifiers/groups/delete", { id: pick("deleteModifierGroup") }).then(loadModifiers); return; }
    if (pick("deleteModifierOption")) { if (await approve("Delete this modifier?")) await postJson("/modifiers/options/delete", { id: pick("deleteModifierOption") }).then(loadModifiers); return; }
    if (pick("deleteModifierAssignment")) { if (await approve("Delete this assignment?")) await postJson("/modifiers/assign/delete", { id: pick("deleteModifierAssignment") }).then(loadModifiers); return; }
    if (pick("deleteCombo")) { if (await approve("Delete this combo?")) await postJson("/combos/delete", { id: pick("deleteCombo") }).then(loadModifiers); return; }
    if (pick("deletePromo")) { if (await approve("Disable this promocode?", "Disable")) await postJson("/admin/promo-codes/delete", { id: pick("deletePromo") }).then(loadPromoCodes); return; }
    if (pick("restoreBackup") && confirm("Restore this backup?")) await postJson("/backup/restore", { filename: pick("restoreBackup") }).then((data) => alert(data.message));
    if (pick("forceLogout") && confirm("Force logout this device?")) await postJson("/device-sessions/force-logout", { id: pick("forceLogout") }).then(loadDeviceSessions);
  } catch (err) {
    alert(err.message);
  }
});

loadReports.addEventListener("click", async () => {
  try {
    reportStatus.textContent = "Loading reports...";
    const data = await fetchJson(`/reports/dashboard?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}&fromDate=${reportFrom.value}&toDate=${reportTo.value}`);
    dailySales.innerHTML = (data.dailySales || []).map((row) => `<p><strong>${esc(row.day)}</strong>: ${money(row.total)} · ${row.orders} order(s)</p>`).join("") || "<p>No paid sales for the selected period.</p>";
    topItems.innerHTML = (data.topSellingItems || []).map((row) => `<p><strong>${esc(row.name)}</strong>: ${row.quantity} · ${money(row.total)}</p>`).join("") || "<p>No paid item sales for the selected period.</p>";
    orderSummary.innerHTML = (data.orderSummary || []).map((row) => `<p><strong>${esc(row.status)} / ${esc(row.payment_status)}</strong>: ${row.count} · ${money(row.total)}</p>`).join("") || "<p>No orders for the selected period.</p>";
    taxSummary.innerHTML = `<p>Taxable sales: <strong>${money(data.taxSummary?.taxableSales || 0)}</strong></p><p>Tax collected: <strong>${money(data.taxSummary?.tax || 0)}</strong></p>`;
    reportStatus.textContent = `Reports loaded for ${reportFrom.value} to ${reportTo.value}`;
  } catch (err) {
    reportStatus.textContent = `Unable to load reports: ${err.message}`;
    dailySales.innerHTML = topItems.innerHTML = orderSummary.innerHTML = taxSummary.innerHTML = `<p>${esc(err.message)}</p>`;
  }
});

expenseForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await postJson("/expenses/save", {
    categoryId: expenseCategory.value,
    description: expenseDescription.value,
    amount: expenseAmount.value,
    expenseDate: expenseDate.value
  });
  expenseForm.reset();
  await loadExpenseCategories();
  alert("Expense added");
});

async function refreshProfitDashboard() {
  if (!["OWNER", "MANAGER_2"].includes(actor.role)) {
    profitDashboard.textContent = "OWNER or MANAGER_2 required";
    return;
  }
  const data = await fetchJson(`/reports/profit-dashboard?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}&fromDate=${reportFrom.value}&toDate=${reportTo.value}`);
  profitDashboard.innerHTML = `
    <p>Sales: ${money(data.sales)}</p>
    <p>Refunds: ${money(data.refunds)}</p>
    <p>Discounts: ${money(data.discounts)}</p>
    <p>Expenses: ${money(data.expenses)}</p>
    <p><strong>Profit: ${money(data.profit)}</strong></p>
    ${(data.byCategory || []).map((row) => `<p>${esc(row.category)}: ${money(row.total)}</p>`).join("")}
  `;
}

loadProfitDashboard.addEventListener("click", () => refreshProfitDashboard().catch((err) => alert(err.message)));
exportProfitCsv.addEventListener("click", () => {
  window.location.href = `/reports/profit/export?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}&fromDate=${reportFrom.value}&toDate=${reportTo.value}`;
});
document.getElementById("loadReservations").addEventListener("click", () => loadReservations().catch((err) => alert(err.message)));
document.getElementById('savePromoCode')?.addEventListener("click", async () => {
  try {
    await postJson('/admin/promo-codes/save', { id: promoCodeId.value || null, code: promoCodeValue.value, discountType: promoDiscountType.value, discountValue: promoDiscountValue.value, maxDiscountAmount: promoDiscountCap.value || 0, minOrderAmount: promoMinOrder.value || 0, validFrom: promoValidFrom.value || null, validTo: promoValidTo.value || null, active: promoActive.checked });
    promoCodeId.value = ''; promoCodeValue.value = ''; promoDiscountValue.value = ''; promoDiscountCap.value = ''; promoMinOrder.value = ''; promoValidFrom.value = ''; promoValidTo.value = ''; promoActive.checked = true; await loadPromoCodes();
  } catch (err) { alert(err.message); }
});

staffCashSettingsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    staffCashSettingsStatus.textContent = "Saving settings...";
    state.settings = await postJson("/settings/update", {
      updatedByRole: actor.role,
      settings: {
        require_open_register_for_cash_payment: checkedValue(settingRequireOpenRegisterForCashPayment),
        allow_cashier_register_close: checkedValue(settingAllowCashierRegisterClose),
        cash_discrepancy_threshold: settingCashDiscrepancyThreshold.value || "0"
      }
    });
    renderSettings();
    staffCashSettingsStatus.textContent = "Staff & cash settings saved";
  } catch (err) {
    staffCashSettingsStatus.textContent = err.message;
  }
});
document.getElementById('promoCodeReset')?.addEventListener('click', () => { promoCodeId.value = ''; promoCodeValue.value = ''; promoDiscountValue.value = ''; promoDiscountCap.value = ''; promoMinOrder.value = ''; promoValidFrom.value = ''; promoValidTo.value = ''; promoActive.checked = true; });

loadInventoryReports.addEventListener("click", async () => {
  const data = await fetchJson(`/inventory/reports?restaurantId=${encodeURIComponent(restaurantId)}&from=${inventoryReportFrom.value}&to=${inventoryReportTo.value}`);
  const purchaseData = await fetchJson(`/purchase-orders/reports?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}&fromDate=${inventoryReportFrom.value}&toDate=${inventoryReportTo.value}`).catch(() => ({ purchaseReport: [], paymentModeReport: [] }));
  inventoryMovementSummary.innerHTML = (data.stockMovementReport || []).map((row) => `<p>${esc(row.movement_type)}: ${money(row.quantity)}</p>`).join("");
  inventoryUsageReport.innerHTML = (data.ingredientUsageReport || []).map((row) => `<p>${esc(row.name)}: ${money(row.quantity)}</p>`).join("");
  inventoryWastageReport.innerHTML = (data.wastageReport || []).map((row) => `<p>${esc(row.name)}: ${money(row.quantity)}</p>`).join("");
  purchaseReportPanel.innerHTML = (purchaseData.purchaseReport || []).map((row) => `<p>${esc(row.day)} ${esc(row.status)}: ${money(row.total)}</p>`).join("") || "<p>No purchase data.</p>";
  purchasePaymentModeReport.innerHTML = (purchaseData.paymentModeReport || []).map((row) => `<p>${esc(row.payment_mode)}: ${money(row.total)}</p>`).join("") || "<p>No supplier payments.</p>";
});

reportFrom.value ||= monthStartIso();
reportTo.value ||= todayIso();
reservationFrom.value ||= todayIso();
reservationTo.value ||= todayIso();
expenseDate.value ||= todayIso();

loadAll().catch((err) => {
  adminStatus.textContent = err.message;
});
if (requestedAdminView) showView(requestedAdminView);
