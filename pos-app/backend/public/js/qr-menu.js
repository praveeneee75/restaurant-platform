const params = new URLSearchParams(window.location.search);
const restaurantId = params.get("restaurantId");
const tableId = params.get("tableId");
const state = { categories: [], items: [], cart: [], currency: "INR", selectedCategoryId: null, pin: "", loaded: false };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => `${state.currency} ${Number(value || 0).toFixed(2)}`;

function total() {
  return state.cart.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
}

function render() {
  qrCategories.innerHTML = state.categories.map((category) => `<button class="${category.id === state.selectedCategoryId ? "active" : ""}" data-category="${category.id}">${esc(category.name)}</button>`).join("");
  qrItems.innerHTML = state.items.filter((item) => item.category_id === state.selectedCategoryId).map((item) => `
    <button class="item-tile" data-item="${item.id}">
      <strong>${esc(item.name)}</strong>
      <span>${money(item.price)}</span>
    </button>
  `).join("");
  qrCartItems.innerHTML = state.cart.map((item) => `
    <div class="cart-line">
      <strong>${esc(item.name)}</strong>
      <span>${item.quantity} x ${money(item.price)}</span>
      <div class="qty-controls">
        <button data-minus="${item.id}">-</button>
        <button data-plus="${item.id}">+</button>
      </div>
    </div>
  `).join("");
  qrTotal.textContent = `Total: ${money(total())}`;
}

async function loadMenu() {
  if (!restaurantId || !tableId) {
    qrStatus.textContent = "Invalid QR link";
    return;
  }
  state.pin = qrTablePin.value.replace(/\D/g, "").slice(0, 6);
  if (!/^\d{6}$/.test(state.pin)) { qrStatus.textContent = "Enter the current 6-digit table PIN from the waiter"; return; }
  const data = await fetch(`/qr/menu?restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(tableId)}&pin=${encodeURIComponent(state.pin)}`).then((res) => res.json());
  if (!data.success) {
    qrStatus.textContent = data.message;
    return;
  }
  state.categories = data.categories || [];
  state.items = data.items || [];
  state.currency = data.restaurant?.currency || "INR";
  state.selectedCategoryId = state.categories[0]?.id || null;
  state.loaded = true;
  qrCategories.hidden = false;
  qrItems.hidden = false;
  restaurantName.textContent = data.restaurant?.displayName || "Menu";
  tableName.textContent = data.table?.table_name || "";
  render();
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.category) {
    state.selectedCategoryId = Number(button.dataset.category);
    render();
  }
  if (button.dataset.item) {
    const item = state.items.find((row) => row.id === Number(button.dataset.item));
    const line = state.cart.find((row) => row.id === item.id);
    if (line) line.quantity += 1;
    else state.cart.push({ ...item, quantity: 1 });
    render();
  }
  if (button.dataset.plus) {
    state.cart.find((row) => row.id === Number(button.dataset.plus)).quantity += 1;
    render();
  }
  if (button.dataset.minus) {
    const line = state.cart.find((row) => row.id === Number(button.dataset.minus));
    line.quantity -= 1;
    state.cart = state.cart.filter((row) => row.quantity > 0);
    render();
  }
});

loadQrMenu.addEventListener("click", loadMenu);

placeQrOrder.addEventListener("click", async () => {
  if (!state.loaded) { qrStatus.textContent = "Open the menu with the current table PIN first"; return; }
  if (state.cart.length === 0) {
    qrStatus.textContent = "Add items first";
    return;
  }
  const customerName = qrCustomerName.value.trim();
  const customerPhone = qrCustomerPhone.value.replace(/\D/g, "").slice(-10);
  if (!customerName || !/^\d{10}$/.test(customerPhone)) {
    qrStatus.textContent = "Enter the customer name and a valid 10-digit mobile number";
    return;
  }
  const res = await fetch("/qr/orders/place", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurantId,
      tableId,
      pin: state.pin,
      customerName,
      customerPhone,
      items: state.cart.map((item) => ({ itemId: item.id, quantity: item.quantity }))
    })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    qrStatus.textContent = data.message || "Order failed";
    return;
  }
  qrStatus.textContent = `Order sent to kitchen. ${data.orderReference || `Order #${data.orderId}`} for ${data.customerName}`;
  state.cart = [];
  render();
});

loadMenu();
