const params = new URLSearchParams(window.location.search);
const restaurantId = params.get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

const state = { categories: [], items: [], selectedCategory: null, cart: [], currency: "INR" };
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => `${state.currency} ${Number(value || 0).toFixed(2)}`;

async function loadMenu() {
  const res = await fetch(`/online/menu?restaurantId=${encodeURIComponent(restaurantId)}`);
  const data = await res.json();
  if (!data.success) throw new Error(data.message || "Menu unavailable");
  restaurantName.textContent = data.restaurant.displayName || "Online Order";
  state.currency = data.restaurant.currency || "INR";
  state.categories = data.categories || [];
  state.items = data.items || [];
  state.selectedCategory = state.categories[0]?.id || null;
  render();
}

function render() {
  categoryBar.innerHTML = state.categories.map((category) => `<button class="secondary-btn ${category.id === state.selectedCategory ? "active" : ""}" data-category="${category.id}">${esc(category.name)}</button>`).join("");
  itemsGrid.innerHTML = state.items.filter((item) => item.category_id === state.selectedCategory).map((item) => `
    <article class="menu-card">
      <h3>${esc(item.name)}</h3>
      <strong>${money(item.price)}</strong>
      <button data-add="${item.id}">Add</button>
    </article>
  `).join("");
  cartItems.innerHTML = state.cart.map((line) => `
    <p>${esc(line.name)} x${line.quantity} <button data-minus="${line.itemId}">-</button> <button data-add="${line.itemId}">+</button></p>
  `).join("") || "<p>No items selected.</p>";
  cartTotal.textContent = money(state.cart.reduce((sum, line) => sum + line.price * line.quantity, 0));
}

document.addEventListener("click", (event) => {
  const category = event.target.closest("[data-category]")?.dataset.category;
  const add = event.target.closest("[data-add]")?.dataset.add;
  const minus = event.target.closest("[data-minus]")?.dataset.minus;
  if (category) state.selectedCategory = Number(category);
  if (add) {
    const item = state.items.find((row) => row.id === Number(add));
    const line = state.cart.find((row) => row.itemId === item.id);
    if (line) line.quantity += 1;
    else state.cart.push({ itemId: item.id, name: item.name, price: Number(item.price || 0), quantity: 1 });
  }
  if (minus) {
    const line = state.cart.find((row) => row.itemId === Number(minus));
    if (line) line.quantity -= 1;
    state.cart = state.cart.filter((row) => row.quantity > 0);
  }
  render();
});

placeOrder.addEventListener("click", async () => {
  orderStatus.textContent = "";
  if (!customerName.value.trim() || !customerPhone.value.trim() || state.cart.length === 0) {
    orderStatus.textContent = "Name, phone and cart are required.";
    return;
  }
  const res = await fetch("/online/orders/place", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      restaurantId,
      customerName: customerName.value.trim(),
      customerPhone: customerPhone.value.trim(),
      orderType: orderType.value,
      deliveryAddress: deliveryAddress.value.trim(),
      items: state.cart.map((line) => ({ itemId: line.itemId, quantity: line.quantity }))
    })
  });
  const data = await res.json();
  if (!data.success) {
    orderStatus.textContent = data.message || "Order failed";
    return;
  }
  state.cart = [];
  render();
  orderStatus.textContent = `Order placed. Order #${data.orderId}`;
});

loadMenu().catch((err) => { orderStatus.textContent = err.message; });
