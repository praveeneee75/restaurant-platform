const params = new URLSearchParams(window.location.search);
const restaurantId = params.get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

const state = {
  categories: [],
  items: [],
  selectedCategory: null,
  cart: [],
  currency: "INR",
  restaurant: {},
  paymentMethods: [],
  paymentMethod: "",
  customer: null,
  promo: null,
  pendingRegistrationOtp: ""
};

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => `${state.currency} ${Number(value || 0).toFixed(2)}`;
const cleanPhone = () => customerPhone.value.replace(/\D/g, "").slice(-10);

async function api(url, options = {}) {
  const res = await fetch(url, options);
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

function subtotalAmount() {
  return state.cart.reduce((sum, line) => sum + Number(line.price || 0) * Number(line.quantity || 0), 0);
}

function totals() {
  const rawSubtotal = subtotalAmount();
  const promoDiscountValue = Math.min(Number(state.promo?.discount || 0), rawSubtotal);
  const creditBalance = Number(state.customer?.balance || state.customer?.creditBalance || 0);
  const creditValue = useLoyaltyCredit.checked && state.restaurant.allowLoyaltyCredit ? Math.min(creditBalance, rawSubtotal - promoDiscountValue) : 0;
  return {
    subtotal: rawSubtotal,
    promoDiscount: promoDiscountValue,
    creditDiscount: creditValue,
    grandTotal: Math.max(rawSubtotal - promoDiscountValue - creditValue, 0)
  };
}

function applyTheme() {
  document.documentElement.style.setProperty("--online-primary", state.restaurant.primaryColor || "#1f7a4d");
  document.documentElement.style.setProperty("--online-accent", state.restaurant.accentColor || "#f5b44b");
  document.body.dataset.onlineTheme = String(state.restaurant.theme || "CLASSIC").toLowerCase();
}

function renderBrand() {
  restaurantName.textContent = state.restaurant.displayName || "Restaurant";
  restaurantMeta.textContent = [state.restaurant.address, state.restaurant.phone].filter(Boolean).join(" | ") || "Fresh food, direct from the restaurant.";
  if (state.restaurant.logoPath) {
    brandLogo.src = state.restaurant.logoPath;
    brandLogo.hidden = false;
  }
  const choices = [];
  if (state.restaurant.takeawayEnabled) choices.push(["TAKEAWAY", "Takeaway"]);
  if (state.restaurant.deliveryEnabled) choices.push(["DELIVERY", "Delivery"]);
  if (choices.length === 0) choices.push(["ONLINE_ORDER", "Online Order"]);
  orderType.innerHTML = choices.map(([value, label]) => `<option value="${value}">${label}</option>`).join("");
  paymentMethods.innerHTML = state.paymentMethods.map((method, index) => `
    <label class="payment-choice">
      <input type="radio" name="paymentMethod" value="${esc(method.code)}" ${index === 0 ? "checked" : ""}>
      <span>${esc(method.label)}</span>
    </label>
  `).join("");
  state.paymentMethod = state.paymentMethods[0]?.code || "COD";
  paymentMethods.addEventListener("change", (event) => {
    if (event.target.name === "paymentMethod") state.paymentMethod = event.target.value;
  });
  applyTheme();
}

function renderMenu() {
  categoryBar.innerHTML = [`<button class="${!state.selectedCategory ? "active" : ""}" data-category="">All</button>`]
    .concat(state.categories.map((category) => `<button class="${String(state.selectedCategory) === String(category.id) ? "active" : ""}" data-category="${category.id}">${esc(category.name)}</button>`))
    .join("");
  const term = menuSearch.value.trim().toLowerCase();
  const rows = state.items.filter((item) => {
    const categoryMatch = !state.selectedCategory || String(item.category_id) === String(state.selectedCategory);
    const searchMatch = !term || item.name.toLowerCase().includes(term) || String(item.online_description || "").toLowerCase().includes(term);
    return categoryMatch && searchMatch;
  });
  itemsGrid.innerHTML = rows.map((item) => `
    <article class="online-item">
      <img src="${esc(item.image_url || "")}" alt="${esc(item.name)}" loading="lazy" onerror="this.closest('.online-item').classList.add('image-failed'); this.remove();">
      <div>
        <h3>${esc(item.name)}</h3>
        <p>${esc(item.online_description || (item.is_veg ? "Vegetarian" : "Restaurant special"))}</p>
        <strong>${money(item.price)}</strong>
      </div>
      <button data-add-item="${item.id}" type="button">Add</button>
    </article>
  `).join("") || `<p>No items found.</p>`;
}

function renderCart() {
  cartList.innerHTML = state.cart.map((line) => `
    <div class="online-cart-row">
      <div>
        <strong>${esc(line.name)}</strong>
        <small>${money(line.price)}</small>
      </div>
      <div class="qty-controls">
        <button data-dec="${line.id}" type="button">-</button>
        <span>${line.quantity}</span>
        <button data-inc="${line.id}" type="button">+</button>
      </div>
    </div>
  `).join("") || `<p>Your cart is empty.</p>`;
  const values = totals();
  document.getElementById("subtotal").textContent = money(values.subtotal);
  promoDiscount.textContent = `-${money(values.promoDiscount)}`;
  creditDiscount.textContent = `-${money(values.creditDiscount)}`;
  grandTotal.textContent = money(values.grandTotal);
}

async function loadMenu() {
  if (!restaurantId) throw new Error("restaurantId is required in the URL");
  const data = await api(`/online/menu?restaurantId=${encodeURIComponent(restaurantId)}`);
  state.restaurant = data.restaurant || {};
  state.currency = state.restaurant.currency || "INR";
  state.categories = data.categories || [];
  state.items = data.items || [];
  state.paymentMethods = data.paymentMethods || [];
  renderBrand();
  renderMenu();
  renderCart();
}

sendOtp.addEventListener("click", async () => {
  try {
    authStatus.textContent = "Sending OTP...";
    const data = await api("/online/auth/request-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, phone: cleanPhone() })
    });
    authStatus.textContent = data.devOtp ? `OTP sent. Dev OTP: ${data.devOtp}` : "OTP sent";
  } catch (err) {
    authStatus.textContent = err.message;
  }
});

verifyOtp.addEventListener("click", async () => {
  try {
    authStatus.textContent = "Verifying...";
    const data = await api("/online/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, phone: cleanPhone(), otp: customerOtp.value })
    });
    if (data.requiresRegistration) {
      state.pendingRegistrationOtp = customerOtp.value;
      registrationPanel.hidden = false;
      authStatus.textContent = data.message || "Please complete registration";
      return;
    }
    state.customer = data.customer;
    customerGreeting.textContent = `Hi ${state.customer.name || "Customer"} | Credit ${money(state.customer.balance || state.customer.creditBalance || 0)}`;
    authStatus.textContent = "Mobile verified";
    renderCart();
  } catch (err) {
    authStatus.textContent = err.message;
  }
});

completeRegistration.addEventListener("click", async () => {
  try {
    if (!registrationName.value.trim()) throw new Error("Name is required for registration");
    const data = await api("/online/auth/verify-otp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, phone: cleanPhone(), otp: state.pendingRegistrationOtp || customerOtp.value, name: registrationName.value })
    });
    state.customer = data.customer;
    registrationPanel.hidden = true;
    customerGreeting.textContent = `Hi ${state.customer.name || "Customer"} | Credit ${money(state.customer.balance || state.customer.creditBalance || 0)}`;
    authStatus.textContent = "Registration complete";
    renderCart();
  } catch (err) {
    authStatus.textContent = err.message;
  }
});

categoryBar.addEventListener("click", (event) => {
  const button = event.target.closest("[data-category]");
  if (!button) return;
  state.selectedCategory = button.dataset.category || null;
  renderMenu();
});

menuSearch.addEventListener("input", renderMenu);
orderType.addEventListener("change", () => {
  deliveryAddressWrap.hidden = orderType.value !== "DELIVERY";
});
useLoyaltyCredit.addEventListener("change", renderCart);

itemsGrid.addEventListener("click", (event) => {
  const button = event.target.closest("[data-add-item]");
  if (!button) return;
  const item = state.items.find((row) => String(row.id) === String(button.dataset.addItem));
  if (!item) return;
  const line = state.cart.find((row) => row.id === item.id);
  if (line) line.quantity += 1;
  else state.cart.push({ id: item.id, name: item.name, price: item.price, quantity: 1 });
  renderCart();
});

cartList.addEventListener("click", (event) => {
  const inc = event.target.closest("[data-inc]");
  const dec = event.target.closest("[data-dec]");
  const id = inc?.dataset.inc || dec?.dataset.dec;
  if (!id) return;
  const line = state.cart.find((row) => String(row.id) === String(id));
  if (!line) return;
  line.quantity += inc ? 1 : -1;
  state.cart = state.cart.filter((row) => row.quantity > 0);
  renderCart();
});

applyPromo.addEventListener("click", async () => {
  try {
    if (!promoCode.value.trim()) return;
    const data = await api("/online/promo/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, code: promoCode.value, total: subtotalAmount() })
    });
    state.promo = data.promo;
    orderStatus.textContent = `Promo applied: ${state.promo.code}`;
    renderCart();
  } catch (err) {
    state.promo = null;
    orderStatus.textContent = err.message;
    renderCart();
  }
});

placeOrder.addEventListener("click", async () => {
  try {
    if (state.cart.length === 0) throw new Error("Add at least one item");
    if (state.restaurant.requireOtp && !state.customer) throw new Error("Verify mobile OTP before placing order");
    if (orderType.value === "DELIVERY" && !deliveryAddress.value.trim()) throw new Error("Delivery address is required");
    orderStatus.textContent = "Placing order...";
    placeOrder.disabled = true;
    const values = totals();
    const data = await api("/online/orders/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId,
        orderType: orderType.value,
        customerName: state.customer?.name || registrationName.value || "",
        customerPhone: cleanPhone(),
        deliveryAddress: deliveryAddress.value,
        paymentMethod: state.paymentMethod,
        promoCode: state.promo?.code || "",
        redeemPoints: useLoyaltyCredit.checked ? Math.floor(Math.min(Number(state.customer?.balance || 0), values.subtotal)) : 0,
        useCredit: useLoyaltyCredit.checked,
        items: state.cart.map((line) => ({ itemId: line.id, quantity: line.quantity }))
      })
    });
    state.cart = [];
    state.promo = null;
    renderCart();
    orderStatus.innerHTML = `<strong>Order #${esc(data.orderId)} received.</strong><br>Total ${money(data.total)} via ${esc(data.paymentMethod || state.paymentMethod)}.`;
  } catch (err) {
    orderStatus.textContent = err.message;
  } finally {
    placeOrder.disabled = false;
  }
});

loadMenu().then(() => {
  deliveryAddressWrap.hidden = orderType.value !== "DELIVERY";
}).catch((err) => {
  document.querySelector(".online-shell").innerHTML = `<section class="online-disabled"><h1>Online ordering unavailable</h1><p>${esc(err.message)}</p></section>`;
});
