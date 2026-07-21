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
async function loadBillingQrSettings() {
  const data = await getJson(`/settings?restaurantId=${encodeURIComponent(restaurantId)}`);
  const settings = data.settings || {};
  billingQrEnabled.checked = !['0', 0, false, 'false'].includes(settings.qr_ordering_enabled);
  billingQrPendingLimit.value = settings.qr_pending_order_limit || 25;
}
function visibleOrders() { const q = (billingSearch.value || '').toLowerCase().trim(); return state.orders.filter(o => o.has_submitted_kot && (!q || `${o.id} ${o.table_no || ''} ${o.customer_name || ''} ${o.order_reference || ''}`.toLowerCase().includes(q))).map(o => ({ ...o, total_amount: Number(o.submitted_total ?? o.total_amount ?? 0) })); }
function normalizeTableName(value) { return String(value || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function billingAmount(order) { return order.has_submitted_kot ? (order.submitted_total ?? order.total_amount) : 0; }
function tableOrders(table) { return visibleOrders().filter(o => o.payment_status !== 'PAID' && (Number(o.table_id) === Number(table.id) || String(o.table_no || '').trim().toLowerCase() === String(table.table_name || '').trim().toLowerCase())); }
function renderTables() {
  // Keep all open bills visible, including multiple customer checks at one table.
  tableMap.innerHTML = state.tables.map(table => {
    const orders = tableOrders(table);
    const bills = orders.length ? orders.map(order => `<button class="billing-open-bill" data-order-id="${order.id}"><strong>${esc(order.order_reference || `${order.order_sequence || order.id}-${order.customer_ref || `A${order.id}`}`)}</strong><span><b>${esc(order.customer_name || `Customer ${order.customer_ref || ''}`)}</b><em>${money(order.total_amount)}</em></span></button>`).join('') : '<span>Available</span>';
    const readyForBilling = orders.some(order => Number(order.billing_ready) === 1);
    return `<section class="billing-table-card ${readyForBilling ? 'ready-billing' : (orders.length ? 'running' : 'blank')}"><strong>${esc(table.table_name)}</strong>${readyForBilling ? '<span class="billing-ready-label">Ready for billing</span>' : ''}<div class="billing-open-bills">${bills}</div></section>`;
  }).join('');
}
function renderRecent() { const rows = visibleOrders().filter(o => state.filter === 'ALL' || (state.filter === 'TAKEAWAY' ? o.order_type !== 'DINE_IN' : o.order_type === state.filter)).slice(0, 12); recentOrders.innerHTML = rows.map(o => `<button class="recent-order" data-order-id="${o.id}"><strong>${esc(o.order_reference || `#${o.id}`)}</strong><span>${esc(o.table_no || o.order_type)} · ${money(o.total_amount)}</span><small>${esc(o.customer_name || 'No customer')} · ${esc(o.payment_status || 'UNPAID')}</small></button>`).join('') || '<p>No orders found.</p>'; }
async function showOrder(orderId) { const d = await getJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`); state.selected = d.order; billingDetail.innerHTML = `<header><div><h2>${esc(d.order.order_reference || `Order ${d.order.id}`)}</h2><p>${esc(d.order.table_no || d.order.order_type)} · ${esc(d.customer?.name || 'No customer')}</p></div><a class="primary-btn" href="/pos-live.html?restaurantId=${encodeURIComponent(restaurantId)}">Open POS</a></header><div class="bill-lines">${(d.items || []).map(i => `<div><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(i.price * i.quantity)}</strong></div>`).join('') || '<p>No items</p>'}</div><div class="bill-total"><span>Total</span><strong>${money(d.order.total_amount)}</strong></div><div class="billing-payment"><h3>Payment</h3><select id="billingPaymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="UPI">UPI</option></select><input id="billingPaymentAmount" type="number" step="0.01" value="${Number(d.order.total_amount || 0).toFixed(2)}"><button id="settleBilling" class="primary-btn" data-settle-order="${d.order.id}">Settle and create invoice</button></div>`; }
async function load() { const [boot, live, pendingQr] = await Promise.all([getJson(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`), getJson(`/orders/live?restaurantId=${encodeURIComponent(restaurantId)}`), getJson(`/qr/orders/pending?restaurantId=${encodeURIComponent(restaurantId)}`)]); state.tables = boot.tables || []; state.orders = live.orders || []; const restaurantName = boot.settings?.restaurantName || restaurantId; const nameElement = document.getElementById('billingRestaurantName'); if (nameElement) nameElement.textContent = restaurantName; openBills.textContent = state.orders.filter(o => o.payment_status !== 'PAID').length; paidToday.textContent = state.orders.filter(o => o.payment_status === 'PAID').length; collectionTotal.textContent = money(state.orders.filter(o => o.payment_status === 'PAID').reduce((s,o) => s + Number(o.total_amount || 0), 0)); billingStatus.textContent = `${state.tables.length} tables · ${state.orders.length} orders`; pendingQrApprovals.innerHTML=(pendingQr.orders||[]).map(o=>`<article class="qr-approval-row"><div><strong>${esc(o.table_no)} · ${esc(o.customer_name)}</strong><span>${(o.items||[]).map(i=>`${esc(i.name)} × ${i.quantity}`).join(', ')}</span><b>${money(o.total_amount)}</b></div><div class="qr-approval-actions"><button type="button" data-reject-qr="${o.id}" class="danger-btn">Reject</button><button type="button" data-approve-qr="${o.id}" class="primary-btn">Approve & send KOT</button></div></article>`).join('')||'<p>No QR orders waiting.</p>'; renderTables(); renderRecent(); }
document.addEventListener('click', e => { const order = e.target.closest('[data-order-id]'); if (order?.dataset.orderId) showOrder(order.dataset.orderId); const filter = e.target.closest('[data-recent-filter]'); if (filter) { state.filter = filter.dataset.recentFilter; document.querySelectorAll('[data-recent-filter]').forEach(x => x.classList.toggle('active', x === filter)); renderRecent(); } });
document.addEventListener('click', async e => { const button = e.target.closest('[data-settle-order]'); if (!button) return; const amount = Number(document.getElementById('billingPaymentAmount').value); const method = document.getElementById('billingPaymentMethod').value; const redeemPoints = Number(document.getElementById('billingRedeemPoints')?.value || 0); const printBill = button.dataset.printBill === 'true'; if (!Number.isFinite(amount) || amount <= 0) return alert('Enter a valid payment amount'); if (!Number.isInteger(redeemPoints) || redeemPoints < 0) return alert('Redeem points must be a whole number'); button.disabled = true; try { const user = JSON.parse(localStorage.getItem('user') || '{}'); const r = await fetch('/orders/settle', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId, actor: { id: user.id, role: user.role || 'CASHIER' }, orderId: Number(button.dataset.settleOrder), redeemPoints, payments: [{ method, amount }], printBill }) }); const d = await r.json(); if (!r.ok || d.success === false) throw Error(d.message || 'Settlement failed'); alert(printBill ? `${d.printMessage} Invoice ${d.invoiceNo}` : `Invoice ${d.invoiceNo} created`); window.dispatchEvent(new Event('pos:notifications-changed')); await load(); billingDetail.innerHTML = '<div class="billing-empty">Bill settled. Select another open customer bill.</div>'; } catch (err) { alert(err.message); button.disabled = false; } });
billingSearch.addEventListener('input', () => { renderTables(); renderRecent(); });
refreshBilling.addEventListener('click', () => Promise.all([load(), loadBillingQrSettings()]).catch(e => billingStatus.textContent = e.message));
saveBillingQrSettings.addEventListener('click', async () => {
  const limit = Number(billingQrPendingLimit.value);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) { billingQrSettingsStatus.textContent = 'Enter a maximum between 1 and 500.'; billingQrPendingLimit.focus(); return; }
  saveBillingQrSettings.disabled = true;
  try {
    const response = await fetch('/settings/update', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ restaurantId, actor:{ id:sessionUser.id, role:sessionUser.role }, settings:{ qr_ordering_enabled:billingQrEnabled.checked?'1':'0', qr_pending_order_limit:String(limit) } }) });
    const data = await response.json();
    if (!response.ok || data.success === false) throw Error(data.message || 'Unable to save QR settings');
    billingQrSettingsStatus.textContent = billingQrEnabled.checked ? 'QR ordering is enabled.' : 'QR ordering is disabled. Customers will be asked to order through the waiter.';
    await load();
  } catch (error) { billingQrSettingsStatus.textContent = error.message; }
  finally { saveBillingQrSettings.disabled = false; }
});
document.addEventListener('click', async (event) => { const button=event.target.closest('[data-approve-qr],[data-reject-qr]'); if(!button)return; const rejecting=Boolean(button.dataset.rejectQr); const orderId=Number(button.dataset.rejectQr||button.dataset.approveQr); button.disabled=true; try { const response=await fetch(rejecting?'/qr/orders/reject':'/qr/orders/approve',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restaurantId,actor:{id:sessionUser.id,role:sessionUser.role},orderId,reason:rejecting?'Rejected from billing':undefined})}); const data=await response.json(); if(!response.ok||data.success===false)throw Error(data.message||'QR order action failed'); billingStatus.textContent=data.message; window.dispatchEvent(new Event('pos:notifications-changed')); await load(); } catch(error){billingStatus.textContent=error.message;button.disabled=false;} });
Promise.all([load(), loadBillingQrSettings()]).catch(e => billingStatus.textContent = e.message);
setInterval(() => load().catch(e => { billingStatus.textContent = e.message; }), 10000);

// Billing must show only kitchen-submitted lines; saved draft lines stay in POS.
async function showSubmittedOrder(orderId) {
  const d = await getJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`);
  const items = (d.items || []).filter(item => item.kot_id);
  const kotGroups = items.reduce((groups, item) => {
    const sequence = item.kot_sequence || item.kot_id;
    const reference = `${d.order.order_reference || d.order.id}-${sequence}`;
    if (!groups.has(reference)) groups.set(reference, []);
    groups.get(reference).push(item);
    return groups;
  }, new Map());
  const kotSections = [...kotGroups.entries()].map(([reference, kotItems]) => `<section class="bill-kot-group"><h3>KOT ${esc(reference)}</h3>${kotItems.map(i => `<div><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(i.price * i.quantity)}</strong></div>`).join('')}</section>`).join('');
  const submittedTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  billingDetail.innerHTML = `<header><div><h2>${esc(d.order.order_reference || `Order ${d.order.id}`)}</h2><p>${esc(d.order.table_no || d.order.order_type)} · ${esc(d.customer?.name || 'No customer')}</p></div><a class="primary-btn" href="/pos-live.html?restaurantId=${encodeURIComponent(restaurantId)}">Open POS</a></header><div class="bill-lines">${kotSections || '<p>No submitted items</p>'}</div><div class="bill-total"><span>Submitted total</span><strong>${money(submittedTotal)}</strong></div><div class="billing-payment"><h3>Payment</h3><p class="billing-hint">Only KOT-submitted items are shown here. Save additional items in POS and submit a new KOT before billing them.</p><select id="billingPaymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="UPI">UPI</option></select><input id="billingPaymentAmount" type="number" step="0.01" value="${submittedTotal.toFixed(2)}"><button id="settleBilling" class="primary-btn" data-action-shortcut="F11" data-settle-order="${d.order.id}">Settle and create invoice</button></div>`;
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
      print.dataset.actionShortcut = 'F12';
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
