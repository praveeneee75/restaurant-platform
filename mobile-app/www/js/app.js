function cleanBase(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

const isLocalDevServer = ["localhost", "127.0.0.1"].includes(window.location.hostname)
  && window.location.port === "4300";
const DEFAULT_DIRECTORY_URL = isLocalDevServer
  ? "http://localhost:4000"
  : "https://api.kmasterpos.com";
const MOBILE_DIRECTORY_URL = cleanBase(
  window.MOBILE_DIRECTORY_URL
  || localStorage.getItem("mobileDirectoryUrl")
  || DEFAULT_DIRECTORY_URL
);
const DEV_POS_URL = cleanBase(window.DEV_POS_URL || localStorage.getItem("devPosUrl") || (isLocalDevServer ? "http://localhost:3000" : ""));
const state = {
  restaurants: [],
  ownerRestaurants: [],
  restaurant: null,
  user: JSON.parse(localStorage.getItem("user") || "null"),
  ownerData: null
};
const native = window.KMasterNative || { isNative: false };
const BIOMETRIC_KEY = "kmaster-biometric-login";
let staffConnectionMonitor = null;
let staffConnectionChecking = false;
const REQUEST_TIMEOUT_MS = 12000;
let pendingCredentials = null;

async function biometricAvailability() {
  if (!native.isNative || !native.biometric || !native.secureStorage) {
    return { isAvailable: false, reason: "Biometric login is available in the Android and iOS app." };
  }
  try {
    return await native.biometric.checkBiometry();
  } catch (_) {
    return { isAvailable: false, reason: "Biometric login is unavailable on this device." };
  }
}

async function biometricEnabled() {
  if (!native.isNative || !native.secureStorage) return false;
  return Boolean(await native.secureStorage.get(BIOMETRIC_KEY).catch(() => null));
}

async function refreshBiometricControls() {
  const availability = await biometricAvailability();
  const enabled = availability.isAvailable && await biometricEnabled();
  biometricLoginButton.hidden = !enabled;
  biometricToggle.checked = enabled;
  biometricToggle.disabled = !availability.isAvailable;
  biometricStatus.textContent = enabled
    ? "Biometric login is enabled on this device."
    : (availability.isAvailable ? "Biometric login is off." : availability.reason || "Biometric login is unavailable.");
}

async function saveBiometricCredentials(credentials) {
  const availability = await biometricAvailability();
  if (!availability.isAvailable) throw new Error(availability.reason || "Biometric login is unavailable.");
  await native.biometric.authenticate({
    reason: "Enable secure login for K'Master POS",
    cancelTitle: "Cancel",
    allowDeviceCredential: true,
    iosFallbackTitle: "Use device passcode",
    androidTitle: "Enable biometric login",
    androidSubtitle: "Confirm your identity",
    androidConfirmationRequired: false
  });
  await native.secureStorage.set(BIOMETRIC_KEY, credentials);
  await refreshBiometricControls();
}

async function removeBiometricCredentials() {
  if (native.secureStorage) await native.secureStorage.remove(BIOMETRIC_KEY).catch(() => {});
  await refreshBiometricControls();
}

async function offerBiometric(credentials) {
  pendingCredentials = credentials;
  if (localStorage.getItem("biometricPromptHandled") || await biometricEnabled()) return;
  const availability = await biometricAvailability();
  if (availability.isAvailable) biometricPrompt.showModal();
}

function showLoginView(message, options = {}) {
  stopStaffConnectionMonitor();
  document.body.classList.remove("owner-mode");
  loginView.hidden = false;
  dashboardView.hidden = true;
  webviewPanel.hidden = true;
  appFrame.src = "about:blank";
  if (message) loginStatus.textContent = options.loginAttempt ? message : (/offline|unreachable|cannot reach|timed out/i.test(message) ? "POS is Offline" : message);
  const connectionError = Boolean(message && /offline|unreachable|cannot reach|timed out/i.test(message));
  loginView.classList.toggle("connection-error", connectionError);
  posOfflineActions.hidden = !connectionError || Boolean(state.user?.cloudOwner);
}

function showDashboardView(message) {
  loginView.classList.remove("connection-error");
  posOfflineActions.hidden = true;
  loginView.hidden = true;
  dashboardView.hidden = false;
  dashboardTitle.textContent = "Performance overview";
  dashboardStatus.textContent = message || `Signed in as ${state.user?.role || "user"}.`;
  drawerRestaurantName.textContent = state.restaurant?.name || localStorage.getItem("restaurantName") || "Restaurant";
  drawerUserName.textContent = state.user?.name || state.user?.username || state.user?.role || "User";
  const ownerAllowed = Boolean(state.user?.cloudOwner);
  document.body.classList.toggle("owner-mode", ownerAllowed);
  dashboardView.classList.toggle("owner-session", ownerAllowed);
  if (ownerAllowed) {
    showOwnerTab("sales");
    refreshOwnerDashboard().catch((error) => { dashboardStatus.textContent = error.message; });
  }
}

function staffPosOfflineMessage(error) {
  const detail = String(error?.message || "").trim();
  const guidance = "The restaurant POS desktop app is offline or unreachable. Open the desktop POS, connect this phone to the same Wi-Fi, then try again.";
  return detail && !/Cannot reach the restaurant POS|Connection timed out/i.test(detail)
    ? `${guidance} ${detail}`
    : guidance;
}

async function validateStaffPosConnection(restaurant) {
  const base = restaurantPosUrl(restaurant);
  if (!restaurant?.restaurantId || !base) throw new Error("The restaurant POS address is unavailable.");
  await fetchJson(`${base}/health`);
  await fetchJson(`${base}/mobile-app/config?restaurantId=${encodeURIComponent(restaurant.restaurantId)}`);
  return base;
}

function showWifiInterruption(message = "POS is offline. Connect to the restaurant Wi-Fi, then refresh.") {
  if (webviewPanel.hidden || !webviewPanel.classList.contains("staff-workspace")) return;
  wifiInterruptionStatus.textContent = message;
  wifiInterruptionScreen.hidden = false;
}

async function checkActiveStaffConnection({ manual = false } = {}) {
  if (staffConnectionChecking || webviewPanel.hidden || !webviewPanel.classList.contains("staff-workspace")) return false;
  staffConnectionChecking = true;
  if (manual) {
    refreshWifiConnection.disabled = true;
    refreshWifiConnection.textContent = "Checking...";
    wifiInterruptionStatus.textContent = "Checking the restaurant POS connection...";
  }
  try {
    await validateStaffPosConnection(state.restaurant || savedRestaurant());
    wifiInterruptionScreen.hidden = true;
    try { appFrame.contentWindow?.dispatchEvent(new Event("online")); } catch (_) { /* cross-origin frame */ }
    return true;
  } catch (error) {
    showWifiInterruption(manual ? "POS is still offline. Confirm Wi-Fi is on and the restaurant network is connected." : "Your order screen is safely kept open.");
    return false;
  } finally {
    staffConnectionChecking = false;
    if (manual) {
      refreshWifiConnection.disabled = false;
      refreshWifiConnection.textContent = "Refresh connection";
    }
  }
}

function startStaffConnectionMonitor() {
  clearInterval(staffConnectionMonitor);
  staffConnectionMonitor = setInterval(() => checkActiveStaffConnection(), 5000);
}

function stopStaffConnectionMonitor() {
  clearInterval(staffConnectionMonitor);
  staffConnectionMonitor = null;
  if (typeof wifiInterruptionScreen !== "undefined") wifiInterruptionScreen.hidden = true;
}

function currency(value) {
  const code = state.restaurant?.currency || localStorage.getItem("currency") || "INR";
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  catch (_) { return `${code} ${Number(value || 0).toFixed(2)}`; }
}

function today() { return new Date().toISOString().slice(0, 10); }

function showOwnerTab(tab) {
  if (!state.user?.cloudOwner) return;
  ownerPerformanceHeader.hidden = tab !== "sales";
  document.querySelectorAll("[data-owner-view]").forEach((view) => view.classList.toggle("active", view.dataset.ownerView === tab));
  document.querySelectorAll("[data-owner-tab]").forEach((button) => button.classList.toggle("active", button.dataset.ownerTab === tab));
  ownerDrawer.hidden = true;
  if (tab === "operations" && state.user?.cloudOwner) refreshCloudLiveOrders().catch((error) => { dashboardStatus.textContent = error.message; });
  if (tab === "online" && state.user?.cloudOwner) refreshCloudOnlineOrders().catch((error) => { dashboardStatus.textContent = error.message; });
  if (tab === "reports") renderOwnerReportCatalog();
  if (tab === "profile" && state.user?.cloudOwner) refreshCloudOwnerProfile().catch((error) => { dashboardStatus.textContent = error.message; });
}

function dataRows(rows, emptyMessage) {
  return rows.length ? rows.join("") : `<p class="empty-state">${esc(emptyMessage)}</p>`;
}

const OWNER_METRICS = {
  orders: { label: "Orders", count: true }, sales: { label: "Sales" }, netSales: { label: "Net sales" },
  tax: { label: "Tax" }, discount: { label: "Discount" }, modified: { label: "Modified", count: true },
  reprinted: { label: "Re-printed", count: true }, waivedOff: { label: "Waived off" }, roundOff: { label: "Round off" },
  deliveryCharge: { label: "Delivery charge" }, containerCharge: { label: "Container charge" }, serviceCharge: { label: "Service charge" }
};

function ownerMetricValue(value, metric) {
  return OWNER_METRICS[metric]?.count ? Number(value || 0).toLocaleString("en-IN") : currency(value);
}

function renderOutletRanking(rows, metric) {
  const meta = OWNER_METRICS[metric] || OWNER_METRICS.sales;
  return `<div class="ranking-head"><span>Outlet name</span><strong>${esc(meta.label)}</strong></div>${dataRows(rows.map((row) => `<div class="ranking-row"><span>${esc(row.name)} <small>↗</small></span><strong>${esc(ownerMetricValue(row[metric], metric))}</strong></div>`), "No synced sales for this selection")}`;
}

function renderGauge(target, total, label) {
  target.innerHTML = `<div class="gauge-arc"><div><strong>${esc(currency(total))}</strong><span>${esc(label)}</span></div></div>`;
}

function renderCloudOwnerStatistics(data) {
  const totals = data.totals || {};
  const rows = [...(data.outlets || [])];
  const selectedMetric = ownerMetricSelect.value || "sales";
  const direction = ownerSortSelect.value === "asc" ? 1 : -1;
  rows.sort((a, b) => direction * (Number(a[selectedMetric] || 0) - Number(b[selectedMetric] || 0)));
  const sales = Number(totals.sales || 0);
  const ratio = (value, base = sales) => base > 0 ? Number(value || 0) * 100 / base : 0;
  ownerTotalSales.textContent = currency(sales);
  ownerNetSales.textContent = currency(totals.netSales);
  ownerOnlineSales.textContent = currency(totals.onlineSales);
  ownerCashCollection.textContent = currency(totals.cashCollection);
  ownerPaidOrders.textContent = `${Number(totals.orders || 0).toLocaleString("en-IN")} order(s)`;
  ownerOutletCount.textContent = `${rows.length} outlet${rows.length === 1 ? "" : "s"}`;
  ownerOnlineShare.textContent = `${ratio(totals.onlineSales).toFixed(1)}% of sales`;
  ownerCashShare.textContent = `${ratio(totals.cashCollection).toFixed(1)}% of sales`;

  const max = Math.max(1, ...rows.map((row) => Math.abs(Number(row[selectedMetric] || 0))));
  ownerSalesChart.innerHTML = dataRows(rows.slice(0, 10).map((row) => `<div class="outlet-bar-column"><div class="outlet-bar-value">${esc(ownerMetricValue(row[selectedMetric], selectedMetric))}</div><div class="outlet-bar-track"><i style="height:${Math.max(Number(row[selectedMetric] || 0) ? 8 : 0, Math.abs(Number(row[selectedMetric] || 0)) / max * 150)}px"></i></div><small>${esc(row.name)}</small></div>`), "No data for this date");
  ownerOutletRows.innerHTML = renderOutletRanking(rows, selectedMetric);

  renderGauge(ownerTaxGauge, totals.tax, "Taxes");
  renderGauge(ownerDiscountGauge, totals.discount, "Discounts");
  const descendingTax = [...rows].sort((a, b) => Number(b.tax || 0) - Number(a.tax || 0));
  const descendingDiscount = [...rows].sort((a, b) => Number(b.discount || 0) - Number(a.discount || 0));
  ownerTaxRows.innerHTML = `<div class="ranking-head"><span>Outlet name</span><strong>Total tax (%) share</strong></div>${dataRows(descendingTax.filter((row) => Number(row.tax || 0) !== 0).map((row) => `<div class="ranking-row"><span>${esc(row.name)}</span><strong>${esc(currency(row.tax))} <small>(${ratio(row.tax, totals.tax).toFixed(1)}%)</small></strong></div>`), "No tax recorded")}`;
  ownerDiscountRows.innerHTML = `<div class="ranking-head"><span>Outlet name</span><strong>Total discount (%) share</strong></div>${dataRows(descendingDiscount.filter((row) => Number(row.discount || 0) !== 0).map((row) => `<div class="ranking-row"><span>${esc(row.name)}</span><strong>${esc(currency(row.discount))} <small>(${ratio(row.discount, totals.discount).toFixed(1)}%)</small></strong></div>`), "No discounts recorded")}`;
  ownerDiscountShare.textContent = `${ratio(totals.discount).toFixed(2)}% discounts given`;
  const updated = rows.map((row) => row.reportUpdatedAt).filter(Boolean).sort().pop();
  ownerSyncStatus.textContent = updated ? `Synced ${new Date(updated).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "No report yet";
  dashboardStatus.textContent = `${data.reportDate} · ${ownerOutletSelect.options[ownerOutletSelect.selectedIndex]?.text || "All outlets"}`;
  drawerRestaurantName.textContent = ownerOutletSelect.options[ownerOutletSelect.selectedIndex]?.text || "All outlets";
}

function liveChannel(order) {
  const type = String(order.channel || order.type || "").toLowerCase();
  if (type === "dinein" || type.includes("dine")) return "dineIn";
  if (type === "online" || type.includes("delivery")) return "delivery";
  return "pickup";
}

function liveStatus(order) {
  const status = String(order.status || "").toUpperCase();
  if (/OUT_FOR_DELIVERY/.test(status)) return "outForDelivery";
  if (/WAITING|READY/.test(status)) return "waitingPickup";
  return "preparation";
}

function liveBreakdownRows(orders, definitions, classifier) {
  return definitions.map(([key, label, symbol]) => {
    const matches = orders.filter((order) => classifier(order) === key);
    const amount = matches.reduce((sum, order) => sum + Number(order.total || 0), 0);
    return `<div class="live-breakdown-row"><span class="live-type-icon">${symbol}</span><span><strong>${esc(label)}</strong><small>${matches.length} order${matches.length === 1 ? "" : "s"}</small></span><b>${esc(currency(amount))}</b></div>`;
  }).join("");
}

function renderCloudLiveOrders(data) {
  const running = data.running || [];
  const pending = data.pending || [];
  const tables = data.tables || [];
  const runningAmount = running.reduce((sum, order) => sum + Number(order.total || 0), 0);
  const pendingAmount = pending.reduce((sum, order) => sum + Number(order.total || 0), 0);
  ownerRunningOrders.textContent = String(running.length);
  ownerRunningAmount.textContent = currency(runningAmount);
  ownerPendingOrders.textContent = String(pending.length);
  ownerPendingAmount.textContent = currency(pendingAmount);
  ownerRunningBreakdown.innerHTML = liveBreakdownRows(running, [["dineIn", "Dine in", "♨"], ["pickup", "Pick up", "▣"], ["delivery", "Delivery", "▤"]], liveChannel);
  ownerPendingBreakdown.innerHTML = liveBreakdownRows(pending, [["preparation", "In preparation", "♨"], ["waitingPickup", "Waiting for pickup", "▣"], ["outForDelivery", "Out for delivery", "▤"]], liveStatus);
  ownerActiveTables.textContent = String(tables.length);
  ownerTableRevenue.textContent = currency(tables.reduce((sum, table) => sum + Number(table.amount || 0), 0));
  ownerRunningTables.innerHTML = tables.length ? tables.map((table) => `<article class="running-table-row"><span class="live-type-icon">◉</span><span><strong>${esc(table.table)}</strong><small>${esc(table.outletName)} · ${table.orders} order${table.orders === 1 ? "" : "s"}</small></span><b>${esc(currency(table.amount))}</b></article>`).join("") : `<div class="live-empty"><span>◉</span><strong>No active tables</strong><p>Tables will appear here when orders start.</p></div>`;
  ownerSyncStatus.textContent = data.lastUpdatedAt ? `Synced ${new Date(data.lastUpdatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Waiting for POS sync";
  dashboardStatus.textContent = data.lastUpdatedAt ? `Live orders updated ${new Date(data.lastUpdatedAt).toLocaleString()}` : "No live POS snapshot has synced yet";
  state.ownerLiveData = data;
}

async function refreshCloudLiveOrders() {
  const token = localStorage.getItem("ownerCloudToken");
  if (!state.user?.cloudOwner || !token) return;
  const restaurantId = ownerOutletSelect.value || "ALL";
  const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/dashboard/live-orders?restaurantId=${encodeURIComponent(restaurantId)}`, { headers: { Authorization: `Bearer ${token}` } });
  renderCloudLiveOrders(data);
}

function onlineStatusLabel(value) {
  return String(value || "Unknown").replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function renderCloudOnlineOrders(data) {
  const orders = data.orders || [];
  onlineResultCount.textContent = `${Number(data.totals?.orders || 0)} order${Number(data.totals?.orders || 0) === 1 ? "" : "s"}`;
  onlineResultAmount.textContent = currency(data.totals?.amount);
  ownerOnlineOrderResults.innerHTML = orders.length ? orders.map((order) => `<article class="online-order-card">
    <header><div><small>${esc(order.outlet_name)}</small><strong>${esc(order.order_no)}</strong></div><span class="online-status status-${esc(String(order.order_status || "").toLowerCase())}">${esc(onlineStatusLabel(order.order_status))}</span></header>
    <dl><div><dt>Order type</dt><dd>${esc(onlineStatusLabel(order.order_type))}</dd></div><div><dt>Total</dt><dd>${esc(currency(order.total_amount))}</dd></div><div><dt>Customer</dt><dd>${esc(order.customer_name)}<small>${esc(order.customer_phone)}</small></dd></div><div><dt>Payment</dt><dd>${esc(onlineStatusLabel(order.payment_mode))}<small>${esc(onlineStatusLabel(order.payment_status))}</small></dd></div></dl>
    <footer><span>${esc(new Date(order.created_at).toLocaleString())}</span><span>${order.pos_order_id ? `POS ${esc(order.pos_order_id)}` : "Awaiting POS reference"}</span></footer>
  </article>`).join("") : `<div class="online-empty"><span>⌕</span><strong>No results found</strong><p>Try another outlet, period, status or order number.</p></div>`;
  dashboardStatus.textContent = `${onlineStatusLabel(data.filters?.source === "ALL" ? "All online sources" : data.filters?.source)} · ${data.totals?.orders || 0} result(s)`;
  state.ownerOnlineData = data;
}

async function refreshCloudOnlineOrders() {
  const token = localStorage.getItem("ownerCloudToken");
  if (!state.user?.cloudOwner || !token) return;
  const activeSource = document.querySelector("[data-online-source].active")?.dataset.onlineSource || "ALL";
  const params = new URLSearchParams({
    restaurantId: onlineRestaurantFilter.value || ownerOutletSelect.value || "ALL",
    source: activeSource,
    hours: onlinePeriodFilter.value || "120",
    status: onlineStatusFilter.value || "ALL",
    orderNo: onlineOrderNumberFilter.value.trim()
  });
  dashboardStatus.textContent = "Loading online orders...";
  const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/dashboard/online-orders?${params.toString()}`, { headers: { Authorization: `Bearer ${token}` } });
  renderCloudOnlineOrders(data);
}

const OWNER_REPORTS = [
  { type: "day-wise", title: "Daily business ledger", description: "Review orders, revenue, reductions, tax, refunds and realised sales by date." },
  { type: "sales", title: "Outlet revenue roll-up", description: "Compare consolidated trading results across selected locations." },
  { type: "item-wise", title: "Product performance by outlet", description: "See sold quantity and revenue for each menu item and location." },
  { type: "online", title: "Digital order register", description: "Inspect online order progress, customer, payment and value information." },
  { type: "discount", title: "Price adjustment analysis", description: "Track discount values alongside the corresponding outlet sales." }
];
let activeOwnerReportType = "";

function ownerReportFavourites() {
  try { return JSON.parse(localStorage.getItem("ownerReportFavourites") || "[]"); } catch (_) { return []; }
}

function reportCard(report, favourites) {
  const favourite = favourites.includes(report.type);
  return `<article class="report-card" data-report-card="${esc(report.type)}"><button class="report-favourite${favourite ? " active" : ""}" data-report-favourite="${esc(report.type)}" type="button" aria-label="${favourite ? "Remove from" : "Add to"} favourites">${favourite ? "★" : "☆"}</button><h4>${esc(report.title)}</h4><p>${esc(report.description)}</p><button class="report-open" data-report-open="${esc(report.type)}" type="button">View details</button></article>`;
}

function renderOwnerReportCatalog() {
  const search = String(ownerReportSearch?.value || "").trim().toLowerCase();
  const favourites = ownerReportFavourites();
  const visible = OWNER_REPORTS.filter((report) => `${report.title} ${report.description}`.toLowerCase().includes(search));
  ownerReportCards.innerHTML = visible.length ? visible.map((report) => reportCard(report, favourites)).join("") : `<p class="empty-state">No reports match your search.</p>`;
  const favouriteReports = visible.filter((report) => favourites.includes(report.type));
  ownerFavouriteReports.hidden = favouriteReports.length === 0;
  ownerFavouriteReports.querySelector(".report-card-list").innerHTML = favouriteReports.map((report) => reportCard(report, favourites)).join("");
}

function ownerReportColumns(type) {
  if (type === "sales") return [["outlet", "Outlet"], ["orders", "Orders"], ["gross_sales", "Gross sales"], ["discount", "Discount"], ["tax", "Tax"], ["net_sales", "Net sales"]];
  if (type === "item-wise") return [["outlet", "Outlet"], ["item", "Item"], ["quantity", "Quantity"], ["sales", "Sales"]];
  if (type === "online") return [["outlet", "Outlet"], ["order_no", "Order no."], ["order_type", "Type"], ["customer_name", "Customer"], ["order_status", "Status"], ["payment_mode", "Payment"], ["total", "Total"], ["created_at", "Created"]];
  return [["outlet", "Outlet"], ["date", "Date"], ["orders", "Orders"], ["gross_sales", "Gross sales"], ["discount", "Discount"], ["tax", "Tax"], ["refunds", "Refunds"], ["net_sales", "Net sales"]];
}

function reportCell(value, key) {
  if (["gross_sales", "discount", "tax", "refunds", "net_sales", "sales", "total"].includes(key)) return currency(value);
  if (key === "created_at") return value ? new Date(value).toLocaleString() : "—";
  if (key === "date") return value ? String(value).slice(0, 10) : "—";
  return value ?? "—";
}

function renderOwnerReport(data) {
  const rows = data.rows || [];
  const columns = ownerReportColumns(data.reportType);
  const monetaryKeys = columns.map(([key]) => key).filter((key) => ["gross_sales", "discount", "tax", "refunds", "net_sales", "sales", "total"].includes(key));
  const totals = monetaryKeys.reduce((result, key) => ({ ...result, [key]: rows.reduce((sum, row) => sum + Number(row[key] || 0), 0) }), {});
  state.ownerReportData = { ...data, columns };
  ownerReportResultCount.textContent = `${rows.length} row${rows.length === 1 ? "" : "s"}`;
  ownerReportResults.innerHTML = rows.length ? `<div class="report-table-scroll"><table><thead><tr>${columns.map(([, label]) => `<th>${esc(label)}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${columns.map(([key]) => `<td>${esc(reportCell(row[key], key))}</td>`).join("")}</tr>`).join("")}</tbody>${monetaryKeys.length ? `<tfoot><tr>${columns.map(([key], index) => `<td>${index === 0 ? "Total" : (key in totals ? esc(currency(totals[key])) : "")}</td>`).join("")}</tr></tfoot>` : ""}</table></div>` : `<p class="empty-state">No synchronized records for this selection.</p>`;
  dashboardStatus.textContent = `${ownerReportTitle.textContent} · ${rows.length} result(s)`;
}

async function refreshCloudOwnerReport() {
  const token = localStorage.getItem("ownerCloudToken");
  if (!state.user?.cloudOwner || !token || !activeOwnerReportType) return;
  const params = new URLSearchParams({ type: activeOwnerReportType, restaurantId: ownerReportRestaurant.value || "ALL", fromDate: ownerReportFrom.value || today(), toDate: ownerReportTo.value || today() });
  dashboardStatus.textContent = "Calculating report...";
  const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/dashboard/reports?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  renderOwnerReport(data);
}

function openOwnerReport(type) {
  const report = OWNER_REPORTS.find((item) => item.type === type);
  if (!report) return;
  activeOwnerReportType = type;
  ownerReportTitle.textContent = report.title;
  ownerReportCatalog.hidden = true;
  ownerReportDetail.hidden = false;
  ownerReportFrom.value ||= today(); ownerReportTo.value ||= today();
  ownerReportRestaurant.value = ownerOutletSelect.value || "ALL";
  refreshCloudOwnerReport().catch((error) => { dashboardStatus.textContent = error.message; });
}

function exportOwnerReportCsv() {
  const data = state.ownerReportData;
  if (!data?.rows?.length) return alert("Load a report with results before exporting.");
  const quote = (value) => `"${String(value ?? "").replaceAll('"', '""')}"`;
  const csv = [data.columns.map(([, label]) => quote(label)).join(","), ...data.rows.map((row) => data.columns.map(([key]) => quote(reportCell(row[key], key))).join(","))].join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = `${activeOwnerReportType}-${ownerReportFrom.value}-${ownerReportTo.value}.csv`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function printOwnerReport() {
  if (!state.ownerReportData?.rows?.length) return alert("Load a report with results before printing.");
  document.body.classList.add("printing-owner-report"); window.print(); setTimeout(() => document.body.classList.remove("printing-owner-report"), 500);
}

function profileValue(value) { return value ? esc(value) : '<span class="profile-empty">Not provided</span>'; }

function renderOwnerProfile(profile, branches) {
  state.ownerProfile = profile;
  state.ownerBranches = branches;
  ownerProfileSummary.innerHTML = `<div><dt>Name</dt><dd>${profileValue(profile.name)}</dd></div><div><dt>Login email</dt><dd>${profileValue(profile.username)}</dd></div><div><dt>Notification email</dt><dd>${profileValue(profile.notificationEmail)}</dd></div><div><dt>Mobile number</dt><dd>${profileValue(profile.mobileNumber)}</dd></div>`;
  ownerProfileName.value = profile.name || "";
  ownerProfileUsername.value = profile.username || "";
  ownerProfileEmail.value = profile.notificationEmail || "";
  ownerProfileMobile.value = profile.mobileNumber || "";
  ownerBranchProfiles.innerHTML = branches.length ? branches.map((branch, index) => `<details class="mobile-branch-profile" ${index === 0 ? "open" : ""}><summary><span><small>${esc(branch.restaurant_code)}</small><strong>${esc(branch.name)}</strong></span><i>⌄</i></summary><dl class="profile-details branch-details"><div><dt>Legal name</dt><dd>${profileValue(branch.legal_name)}</dd></div><div><dt>GSTIN</dt><dd>${profileValue(branch.gstin)}</dd></div><div><dt>FSSAI licence</dt><dd>${profileValue(branch.fssai_license_no)}</dd></div><div><dt>Service SAC</dt><dd>${profileValue(branch.sac_code)}</dd></div><div><dt>GST rate</dt><dd>${Number(branch.tax_rate || 0).toFixed(2)}%</dd></div><div><dt>State / GST code</dt><dd>${profileValue([branch.state, branch.state_code].filter(Boolean).join(" · "))}</dd></div><div class="wide"><dt>Address</dt><dd>${profileValue([branch.address_line_1, branch.address_line_2, branch.city, branch.state, branch.country].filter(Boolean).join(", "))}</dd></div><div><dt>Branch phone</dt><dd>${profileValue(branch.phone)}</dd></div><div><dt>Branch email</dt><dd>${profileValue(branch.email)}</dd></div><div><dt>Currency</dt><dd>${profileValue(branch.currency)}</dd></div><div><dt>Timezone</dt><dd>${profileValue(branch.timezone)}</dd></div></dl></details>`).join("") : `<p class="empty-state">No restaurant profile is assigned to this owner.</p>`;
  dashboardStatus.textContent = `Profile loaded · ${branches.length} restaurant${branches.length === 1 ? "" : "s"}`;
}

async function refreshCloudOwnerProfile() {
  const token = localStorage.getItem("ownerCloudToken");
  if (!token) return;
  dashboardStatus.textContent = "Loading owner and restaurant profiles...";
  const headers = { Authorization: `Bearer ${token}` };
  const [profileData, branchData] = await Promise.all([fetchJson(`${MOBILE_DIRECTORY_URL}/owners/profile`, { headers }), fetchJson(`${MOBILE_DIRECTORY_URL}/owners/branch-profiles`, { headers })]);
  renderOwnerProfile(profileData.profile || {}, branchData.branches || []);
}

async function saveCloudOwnerProfile() {
  const token = localStorage.getItem("ownerCloudToken");
  const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/profile`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ name: ownerProfileName.value.trim(), notificationEmail: ownerProfileEmail.value.trim(), mobileNumber: ownerProfileMobile.value.trim() }) });
  if (data.owner) { state.user = { ...state.user, name: data.owner.name }; localStorage.setItem("user", JSON.stringify(state.user)); }
  ownerProfileForm.hidden = true; ownerProfileSummary.hidden = false; ownerProfileEdit.hidden = false;
  await refreshCloudOwnerProfile();
  dashboardStatus.textContent = data.message || "Profile saved";
}

async function changeCloudOwnerPassword() {
  if (ownerNewPassword.value !== ownerConfirmPassword.value) throw new Error("New passwords do not match.");
  const token = localStorage.getItem("ownerCloudToken");
  const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/change-password`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ currentPassword: ownerCurrentPassword.value, newPassword: ownerNewPassword.value }) });
  if (data.token) localStorage.setItem("ownerCloudToken", data.token);
  ownerPasswordForm.reset();
  dashboardStatus.textContent = data.message || "Password changed";
}

function openOwnerConnections() {
  const branches = state.ownerBranches || [];
  ownerConnectionChoices.innerHTML = branches.map((branch) => `<label><input type="checkbox" value="${esc(branch.restaurant_code)}"><span><strong>${esc(branch.name)}</strong><small>${esc(branch.restaurant_code)}</small></span></label>`).join("");
  ownerConnectionsDialog.showModal();
}

async function disconnectOwnerBranches() {
  const selected = [...ownerConnectionChoices.querySelectorAll('input:checked')].map((input) => input.value);
  if (!selected.length) return alert("Select at least one outlet.");
  if (selected.length >= (state.ownerBranches || []).length) return alert("At least one outlet must remain connected to the owner account.");
  const names = (state.ownerBranches || []).filter((branch) => selected.includes(branch.restaurant_code)).map((branch) => branch.name).join(", ");
  if (!confirm(`Disconnect ${names}? This removes owner access and analytics visibility, but does not delete restaurant or POS data.`)) return;
  const token = localStorage.getItem("ownerCloudToken");
  ownerDisconnectBranches.disabled = true;
  try {
    for (const code of selected) await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/branch-profiles/${encodeURIComponent(code)}/disconnect`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
    ownerConnectionsDialog.close();
    state.restaurant = await loadOwnerRestaurant(token);
    await refreshCloudOwnerProfile();
    await refreshOwnerDashboard();
    dashboardStatus.textContent = `${selected.length} outlet connection${selected.length === 1 ? "" : "s"} removed.`;
  } finally { ownerDisconnectBranches.disabled = false; }
}

function renderOwnerDashboard(payload) {
  const { dashboard, advanced, live, pendingQr, date } = payload;
  const daily = dashboard.dailySales || [];
  const paidOrders = daily.reduce((sum, row) => sum + Number(row.orders || 0), 0);
  const sales = Number(advanced.profitAndLoss?.sales || dashboard.taxSummary?.taxableSales || 0);
  const discounts = Number(advanced.profitAndLoss?.discounts || 0);
  const refunds = Number(advanced.profitAndLoss?.refunds || 0);
  const allOrders = (dashboard.orderSummary || []).reduce((sum, row) => sum + Number(row.count || 0), 0);
  ownerTotalSales.textContent = currency(sales);
  ownerNetSales.textContent = currency(Math.max(sales - discounts - refunds, 0));
  ownerAverageOrder.textContent = currency(paidOrders ? sales / paidOrders : 0);
  ownerTaxCollected.textContent = currency(dashboard.taxSummary?.tax || 0);
  ownerPaidOrders.textContent = `${paidOrders} paid order${paidOrders === 1 ? "" : "s"}`;
  ownerAllOrders.textContent = `${allOrders} total order${allOrders === 1 ? "" : "s"}`;

  const hourly = advanced.hourlySales || [];
  const maxSales = Math.max(...hourly.map((row) => Number(row.sales || 0)), 1);
  ownerSalesChart.innerHTML = dataRows(hourly.map((row) => `<div class="chart-column" title="${esc(row.hour)}:00 · ${esc(currency(row.sales))}"><div class="chart-bar" style="height:${Math.max(3, Number(row.sales || 0) / maxSales * 125)}px"></div><small>${esc(row.hour)}h</small></div>`), "No paid sales for this date");

  ownerPaymentSummary.innerHTML = dataRows((advanced.paymentSummary || []).map((row, index) => `<div class="data-row"><i class="data-dot" style="background:${["#2563eb","#10b981","#f59e0b","#8b5cf6"][index % 4]}"></i><span><strong>${esc(row.payment_mode || "Other")}</strong><small>${row.payments || 0} payment(s)</small></span><b>${esc(currency(row.total))}</b></div>`), "No settled payments");
  ownerTopItems.innerHTML = dataRows((dashboard.topSellingItems || []).slice(0, 8).map((row) => `<div class="data-row"><i class="data-dot"></i><span><strong>${esc(row.name)}</strong><small>${row.quantity || 0} sold</small></span><b>${esc(currency(row.total))}</b></div>`), "No item sales");

  const running = live.orders || [];
  const runningValue = running.reduce((sum, order) => sum + Number(order.total_amount || 0), 0);
  ownerRunningOrders.textContent = String(running.length);
  ownerRunningAmount.textContent = `${currency(runningValue)} value`;
  ownerPendingOrders.textContent = String((pendingQr.orders || []).length);
  const grouped = running.reduce((map, order) => {
    const key = String(order.order_type || "OTHER").replaceAll("_", " ");
    map[key] ||= { count: 0, total: 0 }; map[key].count += 1; map[key].total += Number(order.total_amount || 0); return map;
  }, {});
  ownerOrderOperations.innerHTML = dataRows(Object.entries(grouped).map(([name, value]) => `<div class="data-row"><i class="data-dot"></i><span><strong>${esc(name)}</strong><small>${value.count} running order(s)</small></span><b>${esc(currency(value.total))}</b></div>`), "No running orders");

  const profit = advanced.profitAndLoss || {};
  ownerLeakage.innerHTML = dataRows([
    ["Discounts", profit.discounts], ["Refunds", profit.refunds], ["Expenses", profit.expenses]
  ].map(([name, value], index) => `<div class="data-row"><i class="data-dot" style="background:${["#f59e0b","#ef4444","#8b5cf6"][index]}"></i><span><strong>${name}</strong><small>${date}</small></span><b>${esc(currency(value))}</b></div>`), "No leakage data");
  ownerExpenses.innerHTML = dataRows((profit.byCategory || []).map((row, index) => `<div class="data-row"><i class="data-dot" style="background:${["#2563eb","#f97316","#22c55e","#38bdf8"][index % 4]}"></i><span><strong>${esc(row.category || "Other")}</strong><small>Expense category</small></span><b>${esc(currency(row.total))}</b></div>`), "No expenses for this date");
  ownerNotificationCount.textContent = String((pendingQr.orders || []).length);
  ownerSyncStatus.textContent = "Synced now";
  dashboardStatus.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

async function refreshOwnerDashboard() {
  const restaurant = state.restaurant || selectedRestaurant();
  const cloudToken = localStorage.getItem("ownerCloudToken");
  if (state.user?.cloudOwner && cloudToken) {
    const restaurantId = ownerOutletSelect.value || "ALL";
    const date = ownerBusinessDate.value || today();
    dashboardStatus.textContent = "Refreshing outlet statistics...";
    const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/dashboard/statistics?restaurantId=${encodeURIComponent(restaurantId)}&date=${encodeURIComponent(date)}`, {
      headers: { Authorization: `Bearer ${cloudToken}` }
    });
    renderCloudOwnerStatistics(data);
    state.ownerData = data;
    return;
  }
  const posBase = restaurantPosUrl(restaurant);
  const restaurantId = restaurant?.restaurantId || localStorage.getItem("restaurantId");
  if (!posBase || !restaurantId) throw new Error("Connect to the restaurant POS to load the owner dashboard.");
  const date = ownerBusinessDate.value || today();
  ownerBusinessDate.value = date;
  dashboardStatus.textContent = "Refreshing business data...";
  const params = `restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(state.user?.role || "OWNER")}&fromDate=${date}&toDate=${date}`;
  const [dashboard, advanced, live, pendingQr] = await Promise.all([
    fetchJson(`${posBase}/reports/dashboard?${params}`),
    fetchJson(`${posBase}/reports/advanced?${params}`),
    fetchJson(`${posBase}/orders/live?restaurantId=${encodeURIComponent(restaurantId)}`),
    fetchJson(`${posBase}/qr/orders/pending?restaurantId=${encodeURIComponent(restaurantId)}`).catch(() => ({ orders: [] }))
  ]);
  state.ownerData = { dashboard, advanced, live, pendingQr, date };
  renderOwnerDashboard(state.ownerData);
}

function rememberRestaurant(restaurant) {
  if (!restaurant?.restaurantId) return;
  localStorage.setItem("restaurantId", restaurant.restaurantId);
  localStorage.setItem("restaurantName", restaurant.name || restaurant.restaurantId);
  localStorage.setItem("currency", restaurant.currency || "INR");
  if (restaurant.posUrl) localStorage.setItem("posUrl", restaurantPosUrl(restaurant));
}

function savedRestaurant() {
  const restaurantId = localStorage.getItem("restaurantId");
  if (!restaurantId) return null;
  const posUrl = localStorage.getItem("posUrl") || DEV_POS_URL;
  if (!posUrl) return null;
  return {
    restaurantId,
    name: localStorage.getItem("restaurantName") || restaurantId,
    posUrl,
    currency: localStorage.getItem("currency") || "INR",
    savedOnly: true
  };
}

function setBrand(app) {
  if (!app) return;
  const selectedName = state.restaurant?.name || app.name || localStorage.getItem("restaurantName") || "Restaurant";
  brandName.textContent = app.name || selectedName || "K'Master POS";
  activeRestaurantName.textContent = selectedName ? `${selectedName} active` : "Ready to sign in";
  brandStatus.textContent = app.enabled ? "Premium mobile app enabled" : "Mobile app access disabled";
  document.documentElement.style.setProperty("--primary", state.user?.cloudOwner ? "#087f73" : (app.primaryColor || "#087f73"));
  document.documentElement.style.setProperty("--accent", app.accentColor || "#f59e0b");
  if (app.logoPath) {
    brandLogo.textContent = "";
    brandLogo.style.backgroundImage = `url("${app.logoPath}")`;
    brandLogo.style.backgroundSize = "cover";
    brandLogo.style.backgroundPosition = "center";
  }
}

function selectedRestaurant() {
  return state.restaurants.find((restaurant) => restaurant.restaurantId === restaurantSelect.value) || null;
}

function restaurantPosUrl(restaurant) {
  return cleanBase(restaurant?.posUrl || (isLocalDevServer ? DEV_POS_URL : ""));
}

async function refreshSelectedRestaurant() {
  if (!state.restaurant?.restaurantId) return state.restaurant;
  const data = await fetchRestaurantDirectory();
  const match = (data.restaurants || []).map((restaurant) => ({
    restaurantId: restaurant.restaurantId || restaurant.restaurant_id || restaurant.restaurant_code,
    name: restaurant.name || restaurant.restaurantName || restaurant.restaurant_name || restaurant.displayName || restaurant.display_name || "Restaurant",
    posUrl: restaurant.posUrl || restaurant.pos_url || "",
    currency: restaurant.currency || "INR"
  })).find((restaurant) => restaurant.restaurantId === state.restaurant.restaurantId);
  if (match) {
    state.restaurant = { ...state.restaurant, ...match };
    const index = state.restaurants.findIndex((restaurant) => restaurant.restaurantId === match.restaurantId);
    if (index >= 0) state.restaurants[index] = state.restaurant;
    rememberRestaurant(state.restaurant);
  }
  return state.restaurant;
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...(options || {}), signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
    return data;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`Connection timed out after ${REQUEST_TIMEOUT_MS / 1000} seconds. Check that the restaurant POS is online and reachable.`);
    }
    if (err.name === "TypeError" || /Failed to fetch|NetworkError|Load failed/i.test(err.message || "")) {
      throw new Error(friendlyConnectionMessage(url));
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

function friendlyConnectionMessage(url) {
  const target = String(url || "");
  if (/\/mobile-app\//.test(target) || /\/admin\.html|\/waiter\.html|\/pos-live\.html/.test(target) || /https?:\/\/(10\.|172\.(1[6-9]|2\d|3[0-1])\.|192\.168\.)/.test(target)) {
    return "Cannot reach the restaurant POS. Connect this phone to the same Wi-Fi as the desktop POS, keep the desktop POS app open, then try again.";
  }
  return "Cannot reach K'Master cloud. Check internet connection and try again.";
}

function reportMobileAttempt(details) {
  fetch(`${MOBILE_DIRECTORY_URL}/monitoring/mobile-attempt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurantId: details.restaurantId,
      posUrl: details.posUrl || "",
      posReachable: Boolean(details.posReachable),
      loginSucceeded: Boolean(details.loginSucceeded),
      error: String(details.error || "").slice(0, 300),
      appVersion: "1.0.38",
      platform: navigator.userAgent || "Mobile app"
    })
  }).catch(() => undefined);
}

async function fetchRestaurantDirectory() {
  const bases = [MOBILE_DIRECTORY_URL, ...(isLocalDevServer ? ["http://localhost:4000"] : [])]
    .map(cleanBase)
    .filter((base, index, all) => base && all.indexOf(base) === index);
  let lastError = null;
  for (const base of bases) {
    try {
      const data = await fetchJson(`${base}/mobile/restaurants`);
      localStorage.setItem("mobileDirectoryUrl", base);
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Directory unavailable");
}

function renderRestaurantOptions() {
  restaurantSelect.innerHTML = state.restaurants.length
    ? `<option value="">Automatic discovery</option>` + state.restaurants.map((restaurant) => (
      `<option value="${esc(restaurant.restaurantId)}">${esc(restaurant.name)} (${esc(restaurant.restaurantId)})</option>`
    )).join("")
    : `<option value="">No mobile-enabled restaurants</option>`;
}

async function findLocalStaffLogin(usernameValue, pinValue) {
  try {
    const latest = await fetchRestaurantDirectory();
    const refreshed = (latest.restaurants || []).map((restaurant) => ({
      restaurantId: restaurant.restaurantId || restaurant.restaurant_id || restaurant.restaurant_code,
      name: restaurant.name || restaurant.restaurantName || restaurant.restaurant_name || restaurant.displayName || restaurant.display_name || "Restaurant",
      posUrl: restaurant.posUrl || restaurant.pos_url || "",
      currency: restaurant.currency || "INR"
    })).filter((restaurant) => restaurant.restaurantId);
    if (refreshed.length) state.restaurants = refreshed;
  } catch (_) {
    // A cached restaurant can still be reachable when the cloud directory is unavailable.
  }
  const candidates = [...state.restaurants];
  const saved = savedRestaurant();
  if (saved && !candidates.some((item) => item.restaurantId === saved.restaurantId)) candidates.unshift(saved);
  const attempts = candidates.map(async (restaurant) => {
    const base = restaurantPosUrl(restaurant);
    if (!base) throw new Error("POS address unavailable");
    let posReachable = false;
    try {
      await fetchJson(`${base}/health`);
      posReachable = true;
      const data = await fetchJson(`${base}/mobile-app/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restaurantId: restaurant.restaurantId, username: usernameValue, pin: pinValue }) });
      reportMobileAttempt({ restaurantId: restaurant.restaurantId, posUrl: base, posReachable, loginSucceeded: true });
      return { data, restaurant, base };
    } catch (error) {
      error.posReachable = posReachable;
      reportMobileAttempt({ restaurantId: restaurant.restaurantId, posUrl: base, posReachable, loginSucceeded: false, error: error.message });
      throw error;
    }
  });
  if (!attempts.length) throw new Error("No local POS was advertised. Keep the desktop POS open and try again.");
  try { return await Promise.any(attempts); }
  catch (aggregate) {
    const reachedPosError = (aggregate?.errors || []).find((error) => error?.posReachable);
    if (reachedPosError) throw new Error(reachedPosError.message || "Invalid username or PIN.");
    throw new Error("Cannot sign in to the local POS. Confirm this phone and the desktop POS are on the same Wi-Fi, keep the POS open, and try again.");
  }
}

async function loadOwnerRestaurant(token) {
  const result = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/restaurants`, { headers: { Authorization: `Bearer ${token}` } });
  state.ownerRestaurants = result.restaurants || [];
  const first = result.restaurants?.[0];
  if (!first) throw new Error("No restaurant is assigned to this owner account.");
  ownerOutletSelect.innerHTML = `<option value="ALL">All outlets</option>${state.ownerRestaurants.map((item) => `<option value="${esc(item.restaurant_code)}">${esc(item.name || item.restaurant_code)}</option>`).join("")}`;
  onlineRestaurantFilter.innerHTML = `<option value="ALL">All outlets</option>${state.ownerRestaurants.map((item) => `<option value="${esc(item.restaurant_code)}">${esc(item.name || item.restaurant_code)}</option>`).join("")}`;
  ownerReportRestaurant.innerHTML = `<option value="ALL">All outlets</option>${state.ownerRestaurants.map((item) => `<option value="${esc(item.restaurant_code)}">${esc(item.name || item.restaurant_code)}</option>`).join("")}`;
  return state.restaurants.find((item) => item.restaurantId === first.restaurant_code) || { restaurantId: first.restaurant_code, name: first.name || first.restaurant_code, posUrl: "", currency: "INR" };
}

async function useRestaurant(restaurant) {
  if (!restaurant) return;
  state.restaurant = restaurant;
  restaurantSelect.value = restaurant.restaurantId;
  rememberRestaurant(restaurant);
  activeRestaurantName.textContent = `${restaurant.name} active`;
  setBrand({
    enabled: true,
    name: restaurant.name,
    currency: restaurant.currency
  });
}

async function checkPremiumAccess(restaurant) {
  if (!restaurant?.restaurantId) throw new Error("Restaurant access is unavailable.");
  let base = restaurantPosUrl(restaurant);
  if (!base) {
    const refreshed = await refreshSelectedRestaurant();
    base = restaurantPosUrl(refreshed);
  }
  if (!base) throw new Error("Restaurant POS is not online yet. Open the desktop POS app and try again.");
  const data = await fetchJson(`${base}/mobile-app/config?restaurantId=${encodeURIComponent(restaurant.restaurantId)}`);
  if (data.app?.restaurantId && data.app.restaurantId !== restaurant.restaurantId) {
    restaurant.restaurantId = data.app.restaurantId;
    localStorage.setItem("restaurantId", restaurant.restaurantId);
  }
  if (data.app?.name) restaurant.name = data.app.name;
  if (data.app?.currency) restaurant.currency = data.app.currency;
  rememberRestaurant(restaurant);
  setBrand(data.app);
  return data;
}

async function loadRestaurants() {
  restaurantSelect.innerHTML = `<option value="">Loading...</option>`;
  try {
    const data = await fetchRestaurantDirectory();
    state.restaurants = (data.restaurants || []).map((restaurant) => ({
      restaurantId: restaurant.restaurantId || restaurant.restaurant_id || restaurant.restaurant_code,
      name: restaurant.name || restaurant.restaurantName || restaurant.restaurant_name || restaurant.displayName || restaurant.display_name || "Restaurant",
      posUrl: restaurant.posUrl || restaurant.pos_url || "",
      currency: restaurant.currency || "INR"
    })).filter((restaurant) => restaurant.restaurantId);
    renderRestaurantOptions();
    const rememberedId = localStorage.getItem("restaurantId");
    const remembered = state.user && state.restaurants.find((restaurant) => restaurant.restaurantId === rememberedId);
    if (remembered) {
      await useRestaurant(remembered);
      showRoleGrid(state.user.role);
      if (!state.user.cloudOwner) {
        const landingByRole = { CAPTAIN: "captain", WAITER: "waiter", KITCHEN: "kitchen", CASHIER: "cashier", RETAIL: "retail", MANAGER: "cashier", MANAGER_1: "cashier", MANAGER_2: "cashier" };
        const landing = landingByRole[String(state.user.role || "").toUpperCase()];
        try {
          await validateStaffPosConnection(remembered);
          showDashboardView(`Signed in as ${state.user.role}. Opening workspace...`);
          if (landing) await openRoleWorkspace(landing, { disabled: false, textContent: "Staff workspace" });
        } catch (error) {
          showLoginView("POS is Offline");
        }
      } else {
        showDashboardView(`Signed in as ${state.user.role}.`);
      }
    } else {
      state.restaurant = null;
      restaurantSelect.value = "";
      activeRestaurantName.textContent = "Ready to sign in";
      brandStatus.textContent = "Staff connect on the POS Wi-Fi; owners sign in online.";
      loginStatus.textContent = state.restaurants.length ? "Login with your POS username and PIN." : "No restaurant has active mobile access.";
    }
  } catch (err) {
    const fallback = savedRestaurant();
    if (!fallback) {
      restaurantSelect.innerHTML = `<option value="">Directory unavailable</option>`;
      loginStatus.textContent = err.message;
      return;
    }
    state.restaurants = [fallback];
    renderRestaurantOptions();
    state.restaurant = null;
    restaurantSelect.value = "";
    activeRestaurantName.textContent = "Ready to sign in";
    brandStatus.textContent = "Staff connect on the POS Wi-Fi; owners sign in online.";
    loginStatus.textContent = "Cloud directory unavailable. Staff can retry when the POS is online.";
  }
}

function showRoleGrid(role) {
  const roleRules = {
    captain: ["MANAGER", "MANAGER_1", "MANAGER_2", "CAPTAIN"],
    waiter: ["MANAGER", "MANAGER_1", "MANAGER_2", "WAITER"],
    cashier: ["MANAGER", "MANAGER_1", "MANAGER_2", "CASHIER"],
    kitchen: ["KITCHEN"],
    retail: ["RETAIL"]
  };
  document.querySelectorAll("[data-role]").forEach((button) => {
    button.hidden = !roleRules[button.dataset.role]?.includes(role);
  });
}

async function login() {
  if (!username.value.trim() || !pin.value.trim()) {
    loginStatus.textContent = "Enter username and PIN.";
    return;
  }
  const ownerStyleLogin = username.value.trim().includes("@");
  if (!ownerStyleLogin && !/^\d{6}$/.test(pin.value.trim()) && pin.value.trim().length !== 4) {
    loginStatus.textContent = "Enter your 6 digit PIN.";
    return;
  }
  loginButton.disabled = true;
  loginButton.textContent = "Signing in...";
  loginStatus.textContent = "Connecting to the restaurant POS...";
  try {
    let base = "";
    let data;
    if (ownerStyleLogin) {
      loginStatus.textContent = "Signing in securely through K'Master cloud...";
      const ownerLogin = await fetchJson(`${MOBILE_DIRECTORY_URL}/owners/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: username.value.trim(), password: pin.value })
      });
      state.restaurant = await loadOwnerRestaurant(ownerLogin.token);
      data = { token: ownerLogin.token, user: { ...ownerLogin.owner, username: ownerLogin.owner.email, role: "OWNER", cloudOwner: true } };
    } else {
      const localLogin = await findLocalStaffLogin(username.value.trim(), pin.value.trim());
      data = localLogin.data;
      state.restaurant = localLogin.restaurant;
      base = localLogin.base;
    }
    state.user = data.user;
    if (data.token) localStorage.setItem("ownerCloudToken", data.token);
    if (data.restaurant?.name) state.restaurant.name = data.restaurant.name;
    localStorage.setItem("restaurantId", state.restaurant.restaurantId);
    localStorage.setItem("restaurantName", state.restaurant.name);
    localStorage.setItem("posUrl", base);
    localStorage.setItem("user", JSON.stringify(data.user));
    activeRestaurantName.textContent = `${state.restaurant.name} active`;
    showRoleGrid(data.user.role);
    if (ownerStyleLogin) showDashboardView(`Signed in as ${data.user.role}.`);
    else {
      showDashboardView(`Signed in as ${data.user.role}. Opening workspace...`);
      const landingByRole = {
        CAPTAIN: "captain",
        WAITER: "waiter",
        KITCHEN: "kitchen",
        CASHIER: "cashier",
        RETAIL: "retail",
        MANAGER: "cashier",
        MANAGER_1: "cashier",
        MANAGER_2: "cashier"
      };
      await openRoleWorkspace(landingByRole[String(data.user.role).toUpperCase()] || "cashier", loginButton);
    }
    await offerBiometric({
      restaurantId: state.restaurant.restaurantId,
      restaurantName: state.restaurant.name,
      posUrl: base,
      username: username.value.trim(),
      pin: pin.value.trim()
    });
  } catch (err) {
    if (!ownerStyleLogin && /offline|unreachable|cannot reach|timed out|failed to fetch|network/i.test(String(err.message || ""))) {
      showLoginView(staffPosOfflineMessage(err), { loginAttempt: true });
    } else {
      loginStatus.textContent = err.message || "Login failed. Please try again.";
    }
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Login";
  }
}

restaurantSelect.addEventListener("change", async () => {
  state.restaurant = selectedRestaurant();
  if (!state.restaurant) {
    activeRestaurantName.textContent = "Ready to sign in";
    brandStatus.textContent = "Staff connect on the POS Wi-Fi; owners sign in online.";
    return;
  }
  await useRestaurant(state.restaurant);
  loginStatus.textContent = "Login with your POS username and PIN.";
});

loginButton.addEventListener("click", login);
biometricLoginButton.addEventListener("click", async () => {
  try {
    await native.biometric.authenticate({
      reason: "Sign in to K'Master POS",
      cancelTitle: "Cancel",
      allowDeviceCredential: true,
      iosFallbackTitle: "Use device passcode",
      androidTitle: "K'Master POS login",
      androidSubtitle: "Confirm your identity",
      androidConfirmationRequired: false
    });
    const credentials = await native.secureStorage.get(BIOMETRIC_KEY);
    if (!credentials) throw new Error("Saved login was not found. Sign in with your PIN.");
    const match = state.restaurants.find((item) => item.restaurantId === credentials.restaurantId);
    if (!match) throw new Error("This restaurant is no longer available.");
    await useRestaurant(match);
    username.value = credentials.username;
    pin.value = credentials.pin;
    await login();
    pin.value = "";
  } catch (err) {
    loginStatus.textContent = err.message || "Biometric login was cancelled.";
  }
});
enableBiometricButton.addEventListener("click", async (event) => {
  event.preventDefault();
  try {
    await saveBiometricCredentials(pendingCredentials);
    localStorage.setItem("biometricPromptHandled", "true");
    biometricPrompt.close();
  } catch (err) {
    dashboardStatus.textContent = err.message || "Biometric login could not be enabled.";
  }
});
skipBiometricButton.addEventListener("click", () => localStorage.setItem("biometricPromptHandled", "true"));
settingsButton.addEventListener("click", async () => {
  await refreshBiometricControls();
  settingsDialog.showModal();
});
biometricToggle.addEventListener("change", async () => {
  try {
    if (biometricToggle.checked) {
      if (!pendingCredentials) {
        pendingCredentials = {
          restaurantId: state.restaurant?.restaurantId,
          restaurantName: state.restaurant?.name,
          posUrl: restaurantPosUrl(state.restaurant),
          username: state.user?.username || username.value.trim(),
          pin: pin.value.trim()
        };
      }
      if (!pendingCredentials.pin) throw new Error("Log out and sign in with your PIN once to enable biometric login.");
      await saveBiometricCredentials(pendingCredentials);
    } else {
      await removeBiometricCredentials();
    }
  } catch (err) {
    biometricToggle.checked = false;
    biometricStatus.textContent = err.message || "Could not update biometric login.";
  }
});
logoutButton.addEventListener("click", () => {
  state.user = null;
  localStorage.removeItem("user");
  localStorage.removeItem("ownerCloudToken");
  showRoleGrid("");
  showLoginView("Logged out. Login with your POS username and PIN.");
});
loginBiometricSettings.addEventListener("click", async () => {
  await refreshBiometricControls();
  settingsDialog.showModal();
});

retryPosConnection.addEventListener("click", async () => {
  retryPosConnection.disabled = true;
  retryPosConnection.textContent = "Checking POS...";
  try {
    const restaurant = state.restaurant || savedRestaurant();
    await validateStaffPosConnection(restaurant);
    if (!state.user) throw new Error("Sign in again to continue.");
    const landingByRole = { CAPTAIN: "captain", WAITER: "waiter", KITCHEN: "kitchen", CASHIER: "cashier", RETAIL: "retail", MANAGER: "cashier", MANAGER_1: "cashier", MANAGER_2: "cashier" };
    showDashboardView(`POS connected. Opening workspace...`);
    await openRoleWorkspace(landingByRole[String(state.user.role || "").toUpperCase()] || "cashier", retryPosConnection);
  } catch (error) {
    showLoginView(staffPosOfflineMessage(error));
  } finally {
    retryPosConnection.disabled = false;
    retryPosConnection.textContent = "Retry POS connection";
  }
});
offlineLogoutButton.addEventListener("click", () => logoutButton.click());

async function openRoleWorkspace(role, button) {
  ownerDrawer.hidden = true;
  if (role === "owner") {
    stopStaffConnectionMonitor();
    webviewPanel.hidden = true;
    appFrame.src = "about:blank";
    showDashboardView("Owner control loaded.");
    showOwnerTab("sales");
    return;
  }
  const restaurant = state.restaurant || selectedRestaurant();
  const restId = restaurant?.restaurantId || localStorage.getItem("restaurantId");
  const posBase = restaurantPosUrl(restaurant);
  const mobileParams = new URLSearchParams({
    restaurantId: restId || "",
    mobileUserId: String(state.user?.id || ""),
    mobileUserName: state.user?.name || state.user?.username || "Mobile user",
    mobileRole: state.user?.role || ""
  });
  const paths = {
    captain: `${posBase}/waiter.html?${mobileParams.toString()}`,
    waiter: `${posBase}/waiter.html?${mobileParams.toString()}`,
    cashier: `${posBase}/pos-live.html?${mobileParams.toString()}`,
    retail: `${posBase}/retail.html?${mobileParams.toString()}`,
    pos: `${posBase}/pos-live.html?${mobileParams.toString()}`,
    kitchen: `${posBase}/kds.html?${mobileParams.toString()}`
  };
  if (!restId || !posBase || !state.user) {
    showLoginView("Login first.");
    return false;
  }
  button.disabled = true;
  dashboardStatus.textContent = `Connecting to ${restaurant.name || "restaurant"} POS...`;
  try {
    if (role === "captain" || role === "waiter") {
      const health = await fetchJson(`${posBase}/health`);
      const installed = String(health.version || "0.0.0").split(".").map((value) => Number(value) || 0);
      const compatible = installed[0] > 1 || (installed[0] === 1 && (installed[1] > 0 || (installed[1] === 0 && installed[2] >= 147)));
      if (!compatible) throw new Error(`Update POS Desktop to 1.0.147 or later. This POS is ${health.version || "an older version"} and cannot provide the new mobile Dine In workflow.`);
    }
    await fetchJson(`${posBase}/mobile-app/config?restaurantId=${encodeURIComponent(restId)}`);
    const workspaceLabels = { captain: "POS Dine In", waiter: "POS Dine In", cashier: "Cashier POS", retail: "Retail Counter", pos: "POS", kitchen: "Kitchen KDS" };
    activeRole.textContent = workspaceLabels[role] || "Mobile View";
    webviewPanel.classList.toggle("staff-workspace", !state.user?.cloudOwner);
    closeFrame.hidden = !state.user?.cloudOwner;
    closeFrame.textContent = "Close";
    appFrame.src = paths[role];
    webviewPanel.hidden = false;
    wifiInterruptionScreen.hidden = true;
    startStaffConnectionMonitor();
    dashboardStatus.textContent = `${button.textContent} opened.`;
    return true;
  } catch (err) {
    const message = staffPosOfflineMessage(err);
    dashboardStatus.textContent = message;
    if (!state.user?.cloudOwner) showLoginView(message);
    return false;
  } finally {
    button.disabled = false;
  }
}

document.addEventListener("click", (event) => {
  const roleButton = event.target.closest("[data-role]");
  if (roleButton) openRoleWorkspace(roleButton.dataset.role, roleButton);
});

document.querySelectorAll("[data-owner-tab]").forEach((button) => button.addEventListener("click", () => showOwnerTab(button.dataset.ownerTab)));
document.querySelectorAll("[data-drawer-tab]").forEach((button) => button.addEventListener("click", () => showOwnerTab(button.dataset.drawerTab)));
document.querySelectorAll("[data-open-owner-reports]").forEach((button) => button.addEventListener("click", () => showOwnerTab("reports")));
document.querySelectorAll("[data-open-owner-profile]").forEach((button) => button.addEventListener("click", () => showOwnerTab("profile")));
ownerMenuButton.addEventListener("click", () => { ownerDrawer.hidden = false; });
closeOwnerDrawer.addEventListener("click", () => { ownerDrawer.hidden = true; });
ownerRefreshButton.addEventListener("click", () => refreshOwnerDashboard().catch((error) => { dashboardStatus.textContent = error.message; }));
ownerBusinessDate.addEventListener("change", () => refreshOwnerDashboard().catch((error) => { dashboardStatus.textContent = error.message; }));
ownerOutletSelect.addEventListener("change", () => {
  onlineRestaurantFilter.value = ownerOutletSelect.value;
  refreshOwnerDashboard().catch((error) => { dashboardStatus.textContent = error.message; });
  if (document.querySelector('[data-owner-view="operations"]')?.classList.contains("active")) refreshCloudLiveOrders().catch((error) => { dashboardStatus.textContent = error.message; });
  if (document.querySelector('[data-owner-view="online"]')?.classList.contains("active")) refreshCloudOnlineOrders().catch((error) => { dashboardStatus.textContent = error.message; });
});
ownerMetricSelect.addEventListener("change", () => state.ownerData && renderCloudOwnerStatistics(state.ownerData));
ownerSortSelect.addEventListener("change", () => state.ownerData && renderCloudOwnerStatistics(state.ownerData));
document.querySelectorAll("[data-live-tab]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-live-tab]").forEach((item) => item.classList.toggle("active", item === button));
  document.querySelectorAll("[data-live-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.livePanel === button.dataset.liveTab));
}));
ownerLiveRefresh.addEventListener("click", () => refreshCloudLiveOrders().catch((error) => { dashboardStatus.textContent = error.message; }));
document.querySelectorAll("[data-online-source]").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll("[data-online-source]").forEach((item) => item.classList.toggle("active", item === button));
  refreshCloudOnlineOrders().catch((error) => { dashboardStatus.textContent = error.message; });
}));
ownerOnlineRefresh.addEventListener("click", () => refreshCloudOnlineOrders().catch((error) => { dashboardStatus.textContent = error.message; }));
onlineApplyFilters.addEventListener("click", () => refreshCloudOnlineOrders().catch((error) => { dashboardStatus.textContent = error.message; }));
onlineResetFilters.addEventListener("click", () => {
  onlineRestaurantFilter.value = ownerOutletSelect.value || "ALL";
  onlinePeriodFilter.value = "120";
  onlineStatusFilter.value = "ALL";
  onlineOrderNumberFilter.value = "";
  document.querySelectorAll("[data-online-source]").forEach((item) => item.classList.toggle("active", item.dataset.onlineSource === "ALL"));
  refreshCloudOnlineOrders().catch((error) => { dashboardStatus.textContent = error.message; });
});
ownerReportSearch.addEventListener("input", renderOwnerReportCatalog);
document.querySelector('[data-owner-view="reports"]').addEventListener("click", (event) => {
  const favouriteButton = event.target.closest("[data-report-favourite]");
  if (favouriteButton) {
    const type = favouriteButton.dataset.reportFavourite;
    const favourites = ownerReportFavourites();
    localStorage.setItem("ownerReportFavourites", JSON.stringify(favourites.includes(type) ? favourites.filter((item) => item !== type) : [...favourites, type]));
    renderOwnerReportCatalog(); return;
  }
  const openButton = event.target.closest("[data-report-open]");
  if (openButton) openOwnerReport(openButton.dataset.reportOpen);
});
ownerReportBack.addEventListener("click", () => { ownerReportDetail.hidden = true; ownerReportCatalog.hidden = false; renderOwnerReportCatalog(); });
ownerReportRun.addEventListener("click", () => refreshCloudOwnerReport().catch((error) => { dashboardStatus.textContent = error.message; }));
ownerReportCsv.addEventListener("click", exportOwnerReportCsv);
ownerReportPrint.addEventListener("click", printOwnerReport);
ownerProfileRefresh.addEventListener("click", () => refreshCloudOwnerProfile().catch((error) => { dashboardStatus.textContent = error.message; }));
ownerProfileEdit.addEventListener("click", () => { ownerProfileSummary.hidden = true; ownerProfileForm.hidden = false; ownerProfileEdit.hidden = true; });
ownerProfileCancel.addEventListener("click", () => { ownerProfileForm.hidden = true; ownerProfileSummary.hidden = false; ownerProfileEdit.hidden = false; if (state.ownerProfile) renderOwnerProfile(state.ownerProfile, state.ownerBranches || []); });
ownerProfileForm.addEventListener("submit", (event) => { event.preventDefault(); saveCloudOwnerProfile().catch((error) => { dashboardStatus.textContent = error.message; }); });
ownerPasswordForm.addEventListener("submit", (event) => { event.preventDefault(); changeCloudOwnerPassword().catch((error) => { dashboardStatus.textContent = error.message; }); });
ownerManageConnections.addEventListener("click", openOwnerConnections);
ownerDisconnectBranches.addEventListener("click", () => disconnectOwnerBranches().catch((error) => { dashboardStatus.textContent = error.message; }));
ownerNotificationButton.addEventListener("click", () => {
  const count = Number(ownerNotificationCount.textContent || 0);
  alert(count ? `${count} QR order${count === 1 ? "" : "s"} waiting for approval.` : "No new notifications.");
});
drawerSettingsButton.addEventListener("click", async () => { ownerDrawer.hidden = true; await refreshBiometricControls(); settingsDialog.showModal(); });
drawerLogoutButton.addEventListener("click", () => { ownerDrawer.hidden = true; logoutButton.click(); });

closeFrame.addEventListener("click", () => {
  stopStaffConnectionMonitor();
  appFrame.src = "about:blank";
  webviewPanel.hidden = true;
});

refreshWifiConnection.addEventListener("click", () => checkActiveStaffConnection({ manual: true }));
window.addEventListener("offline", () => showWifiInterruption("Your order screen is safely kept open."));
window.addEventListener("online", () => checkActiveStaffConnection());

window.addEventListener("message", (event) => {
  if (event.data?.type !== "KMASTER_MOBILE_LOGOUT") return;
  stopStaffConnectionMonitor();
  appFrame.src = "about:blank";
  webviewPanel.hidden = true;
  logoutButton.click();
});

showRoleGrid(state.user?.role || "");
ownerBusinessDate.value = today();
ownerReportFrom.value = today();
ownerReportTo.value = today();
loadRestaurants();
refreshBiometricControls();
if (state.user) {
  showDashboardView(`Signed in as ${state.user.role}.`);
} else {
  showLoginView();
}
