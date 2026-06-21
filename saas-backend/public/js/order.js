let storefronts = [];
let selectedSlug = "";
let cart = [];

function money(value) {
  return Number(value || 0).toFixed(2);
}

function renderCart() {
  cartRows.innerHTML = cart.map((item) => `
    <tr>
      <td>${item.name}</td>
      <td>${item.quantity}</td>
      <td>${money(item.quantity * item.price)}</td>
    </tr>
  `).join("") || `<tr><td colspan="3">Cart is empty.</td></tr>`;
  cartTotal.innerText = money(cart.reduce((sum, item) => sum + item.quantity * item.price, 0));
}

function addToCart(item) {
  const existing = cart.find((line) => String(line.id) === String(item.id));
  if (existing) existing.quantity += 1;
  else cart.push({ id: item.id, name: item.name, price: Number(item.price || 0), quantity: 1 });
  renderCart();
}

async function loadStorefronts() {
  const res = await fetch("/online-ordering/storefronts");
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Unable to load branches");
  storefronts = data.storefronts || [];
  storefrontSelect.innerHTML = storefronts.map((sf) => `<option value="${sf.slug}">${sf.display_name} (${sf.pos_status})</option>`).join("");
  selectedSlug = storefrontSelect.value;
}

async function loadMenu() {
  selectedSlug = storefrontSelect.value;
  if (!selectedSlug) return;
  const res = await fetch(`/online-ordering/storefront/${encodeURIComponent(selectedSlug)}/menu`);
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Unable to load menu");
  const items = data.menu.items || [];
  menuItems.innerHTML = items.map((item) => `
    <div class="card">
      ${item.name}
      <strong>${money(item.price)}</strong>
      <small>${item.online_description || ""}</small>
      <button type="button" data-item-id="${item.id}">Add</button>
    </div>
  `).join("") || `<div class="card">No menu synced<strong>Ask the branch to sync menu from POS.</strong></div>`;
  menuItems.querySelectorAll("button[data-item-id]").forEach((button) => {
    const item = items.find((row) => String(row.id) === String(button.dataset.itemId));
    button.addEventListener("click", () => addToCart(item));
  });
  orderStatus.innerText = `Loaded ${data.storefront.display_name}`;
}

async function placeOrder() {
  if (!selectedSlug || cart.length === 0) throw new Error("Choose a branch and add items first");
  const res = await fetch(`/online-ordering/storefront/${encodeURIComponent(selectedSlug)}/orders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderType: orderType.value,
      customerName: customerName.value,
      customerPhone: customerPhone.value,
      deliveryAddress: deliveryAddress.value,
      paymentMode: paymentMode.value,
      items: cart.map((item) => ({ itemId: item.id, itemName: item.name, quantity: item.quantity, unitPrice: item.price }))
    })
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Unable to place order");
  cart = [];
  renderCart();
  orderStatus.innerText = `Order placed: ${data.order.order_no}`;
}

loadMenuBtn.addEventListener("click", () => loadMenu().catch((err) => { orderStatus.innerText = err.message; }));
placeOrderBtn.addEventListener("click", () => placeOrder().catch((err) => { orderStatus.innerText = err.message; }));

loadStorefronts()
  .then(loadMenu)
  .catch((err) => { orderStatus.innerText = err.message; });
renderCart();
