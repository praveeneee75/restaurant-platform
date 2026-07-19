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
  restaurant: null,
  user: JSON.parse(localStorage.getItem("user") || "null"),
  ownerData: null
};
const native = window.KMasterNative || { isNative: false };
const BIOMETRIC_KEY = "kmaster-biometric-login";
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

function showLoginView(message) {
  loginView.hidden = false;
  dashboardView.hidden = true;
  webviewPanel.hidden = true;
  appFrame.src = "about:blank";
  if (message) loginStatus.textContent = message;
}

function showDashboardView(message) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  dashboardTitle.textContent = "Business overview";
  dashboardStatus.textContent = message || `Signed in as ${state.user?.role || "user"}.`;
  ownerOutletName.textContent = state.restaurant?.name || localStorage.getItem("restaurantName") || "Restaurant";
  drawerRestaurantName.textContent = ownerOutletName.textContent;
  drawerUserName.textContent = state.user?.name || state.user?.username || state.user?.role || "User";
  const ownerAllowed = ["OWNER", "MANAGER", "MANAGER_2"].includes(String(state.user?.role || "").toUpperCase());
  showOwnerTab(ownerAllowed ? "sales" : "more");
  if (ownerAllowed) refreshOwnerDashboard().catch((error) => { dashboardStatus.textContent = error.message; });
}

function currency(value) {
  const code = state.restaurant?.currency || localStorage.getItem("currency") || "INR";
  try { return new Intl.NumberFormat("en-IN", { style: "currency", currency: code, maximumFractionDigits: 2 }).format(Number(value || 0)); }
  catch (_) { return `${code} ${Number(value || 0).toFixed(2)}`; }
}

function today() { return new Date().toISOString().slice(0, 10); }

function showOwnerTab(tab) {
  document.querySelectorAll("[data-owner-view]").forEach((view) => view.classList.toggle("active", view.dataset.ownerView === tab));
  document.querySelectorAll("[data-owner-tab]").forEach((button) => button.classList.toggle("active", button.dataset.ownerTab === tab));
  ownerDrawer.hidden = true;
}

function dataRows(rows, emptyMessage) {
  return rows.length ? rows.join("") : `<p class="empty-state">${esc(emptyMessage)}</p>`;
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
    const restaurantId = restaurant?.restaurantId || localStorage.getItem("restaurantId");
    const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/owner-control/owner/dashboard?restaurantId=${encodeURIComponent(restaurantId)}`, {
      headers: { Authorization: `Bearer ${cloudToken}` }
    });
    const today = data.executiveSales?.today || {};
    ownerTotalSales.textContent = currency(today.netSales);
    ownerNetSales.textContent = currency(Math.max(Number(today.netSales || 0) - Number(data.refunds?.total || 0), 0));
    ownerAverageOrder.textContent = currency(today.averageOrder);
    ownerTaxCollected.textContent = currency(today.tax);
    ownerPaidOrders.textContent = `${today.orders || 0} paid order(s)`;
    ownerAllOrders.textContent = "Invoice details excluded";
    ownerSalesChart.innerHTML = '<p class="empty-state">Daily summaries are available in the owner web portal.</p>';
    ownerPaymentSummary.innerHTML = dataRows((data.executiveSales?.byPayment || []).map((row) => `<div class="data-row"><i class="data-dot"></i><span><strong>${esc(row.mode)}</strong><small>Today</small></span><b>${esc(currency(row.total))}</b></div>`), "No settled payments");
    ownerTopItems.innerHTML = dataRows((data.topItems || []).slice(0, 8).map((row) => `<div class="data-row"><i class="data-dot"></i><span><strong>${esc(row.item_name)}</strong><small>${row.quantity_sold || 0} sold</small></span><b>${esc(currency(row.total_sales))}</b></div>`), "No item sales");
    const groups = data.liveOperations || {};
    const running = Object.values(groups).flat();
    ownerRunningOrders.textContent = String(running.length);
    ownerRunningAmount.textContent = `${currency(running.reduce((s,o)=>s+Number(o.total||0),0))} value`;
    ownerPendingOrders.textContent = String((data.pendingApprovals || []).length);
    ownerOrderOperations.innerHTML = dataRows(Object.entries(groups).map(([name, list]) => `<div class="data-row"><i class="data-dot"></i><span><strong>${esc(name)}</strong><small>${list.length} live order(s)</small></span><b>${esc(currency(list.reduce((s,o)=>s+Number(o.total||0),0)))}</b></div>`), "No running orders");
    ownerLeakage.innerHTML = dataRows([['Refunds',data.refunds?.total],['Promocode uses',data.promocodes?.totalUses]].map(([name,value])=>`<div class="data-row"><i class="data-dot"></i><span><strong>${esc(name)}</strong><small>Last 30 days</small></span><b>${name.includes('uses')?Number(value||0):esc(currency(value))}</b></div>`),"No leakage data");
    ownerExpenses.innerHTML = '<p class="empty-state">Expense data is not included in the current cloud snapshot.</p>';
    ownerNotificationCount.textContent = String((data.alerts || []).length + (data.pendingApprovals || []).length);
    const last = data.freshness?.lastSnapshotAt;
    ownerSyncStatus.textContent = last ? `Synced ${new Date(last).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}` : 'Not synced';
    dashboardStatus.textContent = last ? `Cloud data updated ${new Date(last).toLocaleString()}` : 'Waiting for POS cloud sync';
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
  activeRestaurantName.textContent = selectedName ? `${selectedName} active` : "No restaurant selected";
  brandStatus.textContent = app.enabled ? "Premium mobile app enabled" : "Mobile app access disabled";
  document.documentElement.style.setProperty("--primary", app.primaryColor || "#2563eb");
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
    ? `<option value="">Select restaurant</option>` + state.restaurants.map((restaurant) => (
      `<option value="${esc(restaurant.restaurantId)}">${esc(restaurant.name)} (${esc(restaurant.restaurantId)})</option>`
    )).join("")
    : `<option value="">No mobile-enabled restaurants</option>`;
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
  if (!restaurant?.restaurantId) throw new Error("Select a restaurant.");
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
      showDashboardView(`Signed in as ${state.user.role}.`);
    } else {
      state.restaurant = null;
      restaurantSelect.value = "";
      activeRestaurantName.textContent = "No restaurant selected";
      brandStatus.textContent = "Select your restaurant and sign in.";
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
    activeRestaurantName.textContent = "No restaurant selected";
    brandStatus.textContent = "Select your restaurant and sign in.";
    loginStatus.textContent = "Directory unavailable. Select the saved restaurant to continue.";
  }
}

function showRoleGrid(role) {
  const roleRules = {
    owner: ["OWNER", "MANAGER", "MANAGER_2"],
    captain: ["OWNER", "MANAGER", "MANAGER_1", "MANAGER_2", "CAPTAIN", "WAITER"],
    waiter: ["OWNER", "MANAGER", "MANAGER_1", "MANAGER_2", "CAPTAIN", "WAITER"],
    cashier: ["OWNER", "MANAGER", "MANAGER_1", "MANAGER_2", "CASHIER"]
  };
  document.querySelectorAll("[data-role]").forEach((button) => {
    button.hidden = !roleRules[button.dataset.role]?.includes(role);
  });
}

async function login() {
  state.restaurant = selectedRestaurant();
  if (!state.restaurant) {
    loginStatus.textContent = "Select a restaurant.";
    return;
  }
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
    const base = restaurantPosUrl(state.restaurant);
    let data;
    if (ownerStyleLogin) {
      loginStatus.textContent = "Signing in securely through K'Master cloud...";
      data = await fetchJson(`${MOBILE_DIRECTORY_URL}/license/owner-pos-login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: state.restaurant.restaurantId,
          email: username.value.trim(),
          password: pin.value
        })
      });
    } else {
      await checkPremiumAccess(state.restaurant);
      data = await fetchJson(`${base}/mobile-app/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId: state.restaurant.restaurantId,
          username: username.value.trim(),
          pin: pin.value.trim()
        })
      });
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
    showDashboardView(`Signed in as ${data.user.role}.`);
    await offerBiometric({
      restaurantId: state.restaurant.restaurantId,
      restaurantName: state.restaurant.name,
      posUrl: base,
      username: username.value.trim(),
      pin: pin.value.trim()
    });
  } catch (err) {
    loginStatus.textContent = err.message || "Login failed. Please try again.";
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = "Login";
  }
}

restaurantSelect.addEventListener("change", async () => {
  state.restaurant = selectedRestaurant();
  if (!state.restaurant) {
    activeRestaurantName.textContent = "No restaurant selected";
    brandStatus.textContent = "Select your restaurant and sign in.";
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

async function openRoleWorkspace(role, button) {
  ownerDrawer.hidden = true;
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
    owner: `${posBase}/admin.html?${mobileParams.toString()}`,
    captain: `${posBase}/waiter.html?${mobileParams.toString()}`,
    waiter: `${posBase}/waiter.html?${mobileParams.toString()}`,
    cashier: `${posBase}/pos-live.html?${mobileParams.toString()}`
  };
  if (!restId || !posBase || !state.user) {
    showLoginView("Login first.");
    return;
  }
  button.disabled = true;
  dashboardStatus.textContent = `Connecting to ${restaurant.name || "restaurant"} POS...`;
  try {
    await fetchJson(`${posBase}/mobile-app/config?restaurantId=${encodeURIComponent(restId)}`);
    activeRole.textContent = button.textContent;
    appFrame.src = paths[role];
    webviewPanel.hidden = false;
    dashboardStatus.textContent = `${button.textContent} opened.`;
  } catch (err) {
    dashboardStatus.textContent = err.message || "Cannot open this workspace. Check the POS connection.";
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
ownerMenuButton.addEventListener("click", () => { ownerDrawer.hidden = false; });
closeOwnerDrawer.addEventListener("click", () => { ownerDrawer.hidden = true; });
ownerRefreshButton.addEventListener("click", () => refreshOwnerDashboard().catch((error) => { dashboardStatus.textContent = error.message; }));
ownerBusinessDate.addEventListener("change", () => refreshOwnerDashboard().catch((error) => { dashboardStatus.textContent = error.message; }));
ownerOutletButton.addEventListener("click", () => alert(state.restaurant?.name || "Current restaurant"));
ownerNotificationButton.addEventListener("click", () => {
  const count = Number(ownerNotificationCount.textContent || 0);
  alert(count ? `${count} QR order${count === 1 ? "" : "s"} waiting for approval.` : "No new notifications.");
});
drawerSettingsButton.addEventListener("click", async () => { ownerDrawer.hidden = true; await refreshBiometricControls(); settingsDialog.showModal(); });
drawerLogoutButton.addEventListener("click", () => { ownerDrawer.hidden = true; logoutButton.click(); });

closeFrame.addEventListener("click", () => {
  appFrame.src = "about:blank";
  webviewPanel.hidden = true;
});

showRoleGrid(state.user?.role || "");
ownerBusinessDate.value = today();
loadRestaurants();
refreshBiometricControls();
if (state.user) {
  showDashboardView(`Signed in as ${state.user.role}.`);
} else {
  showLoginView();
}
