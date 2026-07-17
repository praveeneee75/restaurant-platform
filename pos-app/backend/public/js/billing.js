const sessionUser = JSON.parse(localStorage.getItem('user') || 'null');
const allowedRoles = new Set(['OWNER', 'ADMIN', 'MANAGER', 'MANAGER_1', 'MANAGER_2', 'CASHIER']);
if (!sessionUser || !allowedRoles.has(String(sessionUser.role || '').toUpperCase())) {
  location.replace(`/login.html?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
  throw new Error('Authentication required');
}
const restaurantId = new URLSearchParams(location.search).get('restaurantId') || localStorage.getItem('restaurantId');
document.querySelectorAll('[data-role-nav="invoices"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2', 'CASHIER'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-role-nav="admin"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-role-nav="availability"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2', 'CASHIER', 'CAPTAIN'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-role-nav="kds"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_2', 'KITCHEN'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', () => { localStorage.clear(); location.href = '/login.html'; }));
const state = { tables: [], orders: [], selected: null, filter: 'ALL' };
const privilegedBillingRoles = new Set(['CASHIER', 'MANAGER_1', 'MANAGER_2', 'OWNER']);
const canSettleAndPrint = privilegedBillingRoles.has(String(sessionUser.role || '').toUpperCase());
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => `INR ${Number(v || 0).toFixed(2)}`;
async function getJson(url) { const r = await fetch(url); const d = await r.json(); if (!r.ok) throw Error(d.message || 'Unable to load billing data'); return d; }
function visibleOrders() { const q = (billingSearch.value || '').toLowerCase().trim(); return state.orders.filter(o => o.has_submitted_kot && (!q || `${o.id} ${o.table_no || ''} ${o.customer_name || ''} ${o.order_reference || ''}`.toLowerCase().includes(q))).map(o => ({ ...o, total_amount: Number(o.submitted_total ?? o.total_amount ?? 0) })); }
function normalizeTableName(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function billingAmount(order) { return order.has_submitted_kot ? (order.submitted_total ?? order.total_amount) : 0; }
function tableOrders(table) { return visibleOrders().filter(o => o.payment_status !== 'PAID' && (Number(o.table_id) === Number(table.id) || String(o.table_no || '').trim().toLowerCase() === String(table.table_name || '').trim().toLowerCase())); }
function renderTables() {
  // Keep all open bills visible, including multiple customer checks at one table.
  tableMap.innerHTML = state.tables.map(table => {
    const orders = tableOrders(table);
    const bills = orders.length ? orders.map(order => `<button class="billing-open-bill" data-order-id="${order.id}"><strong>${esc(order.order_reference || `${order.order_sequence || order.id}-${order.customer_ref || `A${order.id}`}`)}</strong><span><b>${esc(order.customer_name || `Customer ${order.customer_ref || ''}`)}</b><em>${money(order.total_amount)}</em></span></button>`).join('') : '<span>Available</span>';
    return `<section class="billing-table-card ${orders.length ? 'running' : 'blank'}"><strong>${esc(table.table_name)}</strong><div class="billing-open-bills">${bills}</div></section>`;
  }).join('');
}
function renderRecent() { const rows = visibleOrders().filter(o => state.filter === 'ALL' || (state.filter === 'TAKEAWAY' ? o.order_type !== 'DINE_IN' : o.order_type === state.filter)).slice(0, 12); recentOrders.innerHTML = rows.map(o => `<button class="recent-order" data-order-id="${o.id}"><strong>${esc(o.order_reference || `#${o.id}`)}</strong><span>${esc(o.table_no || o.order_type)} · ${money(o.total_amount)}</span><small>${esc(o.customer_name || 'No customer')} · ${esc(o.payment_status || 'UNPAID')}</small></button>`).join('') || '<p>No orders found.</p>'; }
async function showOrder(orderId) { const d = await getJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`); state.selected = d.order; billingDetail.innerHTML = `<header><div><h2>${esc(d.order.order_reference || `Order ${d.order.id}`)}</h2><p>${esc(d.order.table_no || d.order.order_type)} · ${esc(d.customer?.name || 'No customer')}</p></div><a class="primary-btn" href="/pos-live.html?restaurantId=${encodeURIComponent(restaurantId)}">Open POS</a></header><div class="bill-lines">${(d.items || []).map(i => `<div><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(i.price * i.quantity)}</strong></div>`).join('') || '<p>No items</p>'}</div><div class="bill-total"><span>Total</span><strong>${money(d.order.total_amount)}</strong></div><div class="billing-payment"><h3>Payment</h3><select id="billingPaymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="UPI">UPI</option></select><input id="billingPaymentAmount" type="number" step="0.01" value="${Number(d.order.total_amount || 0).toFixed(2)}"><button id="settleBilling" class="primary-btn" data-settle-order="${d.order.id}">Settle and create invoice</button></div>`; }
async function load() { const [boot, live] = await Promise.all([getJson(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`), getJson(`/orders/live?restaurantId=${encodeURIComponent(restaurantId)}`)]); state.tables = boot.tables || []; state.orders = live.orders || []; const restaurantName = boot.settings?.restaurantName || restaurantId; const nameElement = document.getElementById('billingRestaurantName'); if (nameElement) nameElement.textContent = restaurantName; openBills.textContent = state.orders.filter(o => o.payment_status !== 'PAID').length; paidToday.textContent = state.orders.filter(o => o.payment_status === 'PAID').length; collectionTotal.textContent = money(state.orders.filter(o => o.payment_status === 'PAID').reduce((s,o) => s + Number(o.total_amount || 0), 0)); billingStatus.textContent = `${state.tables.length} tables · ${state.orders.length} orders`; renderTables(); renderRecent(); }
document.addEventListener('click', e => { const order = e.target.closest('[data-order-id]'); if (order?.dataset.orderId) showOrder(order.dataset.orderId); const filter = e.target.closest('[data-recent-filter]'); if (filter) { state.filter = filter.dataset.recentFilter; document.querySelectorAll('[data-recent-filter]').forEach(x => x.classList.toggle('active', x === filter)); renderRecent(); } });
document.addEventListener('click', async e => { const button = e.target.closest('[data-settle-order]'); if (!button) return; const amount = Number(document.getElementById('billingPaymentAmount').value); const method = document.getElementById('billingPaymentMethod').value; const redeemPoints = Number(document.getElementById('billingRedeemPoints')?.value || 0); if (!Number.isFinite(amount) || amount <= 0) return alert('Enter a valid payment amount'); if (!Number.isInteger(redeemPoints) || redeemPoints < 0) return alert('Redeem points must be a whole number'); button.disabled = true; try { const user = JSON.parse(localStorage.getItem('user') || '{}'); const r = await fetch('/orders/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId, actor: { id: user.id, role: user.role || 'CASHIER' }, orderId: Number(button.dataset.settleOrder), redeemPoints, payments: [{ method, amount }] }) }); const d = await r.json(); if (!r.ok || d.success === false) throw Error(d.message || 'Settlement failed'); alert(`Invoice ${d.invoiceNo} created`); await load(); billingDetail.innerHTML = '<div class="billing-empty">Bill settled. Select another open customer bill.</div>'; } catch (err) { alert(err.message); button.disabled = false; } });
billingSearch.addEventListener('input', () => { renderTables(); renderRecent(); });
refreshBilling.addEventListener('click', () => load().catch(e => billingStatus.textContent = e.message));
load().catch(e => billingStatus.textContent = e.message);

// Billing must show only kitchen-submitted lines; saved draft lines stay in POS.
async function showSubmittedOrder(orderId) {
  const d = await getJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`);
  const items = (d.items || []).filter(item => item.kot_id);
  const submittedTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  billingDetail.innerHTML = `<header><div><h2>${esc(d.order.order_reference || `Order ${d.order.id}`)}</h2><p>${esc(d.order.table_no || d.order.order_type)} · ${esc(d.customer?.name || 'No customer')}</p></div><a class="primary-btn" href="/pos-live.html?restaurantId=${encodeURIComponent(restaurantId)}">Open POS</a></header><div class="bill-lines">${items.map(i => `<div><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(i.price * i.quantity)}</strong></div>`).join('') || '<p>No submitted items</p>'}</div><div class="bill-total"><span>Submitted total</span><strong>${money(submittedTotal)}</strong></div><div class="billing-payment"><h3>Payment</h3><p class="billing-hint">Only KOT-submitted items are shown here. Save additional items in POS and submit a new KOT before billing them.</p><select id="billingPaymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="UPI">UPI</option></select><input id="billingPaymentAmount" type="number" step="0.01" value="${submittedTotal.toFixed(2)}"><button id="settleBilling" class="primary-btn" data-settle-order="${d.order.id}">Settle and create invoice</button></div>`;
  const adjustments = document.createElement('section');
  adjustments.className = 'billing-adjustments';
  adjustments.innerHTML = '<h3>Discounts and rewards</h3>'
    + '<div class="billing-adjustment-grid">'
    + '<label for="billingPromoCode">Promocode <span class="field-help">Optional</span></label>'
    + '<div class="billing-adjustment-row"><input id="billingPromoCode" type="text" maxlength="40" autocomplete="off" placeholder="Enter promocode"><button type="button" class="secondary-btn" id="applyBillingPromo">Apply promocode</button></div>'
    + '<label for="billingCashDiscount">Cash discount amount <span class="field-help">INR</span></label>'
    + '<div class="billing-adjustment-row"><input id="billingCashDiscount" type="number" min="0" step="0.01" value="0" inputmode="decimal" autocomplete="off" placeholder="Enter amount"><button type="button" class="secondary-btn" id="applyBillingCashDiscount">Apply cash discount</button></div>'
    + '<label for="billingRedeemPoints">Reward points to redeem <span class="field-help">Whole points</span></label>'
    + '<div class="billing-adjustment-row"><input id="billingRedeemPoints" type="number" min="0" step="1" value="0" inputmode="numeric" autocomplete="off" placeholder="Enter points"><button type="button" class="secondary-btn" id="applyBillingRedeemPoints">Apply reward points</button></div>'
    + '</div><p class="billing-hint">Enter only the adjustment you want to use. Each adjustment is checked again when the bill is settled.</p><p id="billingAdjustmentStatus" role="status" aria-live="polite"></p>';
  billingDetail.querySelector('.billing-payment')?.before(adjustments);
  if (canSettleAndPrint) {
    const payment = billingDetail.querySelector('.billing-payment');
    const settle = payment?.querySelector('#settleBilling');
    if (payment && settle && !payment.querySelector('#settlePrintBilling')) {
      const print = settle.cloneNode(true);
      print.id = 'settlePrintBilling';
      print.textContent = 'Settle & Print';
      print.dataset.printBill = 'true';
      settle.insertAdjacentElement('afterend', print);
    }
  }
  document.getElementById('applyBillingPromo')?.addEventListener('click', async () => {
    const status = document.getElementById('billingAdjustmentStatus');
    const code = document.getElementById('billingPromoCode').value.trim().toUpperCase();
    if (!code) { status.textContent = 'Enter a promocode.'; return; }
    try {
      const response = await fetch('/orders/apply-discount', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId, orderId: d.order.id, type: 'PROMO', value: 1, valueType: 'FLAT', promoCode: code, appliedByRole: String(sessionUser.role || '').toUpperCase() }) });
      const result = await response.json();
      if (!response.ok || result.success === false) throw Error(result.message || 'Promocode could not be applied');
      document.getElementById('billingPaymentAmount').value = Number(result.netPayable).toFixed(2);
      status.textContent = `Promocode applied. Discount: ${money(result.discountAmount)}.`;
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById('applyBillingCashDiscount')?.addEventListener('click', async () => {
    const status = document.getElementById('billingAdjustmentStatus');
    const value = Number(document.getElementById('billingCashDiscount').value || 0);
    if (!Number.isFinite(value) || value <= 0) { status.textContent = 'Enter a cash discount greater than zero.'; return; }
    try {
      const response = await fetch('/orders/apply-discount', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId, orderId: d.order.id, type: 'MANUAL', value, valueType: 'FLAT', appliedByRole: String(sessionUser.role || '').toUpperCase() }) });
      const result = await response.json();
      if (!response.ok || result.success === false) throw Error(result.message || 'Cash discount could not be applied');
      document.getElementById('billingPaymentAmount').value = Number(result.netPayable).toFixed(2);
      status.textContent = `Cash discount applied: ${money(result.discountAmount)}.`;
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById('applyBillingRedeemPoints')?.addEventListener('click', () => {
    const status = document.getElementById('billingAdjustmentStatus');
    const input = document.getElementById('billingRedeemPoints');
    const value = Number(input.value || 0);
    const balance = Number(d.customer?.loyaltyBalance ?? d.customer?.loyalty_balance ?? 0);
    if (!Number.isInteger(value) || value < 0) { status.textContent = 'Reward points must be a whole number.'; return; }
    if (value > balance) { status.textContent = `Only ${balance} reward points are available.`; return; }
    status.textContent = value ? `${value} reward point${value === 1 ? '' : 's'} selected. Apply settlement to confirm.` : 'No reward points selected.';
  });
}
showOrder = showSubmittedOrder;
function applySubmittedTotals() { state.orders.forEach(order => { if (order.has_submitted_kot) order.total_amount = Number(order.submitted_total || 0); }); renderTables(); renderRecent(); }
setTimeout(applySubmittedTotals, 0);
