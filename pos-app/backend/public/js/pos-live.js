const restaurantId = new URLSearchParams(window.location.search).get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

const user = JSON.parse(localStorage.getItem("user") || '{"role":"WAITER"}');
const actor = { id: user.id, role: user.role || "WAITER" };
const state = {
  tables: [],
  categories: [],
  items: [],
  modifierGroups: [],
  modifiers: [],
  combos: [],
  comboItems: [],
  deliveryPartners: [],
  enabledModules: [],
  settings: { currency: "INR", defaultOrderType: "DINE_IN" },
  cart: [],
  selectedTable: null,
  activeTableId: null,
  selectedCategoryId: null,
  selectedCartKey: null,
  orderId: null,
  orderReference: null,
  openOrders: [],
  pendingItem: null,
  pendingSplitItems: [],
  customer: null,
  attendance: null,
  cashSession: null,
  expectedCash: 0,
  dirty: false,
  kotSubmitted: false,
  pendingEditKey: null
};
let tableSelectionRequest = 0;

const amount = (value) => Number(value || 0).toFixed(2);
const isPositiveId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const money = (value) => `${state.settings?.currency || "INR"} ${amount(value)}`;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantId, actor, ...body })
  });
  const data = await res.json();
  if (!res.ok || data.success === false) {
    alert(data.message || "Request failed");
    throw new Error(data.message || "Request failed");
  }
  return data;
}

function isDineIn() {
  return orderType.value === "DINE_IN";
}

function deliveryFeeValue() {
  return orderType.value === "DELIVERY" ? Math.max(Number(deliveryFee.value || 0), 0) : 0;
}

function cartTotal() {
  return state.cart.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0) + deliveryFeeValue();
}

function redeemPointsValue() {
  const requested = Math.max(Number(redeemPoints.value || 0), 0);
  const balance = Number(state.customer?.loyaltyBalance || 0);
  return Math.min(requested, balance, cartTotal() + serviceChargeValue());
}

function serviceChargeValue() {
  if (!state.settings?.serviceChargeEnabled) return 0;
  return Math.max(cartTotal() * Number(state.settings.serviceChargePercent || 0) / 100, 0);
}

function payableAmount() {
  const payable = Math.max(cartTotal() + serviceChargeValue() - redeemPointsValue(), 0);
  return state.settings?.roundOffEnabled ? Math.round(payable) : payable;
}

function applyBootstrap(data) {
  const selectedTableId = state.selectedTable?.id;
  const selectedPartnerId = deliveryPartner.value || "";
  Object.assign(state, {
    tables: data.tables || [],
    categories: data.categories || [],
    items: data.items || [],
    modifierGroups: data.modifierGroups || [],
    modifiers: data.modifiers || [],
    combos: data.combos || [],
    comboItems: data.comboItems || [],
    deliveryPartners: data.deliveryPartners || [],
    enabledModules: data.enabledModules || [],
    settings: data.settings || state.settings
  });
  if (selectedTableId) {
    state.selectedTable = state.tables.find((table) => table.id === selectedTableId) || state.selectedTable;
  }
  if (!state.categories.some((category) => category.id === state.selectedCategoryId)) {
    state.selectedCategoryId = state.categories[0]?.id || null;
  }
  if (window.activeRestaurantName) {
    const restaurantName = state.settings.restaurantName || restaurantId;
    activeRestaurantName.textContent = `${restaurantName} active`;
    document.title = `${restaurantName} POS`;
  }
  if (state.settings.restaurantId && state.settings.restaurantId !== restaurantId) {
    localStorage.setItem("restaurantId", state.settings.restaurantId);
    window.location.replace(`/pos-live.html?restaurantId=${encodeURIComponent(state.settings.restaurantId)}`);
    return;
  }
  deliveryPartner.innerHTML = `<option value="">Delivery partner</option>` + state.deliveryPartners.map((partner) => `<option value="${partner.id}">${esc(partner.name)}</option>`).join("");
  if (selectedPartnerId) deliveryPartner.value = selectedPartnerId;
  if (!state.orderId && data.settings?.defaultOrderType && orderType.value === "DINE_IN") {
    orderType.value = data.settings.defaultOrderType;
  }
}

async function boot() {
  const data = await fetch(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  applyBootstrap(data);
  await refreshShiftCashStatus();
  renderTables();
  renderCategories();
  if (state.selectedCategoryId) renderItems(state.selectedCategoryId);
  updateOrderTypeView();
  const rememberedTableId = Number(localStorage.getItem("posActiveTableId") || 0);
  const remembered = state.tables.find((table) => Number(table.id) === rememberedTableId && table.status === "OCCUPIED");
  const firstOccupied = state.tables.find((table) => table.status === "OCCUPIED");
  if (remembered || firstOccupied) await selectTable((remembered || firstOccupied).id, { skipMovePrompt: true });
}

async function refreshLiveState({ updateCart = false } = {}) {
  if (!restaurantId) return;
  const data = await fetch(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  applyBootstrap(data);
  await refreshShiftCashStatus();
  if (state.selectedTable?.id) await restoreSelectedTableOrder();
  renderTables();
  renderCategories();
  if (state.selectedCategoryId) renderItems(state.selectedCategoryId);
  if (updateCart) renderCart();
}

async function loadOpenOrdersForTable(tableId, selectedOrderId = null) {
  if (!isPositiveId(tableId)) return;
  const data = await fetch(`/orders/open-list?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(tableId)}`).then((res) => res.json());
  state.openOrders = data.orders || [];
  if (selectedOrderId) state.orderId = selectedOrderId;
  else if (!state.orderId || !state.openOrders.some((order) => Number(order.id) === Number(state.orderId))) state.orderId = state.openOrders[0]?.id || null;
  renderOrderSelector();
}

async function restoreSelectedTableOrder() {
  if (!state.selectedTable?.id) return;
  await loadOpenOrdersForTable(state.selectedTable.id);
  const orderId = state.openOrders[0]?.id;
  if (!orderId) {
    state.orderId = null;
    state.orderReference = null;
    state.cart = [];
    state.selectedCartKey = null;
    renderCart();
    return;
  }
  const data = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`).then((res) => res.json());
  if (!data.order || Number(state.activeTableId) !== Number(state.selectedTable.id)) return;
  state.orderId = data.order.id;
  state.orderReference = data.order.order_reference || `${data.order.order_sequence || data.order.id}-${data.order.customer_ref || `A${data.order.id}`}`;
  state.kotSubmitted = (data.items || []).some((item) => item.kot_id);
  state.dirty = false;
  state.customer = data.customer || null;
  customerPhone.value = state.customer?.phone || "";
  customerName.value = state.customer?.name || "";
  state.cart = (data.items || []).map(cartItemFromOrderItem);
  state.selectedCartKey = state.cart[0]?.key || null;
  renderOrderSelector();
  renderCart();
}

async function refreshShiftCashStatus() {
  if (!actor.id) {
    shiftCashStatus.textContent = "Login user missing. Shift controls need a logged-in user.";
    return;
  }
  const [attendanceData, cashData] = await Promise.all([
    fetch(`/attendance/current?restaurantId=${encodeURIComponent(restaurantId)}&userId=${encodeURIComponent(actor.id)}`).then((res) => res.json()).catch(() => ({ attendance: null })),
    fetch(`/cash-register/current?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json()).catch(() => ({ session: null, expectedCash: 0 }))
  ]);
  state.attendance = attendanceData.attendance || null;
  state.cashSession = cashData.session || null;
  state.expectedCash = Number(cashData.expectedCash || 0);
  shiftCashStatus.textContent = `${state.attendance ? "Clocked in" : "Not clocked in"} | Register: ${state.cashSession ? `Open ${money(state.expectedCash)}` : "Closed"}`;
}

async function promptAmount(label) {
  const value = prompt(label);
  if (value === null) return null;
  const amountValue = Number(value);
  if (!Number.isFinite(amountValue) || amountValue < 0) {
    alert("Enter a valid amount");
    return null;
  }
  return amountValue;
}

function cartQuantityForItem(itemId) {
  return state.cart.filter((item) => item.id === itemId && !item.comboId).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function cartQuantityForCombo(comboId) {
  return state.cart.filter((item) => item.comboId === comboId).reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

function refreshCartAndMenu() {
  renderCart();
  if (state.selectedCategoryId) renderItems(state.selectedCategoryId);
}

function renderTables() {
  tablesList.innerHTML = state.tables.map((table) => `
    <button class="table-tile ${state.selectedTable?.id === table.id ? "active" : ""}" data-table="${table.id}">
      <strong>${esc(table.table_name)}</strong><span>${esc(table.status)}</span>
    </button>
  `).join("");
}

function setSelectedTableStatus(status) {
  if (!state.selectedTable?.id) return;
  state.tables = state.tables.map((table) => table.id === state.selectedTable.id ? { ...table, status } : table);
  state.selectedTable = state.tables.find((table) => table.id === state.selectedTable.id) || state.selectedTable;
  renderTables();
}

function renderOrderSelector() {
  const current = state.openOrders.find((order) => Number(order.id) === Number(state.orderId)) || state.openOrders[0] || null;
  if (!current && state.orderId) {
    orderSelector.innerHTML = `<option value="${state.orderId}" selected>Current check #${state.orderId}</option>`;
    return;
  }
  orderSelector.innerHTML = [
    `<option value="${current?.id || ""}">${current ? `Order ${current.order_reference || current.id}` : "Current check"}</option>`,
    ...state.openOrders.filter((order) => Number(order.id) !== Number(current?.id)).map((order) => `<option value="${order.id}">Order ${order.order_reference || order.id} - ${money(order.total_amount)}</option>`)
  ].join("");
  if (current) orderSelector.value = String(current.id);
}

function renderCategories() {
  categories.innerHTML = state.categories.map((category) => `
    <button class="${state.selectedCategoryId === category.id ? "active" : ""}" data-category="${category.id}">
      ${esc(category.name)}
    </button>
  `).join("");
}

function renderItems(categoryId) {
  const itemTiles = state.items.filter((item) => item.category_id === categoryId).map((item) => {
    const quantity = state.activeTableId ? cartQuantityForItem(item.id) : 0;
    return `
      <button class="item-tile ${quantity > 0 ? "selected" : ""}" data-item="${item.id}">
        <strong>${esc(item.name)}</strong>
        <span>${money(item.price)}</span>
        ${quantity > 0 ? `<span class="tile-quantity-controls"><span data-item-minus="${item.id}" role="button">-</span><em>${quantity}</em><span data-item-plus="${item.id}" role="button">+</span></span>` : ""}
      </button>
    `;
  }).join("");
  const comboTiles = state.combos.map((combo) => {
    const quantity = state.activeTableId ? cartQuantityForCombo(combo.id) : 0;
    return `
      <button class="item-tile combo-tile ${quantity > 0 ? "selected" : ""}" data-combo="${combo.id}">
        <strong>${esc(combo.name)}</strong>
        <span>${money(combo.price)}</span>
        ${quantity > 0 ? `<em>${quantity}</em>` : ""}
      </button>
    `;
  }).join("");
  items.innerHTML = itemTiles + comboTiles;
}

function renderCart() {
  cartTitle.textContent = isDineIn() ? (state.selectedTable ? state.selectedTable.table_name : "Select a table") : orderType.options[orderType.selectedIndex].text;
  orderMeta.textContent = state.orderId ? `Order ${state.orderReference || state.orderId}` : "New order";
  cartItems.innerHTML = state.cart.map((item) => `
    <div class="cart-line ${state.selectedCartKey === item.key ? "selected" : ""}" data-cart-line="${item.key}" role="button" tabindex="0" aria-label="Edit ${esc(item.name)}">
      <div>
        <strong>${esc(item.name)}</strong>
        <span>${money(item.price)}</span>
        ${item.sentToKitchen ? "<small>Sent to kitchen</small>" : ""}
        ${(item.modifiers || []).map((modifier) => `<small>+ ${esc(modifier.name)}</small>`).join("")}
      </div>
      <div class="qty-controls">
        <button data-minus="${item.key}" ${item.sentToKitchen ? "disabled" : ""}>-</button>
        <span>${item.quantity}</span>
        <button data-plus="${item.key}" ${item.sentToKitchen ? "disabled" : ""}>+</button>
        <button data-remove="${item.key}" ${item.sentToKitchen ? "disabled" : ""}>Remove</button>
      </div>
    </div>
  `).join("");
  total.textContent = `Total: ${money(cartTotal())}`;
  customerSummary.textContent = state.customer ? `${state.customer.name} - ${state.customer.phone} - ${state.customer.loyaltyBalance || 0} pts` : "No customer attached";
  redeemPoints.max = state.customer?.loyaltyBalance || 0;
  payableTotal.textContent = `Payable: ${money(payableAmount())}`;
  moveTableBtn.disabled = !isDineIn() || !state.selectedTable || !state.orderId;
  // A new order has no ID until it is saved, so it must still be possible to send its first KOT.
  submitKot.disabled = !(state.cart.length > 0 && (!state.orderId || state.dirty));
  submitKot.title = submitKot.disabled ? "Submit KOT only after the order changes" : "";
  if (paymentMode.value !== "SPLIT") {
    cashAmount.value = paymentMode.value === "CASH" ? amount(payableAmount()) : "";
    cardAmount.value = paymentMode.value === "CARD" ? amount(payableAmount()) : "";
    upiAmount.value = paymentMode.value === "UPI" ? amount(payableAmount()) : "";
  }
}

function cartItemFromOrderItem(item) {
  return {
    id: item.id,
    orderItemId: item.order_item_id,
    key: `open-${item.order_item_id}`,
    comboId: item.comboId || item.combo_id || null,
    name: item.comboId || item.combo_id ? item.name : item.combo_name ? `${item.combo_name}: ${item.name}` : item.name,
    price: item.price,
    quantity: item.quantity,
    modifiers: item.modifiers || [],
    sentToKitchen: Boolean(item.kot_id)
  };
}

function updateOrderTypeView() {
  deliveryFields.hidden = orderType.value !== "DELIVERY";
  if (!isDineIn()) state.selectedTable = null;
  renderTables();
  refreshCartAndMenu();
}

async function selectTable(tableId, options = {}) {
  const requestId = ++tableSelectionRequest;
  state.activeTableId = Number(tableId);
  localStorage.setItem("posActiveTableId", String(tableId));
  if (!isDineIn()) orderType.value = "DINE_IN";
  state.customer = null;
  customerPhone.value = "";
  customerName.value = "";
  state.selectedTable = state.tables.find((table) => table.id === tableId);
  state.cart = [];
  state.selectedCartKey = null;
  state.orderId = null;
  state.orderReference = null;
  state.dirty = false;
  state.kotSubmitted = false;
  refreshCartAndMenu();
  renderTables();
  await loadOpenOrdersForTable(tableId);
  const selectedOpenOrder = state.openOrders.find((order) => Number(order.id) === Number(state.orderId)) || state.openOrders[state.openOrders.length - 1];
  const orderQuery = selectedOpenOrder?.id
    ? `orderId=${encodeURIComponent(selectedOpenOrder.id)}`
    : `tableId=${encodeURIComponent(tableId)}`;
  const data = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&${orderQuery}`).then((res) => res.json());
  if (requestId !== tableSelectionRequest) return;
  if (data.order) {
    state.orderId = data.order.id;
    state.orderReference = data.order.order_reference || `${data.order.order_sequence || data.order.id}-${data.order.customer_ref || `A${data.order.id}`}`;
    state.kotSubmitted = (data.items || []).some((item) => item.kot_id);
    state.dirty = false;
    state.customer = data.customer || null;
    customerPhone.value = state.customer?.phone || "";
    customerName.value = state.customer?.name || "";
    state.cart = (data.items || []).map(cartItemFromOrderItem);
    state.selectedCartKey = state.cart[0]?.key || null;
  }
  if (requestId !== tableSelectionRequest || state.activeTableId !== Number(tableId)) return;
  updateOrderTypeView();
  renderOrderSelector();
  renderCart();
}

function itemGroups(itemId) {
  return state.modifierGroups
    .filter((group) => group.item_id === itemId)
    .map((group) => ({ ...group, modifiers: state.modifiers.filter((modifier) => modifier.group_id === group.id) }));
}

function selectedModifiersFromModal() {
  return [...modifierGroups.querySelectorAll("input[type='checkbox']:checked")].map((input) => Number(input.value));
}

function modalUnitPrice() {
  const base = Number(state.pendingItem?.price || 0);
  return base + selectedModifiersFromModal().reduce((sum, id) => {
    const modifier = state.modifiers.find((row) => row.id === id);
    return sum + Number(modifier?.price_delta || 0);
  }, 0);
}

function validateModal(groups) {
  for (const group of groups) {
    const count = [...modifierGroups.querySelectorAll(`input[data-group="${group.id}"]:checked`)].length;
    if (group.required && count < Number(group.min_select || 1)) return `${group.name} is required`;
    if (count < Number(group.min_select || 0)) return `${group.name} needs at least ${group.min_select} selection(s)`;
    if (Number(group.max_select || 0) > 0 && count > Number(group.max_select)) return `${group.name} allows only ${group.max_select} selection(s)`;
  }
  return "";
}

function openModifierModal(itemId) {
  if (isDineIn() && !state.selectedTable) return alert("Select a table first");
  const menuItem = state.items.find((item) => item.id === itemId);
  if (!menuItem) return;
  state.pendingEditKey = null;
  const groups = itemGroups(itemId);
  if (groups.length === 0) return addItemToCart(menuItem, []);
  state.pendingItem = menuItem;
  modifierModalTitle.textContent = menuItem.name;
  modifierGroups.innerHTML = groups.map((group) => `
    <section class="modifier-group" data-group-section="${group.id}">
      <h3>${esc(group.name)} ${group.required ? "*" : ""}</h3>
      <p>${group.min_select || 0} min, ${group.max_select || 0} max</p>
      ${group.modifiers.map((modifier) => `
        <label class="check-row"><input type="checkbox" value="${modifier.id}" data-group="${group.id}"> ${esc(modifier.name)} <span>${money(modifier.price_delta)}</span></label>
      `).join("")}
    </section>
  `).join("");
  modifierModalPrice.textContent = money(modalUnitPrice());
  modifierModal.hidden = false;
}

function prefillModifierModal(modifiers = []) {
  const modifierIds = new Set((modifiers || []).map((modifier) => Number(modifier.id)));
  modifierGroups.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.checked = modifierIds.has(Number(input.value));
  });
  modifierModalPrice.textContent = money(modalUnitPrice());
}

function openEditSelectedItem() {
  const line = state.cart.find((item) => item.key === state.selectedCartKey);
  if (!line) return alert("Select an item in the bill first");
  if (line.sentToKitchen) return alert("This item has already been sent to the kitchen. Add a new item for an additional KOT, or cancel it from KDS.");
  if (line.comboId) return alert("Combo items cannot be edited. Remove and add again.");
  const menuItem = state.items.find((item) => item.id === line.id);
  if (!menuItem) return alert("Selected item is no longer available");
  const groups = itemGroups(menuItem.id);
  if (groups.length === 0) {
    const quantity = Number(prompt(`Quantity for ${menuItem.name}`, String(line.quantity)));
    if (!Number.isInteger(quantity) || quantity < 1) return alert("Enter a whole quantity of 1 or more");
    line.quantity = quantity;
    state.dirty = true;
    refreshCartAndMenu();
    return;
  }
  state.pendingItem = menuItem;
  state.pendingEditKey = line.key;
  modifierModalTitle.textContent = `Edit ${menuItem.name}`;
  modifierGroups.innerHTML = groups.map((group) => `
    <section class="modifier-group" data-group-section="${group.id}">
      <h3>${esc(group.name)} ${group.required ? "*" : ""}</h3>
      <p>${group.min_select || 0} min, ${group.max_select || 0} max</p>
      ${group.modifiers.map((modifier) => `
        <label class="check-row"><input type="checkbox" value="${modifier.id}" data-group="${group.id}"> ${esc(modifier.name)} <span>${money(modifier.price_delta)}</span></label>
      `).join("")}
    </section>
  `).join("");
  prefillModifierModal(line.modifiers || []);
  modifierModal.hidden = false;
}

function addItemToCart(menuItem, modifiers) {
  const modifierIds = modifiers.map((modifier) => modifier.id).sort((a, b) => a - b);
  const key = `item-${menuItem.id}-${modifierIds.join(".") || "none"}`;
  const unitPrice = Number(menuItem.price || 0) + modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta || 0), 0);
  const line = state.cart.find((item) => item.key === key);
  if (line) line.quantity += 1;
  else state.cart.push({ ...menuItem, key, price: unitPrice, quantity: 1, modifiers });
  state.selectedCartKey = key;
  state.dirty = true;
  refreshCartAndMenu();
}

async function moveOrderToTable(targetTableId) {
  if (!state.orderId || !state.selectedTable) return alert("Select a table order first");
  const data = await postJson("/orders/transfer-table", {
    orderId: state.orderId,
    fromTableId: state.selectedTable.id,
    toTableId: targetTableId
  });
  await selectTable(data.table?.id || targetTableId, { skipMovePrompt: true });
}

function openSplitBillModal() {
  if (!state.orderId) return alert("Save the table order first");
  if (state.cart.length === 0) return alert("There are no items to split");
  splitCustomerName.value = "";
  splitCustomerPhone.value = "";
  splitBillItems.innerHTML = state.cart.map((item) => `
    <label class="check-row">
      <input type="checkbox" value="${item.key}" checked>
      ${esc(item.name)} x${item.quantity}
      <span>${money(item.price * item.quantity)}</span>
    </label>
  `).join("");
  splitBillModal.hidden = false;
}

function addCombo(comboId) {
  if (isDineIn() && !state.selectedTable) return alert("Select a table first");
  const combo = state.combos.find((row) => row.id === comboId);
  if (!combo) return;
  const key = `combo-${combo.id}`;
  const included = state.comboItems.filter((item) => item.combo_id === combo.id).map((item) => `${item.item_name} x${item.quantity}`).join(", ");
  const line = state.cart.find((item) => item.key === key);
  if (line) line.quantity += 1;
  else state.cart.push({ key, comboId: combo.id, name: combo.name, price: combo.price, quantity: 1, modifiers: included ? [{ name: included, id: 0 }] : [] });
  state.selectedCartKey = key;
  state.dirty = true;
  refreshCartAndMenu();
}

async function saveCurrentOrder(force = false) {
  if (isDineIn() && !state.selectedTable) return alert("Select a table and add items");
  if (state.cart.length === 0) return alert("Add items first");
  if (state.orderId && !state.dirty && !force) return true;
  if (orderType.value === "DELIVERY" && (!deliveryPhone.value.trim() || !deliveryAddress.value.trim())) return alert("Enter delivery phone and address");
  const data = await postJson("/orders/save", {
    orderId: state.orderId,
    orderType: orderType.value,
    tableId: state.selectedTable?.id || null,
    tableName: state.selectedTable?.table_name || null,
    customerId: state.customer?.id || null,
    deliveryAddress: deliveryAddress.value,
    deliveryPhone: deliveryPhone.value || customerPhone.value,
    deliveryFee: deliveryFeeValue(),
    deliveryPartnerId: deliveryPartner.value || null,
    expectedDeliveryTime: expectedDeliveryTime.value || null,
    items: state.cart.map((item) => item.comboId
      ? ({ orderItemId: item.orderItemId || null, comboId: item.comboId, quantity: item.quantity })
      : ({ orderItemId: item.orderItemId || null, itemId: item.id, quantity: item.quantity, modifiers: (item.modifiers || []).filter((modifier) => modifier.id).map((modifier) => modifier.id) }))
  });
  state.orderId = data.orderId;
  state.orderReference = data.orderReference || state.orderReference || data.orderId;
  state.dirty = false;
  setSelectedTableStatus("OCCUPIED");
  orderMeta.textContent = `Order ${state.orderReference}`;
  await refreshLiveState();
  return true;
}

async function submitCurrentKot() {
  const submittedItems = state.cart.filter((item) => item.sentToKitchen);
  const newItems = state.cart.filter((item) => !item.sentToKitchen);
  const summary = [
    `Order ${state.orderReference || state.orderId || "new"}`,
    "",
    "Already submitted:",
    ...(submittedItems.length ? submittedItems.map((item) => `${item.quantity} x ${item.name}`) : ["None"]),
    "",
    "New in this KOT:",
    ...(newItems.length ? newItems.map((item) => `${item.quantity} x ${item.name}`) : ["None"])
  ].join("\n");
  if (!newItems.length) return alert(`${summary}\n\nThere are no new items to submit.`);
  if (!confirm(`${summary}\n\nSubmit this KOT?`)) return;
  const saved = await saveCurrentOrder();
  if (!saved) return;
  const data = await postJson("/orders/submit-kot", { orderId: state.orderId });
  if (data.success) {
    state.kotSubmitted = true;
    state.dirty = false;
    state.cart.forEach((item) => { item.sentToKitchen = true; });
    kotStatus.textContent = data.message || "KOT submitted";
    kotStatus.className = "success-message";
    submitKot.title = data.kotReference ? `Last KOT: ${data.kotReference}` : "KOT submitted";
    refreshCartAndMenu();
  }
  alert(data.message || "KOT submitted");
}

async function settleCurrentOrder() {
  const settledTableId = state.selectedTable?.id || null;
  const wasSubmittedAndEdited = state.kotSubmitted && state.dirty;
  const saved = await saveCurrentOrder();
  if (!saved) return;
  if (wasSubmittedAndEdited) {
    await postJson("/orders/submit-kot", { orderId: state.orderId });
    state.kotSubmitted = true;
  }
  const payments = [];
  if (Number(cashAmount.value) > 0) payments.push({ method: "CASH", amount: Number(cashAmount.value) });
  if (Number(cardAmount.value) > 0) payments.push({ method: "CARD", amount: Number(cardAmount.value) });
  if (Number(upiAmount.value) > 0) payments.push({ method: "UPI", amount: Number(upiAmount.value) });
  const data = await postJson("/orders/settle", { orderId: state.orderId, customerId: state.customer?.id || null, redeemPoints: Math.floor(redeemPointsValue()), payments });
  alert(`Invoice ${data.invoiceNo}`);
  state.cart = [];
  state.selectedCartKey = null;
  state.orderId = null;
  state.orderReference = null;
  state.customer = null;
  state.dirty = false;
  state.kotSubmitted = false;
  setSelectedTableStatus("AVAILABLE");
  customerPhone.value = "";
  customerName.value = "";
  deliveryAddress.value = "";
  deliveryPhone.value = "";
  deliveryFee.value = "";
  redeemPoints.value = 0;
  if (settledTableId) {
    await selectTable(settledTableId, { skipMovePrompt: true });
  } else {
    await refreshLiveState({ updateCart: true });
    refreshCartAndMenu();
  }
}

async function searchCustomerByPhone() {
  if (!customerPhone.value.trim()) return alert("Enter customer phone");
  const data = await fetch(`/customers/search?restaurantId=${encodeURIComponent(restaurantId)}&phone=${encodeURIComponent(customerPhone.value.trim())}`).then((res) => res.json());
  if (!data.success) return alert(data.message);
  state.customer = data.customer;
  if (!state.customer) {
    customerSummary.textContent = "Customer not found";
    return;
  }
  customerName.value = state.customer.name;
  deliveryPhone.value ||= state.customer.phone || "";
  renderCart();
}

async function createCustomerFromBilling() {
  if (!customerPhone.value.trim() || !customerName.value.trim()) return alert("Enter customer name and phone");
  const data = await postJson("/customers/create", { name: customerName.value, phone: customerPhone.value });
  state.customer = data.customer;
  deliveryPhone.value ||= state.customer.phone || "";
  renderCart();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.table) await selectTable(Number(target.dataset.table));
  if (target.dataset.category) {
    state.selectedCategoryId = Number(target.dataset.category);
    renderCategories();
    renderItems(state.selectedCategoryId);
  }
  if (target.dataset.item) openModifierModal(Number(target.dataset.item));
  if (target.dataset.combo) addCombo(Number(target.dataset.combo));
  if (target.dataset.plus) {
    const line = state.cart.find((item) => item.key === target.dataset.plus);
    if (line && !line.sentToKitchen) {
      line.quantity += 1;
      state.selectedCartKey = line.key;
      state.dirty = true;
    }
  }
  if (target.dataset.minus) {
    const line = state.cart.find((item) => item.key === target.dataset.minus);
    if (line && !line.sentToKitchen) {
      line.quantity -= 1;
      state.selectedCartKey = line.key;
      state.dirty = true;
    }
  }
  if (target.dataset.remove) {
    const line = state.cart.find((item) => item.key === target.dataset.remove);
    if (line?.sentToKitchen) return alert("This item has already been sent to the kitchen. Cancel it from KDS instead.");
    state.cart = state.cart.filter((item) => item.key !== target.dataset.remove);
    if (state.selectedCartKey === target.dataset.remove) state.selectedCartKey = state.cart[0]?.key || null;
    state.dirty = true;
  }
  state.cart = state.cart.filter((item) => item.quantity > 0);
  if (!state.cart.some((item) => item.key === state.selectedCartKey)) state.selectedCartKey = state.cart[0]?.key || null;
  refreshCartAndMenu();
});

cartItems.addEventListener("click", (event) => {
  const line = event.target.closest("[data-cart-line]");
  if (!line) return;
  if (event.target.closest("button")) return;
  state.selectedCartKey = line.dataset.cartLine;
  renderCart();
  openEditSelectedItem();
});

items.addEventListener("click", (event) => {
  const target = event.target.closest("[data-item-plus], [data-item-minus]");
  if (!target) return;
  event.preventDefault();
  event.stopPropagation();
  const itemId = Number(target.dataset.itemPlus || target.dataset.itemMinus);
  const line = state.cart.find((item) => Number(item.id) === itemId && !item.comboId);
  if (!line || line.sentToKitchen) return;
  if (target.dataset.itemPlus) line.quantity += 1;
  else line.quantity -= 1;
  state.selectedCartKey = line.key;
  state.dirty = true;
  state.cart = state.cart.filter((item) => Number(item.quantity) > 0);
  refreshCartAndMenu();
});

cartItems.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const line = event.target.closest("[data-cart-line]");
  if (!line) return;
  event.preventDefault();
  state.selectedCartKey = line.dataset.cartLine;
  renderCart();
  openEditSelectedItem();
});

modifierGroups.addEventListener("change", (event) => {
  const input = event.target;
  if (input.type !== "checkbox" || !input.checked) return;
  const group = state.modifierGroups.find((row) => row.id === Number(input.dataset.group));
  const checked = [...modifierGroups.querySelectorAll(`input[data-group="${group.id}"]:checked`)];
  if (Number(group.max_select || 0) > 0 && checked.length > Number(group.max_select)) {
    input.checked = false;
    alert(`${group.name} allows only ${group.max_select} selection(s)`);
  }
  modifierModalPrice.textContent = money(modalUnitPrice());
});

closeModifierModal.addEventListener("click", () => {
  modifierModal.hidden = true;
  state.pendingItem = null;
});

addModifiedItem.addEventListener("click", () => {
  if (!state.pendingItem) return;
  const groups = itemGroups(state.pendingItem.id);
  const error = validateModal(groups);
  if (error) return alert(error);
  const modifierIds = selectedModifiersFromModal();
  const modifiers = modifierIds.map((id) => state.modifiers.find((modifier) => modifier.id === id)).filter(Boolean);
  if (state.pendingEditKey) {
    const existing = state.cart.find((item) => item.key === state.pendingEditKey);
    if (existing) {
      state.cart = state.cart.filter((item) => item.key !== state.pendingEditKey);
      const replacement = { ...existing, ...state.pendingItem, modifiers: modifiers.slice() };
      replacement.price = Number(state.pendingItem.price || 0) + modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta || 0), 0);
      replacement.quantity = existing.quantity;
      const modifierIdsSorted = modifiers.map((modifier) => modifier.id).sort((a, b) => a - b);
      replacement.key = `item-${state.pendingItem.id}-${modifierIdsSorted.join(".") || "none"}`;
      state.cart.push(replacement);
      state.selectedCartKey = replacement.key;
      state.dirty = true;
      refreshCartAndMenu();
    }
  } else {
    addItemToCart(state.pendingItem, modifiers);
  }
  modifierModal.hidden = true;
  state.pendingItem = null;
  state.pendingEditKey = null;
});

paymentMode.addEventListener("change", renderCart);
redeemPoints.addEventListener("input", renderCart);
orderType.addEventListener("change", updateOrderTypeView);
deliveryFee.addEventListener("input", renderCart);
orderSelector.addEventListener("change", async () => {
  if (!state.selectedTable || !orderSelector.value) return;
  const orderId = Number(orderSelector.value);
  const data = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`).then((res) => res.json());
  if (!data.order) return;
  state.orderId = data.order.id;
  state.customer = data.customer || null;
  customerPhone.value = state.customer?.phone || "";
  customerName.value = state.customer?.name || "";
  state.cart = (data.items || []).map(cartItemFromOrderItem);
  state.selectedCartKey = state.cart[0]?.key || null;
  renderCart();
});
searchCustomer.addEventListener("click", searchCustomerByPhone);
createCustomer.addEventListener("click", createCustomerFromBilling);
saveOrder.addEventListener("click", () => saveCurrentOrder());
submitKot.addEventListener("click", submitCurrentKot);
settleOrder.addEventListener("click", settleCurrentOrder);
moveTableBtn.addEventListener("click", async () => {
  if (!isDineIn() || !state.selectedTable) return alert("Select a dine-in table first");
  const targetTableName = prompt("Enter the table number/name to move to");
  if (!targetTableName) return;
  const targetTable = state.tables.find((table) => table.table_name.toLowerCase() === targetTableName.trim().toLowerCase());
  if (!targetTable) return alert("Target table not found");
  await moveOrderToTable(targetTable.id);
});
splitBillBtn.addEventListener("click", openSplitBillModal);
closeSplitBillModal.addEventListener("click", () => {
  splitBillModal.hidden = true;
});
createSplitCheckBtn.addEventListener("click", async () => {
  const selectedKeys = [...splitBillItems.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
  if (selectedKeys.length === 0) return alert("Select at least one item");
  const data = await postJson("/orders/split-check", {
    orderId: state.orderId,
    itemKeys: selectedKeys,
    checkName: prompt("Split check name") || "",
    customerName: splitCustomerName.value.trim(),
    customerPhone: splitCustomerPhone.value.trim()
  });
  splitBillModal.hidden = true;
  await loadOpenOrdersForTable(state.selectedTable.id, data.orderId);
  const latest = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(data.orderId)}`).then((res) => res.json());
  if (latest.order) {
    state.orderId = latest.order.id;
    state.orderReference = latest.order.order_reference || `${latest.order.order_sequence || latest.order.id}-${latest.order.customer_ref || `A${latest.order.id}`}`;
    state.cart = (latest.items || []).map(cartItemFromOrderItem);
    state.selectedCartKey = state.cart[0]?.key || null;
    renderCart();
  }
});
clockInBtn.addEventListener("click", async () => {
  await postJson("/attendance/clock-in", { userId: actor.id, openingNote: prompt("Opening note") || "" });
  await refreshShiftCashStatus();
});
clockOutBtn.addEventListener("click", async () => {
  await postJson("/attendance/clock-out", { userId: actor.id, closingNote: prompt("Closing note") || "" });
  await refreshShiftCashStatus();
});
openRegisterBtn.addEventListener("click", async () => {
  const openingCash = await promptAmount("Opening cash");
  if (openingCash === null) return;
  await postJson("/cash-register/open", { openingCash, note: prompt("Opening note") || "" });
  await refreshShiftCashStatus();
});
closeRegisterBtn.addEventListener("click", async () => {
  const closingCash = await promptAmount("Counted closing cash");
  if (closingCash === null) return;
  const data = await postJson("/cash-register/close", { closingCash, note: prompt("Closing note") || "" });
  alert(`Register closed. Difference: ${money(data.cashDifference)}`);
  await refreshShiftCashStatus();
});
cashInBtn.addEventListener("click", async () => {
  const amountValue = await promptAmount("Cash in amount");
  if (amountValue === null) return;
  await postJson("/cash-register/movement", { type: "CASH_IN", amount: amountValue, reason: prompt("Reason") || "" });
  await refreshShiftCashStatus();
});
cashOutBtn.addEventListener("click", async () => {
  const amountValue = await promptAmount("Cash out amount");
  if (amountValue === null) return;
  await postJson("/cash-register/movement", { type: "CASH_OUT", amount: amountValue, reason: prompt("Reason") || "" });
  await refreshShiftCashStatus();
});
cancelOrder.addEventListener("click", async () => {
  if (!state.orderId || !confirm("Cancel this order?")) return;
  await postJson("/orders/cancel", { orderId: state.orderId });
  state.cart = [];
  state.selectedCartKey = null;
  state.orderId = null;
  state.orderReference = null;
  state.dirty = false;
  state.kotSubmitted = false;
  await refreshLiveState({ updateCart: true });
  refreshCartAndMenu();
});

boot().then(renderCart).catch((err) => alert(err.message));
setInterval(() => refreshLiveState().catch(() => {}), 5000);
window.addEventListener("focus", () => refreshLiveState().catch(() => {}));
