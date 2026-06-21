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
  orderId: null,
  latestUpdatedAt: null,
  lock: null,
  permissions: []
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => Number(value || 0).toFixed(2);
const can = (permission) => state.permissions.includes(permission) || actor.role === "OWNER";
let bootstrapInFlight = false;

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
      <button data-add-item="${item.id}">Add</button>
    </div>
  `).join("") || "<p>No items.</p>";
}

function renderCart() {
  waiterCart.innerHTML = state.cart.map((item) => `
    <div class="cart-row">
      <div><strong>${esc(item.name)}</strong><br><small>${money(item.price)} x ${item.quantity}</small></div>
      <div class="qty-controls">
        <button data-dec="${item.id}">-</button>
        <span>${item.quantity}</span>
        <button data-inc="${item.id}">+</button>
      </div>
    </div>
  `).join("") || "<p>No items selected.</p>";
  waiterTotal.textContent = `Total: ${money(state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0))}`;
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
  const open = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(table.id)}`).then((res) => res.json());
  state.orderId = open.order?.id || null;
  state.latestUpdatedAt = open.order?.updated_at || null;
  state.cart = (open.items || []).map((item) => ({ id: item.id, name: item.name, price: item.price, quantity: item.quantity, modifiers: [] }));
  renderAll();
}

function addItem(itemId) {
  const item = state.items.find((row) => Number(row.id) === Number(itemId));
  if (!item) return;
  const existing = state.cart.find((row) => Number(row.id) === Number(itemId));
  if (existing) existing.quantity += 1;
  else state.cart.push({ id: item.id, name: item.name, price: item.price, quantity: 1, modifiers: [] });
  renderCart();
}

async function saveOrder() {
  if (!can("orders.create")) throw new Error("Order creation permission required");
  if (!state.selectedTable || !state.lock) throw new Error("Select and lock a table first");
  if (state.cart.length === 0) throw new Error("Add at least one item");
  const saved = await postJson("/orders/save", {
    orderId: state.orderId,
    tableId: state.selectedTable.id,
    tableName: state.selectedTable.table_name,
    orderType: "DINE_IN",
    lockId: state.lock.id,
    latestUpdatedAt: state.latestUpdatedAt,
    items: state.cart.map((item) => ({ id: item.id, quantity: item.quantity, modifiers: [] }))
  });
  state.orderId = saved.orderId;
  const open = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(state.selectedTable.id)}`).then((res) => res.json());
  state.latestUpdatedAt = open.order?.updated_at || null;
  waiterStatus.textContent = `Saved order #${state.orderId}`;
  await loadBootstrap();
}

async function submitKot() {
  await saveOrder();
  await postJson("/orders/submit-kot", { orderId: state.orderId });
  waiterStatus.textContent = `KOT submitted for order #${state.orderId}`;
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
    if (target.dataset.tableId) await selectTable(target.dataset.tableId);
    if (target.dataset.categoryId) {
      state.selectedCategoryId = Number(target.dataset.categoryId);
      renderItems();
    }
    if (target.dataset.addItem) addItem(target.dataset.addItem);
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

saveWaiterOrder.addEventListener("click", () => saveOrder().catch((err) => alert(err.message)));
submitWaiterKot.addEventListener("click", () => submitKot().catch((err) => alert(err.message)));
transferTableButton.addEventListener("click", () => transferSelectedTable().catch((err) => alert(err.message)));
unlockWaiterTable.addEventListener("click", async () => {
  if (state.lock) await postJson("/orders/unlock", { lockId: state.lock.id, tableId: state.selectedTable?.id });
  state.lock = null;
  state.selectedTable = null;
  state.cart = [];
  renderAll();
});
refreshWaiter.addEventListener("click", () => loadBootstrap().catch((err) => alert(err.message)));

loadBootstrap().then(touchDevice).catch((err) => {
  waiterStatus.textContent = err.message;
});
setInterval(() => loadBootstrap().catch(() => {}), 15000);
setInterval(() => renewLock().catch(() => {}), 30000);
setInterval(() => touchDevice().catch(() => {}), 30000);
