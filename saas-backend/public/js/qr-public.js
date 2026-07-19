const params = new URLSearchParams(location.search);
const restaurantId = String(params.get('restaurantId') || '').trim().toUpperCase();
const tableId = String(params.get('tableId') || '').trim();
const state = { storefront: null, categories: [], items: [], cart: [], currency: 'INR', categoryId: null };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = (value) => `${state.currency} ${Number(value || 0).toFixed(2)}`;

function render() {
  qrCategories.innerHTML = state.categories.map((category) => `<button type="button" data-category="${category.id}">${esc(category.name)}</button>`).join('');
  qrItems.innerHTML = state.items.filter((item) => String(item.category_id) === String(state.categoryId)).map((item) => `<article class="card"><strong>${esc(item.name)}</strong><span>${money(item.price)}</span><button type="button" data-item="${item.id}">Add</button></article>`).join('') || '<p>No items in this category.</p>';
  qrCartItems.innerHTML = state.cart.map((item) => `<div class="card"><strong>${esc(item.name)}</strong><span>${item.quantity} × ${money(item.price)}</span><button type="button" data-minus="${item.id}">−</button><button type="button" data-plus="${item.id}">+</button></div>`).join('') || '<p>Your cart is empty.</p>';
  qrTotal.textContent = `Total: ${money(state.cart.reduce((sum, item) => sum + Number(item.price) * item.quantity, 0))}`;
}

async function loadMenu() {
  if (!restaurantId || !/^\d+$/.test(tableId)) throw new Error('This QR link is invalid. Ask the waiter for a new QR code.');
  const storefrontData = await fetch('/online-ordering/storefronts').then((response) => response.json());
  state.storefront = (storefrontData.storefronts || []).find((row) => String(row.restaurant_code).toUpperCase() === restaurantId);
  if (!state.storefront) throw new Error('Online menu is not published for this restaurant yet.');
  const response = await fetch(`/online-ordering/storefront/${encodeURIComponent(state.storefront.slug)}/menu`);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load menu');
  state.categories = data.menu?.categories || [];
  state.items = data.menu?.items || [];
  state.currency = data.menu?.restaurant?.currency || 'INR';
  state.categoryId = state.categories[0]?.id || null;
  restaurantName.textContent = data.storefront.display_name;
  tableName.textContent = `Table ${tableId}`;
  qrStatus.textContent = `${state.items.length} menu items available`;
  render();
}

document.addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  if (button.dataset.category) state.categoryId = button.dataset.category;
  if (button.dataset.item) {
    const item = state.items.find((row) => String(row.id) === button.dataset.item);
    const line = state.cart.find((row) => String(row.id) === button.dataset.item);
    if (line) line.quantity += 1;
    else if (item) state.cart.push({ ...item, quantity: 1 });
  }
  if (button.dataset.plus) state.cart.find((row) => String(row.id) === button.dataset.plus).quantity += 1;
  if (button.dataset.minus) {
    const line = state.cart.find((row) => String(row.id) === button.dataset.minus);
    line.quantity -= 1;
    state.cart = state.cart.filter((row) => row.quantity > 0);
  }
  render();
});

placeQrOrder.addEventListener('click', async () => {
  try {
    qrCustomerNameError.textContent = '';
    qrCustomerPhoneError.textContent = '';
    qrCustomerName.removeAttribute('aria-invalid');
    qrCustomerPhone.removeAttribute('aria-invalid');
    const customerName = qrCustomerName.value.trim();
    const customerPhone = qrCustomerPhone.value.replace(/\D/g, '').slice(-10);
    if (!state.storefront || !state.cart.length) throw new Error('Add at least one item first.');
    if (!customerName) { qrCustomerNameError.textContent = 'Customer name is required.'; qrCustomerName.setAttribute('aria-invalid','true'); qrCustomerName.focus(); throw new Error('Customer name is required.'); }
    if (!/^\d{10}$/.test(customerPhone)) { qrCustomerPhoneError.textContent = 'Enter a valid 10-digit mobile number.'; qrCustomerPhone.setAttribute('aria-invalid','true'); qrCustomerPhone.focus(); throw new Error('Enter a valid 10-digit mobile number.'); }
    const response = await fetch(`/online-ordering/storefront/${encodeURIComponent(state.storefront.slug)}/orders`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderType: 'DINE_IN', tableId, customerName, customerPhone, paymentMode: 'COD', notes: qrOrderNotes.value.trim(), items: state.cart.map((item) => ({ itemId: item.id, itemName: item.name, quantity: item.quantity, unitPrice: item.price })) })
    });
    const data = await response.json();
    if (!response.ok || !data.success) {
      if (data.field === 'customerName') { qrCustomerNameError.textContent = data.message; qrCustomerName.setAttribute('aria-invalid','true'); }
      if (data.field === 'customerPhone') { qrCustomerPhoneError.textContent = data.message; qrCustomerPhone.setAttribute('aria-invalid','true'); }
      throw new Error(data.message || 'Unable to place order');
    }
    state.cart = [];
    render();
    qrStatus.textContent = `Order placed: ${data.order.order_no}. Waiting for billing approval before the table is occupied and KOT is printed.`;
  } catch (error) { qrStatus.textContent = error.message; }
});

loadMenu().catch((error) => { qrStatus.textContent = error.message; });
