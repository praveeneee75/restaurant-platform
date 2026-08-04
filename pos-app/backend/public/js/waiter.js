const params = new URLSearchParams(window.location.search);
const restaurantId = params.get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

function userFromMobileParams() {
  const role = params.get("mobileRole");
  if (!role) return null;
  return {
    id: Number(params.get("mobileUserId") || 0),
    name: params.get("mobileUserName") || "Mobile user",
    role
  };
}

const user = JSON.parse(localStorage.getItem("user") || "null") || userFromMobileParams();
if (user) localStorage.setItem("user", JSON.stringify(user));
if (!restaurantId || !user) {
  waiterStatus.textContent = "Login from the mobile app first.";
  throw new Error("Missing restaurant or user session");
}

const actor = { id: user?.id, role: user?.role };
const state = {
  tables: [],
  categories: [],
  items: [],
  cart: [],
  selectedTable: null,
  selectedCategoryId: null,
  selectedCartKey: null,
  orderId: null,
  openOrders: [],
  customer: null,
  fulfillmentType: "DINE_IN",
  billingReady: false,
  latestUpdatedAt: null,
  lock: null,
  permissions: [],
  settings: {}
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => Number(value || 0).toFixed(2);
const can = (permission) => state.permissions.includes(permission) || actor.role === "OWNER";
let bootstrapInFlight = false;
let activeMobileStep = "tables";

function showMobileStep(step) {
  activeMobileStep = step;
  document.querySelectorAll("[data-waiter-step]").forEach((button) => {
    button.classList.toggle("active", button.dataset.waiterStep === step);
  });
  document.querySelectorAll("[data-waiter-panel]").forEach((panel) => {
    panel.classList.toggle("mobile-active", panel.dataset.waiterPanel === step);
  });
}

async function postJson(url, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: controller.signal,
    body: JSON.stringify({ restaurantId, actor, deviceName: navigator.userAgent.slice(0, 80), ...body })
  }).finally(() => clearTimeout(timer));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  const res = await fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function loadBootstrap() {
  if (bootstrapInFlight) return;
  bootstrapInFlight = true;
  waiterStatus.textContent = "Refreshing tables...";
  try {
    const [pos, permissions] = await Promise.all([
      fetchJson(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`),
      fetchJson(`/permissions/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`)
    ]);
    state.tables = pos.tables || [];
    state.categories = pos.categories || [];
    state.items = pos.items || [];
    state.permissions = permissions.currentPermissions || [];
    state.settings = pos.settings || {};
    if (!can("orders.create")) {
      waiterStatus.textContent = "Your role cannot create waiter orders.";
      saveWaiterOrder.disabled = true;
      submitWaiterKot.disabled = true;
    } else {
      waiterStatus.textContent = `${state.tables.length} tables ready`;
      saveWaiterOrder.disabled = false;
      submitWaiterKot.disabled = false;
    }
    if (!state.selectedCategoryId) state.selectedCategoryId = state.categories[0]?.id || null;
    renderAll();
  } finally {
    bootstrapInFlight = false;
  }
}

async function touchDevice() {
  await postJson("/device-sessions/touch", {});
}

function renderAll() {
  renderTables();
  renderCategories();
  renderItems();
  renderCart();
  renderTransferOptions();
  renderOrderControls();
}

function renderOrderControls() {
  waiterOrderSelector.innerHTML = `<option value="">New customer check</option>` + state.openOrders.map((order) => (
    `<option value="${order.id}">${esc(order.order_reference || `Order ${order.id}`)}${order.customer_name ? ` - ${esc(order.customer_name)}` : ""}</option>`
  )).join("");
  waiterOrderSelector.value = state.orderId ? String(state.orderId) : "";
  waiterCustomerPhone.value = state.customer?.phone || "";
  waiterCustomerName.value = state.customer?.name || "";
  waiterCustomerStatus.textContent = state.customer ? `${state.customer.name} - ${state.customer.phone || "No phone"}` : "No customer attached";
  fulfilmentStatus.textContent = state.fulfillmentType === "TAKEAWAY" ? "Parcel check linked to this table" : "Dine In check";
  const hasUnsentItems = state.cart.some((item) => !item.sentToKitchen);
  submitWaiterKot.disabled = state.billingReady || !state.selectedTable || !state.lock || !hasUnsentItems;
  finalWaiterCheck.hidden = state.settings.showFinalBillPrintDineIn === false;
  finalWaiterCheck.disabled = state.billingReady || !state.selectedTable || !state.lock || state.cart.length === 0;
  saveWaiterOrder.disabled = state.billingReady || state.cart.length === 0;
}

function renderTables() {
  waiterTables.innerHTML = state.tables.map((table) => `
    <button class="table-btn ${table.status === "OCCUPIED" ? "occupied" : ""} ${state.selectedTable?.id === table.id ? "selected" : ""}" data-table-id="${table.id}">
      <strong>${esc(table.table_name)}</strong><br>
      <small>${esc(table.status)}</small>
    </button>
  `).join("");
}

function renderCategories() {
  waiterCategories.innerHTML = state.categories.map((category) => `<button data-category-id="${category.id}">${esc(category.name)}</button>`).join("");
}

function renderItems() {
  const items = state.items.filter((item) => item.category_id === state.selectedCategoryId);
  waiterItems.innerHTML = items.map((item) => `
    <div class="item-row">
      <div><strong>${esc(item.name)}</strong><br><small>${money(item.price)}</small></div>
      <div class="menu-qty-controls">
        <button data-menu-dec="${item.id}" aria-label="Remove one ${esc(item.name)}">−</button>
        <strong>${state.cart.filter((line) => Number(line.id) === Number(item.id) && !line.sentToKitchen).reduce((sum, line) => sum + Number(line.quantity || 0), 0)}</strong>
        <button data-add-item="${item.id}" aria-label="Add one ${esc(item.name)}">+</button>
      </div>
    </div>
  `).join("") || "<p>No items.</p>";
}

function renderCart() {
  waiterCart.innerHTML = state.cart.map((item) => `
    <div class="cart-row ${state.selectedCartKey === item.id ? "selected" : ""}" data-cart-line="${item.id}" role="button" tabindex="0" aria-label="Edit ${esc(item.name)}">
      <div><strong>${esc(item.name)}</strong><br><small>${money(item.price)} x ${item.quantity}</small>${item.notes ? `<br><small class="item-note">Special note: ${esc(item.notes)}</small>` : ''}${item.sentToKitchen ? '<br><small>Sent to kitchen</small>' : ''}</div>
      <div class="qty-controls">
        <button data-dec="${item.id}" ${item.sentToKitchen ? 'disabled' : ''}>-</button>
        <span>${item.quantity}</span>
        <button data-inc="${item.id}" ${item.sentToKitchen ? 'disabled' : ''}>+</button>
        <button data-note-item="${item.id}" ${item.sentToKitchen ? 'disabled' : ''}>Note</button>
      </div>
    </div>
  `).join("") || "<p>No items selected.</p>";
  waiterTotal.textContent = `Total: ${money(state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0))}`;
  mobileCartCount.textContent = String(state.cart.reduce((sum, item) => sum + Number(item.quantity || 0), 0));
  lockStatus.textContent = state.lock ? `Locked until ${state.lock.expires_at}` : "No table locked";
  transferTableButton.disabled = !state.orderId || !state.selectedTable || !state.lock;
}

function renderTransferOptions() {
  const selectedId = Number(state.selectedTable?.id || 0);
  const availableTables = state.tables.filter((table) => Number(table.id) !== selectedId && table.status !== "OCCUPIED" && table.status !== "INACTIVE");
  transferTable.innerHTML = `<option value="">Choose target table</option>` + availableTables.map((table) => (
    `<option value="${table.id}">${esc(table.table_name)} (${esc(table.status)})</option>`
  )).join("");
}

async function selectTable(tableId) {
  const table = state.tables.find((row) => Number(row.id) === Number(tableId));
  if (!table) return;
  const locked = await postJson("/orders/lock", { tableId: table.id });
  state.lock = locked.lock;
  state.selectedTable = table;
  selectedTableTitle.textContent = table.table_name;
  const list = await fetchJson(`/orders/open-list?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(table.id)}`);
  state.openOrders = list.orders || [];
  await loadWaiterOrder(state.openOrders[0]?.id || null);
  renderAll();
  showMobileStep("menu");
}

async function loadWaiterOrder(orderId, options = {}) {
  const fulfillmentType = options.fulfillmentType || "DINE_IN";
  state.orderId = Number(orderId) || null;
  state.customer = null;
  state.cart = [];
  state.billingReady = false;
  state.fulfillmentType = fulfillmentType;
  if (!state.orderId) {
    state.latestUpdatedAt = null;
    return;
  }
  const open = await fetchJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(state.orderId)}`);
  state.latestUpdatedAt = open.order?.updated_at || null;
  state.billingReady = Number(open.order?.billing_ready) === 1;
  state.customer = open.customer || null;
  state.cart = (open.items || [])
    .filter((item) => String(item.fulfillment_type || "DINE_IN").toUpperCase() === fulfillmentType)
    .map((item) => ({ id: item.id, orderItemId: item.order_item_id || null, name: item.name, price: item.price, quantity: item.quantity, notes: item.notes || '', sentToKitchen: Boolean(item.kot_id), fulfillmentType: item.fulfillment_type || "DINE_IN", modifiers: [] }));
}

function addItem(itemId) {
  const item = state.items.find((row) => Number(row.id) === Number(itemId));
  if (!item) return;
  const existing = state.cart.find((row) => Number(row.id) === Number(itemId) && !row.sentToKitchen);
  if (existing) existing.quantity += 1;
  else state.cart.push({ id: item.id, name: item.name, price: item.price, quantity: 1, notes: '', sentToKitchen: false, modifiers: [] });
  state.selectedCartKey = Number(item.id);
  renderCart();
  renderItems();
  renderOrderControls();
}

function decrementMenuItem(itemId) {
  const item = [...state.cart].reverse().find((row) => Number(row.id) === Number(itemId) && !row.sentToKitchen);
  if (!item) return;
  item.quantity -= 1;
  state.cart = state.cart.filter((row) => row.sentToKitchen || row.quantity > 0);
  renderItems();
  renderCart();
  renderOrderControls();
}

async function saveOrder() {
  if (!can("orders.create")) throw new Error("Order creation permission required");
  if (!state.selectedTable || !state.lock) throw new Error("Select and lock a table first");
  if (state.cart.length === 0) throw new Error("Add at least one item");
  const saved = await postJson("/orders/save", {
    orderId: state.orderId,
    tableId: state.selectedTable.id,
    tableName: state.selectedTable.table_name,
    customerId: state.customer?.id || null,
    orderType: state.fulfillmentType,
    linkedFulfillment: state.fulfillmentType === "TAKEAWAY",
    lockId: state.lock.id,
    latestUpdatedAt: state.latestUpdatedAt,
    items: state.cart.map((item) => ({ id: item.id, orderItemId: item.orderItemId || null, quantity: item.quantity, notes: item.notes || '', modifiers: [] }))
  });
  state.orderId = saved.orderId;
  const list = await fetchJson(`/orders/open-list?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(state.selectedTable.id)}`);
  state.openOrders = list.orders || [];
  const open = await fetchJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(state.orderId)}`);
  state.latestUpdatedAt = open.order?.updated_at || null;
  waiterStatus.textContent = `Saved order #${state.orderId}`;
  await loadBootstrap();
}

async function submitKot() {
  if (!state.cart.some((item) => !item.sentToKitchen)) throw new Error("There are no new items to submit");
  submitWaiterKot.disabled = true;
  await saveOrder();
  const result = await postJson("/orders/submit-kot", { orderId: state.orderId, fulfillmentType: state.fulfillmentType });
  await loadWaiterOrder(state.orderId, { fulfillmentType: state.fulfillmentType });
  renderAll();
  showMobileStep("order");
  waiterStatus.textContent = result.message || `KOT submitted for order #${state.orderId}`;
}

async function requestFinalCheck() {
  if (!state.orderId || state.cart.some((item) => !item.sentToKitchen)) await saveOrder();
  finalWaiterCheck.disabled = true;
  const result = await postJson("/orders/final-bill", { orderId: state.orderId });
  state.billingReady = true;
  renderOrderControls();
  waiterStatus.textContent = result.message;
}

function startNewWaiterCheck() {
  state.orderId = null;
  state.customer = null;
  state.cart = [];
  state.latestUpdatedAt = null;
  state.billingReady = false;
  state.fulfillmentType = "DINE_IN";
  renderAll();
  showMobileStep("menu");
}

async function startParcelWaiterCheck() {
  if (!state.selectedTable) throw new Error("Select a table first");
  if (!state.orderId) throw new Error("Save the Dine In check before adding a linked parcel check");
  state.fulfillmentType = "TAKEAWAY";
  state.cart = state.cart.filter((item) => item.fulfillmentType === "TAKEAWAY");
  renderAll();
  showMobileStep("menu");
}

async function searchWaiterCustomerByPhone() {
  const phone = waiterCustomerPhone.value.trim();
  if (!phone) throw new Error("Enter customer phone");
  const result = await fetchJson(`/customers/search?restaurantId=${encodeURIComponent(restaurantId)}&phone=${encodeURIComponent(phone)}`);
  state.customer = result.customer || null;
  renderOrderControls();
  if (!state.customer) waiterCustomerStatus.textContent = "Customer not found. Enter a name and create the customer.";
}

async function createWaiterCustomerFromForm() {
  const name = waiterCustomerName.value.trim();
  const phone = waiterCustomerPhone.value.trim();
  if (!name || !phone) throw new Error("Enter customer name and phone");
  const result = await postJson("/customers/create", { name, phone });
  state.customer = result.customer;
  renderOrderControls();
}

async function transferSelectedTable() {
  if (!can("orders.transfer_table")) throw new Error("Table transfer permission required");
  if (!state.selectedTable || !state.orderId || !state.lock) throw new Error("Select and lock a table with an open order first");
  if (!transferTable.value) throw new Error("Choose a target table");
  const moved = await postJson("/orders/transfer-table", {
    orderId: state.orderId,
    fromTableId: state.selectedTable.id,
    toTableId: transferTable.value,
    lockId: state.lock.id
  });
  waiterStatus.textContent = moved.message || "Table transferred";
  state.selectedTable = null;
  state.lock = null;
  state.cart = [];
  state.orderId = null;
  await loadBootstrap();
}

async function renewLock() {
  if (!state.lock) return;
  try {
    const renewed = await postJson("/orders/lock/renew", { lockId: state.lock.id, tableId: state.selectedTable?.id });
    state.lock = renewed.lock;
    renderCart();
  } catch (err) {
    state.lock = null;
    lockStatus.textContent = err.message;
  }
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  try {
    if (target.dataset.waiterStep) {
      showMobileStep(target.dataset.waiterStep);
      return;
    }
    if (target.dataset.tableId) await selectTable(target.dataset.tableId);
    if (target.dataset.categoryId) {
      state.selectedCategoryId = Number(target.dataset.categoryId);
      renderItems();
    }
    if (target.dataset.addItem) addItem(target.dataset.addItem);
    if (target.dataset.menuDec) decrementMenuItem(target.dataset.menuDec);
    if (target.dataset.noteItem) {
      const item = state.cart.find((row) => Number(row.id) === Number(target.dataset.noteItem));
      if (item && !item.sentToKitchen) {
        const note = prompt(`Special note for ${item.name}`, item.notes || '');
        if (note !== null) item.notes = note.trim();
      }
      renderCart();
    }
    if (target.dataset.inc) {
      const item = state.cart.find((row) => Number(row.id) === Number(target.dataset.inc));
      if (item) item.quantity += 1;
      renderCart();
    }
    if (target.dataset.dec) {
      const item = state.cart.find((row) => Number(row.id) === Number(target.dataset.dec));
      if (item) item.quantity -= 1;
      state.cart = state.cart.filter((row) => row.quantity > 0);
      renderCart();
    }
  } catch (err) {
    waiterStatus.textContent = err.message;
    alert(err.message);
  }
});

waiterCart.addEventListener("click", (event) => {
  if (event.target.closest("button")) return;
  const line = event.target.closest("[data-cart-line]");
  if (!line) return;
  state.selectedCartKey = Number(line.dataset.cartLine);
  renderCart();
});

waiterCart.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const line = event.target.closest("[data-cart-line]");
  if (!line) return;
  event.preventDefault();
  state.selectedCartKey = Number(line.dataset.cartLine);
  renderCart();
});

saveWaiterOrder.addEventListener("click", () => saveOrder().catch((err) => alert(err.message)));
submitWaiterKot.addEventListener("click", () => submitKot().catch((err) => { renderOrderControls(); waiterStatus.textContent = err.message; alert(err.message); }));
finalWaiterCheck.addEventListener("click", () => requestFinalCheck().catch((err) => { finalWaiterCheck.disabled = false; alert(err.message); }));
newWaiterCheck.addEventListener("click", startNewWaiterCheck);
parcelWaiterCheck.addEventListener("click", () => startParcelWaiterCheck().catch((err) => alert(err.message)));
waiterOrderSelector.addEventListener("change", async () => {
  try {
    const orderId = Number(waiterOrderSelector.value || 0);
    if (orderId && state.selectedTable) {
      const locked = await postJson("/orders/lock", { tableId: state.selectedTable.id, orderId });
      state.lock = locked.lock;
    }
    await loadWaiterOrder(orderId);
    renderAll();
    showMobileStep("order");
  } catch (err) {
    waiterStatus.textContent = err.message;
    alert(err.message);
  }
});
searchWaiterCustomer.addEventListener("click", () => searchWaiterCustomerByPhone().catch((err) => alert(err.message)));
createWaiterCustomer.addEventListener("click", () => createWaiterCustomerFromForm().catch((err) => alert(err.message)));
transferTableButton.addEventListener("click", () => transferSelectedTable().catch((err) => alert(err.message)));
unlockWaiterTable.addEventListener("click", async () => {
  if (state.lock) await postJson("/orders/unlock", { lockId: state.lock.id, tableId: state.selectedTable?.id });
  state.lock = null;
  state.selectedTable = null;
  state.cart = [];
  renderAll();
});
refreshWaiter.addEventListener("click", () => loadBootstrap().catch((err) => alert(err.message)));
logoutWaiter.addEventListener("click", () => window.parent.postMessage({ type: "KMASTER_MOBILE_LOGOUT" }, "*"));

loadBootstrap().then(touchDevice).catch((err) => {
  waiterStatus.textContent = err.message;
});
showMobileStep(activeMobileStep);
setInterval(() => loadBootstrap().catch(() => {}), 15000);
setInterval(() => renewLock().catch(() => {}), 30000);
setInterval(() => touchDevice().catch(() => {}), 30000);
