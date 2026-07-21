const sessionUser = JSON.parse(localStorage.getItem("user") || "null");
const POS_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
let posLastActivityAt = Date.now();
const markPosActivity = () => { posLastActivityAt = Date.now(); };
['click', 'keydown', 'pointermove', 'touchstart'].forEach((name) => window.addEventListener(name, markPosActivity, { passive: true }));
setInterval(() => {
  if (Date.now() - posLastActivityAt < POS_IDLE_TIMEOUT_MS) return;
  localStorage.clear();
  window.location.replace('/login.html?reason=timeout');
}, 30 * 1000);
const role = String(sessionUser?.role || "").toUpperCase();
const allowedPosRoles = new Set(["OWNER", "MANAGER_1", "MANAGER_2", "CASHIER", "CAPTAIN", "WAITER"]);
if (!sessionUser || !allowedPosRoles.has(role)) {
  window.location.replace(`/login.html?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  throw new Error("POS login required");
}
const actor = { id: sessionUser.id, role };
const modeParam = String(new URLSearchParams(window.location.search).get("mode") || "DINE_IN").toUpperCase();
const posMode = ["DINE_IN", "PARCEL", "PARTY"].includes(modeParam) ? modeParam : "DINE_IN";
const cashierDineLayout = posMode === "DINE_IN" && new URLSearchParams(window.location.search).get("layout") === "cashier";
const requestedTableId = Number(new URLSearchParams(window.location.search).get("tableId") || 0);
const restaurantId = new URLSearchParams(window.location.search).get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

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
  orderDetailsCache: new Map(),
  pendingItem: null,
  pendingSplitItems: [],
  customer: null,
  discountAmount: 0,
  serverOrderTotal: null,
  attendance: null,
  cashSession: null,
  expectedCash: 0,
  dirty: false,
  kotSubmitted: false,
  billingReady: false,
  pendingEditKey: null
  ,reviewBaselineQuantities: {}
  ,parcelTableId: null
  ,parcelDraftItem: null
  ,parcelSuggestionIndex: -1
  ,pendingParcelDraft: null
};
let tableSelectionRequest = 0;

const amount = (value) => Number(value || 0).toFixed(2);
const isPositiveId = (value) => Number.isInteger(Number(value)) && Number(value) > 0;
const money = (value) => `${state.settings?.currency || "INR"} ${amount(value)}`;
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const itemSearch = document.getElementById("itemSearch");
const posToast = document.getElementById("posToast");
const availabilityBtn = document.getElementById("availabilityBtn");
const settlementType = document.getElementById("settlementType");
const paymentAmount = document.getElementById("paymentAmount");
const settlePrintOrder = document.getElementById("settlePrintOrder");
const finalBillPrintOrder = document.getElementById("finalBillPrintOrder");
const itemNoteEditor = document.getElementById("itemNoteEditor");
const itemNoteTitle = document.getElementById("itemNoteTitle");
const itemNoteHelp = document.getElementById("itemNoteHelp");
const itemNoteInput = document.getElementById("itemNoteInput");
const editItemOptions = document.getElementById("editItemOptions");
const selectedItemMinus = document.getElementById("selectedItemMinus");
const selectedItemPlus = document.getElementById("selectedItemPlus");
const selectedItemQuantity = document.getElementById("selectedItemQuantity");
const removeSelectedItem = document.getElementById("removeSelectedItem");
const parcelItemEntry = document.getElementById("parcelItemEntry");
const parcelItemSearchSlot = document.getElementById("parcelItemSearchSlot");
const parcelItemSuggestionsSlot = document.getElementById("parcelItemSuggestionsSlot");
const parcelItemNote = document.getElementById("parcelItemNote");
const parcelItemQuantity = document.getElementById("parcelItemQuantity");
const addParcelItem = document.getElementById("addParcelItem");
const posConfirmModal = document.getElementById("posConfirmModal");
const posConfirmTitle = document.getElementById("posConfirmTitle");
const posConfirmMessage = document.getElementById("posConfirmMessage");
const posConfirmInput = document.getElementById("posConfirmInput");
const cancelPosConfirm = document.getElementById("cancelPosConfirm");
const acceptPosConfirm = document.getElementById("acceptPosConfirm");
let posToastTimer;
const displayItemCode = (item) => String(item.item_code || String(item.id).padStart(4, "0")).replace(/^ITM[-\s]*/i, "");

// Keep validation and completion messages inside the POS window so a native
// blocking dialog cannot leave the Electron renderer with stale focus.
function alert(message) {
  if (!posToast) return;
  posToast.textContent = String(message || "");
  posToast.hidden = false;
  clearTimeout(posToastTimer);
  posToastTimer = setTimeout(() => { posToast.hidden = true; }, 4200);
}

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
  return posMode === "DINE_IN" && orderType.value === "DINE_IN";
}

function applyRoleAndModeUI() {
  const modeTitle = document.getElementById("posModeTitle");
  const labels = { DINE_IN: "POS Dine In", PARCEL: "POS Parcel", PARTY: "POS Party Order" };
  if (modeTitle) modeTitle.textContent = labels[posMode];
  document.title = labels[posMode];
  document.querySelectorAll("[data-pos-mode]").forEach((link) => {
    const mode = link.dataset.posMode;
    link.classList.toggle("active", mode === posMode);
    link.hidden = !["CASHIER", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role) && mode !== "DINE_IN";
  });
  const canBilling = ["CASHIER", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role);
  const canMove = ["CAPTAIN", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role) && posMode === "DINE_IN";
  const canSettle = ["CAPTAIN", "CASHIER", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role);
  const canSettleAndPrint = ["CASHIER", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role);
  document.querySelectorAll('[data-role-nav="billing"]').forEach((el) => { el.hidden = !canBilling; });
  document.querySelectorAll('[data-role-nav="invoices"]').forEach((el) => { el.hidden = !canBilling; });
  document.querySelectorAll('[data-role-nav="admin"]').forEach((el) => { el.hidden = !["OWNER", "MANAGER_1", "MANAGER_2"].includes(role); });
  document.querySelectorAll('[data-role-nav="availability"]').forEach((el) => { el.hidden = !["OWNER", "MANAGER_1", "MANAGER_2", "CASHIER", "CAPTAIN"].includes(role); });
  document.querySelectorAll('[data-role-nav="kds"]').forEach((el) => { el.hidden = role !== "OWNER" && role !== "MANAGER_2" && role !== "KITCHEN"; });
  document.querySelectorAll('[data-role-nav="availability"]').forEach((el) => { el.hidden = !["CAPTAIN", "CASHIER", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role); });
  document.querySelectorAll('[data-role-nav="live-orders"]').forEach((el) => { el.hidden = !["CASHIER", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role); });
  document.querySelectorAll('[data-role-nav="qr-notifications"]').forEach((el) => { el.hidden = !["CAPTAIN", "CASHIER", "WAITER", "MANAGER_1", "MANAGER_2", "OWNER"].includes(role); });
  if (moveTableBtn) moveTableBtn.hidden = !canMove;
  if (settleOrder) settleOrder.hidden = !canSettle;
  if (settlePrintOrder) settlePrintOrder.hidden = !canSettleAndPrint;
  if (settlementType) settlementType.hidden = role !== "MANAGER_1";
  if (posMode !== "DINE_IN") document.body.classList.add("pos-non-dine-in");
  else document.body.classList.add("pos-mode-dine-in");
  if (posMode === "PARTY") {
    document.body.classList.add("pos-mode-party");
    saveOrder.hidden = true;
  }
  if (finalBillPrintOrder) finalBillPrintOrder.hidden = !["DINE_IN", "PARCEL", "PARTY"].includes(posMode);
  if (posMode === "DINE_IN") {
    moveTableBtn.hidden = true;
    settleOrder.hidden = true;
    settlePrintOrder.hidden = true;
  }
  if (posMode === "PARCEL" || cashierDineLayout) {
    const parcelIntake = document.getElementById("parcelIntake");
    const parcelPhoneSlot = document.getElementById("parcelPhoneSlot");
    const parcelNameSlot = document.getElementById("parcelNameSlot");
    const parcelDeliverySlot = document.getElementById("parcelDeliverySlot");
    const parcelCustomerStatusSlot = document.getElementById("parcelCustomerStatusSlot");
    document.body.classList.add("pos-mode-parcel");
    if (cashierDineLayout) {
      document.body.classList.add("pos-mode-cashier-dine");
      document.querySelector('.parcel-intake .eyebrow').textContent = 'Dine-in order';
      document.getElementById('parcelIntakeTitle').textContent = 'Cashier order entry';
      document.querySelector('.parcel-intake-heading small').textContent = 'Choose a table, find or create the customer, then add items.';
      const tableField = document.createElement('label');
      tableField.className = 'parcel-field cashier-table-field';
      tableField.innerHTML = '<span>Table</span><select id="cashierDineTable"><option value="">Select table</option></select>';
      document.querySelector('.parcel-intake-grid').prepend(tableField);
      tableField.querySelector('select').addEventListener('change', (event) => {
        if (event.target.value) selectTable(Number(event.target.value), { skipMovePrompt: true });
      });
    } else {
      orderType.value = "TAKEAWAY";
      const parcelOption = orderType.querySelector('option[value="TAKEAWAY"]');
      if (parcelOption) parcelOption.textContent = "Parcel";
    }
    parcelIntake.hidden = false;
    parcelItemEntry.hidden = false;
    parcelItemSearchSlot.appendChild(document.querySelector(".item-search"));
    parcelItemSuggestionsSlot.appendChild(items);
    categories.hidden = true;
    if (!cashierDineLayout) {
      splitBillBtn.hidden = true;
      parcelCheckBtn.hidden = true;
      saveOrder.hidden = true;
    }
    parcelPhoneSlot.appendChild(document.querySelector(".customer-search-row"));
    parcelNameSlot.append(customerName, createCustomer);
    parcelDeliverySlot.appendChild(deliveryFields);
    parcelCustomerStatusSlot.appendChild(customerSummary);
    document.querySelector(".customer-panel").classList.add("parcel-payment-customer-panel");
    const parcelBillHeader = document.createElement("div");
    parcelBillHeader.className = "parcel-bill-header";
    parcelBillHeader.innerHTML = "<strong>Item</strong><strong>Special Note</strong><strong>Qty.</strong><strong>Price</strong><strong>Amount</strong>";
    cartItems.before(parcelBillHeader);
  }
}

document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", () => { localStorage.clear(); window.location.href = "/login.html"; }));
let autosaveNavigationInProgress = false;
document.querySelector('.app-home-nav')?.addEventListener('click', async (event) => {
  const link = event.target.closest('a[href]');
  if (!link || autosaveNavigationInProgress || link.getAttribute('href')?.startsWith('#')) return;
  const needsOrderSave = state.cart.length > 0 && (state.dirty || !state.orderId);
  if (!needsOrderSave) return;
  event.preventDefault();
  autosaveNavigationInProgress = true;
  link.setAttribute('aria-busy', 'true');
  const previousStatus = kotStatus.textContent;
  kotStatus.textContent = 'Saving order before navigation...';
  try {
    const saved = await saveCurrentOrder(true);
    if (!saved) throw new Error('Order could not be saved');
    window.location.assign(link.href);
  } catch (error) {
    kotStatus.textContent = error.message || previousStatus || 'Order autosave failed';
    link.removeAttribute('aria-busy');
    autosaveNavigationInProgress = false;
  }
});

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
  const payable = Math.max(cartTotal() + serviceChargeValue() - redeemPointsValue() - Number(state.discountAmount || 0), 0);
  return state.settings?.roundOffEnabled ? Math.round(payable) : payable;
}

async function applyPosDiscount(type, value, valueType, promoCode) {
  if (!state.orderId) { discountStatus.textContent = 'Save the order before applying a discount.'; return; }
  try {
    const result = await postJson('/orders/apply-discount', { orderId: state.orderId, type, value, valueType, promoCode, appliedByRole: role });
    state.discountAmount = Number(result.discountAmount || 0);
    discountStatus.textContent = `Discount applied: ${money(state.discountAmount)}`;
    renderCart();
  } catch (error) { discountStatus.textContent = error.message; }
}

function applyBootstrap(data) {
  const selectedTableId = state.selectedTable?.id;
  const selectedPartnerId = deliveryPartner.value || "";
  const channelField = posMode === 'PARCEL' ? 'allow_parcel' : posMode === 'PARTY' ? 'allow_party_order' : 'allow_dine_in';
  const channelItems = (data.items || []).filter((item) => Number(item[channelField] ?? 1) === 1);
  const channelItemIds = new Set(channelItems.map((item) => Number(item.id)));
  const channelCombos = (data.combos || []).filter((combo) => {
    const components = (data.comboItems || []).filter((component) => Number(component.combo_id) === Number(combo.id));
    return components.length > 0 && components.every((component) => channelItemIds.has(Number(component.item_id)));
  });
  Object.assign(state, {
    tables: data.tables || [],
    categories: data.categories || [],
    items: channelItems,
    modifierGroups: data.modifierGroups || [],
    modifiers: data.modifiers || [],
    combos: channelCombos,
    comboItems: data.comboItems || [],
    deliveryPartners: data.deliveryPartners || [],
    enabledModules: data.enabledModules || [],
    settings: data.settings || state.settings
  });
  if (selectedTableId) {
    state.selectedTable = state.tables.find((table) => table.id === selectedTableId) || state.selectedTable;
  }
  if (state.selectedCategoryId !== "ALL" && !state.categories.some((category) => category.id === state.selectedCategoryId)) {
    state.selectedCategoryId = "ALL";
  }
  if (window.activeRestaurantName) {
    const restaurantName = state.settings.restaurantName || restaurantId;
    activeRestaurantName.textContent = `${restaurantName} active`;
    const topName = document.getElementById("activeRestaurantNameTop");
    if (topName) topName.textContent = restaurantName;
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
  if (posMode === "PARCEL") orderType.value = "TAKEAWAY";
  if (posMode === "PARTY") orderType.value = "PHONE_ORDER";
  applyRoleAndModeUI();
  const data = await fetch(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  applyBootstrap(data);
  await refreshShiftCashStatus();
  renderTables();
  const cashierTableSelect = document.getElementById('cashierDineTable');
  if (cashierTableSelect) cashierTableSelect.innerHTML = '<option value="">Select table</option>' + state.tables.map((table) => `<option value="${table.id}">${esc(table.table_name)} · ${esc(table.status || 'AVAILABLE')}</option>`).join('');
  renderCategories();
  if (state.selectedCategoryId) renderItems(state.selectedCategoryId);
  updateOrderTypeView();
  if (posMode !== "DINE_IN") {
    state.selectedTable = null;
    state.activeTableId = null;
    renderTables();
    await restoreCurrentContextOrder();
    renderCart();
    return;
  }
  const rememberedTableId = requestedTableId || Number(localStorage.getItem("posActiveTableId") || 0);
  const remembered = state.tables.find((table) => Number(table.id) === rememberedTableId && table.status === "OCCUPIED");
  const requested = state.tables.find((table) => Number(table.id) === requestedTableId);
  const firstOccupied = state.tables.find((table) => table.status === "OCCUPIED");
  if (requested || remembered || firstOccupied) await selectTable((requested || remembered || firstOccupied).id, { skipMovePrompt: true });
}

async function refreshLiveState({ updateCart = false } = {}) {
  if (!restaurantId) return;
  const data = await fetch(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  applyBootstrap(data);
  await refreshShiftCashStatus();
  if (updateCart && (state.selectedTable?.id || posMode !== "DINE_IN")) await restoreCurrentContextOrder();
  renderTables();
  renderCategories();
  if (state.selectedCategoryId) renderItems(state.selectedCategoryId);
  if (updateCart) renderCart();
}

async function loadOpenOrdersForTable(tableId, selectedOrderId = null) {
  if (!isPositiveId(tableId)) return;
  const data = await fetch(`/orders/open-list?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(tableId)}`).then((res) => res.json());
  state.openOrders = data.orders || [];
  const requestedOrder = state.openOrders.find((order) => Number(order.id) === Number(selectedOrderId));
  const currentOrder = state.openOrders.find((order) => Number(order.id) === Number(state.orderId));
  state.orderId = requestedOrder?.id || currentOrder?.id || state.openOrders[0]?.id || null;
  state.billingReady = Number((requestedOrder || currentOrder || state.openOrders[0])?.billing_ready) === 1;
  renderOrderSelector();
  primeOpenOrderCache();
}

async function loadOpenOrdersForCurrentContext(selectedOrderId = null) {
  if (isDineIn()) return loadOpenOrdersForTable(state.selectedTable?.id, selectedOrderId);
  const data = await fetch(`/orders/open-list?restaurantId=${encodeURIComponent(restaurantId)}&orderType=${encodeURIComponent(orderType.value)}`).then((res) => res.json());
  state.openOrders = data.orders || [];
  const requestedOrder = state.openOrders.find((order) => Number(order.id) === Number(selectedOrderId));
  const currentOrder = state.openOrders.find((order) => Number(order.id) === Number(state.orderId));
  state.orderId = requestedOrder?.id || currentOrder?.id || state.openOrders[0]?.id || null;
  state.billingReady = Number((requestedOrder || currentOrder || state.openOrders[0])?.billing_ready) === 1;
  renderOrderSelector();
  primeOpenOrderCache();
}

function fetchOpenOrderDetails(orderId, { fresh = false } = {}) {
  const key = Number(orderId);
  if (!fresh && state.orderDetailsCache.has(key)) return state.orderDetailsCache.get(key);
  const request = fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(key)}`)
    .then(async (response) => {
      const data = await response.json();
      if (!response.ok || data.success === false) throw new Error(data.message || 'Unable to load customer check');
      return data;
    })
    .catch((error) => {
      state.orderDetailsCache.delete(key);
      throw error;
    });
  state.orderDetailsCache.set(key, request);
  return request;
}

function primeOpenOrderCache() {
  state.openOrders.forEach((order) => fetchOpenOrderDetails(order.id).catch(() => {}));
}

async function restoreCurrentContextOrder() {
  if (isDineIn() && !state.selectedTable?.id) return;
  const rememberedOrderId = state.orderId;
  await loadOpenOrdersForCurrentContext(rememberedOrderId);
  const orderId = state.openOrders.find((order) => Number(order.id) === Number(rememberedOrderId))?.id || state.openOrders[0]?.id;
  if (!orderId) {
    state.orderId = null;
    state.orderReference = null;
    state.billingReady = false;
    state.cart = [];
    state.selectedCartKey = null;
    renderCart();
    return;
  }
  const data = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`).then((res) => res.json());
  if (!data.order || (isDineIn() && Number(state.activeTableId) !== Number(state.selectedTable.id))) return;
  state.orderId = data.order.id;
  state.orderReference = data.order.order_reference || `${data.order.order_sequence || data.order.id}-${data.order.customer_ref || `A${data.order.id}`}`;
  state.billingReady = Number(data.order.billing_ready) === 1;
  state.kotSubmitted = (data.items || []).some((item) => item.kot_id);
  state.dirty = false;
  state.customer = data.customer || null;
  customerPhone.value = state.customer?.phone || "";
  customerName.value = state.customer?.name || "";
  state.cart = (data.items || []).map(cartItemFromOrderItem);
  state.selectedCartKey = state.cart[0]?.key || null;
  state.reviewBaselineQuantities = reviewBaselineForCart();
  renderOrderSelector();
  renderCart();
}

function askPosConfirmation(message, title = "Confirm action") {
  return new Promise((resolve) => {
    posConfirmTitle.textContent = title;
    posConfirmMessage.textContent = String(message || "");
    posConfirmInput.hidden = true;
    posConfirmModal.hidden = false;
    const finish = (accepted) => {
      posConfirmModal.hidden = true;
      acceptPosConfirm.removeEventListener("click", accept);
      cancelPosConfirm.removeEventListener("click", cancel);
      resolve(accepted);
    };
    const accept = () => finish(true);
    const cancel = () => finish(false);
    acceptPosConfirm.addEventListener("click", accept);
    cancelPosConfirm.addEventListener("click", cancel);
    cancelPosConfirm.focus();
  });
}

function askPosInput(message, title = "Enter details", initialValue = "") {
  return new Promise((resolve) => {
    posConfirmTitle.textContent = title;
    posConfirmMessage.textContent = String(message || "");
    posConfirmInput.hidden = false;
    posConfirmInput.value = String(initialValue || "");
    posConfirmModal.hidden = false;
    const finish = (accepted) => {
      const value = accepted ? posConfirmInput.value : null;
      posConfirmModal.hidden = true;
      posConfirmInput.hidden = true;
      acceptPosConfirm.removeEventListener("click", accept);
      cancelPosConfirm.removeEventListener("click", cancel);
      posConfirmInput.removeEventListener("keydown", keydown);
      resolve(value);
    };
    const accept = () => finish(true);
    const cancel = () => finish(false);
    const keydown = (event) => {
      if (event.key === "Enter") finish(true);
      if (event.key === "Escape") finish(false);
    };
    acceptPosConfirm.addEventListener("click", accept);
    cancelPosConfirm.addEventListener("click", cancel);
    posConfirmInput.addEventListener("keydown", keydown);
    posConfirmInput.focus();
    posConfirmInput.select();
  });
}

async function reloadCurrentOrderCart() {
  if (!state.orderId) return;
  const selectedOrderItemId = state.cart.find((item) => item.key === state.selectedCartKey)?.orderItemId;
  const data = await fetch(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(state.orderId)}`).then((res) => res.json());
  if (!data.order || Number(data.order.id) !== Number(state.orderId)) throw new Error('Saved order could not be reloaded');
  state.orderReference = data.order.order_reference || state.orderReference;
  state.billingReady = Number(data.order.billing_ready) === 1;
  state.kotSubmitted = (data.items || []).some((item) => item.kot_id);
  state.cart = (data.items || []).map(cartItemFromOrderItem);
  state.selectedCartKey = state.cart.find((item) => Number(item.orderItemId) === Number(selectedOrderItemId))?.key || state.cart[0]?.key || null;
  state.reviewBaselineQuantities = reviewBaselineForCart();
  renderCart();
}

async function refreshShiftCashStatus() {
  return;
  const [attendanceData, cashData] = await Promise.all([
    fetch(`/attendance/current?restaurantId=${encodeURIComponent(restaurantId)}&userId=${encodeURIComponent(actor.id)}`).then((res) => res.json()).catch(() => ({ attendance: null })),
    fetch(`/cash-register/current?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json()).catch(() => ({ session: null, expectedCash: 0 }))
  ]);
  state.attendance = attendanceData.attendance || null;
  state.cashSession = cashData.session || null;
  state.expectedCash = Number(cashData.expectedCash || 0);
  return;
}

async function promptAmount(label) {
  const value = await askPosInput(label, "Enter amount");
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
  schedulePosAutosave();
}

let posAutosaveTimer;
let posAutosaveRunning = false;
function schedulePosAutosave() {
  if (!(["PARCEL", "PARTY"].includes(posMode) || cashierDineLayout) || !state.dirty || !state.cart.length || state.billingReady) return;
  clearTimeout(posAutosaveTimer);
  posAutosaveTimer = setTimeout(async () => {
    if (posAutosaveRunning || !state.dirty || !state.cart.length || state.billingReady) return;
    posAutosaveRunning = true;
    try {
      const saved = await saveCurrentOrder();
      if (saved) {
        kotStatus.textContent = "Order autosaved";
        kotStatus.className = "success-message";
      }
    } catch (error) {
      kotStatus.textContent = `Autosave failed: ${error.message}`;
      kotStatus.className = "error-message";
    } finally {
      posAutosaveRunning = false;
      if (state.dirty) schedulePosAutosave();
    }
  }, 1200);
}

function renderTables() {
  tablesList.innerHTML = state.tables.map((table) => `
    <button class="table-tile table-${String(table.status || "AVAILABLE").toLowerCase()} ${state.selectedTable?.id === table.id ? "active" : ""}" data-table="${table.id}">
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
    `<option value="${current?.id || ""}">${current ? `Order ${current.order_reference || current.id}${current.customer_name ? ` - ${current.customer_name}` : ""}` : "Current check"}</option>`,
    ...state.openOrders.filter((order) => Number(order.id) !== Number(current?.id)).map((order) => `<option value="${order.id}">Order ${order.order_reference || order.id}${order.customer_name ? ` - ${esc(order.customer_name)}` : ""} - ${money(order.total_amount)}</option>`)
  ].join("");
  if (current) orderSelector.value = String(current.id);
}

function renderCategories() {
  categories.innerHTML = [`<button class="${state.selectedCategoryId === "ALL" ? "active" : ""}" data-category="ALL">All</button>`, ...state.categories.map((category) => `
    <button class="${state.selectedCategoryId === category.id ? "active" : ""}" data-category="${category.id}">
      ${esc(category.name)}
    </button>
  `)].join("");
}

function renderItems(categoryId) {
  const query = (itemSearch?.value || "").trim().toLowerCase();
  if (posMode === "PARCEL" && !query) {
    items.innerHTML = "";
    return;
  }
  const itemTiles = state.items.filter((item) => (categoryId === "ALL" || item.category_id === categoryId) && (!query || `${item.item_code || ""} ${item.name}`.toLowerCase().includes(query))).map((item) => {
    const matchingLines = state.cart.filter((line) => line.id === item.id && !line.comboId);
    const quantity = matchingLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const stateClass = matchingLines.some((line) => line.sentToKitchen) ? "saved" : matchingLines.some((line) => line.savedLocally) ? "pending-save" : quantity > 0 ? "new-item" : "";
    return `
      <button class="item-tile ${quantity > 0 ? "selected" : ""} ${stateClass}" data-item="${item.id}" ${state.billingReady ? 'disabled title="Final bill requested for this order"' : ''}>
        <strong>${esc(displayItemCode(item))} · ${esc(item.name)}</strong>
        <span class="item-price">${money(item.price)}</span>
        ${quantity > 0 ? `<span class="tile-quantity-controls"><span data-item-minus="${item.id}" role="button">-</span><em>${quantity}</em><span data-item-plus="${item.id}" role="button">+</span></span>` : ""}
      </button>
    `;
  }).join("");
  const comboTiles = state.combos.filter((combo) => (categoryId === "ALL" || !combo.category_id || Number(combo.category_id) === Number(categoryId)) && (!query || combo.name.toLowerCase().includes(query))).map((combo) => {
    const matchingLines = state.cart.filter((line) => line.comboId === combo.id);
    const quantity = matchingLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0);
    const stateClass = matchingLines.some((line) => line.sentToKitchen) ? "saved" : matchingLines.some((line) => line.savedLocally) ? "pending-save" : quantity > 0 ? "new-item" : "";
    return `
      <button class="item-tile combo-tile ${quantity > 0 ? "selected" : ""} ${stateClass}" data-combo="${combo.id}" ${state.billingReady ? 'disabled title="Final bill requested for this order"' : ''}>
        <strong>${esc(combo.name)}</strong>
        <span>${money(combo.price)}</span>
        ${quantity > 0 ? `<span class="tile-quantity-controls"><span data-combo-minus="${combo.id}" role="button">-</span><em>${quantity}</em><span data-combo-plus="${combo.id}" role="button">+</span></span>` : ""}
      </button>
    `;
  }).join("");
  items.innerHTML = itemTiles + comboTiles;
}

function filteredMenuItems() {
  const query = (itemSearch?.value || "").trim().toLowerCase();
  if (!query) return [];
  return state.items.filter((item) =>
    (state.selectedCategoryId === "ALL" || item.category_id === state.selectedCategoryId)
    && `${item.item_code || ""} ${item.name}`.toLowerCase().includes(query)
  );
}

function selectParcelDraftItem(item) {
  state.parcelDraftItem = item;
  state.parcelSuggestionIndex = -1;
  itemSearch.value = `${displayItemCode(item)} · ${item.name}`;
  items.innerHTML = "";
  parcelItemNote.focus();
}

function resetParcelItemEntry() {
  state.parcelDraftItem = null;
  state.parcelSuggestionIndex = -1;
  state.pendingParcelDraft = null;
  itemSearch.value = "";
  parcelItemNote.value = "";
  parcelItemQuantity.value = "1";
  items.innerHTML = "";
  itemSearch.focus();
}

function commitParcelDraft() {
  if (state.billingReady) return alert("Final bill has been requested for this order. Start a new customer check to add items.");
  const item = state.parcelDraftItem;
  const quantity = Math.max(Math.trunc(Number(parcelItemQuantity.value || 0)), 0);
  if (!item) return alert("Select an item from the suggestions first");
  if (quantity < 1) return alert("Quantity must be at least 1");
  const options = { quantity, notes: parcelItemNote.value.trim(), forceNew: true };
  if (itemGroups(item.id).length > 0) {
    state.pendingParcelDraft = options;
    openModifierModal(Number(item.id));
    return;
  }
  addItemToCart(item, [], options);
  resetParcelItemEntry();
}

function addSingleSearchResult() {
  const matchingItems = filteredMenuItems();
  const query = itemSearch.value.trim().toLowerCase();
  const matchingCombos = state.combos.filter((combo) =>
    (state.selectedCategoryId === "ALL" || !combo.category_id || Number(combo.category_id) === Number(state.selectedCategoryId))
    && combo.name.toLowerCase().includes(query)
  );
  if (matchingItems.length !== 1 || matchingCombos.length !== 0) return false;
  if (posMode === "PARCEL") selectParcelDraftItem(matchingItems[0]);
  else openModifierModal(Number(matchingItems[0].id));
  return true;
}

function renderCart() {
  cartTitle.textContent = isDineIn() ? (state.selectedTable ? state.selectedTable.table_name : "Select a table") : orderType.options[orderType.selectedIndex].text;
  orderMeta.textContent = state.orderId ? `Order ${state.orderReference || state.orderId}` : "New order";
  cartItems.innerHTML = state.cart.map((item) => posMode === "PARCEL" ? `
    <div class="cart-line parcel-cart-row ${state.selectedCartKey === item.key ? "selected" : ""} ${item.sentToKitchen ? "saved" : item.savedLocally ? "pending-save" : "new-item"}" data-cart-line="${item.key}" role="button" tabindex="0" aria-label="Edit ${esc(item.name)}">
      <div><strong>${esc(item.name)}</strong>${(item.modifiers || []).map((modifier) => `<small>+ ${esc(modifier.name)}</small>`).join("")}</div>
      <span class="parcel-line-note">${item.notes ? esc(item.notes) : "--"}</span>
      <span class="cart-line-quantity">${item.quantity}</span>
      <span>${money(item.price)}</span>
      <strong>${money(Number(item.price || 0) * Number(item.quantity || 0))}</strong>
    </div>` : `
    <div class="cart-line ${state.selectedCartKey === item.key ? "selected" : ""} ${item.sentToKitchen ? "saved" : item.savedLocally ? "pending-save" : "new-item"}" data-cart-line="${item.key}" role="button" tabindex="0" aria-label="Edit ${esc(item.name)}">
      <div>
        <strong>${esc(item.name)}</strong>
        <span>${money(item.price)}</span>
        ${item.sentToKitchen ? "<small>Sent to kitchen</small>" : ""}
        ${(item.modifiers || []).map((modifier) => `<small>+ ${esc(modifier.name)}</small>`).join("")}
        ${item.notes ? `<small class="item-note">Note: ${esc(item.notes)}</small>` : ""}
      </div>
      <span class="cart-line-quantity">× ${item.quantity}</span>
    </div>
  `).join("");
  renderItemNoteEditor();
  total.textContent = `Total: ${money(cartTotal())}`;
  customerSummary.textContent = state.customer ? `${state.customer.name} - ${state.customer.phone} - ${state.customer.loyaltyBalance || 0} pts` : "No customer attached";
  redeemPoints.max = state.customer?.loyaltyBalance || 0;
  payableTotal.textContent = `Payable: ${money(payableAmount())}`;
  moveTableBtn.disabled = state.billingReady || !isDineIn() || !state.selectedTable || !state.orderId;
  // A new order has no ID until it is saved, so it must still be possible to send its first KOT.
  const baseline = state.reviewBaselineQuantities || {};
  const hasNewKotItems = state.cart.some((item) => !item.sentToKitchen && Number(item.quantity || 0) > Number(baseline[item.key] || 0));
  submitKot.disabled = state.billingReady || !(state.cart.length > 0 && (!state.orderId || state.dirty || hasNewKotItems));
  submitKot.title = state.billingReady ? "Final bill requested; this order is locked" : (submitKot.disabled ? "Save or add an item before submitting a KOT" : "Submit new items to the kitchen");
  saveOrder.disabled = state.billingReady;
  finalBillPrintOrder.disabled = state.billingReady;
  itemSearch.disabled = state.billingReady;
  if (state.billingReady) {
    kotStatus.textContent = "Final bill requested — this order is locked. Start a new customer check for additional items.";
    kotStatus.className = "success-message";
  }
  paymentAmount.value = amount(payableAmount());
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
    notes: item.notes || "",
    sentToKitchen: Boolean(item.kot_id),
    savedLocally: !item.kot_id
  };
}

function itemLabel(item) {
  return `${item.quantity} x ${item.name}${item.notes ? ` (${item.notes})` : ""}`;
}

function reviewBaselineForCart() {
  // Only quantities already sent to the kitchen belong to the KOT baseline.
  // Saved local lines must remain eligible for the next KOT after a table switch.
  return Object.fromEntries(state.cart.map((item) => [item.key, item.sentToKitchen ? Number(item.quantity || 0) : 0]));
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
  state.parcelTableId = null;
  localStorage.setItem("posActiveTableId", String(tableId));
  if (!isDineIn()) orderType.value = "DINE_IN";
  state.customer = null;
  state.discountAmount = 0;
  customerPhone.value = "";
  customerName.value = "";
  state.selectedTable = state.tables.find((table) => table.id === tableId);
  const cashierTableSelect = document.getElementById('cashierDineTable');
  if (cashierTableSelect) cashierTableSelect.value = String(tableId);
  if (isDineIn() && state.selectedTable) {
    try {
      const qrSession = await postJson('/qr/session/start', { tableId });
      alert(`QR table PIN: ${qrSession.pin} (valid for ${qrSession.expiresInMinutes} minutes)`);
    } catch (error) {
      // QR ordering is optional; table ordering must remain available if it is disabled.
    }
  }
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
    state.reviewBaselineQuantities = reviewBaselineForCart();
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
    return alert("This item has no options. Use the quantity controls in the selected-item panel.");
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

function addItemToCart(menuItem, modifiers, options = {}) {
  if (state.billingReady) return alert("Final bill has been requested for this order. Start a new customer check to add items.");
  const modifierIds = modifiers.map((modifier) => modifier.id).sort((a, b) => a - b);
  const key = `item-${menuItem.id}-${modifierIds.join(".") || "none"}`;
  const unitPrice = Number(menuItem.price || 0) + modifiers.reduce((sum, modifier) => sum + Number(modifier.price_delta || 0), 0);
  const requestedQuantity = Math.max(Math.trunc(Number(options.quantity || 1)), 1);
  const line = options.forceNew ? null : state.cart.find((item) => item.key === key && !item.sentToKitchen);
  if (line) line.quantity += requestedQuantity;
  else {
    const nextKey = state.cart.some((item) => item.key === key) || options.forceNew ? `${key}-new-${Date.now()}` : key;
    state.cart.push({ ...menuItem, key: nextKey, price: unitPrice, quantity: requestedQuantity, notes: options.notes || "", modifiers, savedLocally: false });
    state.selectedCartKey = nextKey;
  }
  if (line) state.selectedCartKey = line.key;
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
  if (state.billingReady) return alert("Final bill has been requested for this order. Start a new customer check to add items.");
  if (isDineIn() && !state.selectedTable) return alert("Select a table first");
  const combo = state.combos.find((row) => row.id === comboId);
  if (!combo) return;
  const key = `combo-${combo.id}`;
  const included = state.comboItems.filter((item) => item.combo_id === combo.id).map((item) => `${item.item_name} x${item.quantity}`).join(", ");
  const line = state.cart.find((item) => item.key === key);
  if (line) line.quantity += 1;
  else state.cart.push({ key, comboId: combo.id, name: combo.name, price: combo.price, quantity: 1, modifiers: included ? [{ name: included, id: 0 }] : [], savedLocally: false });
  state.selectedCartKey = key;
  state.dirty = true;
  refreshCartAndMenu();
}

async function saveCurrentOrder(force = false) {
  if (state.billingReady) return alert("Final bill has been requested for this order. It cannot be edited.");
  if (isDineIn() && !state.selectedTable) return alert("Select a table and add items");
  if (state.cart.length === 0) return alert("Add items first");
  if (state.orderId && !state.dirty && !force) return true;
  if (orderType.value === "DELIVERY" && (!deliveryPhone.value.trim() || !deliveryAddress.value.trim())) return alert("Enter delivery phone and address");
  const data = await postJson("/orders/save", {
    orderId: state.orderId,
    orderType: orderType.value,
    tableId: isDineIn() ? (state.selectedTable?.id || null) : (state.parcelTableId || null),
    tableName: isDineIn() ? (state.selectedTable?.table_name || null) : (state.tables.find((table) => table.id === state.parcelTableId)?.table_name || null),
    customerId: state.customer?.id || null,
    deliveryAddress: deliveryAddress.value,
    deliveryPhone: deliveryPhone.value || customerPhone.value,
    deliveryFee: deliveryFeeValue(),
    deliveryPartnerId: deliveryPartner.value || null,
    expectedDeliveryTime: expectedDeliveryTime.value || null,
    items: state.cart.map((item) => item.comboId
      ? ({ orderItemId: item.orderItemId || null, comboId: item.comboId, quantity: item.quantity })
      : ({ orderItemId: item.orderItemId || null, itemId: item.id, quantity: item.quantity, notes: item.notes || "", modifiers: (item.modifiers || []).filter((modifier) => modifier.id).map((modifier) => modifier.id) }))
  });
  state.orderId = data.orderId;
  state.orderDetailsCache.delete(Number(data.orderId));
  state.serverOrderTotal = Number(data.total || 0);
  state.orderReference = data.orderReference || state.orderReference || data.orderId;
  state.dirty = false;
  setSelectedTableStatus("OCCUPIED");
  orderMeta.textContent = `Order ${state.orderReference}`;
  await refreshLiveState();
  // The server assigns order-item IDs during every save. Reload immediately so
  // a submitted line can never be mistaken for a new line on the next save/KOT.
  await reloadCurrentOrderCart();
  return data;
}

function renderItemNoteEditor() {
  const line = state.cart.find((item) => item.key === state.selectedCartKey);
  itemNoteEditor.hidden = !line;
  if (!line) {
    itemNoteInput.value = "";
    return;
  }
  itemNoteTitle.textContent = `${line.name} · ${money(line.price)}`;
  itemNoteHelp.textContent = line.sentToKitchen
    ? "Already sent to kitchen. Add a new item to send an additional instruction."
    : "This item-level note prints in the Special Note column on the next KOT.";
  if (document.activeElement !== itemNoteInput) itemNoteInput.value = line.notes || "";
  itemNoteInput.disabled = state.billingReady || line.sentToKitchen;
  selectedItemQuantity.textContent = String(line.quantity);
  selectedItemMinus.disabled = state.billingReady || line.sentToKitchen;
  selectedItemPlus.disabled = state.billingReady || line.sentToKitchen;
  removeSelectedItem.disabled = state.billingReady || line.sentToKitchen;
  editItemOptions.disabled = state.billingReady || line.sentToKitchen || Boolean(line.comboId);
}

function updateSelectedItemNote(value) {
  const line = state.cart.find((item) => item.key === state.selectedCartKey);
  if (!line || state.billingReady || line.sentToKitchen) return;
  line.notes = String(value || "").slice(0, 300);
  line.savedLocally = false;
  state.dirty = true;
  schedulePosAutosave();
}

function removeSelectedCartItem() {
  if (state.billingReady) return alert("Final bill has been requested for this order. It cannot be edited.");
  const index = state.cart.findIndex((item) => item.key === state.selectedCartKey);
  const line = state.cart[index];
  if (!line) return;
  if (line.sentToKitchen) return alert("This item has already been sent to the kitchen. Cancel it from KDS instead.");
  state.cart.splice(index, 1);
  state.selectedCartKey = state.cart[Math.min(index, state.cart.length - 1)]?.key || null;
  state.dirty = true;
  refreshCartAndMenu();
}

function changeSelectedItemQuantity(delta) {
  if (state.billingReady) return alert("Final bill has been requested for this order. It cannot be edited.");
  const line = state.cart.find((item) => item.key === state.selectedCartKey);
  if (!line || line.sentToKitchen) return;
  line.quantity = Number(line.quantity || 0) + Number(delta || 0);
  if (line.quantity <= 0) return removeSelectedCartItem();
  line.savedLocally = false;
  state.dirty = true;
  refreshCartAndMenu();
}

async function submitCurrentKot() {
  const baseline = state.reviewBaselineQuantities || {};
  const submittedItems = state.cart.filter((item) => item.sentToKitchen);
  const previousItems = state.cart
    .filter((item) => Object.prototype.hasOwnProperty.call(baseline, item.key) && !item.sentToKitchen)
    .map((item) => ({ ...item, quantity: Math.min(Number(item.quantity || 0), Number(baseline[item.key] || 0)) }))
    .filter((item) => item.quantity > 0);
  const newItems = state.cart.flatMap((item) => {
    if (item.sentToKitchen) return [];
    const delta = Number(item.quantity || 0) - Number(baseline[item.key] || 0);
    return delta > 0 ? [{ ...item, quantity: delta }] : [];
  });
  const summary = [
    `Order ${state.orderReference || state.orderId || "new"}`,
    "",
    "Already submitted:",
    ...(submittedItems.length ? submittedItems.map(itemLabel) : ["None"]),
    "",
    "Previously in this check:",
    ...(previousItems.length ? previousItems.map(itemLabel) : ["None"]),
    "",
    "New in this KOT:",
    ...(newItems.length ? newItems.map(itemLabel) : ["None"])
  ].join("\n");
  if (!newItems.length) return alert(`${summary}\n\nThere are no unsent items to submit. Add an item or save a new item before sending the KOT.`);
  if (!await askPosConfirmation(`${summary}\n\nSubmit this KOT?`, "Confirm KOT")) return;
  const saved = await saveCurrentOrder();
  if (!saved) return;
  const data = await postJson("/orders/submit-kot", { orderId: state.orderId });
  if (data.success) {
    state.kotSubmitted = true;
    state.dirty = false;
    state.cart.forEach((item) => { item.sentToKitchen = true; });
    state.reviewBaselineQuantities = reviewBaselineForCart();
    kotStatus.textContent = data.message || "KOT submitted";
    kotStatus.className = "success-message";
    submitKot.title = data.kotReference ? `Last KOT: ${data.kotReference}` : "KOT submitted";
    await loadOpenOrdersForCurrentContext(state.orderId);
    await reloadCurrentOrderCart();
    refreshCartAndMenu();
  }
  alert(data.message || "KOT submitted");
}

async function settleCurrentOrder(printBill = false) {
  const settledTableId = state.selectedTable?.id || null;
  const wasSubmittedAndEdited = state.kotSubmitted && state.dirty;
  // Reconcile the visible cart with the server before billing, even when the
  // screen is clean, so a stale order total cannot reject the displayed amount.
  const saved = await saveCurrentOrder(true);
  if (!saved) return;
  if (wasSubmittedAndEdited) {
    await postJson("/orders/submit-kot", { orderId: state.orderId });
    state.kotSubmitted = true;
  }
  // The final save is authoritative. Use its total for the default cash
  // amount so switching checks or editing a submitted KOT cannot leave a
  // stale client-side amount in the settlement request.
  const serverTotal = Number(saved.total || state.serverOrderTotal || 0);
  const serverPayable = Math.max(serverTotal + serviceChargeValue() - redeemPointsValue() - Number(state.discountAmount || 0), 0);
  const displayedPayable = payableAmount();
  if (Math.abs(Number(paymentAmount.value) - displayedPayable) < 0.01 || Math.abs(Number(paymentAmount.value) - serverPayable) < 0.01) paymentAmount.value = amount(serverPayable);
  const payments = [{ method: paymentMode.value, amount: Number(paymentAmount.value) }];
  const isInvoice = settlementType?.value !== "NON_INVOICE";
  const data = await postJson("/orders/settle", { orderId: state.orderId, customerId: state.customer?.id || null, redeemPoints: Math.floor(redeemPointsValue()), payments, isInvoice, printBill });
  alert(isInvoice ? `${printBill ? `${data.printMessage} Invoice ${data.invoiceNo}` : `Invoice ${data.invoiceNo}`}` : `Order settled without invoice. Reference ${data.invoiceNo}`);
  state.cart = [];
  state.selectedCartKey = null;
  state.orderId = null;
  state.orderReference = null;
  state.serverOrderTotal = null;
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

async function requestFinalBillAndPrint() {
  if (!state.orderId) return alert("Save the order and submit its KOT first");
  if (state.dirty || state.cart.some((item) => !item.sentToKitchen)) return alert("Submit all new items to KOT before requesting the final bill");
  if (!await askPosConfirmation(`Print the final bill and mark ${state.selectedTable?.table_name || 'this table'} ready for billing?`, "Final bill")) return;
  finalBillPrintOrder.disabled = true;
  try {
    const data = await postJson('/orders/final-bill', { orderId: state.orderId });
    state.orderDetailsCache.delete(Number(state.orderId));
    state.billingReady = true;
    state.dirty = false;
    kotStatus.textContent = data.message;
    kotStatus.className = 'success-message';
    refreshCartAndMenu();
    window.dispatchEvent(new Event('pos:notifications-changed'));
    alert(data.message);
  } finally { finalBillPrintOrder.disabled = state.billingReady; }
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
  if (state.cart.length) state.dirty = true;
  renderCart();
  schedulePosAutosave();
}

async function createCustomerFromBilling() {
  if (!customerPhone.value.trim() || !customerName.value.trim()) return alert("Enter customer name and phone");
  const data = await postJson("/customers/create", { name: customerName.value, phone: customerPhone.value });
  state.customer = data.customer;
  deliveryPhone.value ||= state.customer.phone || "";
  if (state.cart.length) state.dirty = true;
  renderCart();
  schedulePosAutosave();
}

document.addEventListener("click", async (event) => {
  const comboControl = event.target.closest("[data-combo-plus], [data-combo-minus]");
  if (comboControl) {
    const comboId = Number(comboControl.dataset.comboPlus || comboControl.dataset.comboMinus);
    const line = state.cart.find((item) => Number(item.comboId) === comboId);
    if (line && !line.sentToKitchen) {
      line.quantity += comboControl.dataset.comboPlus ? 1 : -1;
      state.selectedCartKey = line.key;
      line.savedLocally = false;
      state.dirty = true;
      state.cart = state.cart.filter((item) => item.quantity > 0);
      refreshCartAndMenu();
    }
    return;
  }
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.table) await selectTable(Number(target.dataset.table));
  if (target.dataset.category) {
    state.selectedCategoryId = target.dataset.category === "ALL" ? "ALL" : Number(target.dataset.category);
    renderCategories();
    renderItems(state.selectedCategoryId);
  }
  if (target.dataset.item) {
    const selectedItem = state.items.find((item) => Number(item.id) === Number(target.dataset.item));
    if (posMode === "PARCEL" && selectedItem) {
      selectParcelDraftItem(selectedItem);
      return;
    }
    else openModifierModal(Number(target.dataset.item));
  }
  if (target.dataset.combo) addCombo(Number(target.dataset.combo));
  if (target.dataset.plus) {
    const line = state.cart.find((item) => item.key === target.dataset.plus);
    if (line && !line.sentToKitchen) {
      line.quantity += 1;
      line.savedLocally = false;
      state.selectedCartKey = line.key;
      state.dirty = true;
    }
  }
  if (target.dataset.minus) {
    const line = state.cart.find((item) => item.key === target.dataset.minus);
    if (line && !line.sentToKitchen) {
      line.quantity -= 1;
      line.savedLocally = false;
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
});

itemNoteInput.addEventListener("input", () => updateSelectedItemNote(itemNoteInput.value));
editItemOptions.addEventListener("click", openEditSelectedItem);
selectedItemMinus.addEventListener("click", () => changeSelectedItemQuantity(-1));
selectedItemPlus.addEventListener("click", () => changeSelectedItemQuantity(1));
removeSelectedItem.addEventListener("click", removeSelectedCartItem);

items.addEventListener("click", (event) => {
  if (state.billingReady) return alert("Final bill has been requested for this order. Start a new customer check to add items.");
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
      const replacement = { ...existing, ...state.pendingItem, modifiers: modifiers.slice(), savedLocally: false };
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
    addItemToCart(state.pendingItem, modifiers, state.pendingParcelDraft || {});
  }
  modifierModal.hidden = true;
  state.pendingItem = null;
  state.pendingEditKey = null;
  if (state.pendingParcelDraft) resetParcelItemEntry();
});

paymentMode.addEventListener("change", renderCart);
redeemPoints.addEventListener("input", renderCart);
applyPromoCode.addEventListener("click", () => applyPosDiscount("PROMO", 1, "FLAT", promoCode.value.trim().toUpperCase()));
applyDiscountAmount.addEventListener("click", () => applyPosDiscount("MANUAL", Number(discountAmount.value || 0), "FLAT", null));
orderType.addEventListener("change", () => { if (state.cart.length) state.dirty = true; updateOrderTypeView(); });
[deliveryAddress, deliveryPhone, deliveryFee, deliveryPartner, expectedDeliveryTime].forEach((control) => {
  control?.addEventListener('input', () => { if (state.cart.length) state.dirty = true; });
  control?.addEventListener('change', () => { if (state.cart.length) state.dirty = true; });
});
let itemSearchTimer;
itemSearch.addEventListener("input", () => {
  if (posMode === "PARCEL") {
    state.parcelDraftItem = null;
    state.parcelSuggestionIndex = -1;
  }
  clearTimeout(itemSearchTimer);
  itemSearchTimer = setTimeout(() => renderItems(state.selectedCategoryId), 120);
});
itemSearch.addEventListener("keydown", (event) => {
  if (posMode === "PARCEL" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
    if (!(itemSearch.value || "").trim()) return;
    event.preventDefault();
    clearTimeout(itemSearchTimer);
    renderItems(state.selectedCategoryId);
    const suggestions = [...items.querySelectorAll("[data-item]")];
    if (!suggestions.length) return;
    const direction = event.key === "ArrowDown" ? 1 : -1;
    state.parcelSuggestionIndex = (state.parcelSuggestionIndex + direction + suggestions.length) % suggestions.length;
    suggestions.forEach((suggestion, index) => suggestion.classList.toggle("keyboard-active", index === state.parcelSuggestionIndex));
    suggestions[state.parcelSuggestionIndex].scrollIntoView({ block: "nearest" });
    return;
  }
  const parcelSelectKey = posMode === "PARCEL" && (event.key === "Tab" || event.key === "Enter");
  if ((!parcelSelectKey && event.key !== "Enter") || event.isComposing) return;
  if (posMode === "PARCEL" && !(itemSearch.value || "").trim()) return;
  event.preventDefault();
  clearTimeout(itemSearchTimer);
  renderItems(state.selectedCategoryId);
  if (posMode === "PARCEL") {
    const matches = filteredMenuItems();
    const selectedMatch = state.parcelSuggestionIndex >= 0 ? matches[state.parcelSuggestionIndex] : (event.key === "Tab" ? matches[0] : (matches.length === 1 ? matches[0] : null));
    if (selectedMatch) selectParcelDraftItem(selectedMatch);
    else alert("No matching item found");
    return;
  }
  addSingleSearchResult();
});
parcelItemNote?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  parcelItemQuantity.focus();
  parcelItemQuantity.select();
});
parcelItemQuantity?.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" || event.isComposing) return;
  event.preventDefault();
  commitParcelDraft();
});
addParcelItem?.addEventListener("click", commitParcelDraft);

deliveryFee.addEventListener("input", renderCart);
orderSelector.addEventListener("change", async () => {
  if ((isDineIn() && !state.selectedTable) || !orderSelector.value) return;
  const orderId = Number(orderSelector.value);
  const requestId = ++tableSelectionRequest;
  orderSelector.disabled = true;
  orderMeta.textContent = 'Loading customer check...';
  try {
    const data = await fetchOpenOrderDetails(orderId);
    if (requestId !== tableSelectionRequest || Number(data.order?.id) !== orderId || (isDineIn() && Number(state.activeTableId) !== Number(state.selectedTable.id))) return;
    state.orderId = data.order.id;
    state.orderReference = data.order.order_reference || `${data.order.order_sequence || data.order.id}-${data.order.customer_ref || `A${data.order.id}`}`;
    state.billingReady = Number(data.order.billing_ready) === 1;
    state.kotSubmitted = (data.items || []).some((item) => item.kot_id);
    state.dirty = false;
    state.customer = data.customer || null;
    customerPhone.value = state.customer?.phone || "";
    customerName.value = state.customer?.name || "";
    state.cart = (data.items || []).map(cartItemFromOrderItem);
    state.selectedCartKey = state.cart[0]?.key || null;
    state.reviewBaselineQuantities = reviewBaselineForCart();
    orderMeta.textContent = `Order ${state.orderReference}`;
    renderCart();
  } catch (error) {
    orderMeta.textContent = `Unable to load customer check`;
    alert(error.message);
  } finally {
    orderSelector.disabled = false;
  }
});
searchCustomer.addEventListener("click", searchCustomerByPhone);
createCustomer.addEventListener("click", createCustomerFromBilling);
saveOrder.addEventListener("click", () => saveCurrentOrder());
submitKot.addEventListener("click", submitCurrentKot);
settleOrder.addEventListener("click", settleCurrentOrder);
settlePrintOrder?.addEventListener("click", () => settleCurrentOrder(true));
finalBillPrintOrder?.addEventListener("click", requestFinalBillAndPrint);
moveTableBtn.addEventListener("click", async () => {
  if (!isDineIn() || !state.selectedTable) return alert("Select a dine-in table first");
  const destinations = state.tables
    .filter((table) => Number(table.id) !== Number(state.selectedTable.id))
    .map((table) => `${table.table_name} [${table.status || "AVAILABLE"}]`)
    .join("\n");
  if (!destinations) return alert("No destination tables are available");
  const targetTableName = await askPosInput(`Choose the destination table by entering its name:\n\n${destinations}`, "Move table");
  if (!targetTableName) return;
  const targetName = targetTableName.trim().replace(/\s*\[.*\]$/, "").trim().toLowerCase();
  const targetTable = state.tables.find((table) => table.table_name.toLowerCase() === targetName && Number(table.id) !== Number(state.selectedTable.id));
  if (!targetTable) return alert("Target table not found");
  try {
    await moveOrderToTable(targetTable.id);
  } catch (error) {
    alert(error.message || "The order could not be moved. Choose another destination table.");
  }
});
splitBillBtn.addEventListener("click", openSplitBillModal);
newCheckBtn.addEventListener("click", async () => {
  if (posMode === "DINE_IN" && !state.selectedTable) return alert("Select a table first");
  if (state.cart.length && state.dirty && !state.billingReady) {
    const saved = await saveCurrentOrder();
    if (!saved) return;
  }
  state.orderId = null;
  state.parcelTableId = null;
  state.orderReference = null;
  state.billingReady = false;
  state.openOrders = [];
  state.cart = [];
  state.selectedCartKey = null;
  state.customer = null;
  state.dirty = false;
  state.kotSubmitted = false;
  customerPhone.value = "";
  customerName.value = "";
  orderType.value = posMode === "PARCEL" ? "TAKEAWAY" : posMode === "PARTY" ? "PHONE_ORDER" : "DINE_IN";
  kotStatus.textContent = "New customer check started";
  updateOrderTypeView();
});
parcelCheckBtn.addEventListener("click", () => {
  if (posMode !== "DINE_IN") return alert("Use the current POS mode for this order");
  if (!state.selectedTable) return alert("Select the customer's table first");
  state.parcelTableId = state.selectedTable.id;
  const parcelCustomer = state.customer;
  state.orderId = null;
  state.orderReference = null;
  state.billingReady = false;
  state.openOrders = [];
  state.cart = [];
  state.selectedCartKey = null;
  state.customer = parcelCustomer;
  state.dirty = false;
  state.kotSubmitted = false;
  customerPhone.value = state.customer?.phone || "";
  customerName.value = state.customer?.name || "";
  orderType.value = "TAKEAWAY";
  kotStatus.textContent = "Separate parcel check started";
  updateOrderTypeView();
});
closeSplitBillModal.addEventListener("click", () => {
  splitBillModal.hidden = true;
});
createSplitCheckBtn.addEventListener("click", async () => {
  const selectedKeys = [...splitBillItems.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
  if (selectedKeys.length === 0) return alert("Select at least one item");
  const data = await postJson("/orders/split-check", {
    orderId: state.orderId,
    itemKeys: selectedKeys,
    checkName: await askPosInput("Enter a name for the new check (optional)", "Split check") || "",
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
/* Register and attendance controls are intentionally not exposed in POS. */
/*
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
*/
cancelOrder.addEventListener("click", async () => {
  if (!state.orderId || !await askPosConfirmation("Cancel this order?", "Cancel order")) return;
  await postJson("/orders/cancel", { orderId: state.orderId });
  state.cart = [];
  state.selectedCartKey = null;
  state.orderId = null;
  state.orderReference = null;
  state.billingReady = false;
  state.dirty = false;
  state.kotSubmitted = false;
  await refreshLiveState({ updateCart: true });
  refreshCartAndMenu();
});

availabilityBtn?.addEventListener("click", async () => {
  const code = await askPosInput(`Enter the item code to change availability:\n\n${state.items.map((item) => `${displayItemCode(item)} - ${item.name}`).join("\n")}`, "Item availability");
  if (!code) return;
  const item = state.items.find((row) => String(row.item_code || row.id).toLowerCase() === code.trim().toLowerCase() || String(row.id) === code.trim());
  if (!item) return alert("Item code not found");
  const available = await askPosConfirmation(`${item.name}\n\nConfirm to mark available. Cancel to mark unavailable.`, "Item availability");
  await postJson("/pos/item-availability", { id: item.id, active: available });
  alert(`${item.name} is now ${available ? "available" : "unavailable"}`);
  await refreshLiveState();
});

boot().then(renderCart).catch((err) => alert(err.message));
setInterval(() => refreshLiveState().catch(() => {}), 15000);
window.addEventListener("focus", () => refreshLiveState().catch(() => {}));
