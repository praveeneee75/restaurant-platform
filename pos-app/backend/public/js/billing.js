const sessionUser = JSON.parse(localStorage.getItem('user') || 'null');
const allowedRoles = new Set(['OWNER', 'ADMIN', 'MANAGER', 'MANAGER_1', 'MANAGER_2', 'CASHIER']);
if (!sessionUser || !allowedRoles.has(String(sessionUser.role || '').toUpperCase())) {
  location.replace(`/login.html?returnTo=${encodeURIComponent(location.pathname + location.search)}`);
  throw new Error('Authentication required');
}
const restaurantId = new URLSearchParams(location.search).get('restaurantId') || localStorage.getItem('restaurantId');
const requestedOrderId = Number(new URLSearchParams(location.search).get('orderId') || 0);
document.querySelectorAll('[data-role-nav="invoices"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2', 'CASHIER'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-role-nav="admin"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-role-nav="availability"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2', 'CASHIER', 'CAPTAIN'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-role-nav="kds"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_2', 'KITCHEN'].includes(String(sessionUser.role || '').toUpperCase()); });
document.querySelectorAll('[data-logout]').forEach((button) => button.addEventListener('click', () => { localStorage.clear(); location.href = '/login.html'; }));
const state = { tables: [], orders: [], selected: null, filter: 'ALL', billingSettings: {} };
const privilegedBillingRoles = new Set(['CASHIER', 'MANAGER_1', 'MANAGER_2', 'OWNER']);
const canSettleAndPrint = privilegedBillingRoles.has(String(sessionUser.role || '').toUpperCase());
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money = v => `INR ${Number(v || 0).toFixed(2)}`;
async function getJson(url) { const r = await fetch(url); const d = await r.json(); if (!r.ok) throw Error(d.message || 'Unable to load billing data'); return d; }
async function loadBillingQrSettings() {
  const data = await getJson(`/settings?restaurantId=${encodeURIComponent(restaurantId)}`);
  const settings = data.settings || {};
  state.billingSettings = settings;
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
    const bills = orders.length ? orders.map(order => {
      const readyForBilling = Number(order.billing_ready) === 1;
      return `<button class="billing-open-bill${readyForBilling ? ' ready-billing' : ''}" data-order-id="${order.id}"><strong>${esc(order.order_reference || `${order.order_sequence || order.id}-${order.customer_ref || `A${order.id}`}`)}</strong><span><b>${esc(order.customer_name || `Customer ${order.customer_ref || ''}`)}</b><em>${money(order.total_amount)}</em></span>${readyForBilling ? '<small class="billing-ready-label">Ready for billing</small>' : ''}</button>`;
    }).join('') : '<span>Available</span>';
    return `<section class="billing-table-card ${orders.length ? 'running' : 'blank'}" data-cashier-table-id="${table.id}" title="Open cashier dine-in order entry"><strong>${esc(table.table_name)}</strong><div class="billing-open-bills">${bills}</div></section>`;
  }).join('');
}
function renderRecent() { const rows = visibleOrders().filter(o => state.filter === 'ALL' || (state.filter === 'TAKEAWAY' ? o.order_type !== 'DINE_IN' : o.order_type === state.filter)).slice(0, 12); recentOrders.innerHTML = rows.map(o => `<button class="recent-order" data-order-id="${o.id}"><strong>${esc(o.order_reference || `#${o.id}`)}</strong><span>${esc(o.table_no || o.order_type)} · ${money(o.total_amount)}</span><small>${esc(o.customer_name || 'No customer')} · ${esc(o.payment_status || 'UNPAID')}</small></button>`).join('') || '<p>No orders found.</p>'; }
async function showOrder(orderId) { const d = await getJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`); state.selected = d.order; billingDetail.innerHTML = `<header><div><h2>${esc(d.order.order_reference || `Order ${d.order.id}`)}</h2><p>${esc(d.order.table_no || d.order.order_type)} · ${esc(d.customer?.name || 'No customer')}</p></div><a class="primary-btn" href="/pos-live.html?restaurantId=${encodeURIComponent(restaurantId)}">Open POS</a></header><div class="bill-lines">${(d.items || []).map(i => `<div><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(i.price * i.quantity)}</strong></div>`).join('') || '<p>No items</p>'}</div><div class="bill-total"><span>Total</span><strong>${money(d.order.total_amount)}</strong></div><div class="billing-payment"><h3>Payment</h3><select id="billingPaymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="UPI">UPI</option></select><input id="billingPaymentAmount" type="number" step="0.01" value="${Number(d.order.total_amount || 0).toFixed(2)}"><button id="settleBilling" class="primary-btn" data-settle-order="${d.order.id}">Settle and create invoice</button></div>`; }
async function load() { const [boot, live, pendingQr] = await Promise.all([getJson(`/pos/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`), getJson(`/orders/live?restaurantId=${encodeURIComponent(restaurantId)}`), getJson(`/qr/orders/pending?restaurantId=${encodeURIComponent(restaurantId)}`)]); state.tables = boot.tables || []; state.orders = live.orders || []; const restaurantName = boot.settings?.restaurantName || restaurantId; const nameElement = document.getElementById('billingRestaurantName'); if (nameElement) nameElement.textContent = restaurantName; openBills.textContent = state.orders.filter(o => o.payment_status !== 'PAID').length; paidToday.textContent = state.orders.filter(o => o.payment_status === 'PAID').length; collectionTotal.textContent = money(state.orders.filter(o => o.payment_status === 'PAID').reduce((s,o) => s + Number(o.total_amount || 0), 0)); billingStatus.textContent = `${state.tables.length} tables · ${state.orders.length} orders`; pendingQrApprovals.innerHTML=(pendingQr.orders||[]).map(o=>`<article class="qr-approval-row"><div><strong>${esc(o.table_no)} · ${esc(o.customer_name)}</strong><span>${(o.items||[]).map(i=>`${esc(i.name)} × ${i.quantity}`).join(', ')}</span><b>${money(o.total_amount)}</b></div><div class="qr-approval-actions"><button type="button" data-reject-qr="${o.id}" class="danger-btn">Reject</button><button type="button" data-approve-qr="${o.id}" class="primary-btn">Approve & send KOT</button></div></article>`).join('')||'<p>No QR orders waiting.</p>'; renderTables(); renderRecent(); }
document.addEventListener('click', e => { const order = e.target.closest('[data-order-id]'); if (order?.dataset.orderId) { showOrder(order.dataset.orderId); return; } const table = e.target.closest('[data-cashier-table-id]'); if (table) { location.href = `/pos-live.html?mode=DINE_IN&layout=cashier&returnTo=billing&restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(table.dataset.cashierTableId)}`; return; } const filter = e.target.closest('[data-recent-filter]'); if (filter) { state.filter = filter.dataset.recentFilter; document.querySelectorAll('[data-recent-filter]').forEach(x => x.classList.toggle('active', x === filter)); renderRecent(); } });
document.addEventListener('click', async e => {
  const button = e.target.closest('[data-settle-order]');
  if (!button) return;
  const amount = Number(document.getElementById('billingPaymentAmount').value);
  const method = document.getElementById('billingPaymentMethod').value;
  const redeemPoints = Number(document.getElementById('billingRedeemPoints')?.value || 0);
  const settlementMode = button.dataset.settlementMode || 'INVOICE';
  const isInvoice = settlementMode !== 'NO_INVOICE';
  const printBill = settlementMode === 'PRINT';
  if (!Number.isFinite(amount) || amount <= 0) return alert('Enter a valid payment amount');
  if (!Number.isInteger(redeemPoints) || redeemPoints < 0) return alert('Redeem points must be a whole number');
  button.disabled = true;
  try {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    const r = await fetch('/orders/settle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurantId,
        actor: { id: user.id, role: user.role || 'CASHIER' },
        orderId: Number(button.dataset.settleOrder),
        redeemPoints,
        payments: [{ method, amount }],
        isInvoice,
        printBill,
        discardSavedItems: true
      })
    });
    const d = await r.json();
    if (!r.ok || d.success === false) throw Error(d.message || 'Settlement failed');
    const discarded = Number(d.discardedSavedItemCount || 0);
    const discardMessage = discarded ? ` ${discarded} saved item${discarded === 1 ? '' : 's'} discarded.` : '';
    const resultMessage = settlementMode === 'NO_INVOICE'
      ? 'Order settled without an invoice. An invoice can be generated later from Invoices.'
      : printBill
        ? `${d.printMessage} Invoice ${d.invoiceNo}`
        : `Invoice ${d.invoiceNo} created without printing`;
    alert(resultMessage + discardMessage);
    window.dispatchEvent(new Event('pos:notifications-changed'));
    await load();
    billingDetail.innerHTML = '<div class="billing-empty">Bill settled. Select another open customer bill.</div>';
  } catch (err) {
    alert(err.message);
    button.disabled = false;
  }
});
billingSearch.addEventListener('input', () => { renderTables(); renderRecent(); });
refreshBilling.addEventListener('click', () => Promise.all([load(), loadBillingQrSettings()]).catch(e => billingStatus.textContent = e.message));
transferBillingOrder.addEventListener('click', () => openBillingOrderTransfer().catch((error) => { billingStatus.textContent = error.message; }));
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
Promise.all([load(), loadBillingQrSettings()]).then(() => {
  if (requestedOrderId > 0) return showSubmittedOrder(requestedOrderId);
}).catch(e => billingStatus.textContent = e.message);
setInterval(() => load().catch(e => { billingStatus.textContent = e.message; }), 10000);

// Billing must show only kitchen-submitted lines; saved draft lines stay in POS.
async function showSubmittedOrder(orderId) {
  const d = await getJson(`/orders/open?restaurantId=${encodeURIComponent(restaurantId)}&orderId=${encodeURIComponent(orderId)}`);
  state.selected = d.order;
  transferBillingOrder.disabled = !d.order?.id || d.order.payment_status === 'PAID';
  const items = (d.items || []).filter(item => item.kot_id);
  const kotGroups = items.reduce((groups, item) => {
    const sequence = item.kot_sequence || item.kot_id;
    const reference = `${d.order.order_reference || d.order.id}-${sequence}`;
    if (!groups.has(reference)) groups.set(reference, []);
    groups.get(reference).push(item);
    return groups;
  }, new Map());
  const taxRate = Number(d.pricing?.taxRate || 0);
  const grossLineAmount = (item) => Number(item.price || 0) * Number(item.quantity || 0) * (String(item.tax_mode || 'INCLUSIVE').toUpperCase() === 'EXCLUSIVE' ? (1 + taxRate / 100) : 1);
  const kotSections = [...kotGroups.entries()].map(([reference, kotItems]) => `<section class="bill-kot-group"><h3>KOT ${esc(reference)}</h3>${kotItems.map(i => `<div><span>${esc(i.name)} × ${i.quantity}</span><strong>${money(grossLineAmount(i))}</strong></div>`).join('')}</section>`).join('');
  const listedTotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 0), 0);
  const pricing = d.pricing || {};
  const grossTotal = Number(pricing.payableSubtotal ?? listedTotal);
  const persistedAdjustments = d.adjustments || {};
  const displayedDiscount = Math.max(Number(persistedAdjustments.discountAmount || 0), 0);
  const displayedServiceCharge = Math.max(Number(persistedAdjustments.serviceCharge || 0), 0);
  const displayedRoundOff = Number(persistedAdjustments.roundOff || 0);
  const submittedTotal = Number(persistedAdjustments.netPayable ?? grossTotal);
  const persistedPromo = (d.discounts || []).find((discount) => String(discount.type || '').toUpperCase() === 'PROMO');
  const persistedManual = (d.discounts || []).find((discount) => String(discount.type || '').toUpperCase() === 'MANUAL');
  const enabled = (key) => !['0', 0, false, 'false'].includes(state.billingSettings[key] ?? '1');
  const cashierUrl = `/pos-live.html?mode=DINE_IN&layout=cashier&returnTo=billing&restaurantId=${encodeURIComponent(restaurantId)}&tableId=${encodeURIComponent(d.order.table_id || '')}&orderId=${encodeURIComponent(d.order.id)}`;
  const discountDetails = (d.discounts || []).map((discount) => {
    const type = String(discount.type || '').toUpperCase();
    const amount = String(discount.value_type || '').toUpperCase() === 'PERCENT' ? grossTotal * Number(discount.value || 0) / 100 : Number(discount.value || 0);
    const label = type === 'PROMO' ? `Promocode${discount.promo_code ? ` · ${discount.promo_code}` : ''}`
      : type === 'LOYALTY_PROGRAM' ? `Loyalty program${discount.promo_code ? ` · ${discount.promo_code}` : ''}`
      : type === 'MANUAL' ? `Manual ${String(discount.value_type || '').toUpperCase() === 'PERCENT' ? 'percentage' : 'cash'} discount`
      : (type.replaceAll('_', ' ').toLowerCase() || 'Discount');
    return `<div class="bill-adjustment-row discount"><span>${esc(label)}</span><strong>-${money(amount)}</strong></div>`;
  }).join('');
  const rewardDiscount = Math.max(Number(d.order.loyalty_discount || 0), 0);
  const rewardDetail = rewardDiscount > 0 ? `<div class="bill-adjustment-row discount"><span>Reward points${Number(d.order.redeemed_points || 0) ? ` · ${Number(d.order.redeemed_points)} points` : ''}</span><strong>-${money(rewardDiscount)}</strong></div>` : '';
  const adjustmentRows = `${discountDetails || rewardDetail ? discountDetails + rewardDetail : (displayedDiscount > 0 ? `<div class="bill-adjustment-row discount"><span>Discount applied</span><strong>-${money(displayedDiscount)}</strong></div>` : '')}${displayedServiceCharge > 0 ? `<div class="bill-adjustment-row"><span>Service charge</span><strong>${money(displayedServiceCharge)}</strong></div>` : ''}${Math.abs(displayedRoundOff) >= 0.005 ? `<div class="bill-adjustment-row"><span>Round off</span><strong>${displayedRoundOff < 0 ? '-' : ''}${money(Math.abs(displayedRoundOff))}</strong></div>` : ''}`;
  billingDetail.innerHTML = `<header><div><h2>${esc(d.order.order_reference || `Order ${d.order.id}`)}</h2><p>${esc(d.order.table_no || d.order.order_type)} · ${esc(d.customer?.name || 'No customer')}</p></div><div class="billing-detail-actions"><button type="button" class="secondary-btn" id="billingSplitBill">Split Bill</button><button type="button" class="secondary-btn" id="billingMergeBill">Merge Bill</button>${Number(d.order.billing_ready) === 1 ? '<button type="button" class="secondary-btn" id="billingUnlockBill">Unlock</button>' : ''}<a class="primary-btn" href="${cashierUrl}">Open POS</a></div></header><div class="bill-lines">${kotSections || '<p>No submitted items</p>'}</div><div class="billing-total-breakdown"><div class="bill-adjustment-row"><span>Subtotal (including tax)</span><strong>${money(grossTotal)}</strong></div>${adjustmentRows}<div class="bill-total"><span>Payable total (including tax)</span><strong>${money(submittedTotal)}</strong></div></div><div class="billing-payment"><h3>Payment</h3><p class="billing-hint">Only KOT-submitted items are billed.</p><select id="billingPaymentMethod"><option value="CASH">Cash</option><option value="CARD">Card</option><option value="UPI">UPI</option></select><input id="billingPaymentAmount" type="number" step="0.01" value="${submittedTotal.toFixed(2)}"><div class="billing-settlement-actions">${enabled('billing_show_settle_print') ? `<button id="settlePrintBilling" class="primary-btn" data-action-shortcut="F12" data-settlement-mode="PRINT" data-settle-order="${d.order.id}">Settle &amp; Print</button>` : ''}${enabled('billing_show_settle_invoice') ? `<button id="settleBilling" class="primary-btn" data-action-shortcut="F11" data-settlement-mode="INVOICE" data-settle-order="${d.order.id}">Settle &amp; Create Invoice</button>` : ''}${enabled('billing_show_settle_only') ? `<button id="settleWithoutInvoice" class="primary-btn" data-settlement-mode="NO_INVOICE" data-settle-order="${d.order.id}">Settle</button>` : ''}</div></div>`;
  document.getElementById('billingSplitBill')?.addEventListener('click', () => openBillingSplit(d, items));
  document.getElementById('billingMergeBill')?.addEventListener('click', () => openBillingMerge(d));
  document.getElementById('billingUnlockBill')?.addEventListener('click', async () => {
    if (!confirm('Unlock this bill so POS can accept additional items?')) return;
    const response = await fetch('/orders/unlock-billing', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ restaurantId, actor:{id:sessionUser.id,role:sessionUser.role}, orderId:d.order.id }) });
    const result = await response.json();
    if (!response.ok || result.success === false) return alert(result.message || 'Unable to unlock bill');
    alert(result.message);
    await load();
    await showSubmittedOrder(d.order.id);
  });
  const adjustments = document.createElement('section');
  adjustments.className = 'billing-adjustments';
  adjustments.hidden = !['billing_show_promocode', 'billing_show_reward_points', 'billing_show_cash_discount', 'billing_show_percentage_discount'].some(enabled);
  adjustments.innerHTML = '<h3>Discounts and rewards</h3>'
    + '<div class="billing-adjustment-grid">'
    + (enabled('billing_show_promocode') ? '<div class="billing-adjustment-option"><label for="billingPromoCode">Promocode <span class="field-help">Optional</span></label><div class="billing-adjustment-row"><input id="billingPromoCode" type="text" maxlength="40" autocomplete="off" placeholder="Enter promocode"><button type="button" class="secondary-btn" id="applyBillingPromo">Apply promocode</button></div></div>' : '')
    + '<div class="billing-discount-pair">'
    + (enabled('billing_show_cash_discount') ? '<div class="billing-adjustment-option"><label for="billingCashDiscount">Cash discount amount <span class="field-help">INR</span></label><div class="billing-adjustment-row"><input id="billingCashDiscount" type="number" min="0" step="0.01" value="0" inputmode="decimal" placeholder="Enter amount"><button type="button" class="secondary-btn" id="applyBillingCashDiscount">Apply cash discount</button></div></div>' : '')
    + (enabled('billing_show_percentage_discount') ? '<div class="billing-adjustment-option"><label for="billingPercentageDiscount">Percentage discount <span class="field-help">%</span></label><div class="billing-adjustment-row"><input id="billingPercentageDiscount" type="number" min="0" max="100" step="0.01" value="0" inputmode="decimal" placeholder="Enter percent"><button type="button" class="secondary-btn" id="applyBillingPercentageDiscount">Apply percentage</button></div></div>' : '')
    + '</div>'
    + (enabled('billing_show_reward_points') ? '<div class="billing-adjustment-option"><label for="billingRedeemPoints">Reward points to redeem <span class="field-help">Whole points</span></label><div class="billing-adjustment-row"><input id="billingRedeemPoints" type="number" min="0" step="1" value="0" inputmode="numeric" placeholder="Enter points"><button type="button" class="secondary-btn" id="applyBillingRedeemPoints">Apply reward points</button></div></div>' : '')
    + '</div><p class="billing-hint">Enter only the adjustment you want to use. Each adjustment is checked again when the bill is settled.</p><p id="billingAdjustmentStatus" role="status" aria-live="polite"></p>';
  billingDetail.querySelector('.billing-payment')?.before(adjustments);
  const promoInput = document.getElementById('billingPromoCode');
  const cashDiscountInput = document.getElementById('billingCashDiscount');
  const adjustmentStatus = document.getElementById('billingAdjustmentStatus');
  if (persistedPromo && promoInput) promoInput.value = persistedPromo.promo_code || '';
  if (persistedManual && cashDiscountInput && String(persistedManual.value_type || '').toUpperCase() !== 'PERCENT') cashDiscountInput.value = Number(persistedManual.amount || persistedManual.value || 0).toFixed(2);
  if (persistedPromo || persistedManual) {
    const parts = [];
    if (persistedPromo) parts.push(`Promocode ${persistedPromo.promo_code || ''} applied`);
    if (persistedManual) parts.push(`discount ${money(displayedDiscount)} applied`);
    adjustmentStatus.textContent = `${parts.join('; ')}. Payable: ${money(submittedTotal)}.`;
  }
  if (document.getElementById('settlePrintBilling')) document.getElementById('settlePrintBilling').hidden = !canSettleAndPrint;
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
      await showSubmittedOrder(d.order.id);
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
      await showSubmittedOrder(d.order.id);
    } catch (error) { status.textContent = error.message; }
  });
  document.getElementById('applyBillingPercentageDiscount')?.addEventListener('click', async () => {
    const status = document.getElementById('billingAdjustmentStatus');
    const value = Number(document.getElementById('billingPercentageDiscount').value || 0);
    if (!Number.isFinite(value) || value <= 0 || value > 100) { status.textContent = 'Enter a percentage between 0 and 100.'; return; }
    try {
      const response = await fetch('/orders/apply-discount', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ restaurantId, orderId: d.order.id, type: 'MANUAL', value, valueType: 'PERCENT', appliedByRole: String(sessionUser.role || '').toUpperCase() }) });
      const result = await response.json();
      if (!response.ok || result.success === false) throw Error(result.message || 'Percentage discount could not be applied');
      document.getElementById('billingPaymentAmount').value = Number(result.netPayable).toFixed(2);
      status.textContent = `Percentage discount applied: ${value.toFixed(2)}%.`;
      await showSubmittedOrder(d.order.id);
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

async function openBillingOrderTransfer() {
  if (!state.selected?.id) return alert('Select an open bill first');
  const response = await fetch('/orders/transfer-preview', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ restaurantId, actor:{id:sessionUser.id,role:sessionUser.role}, orderId:state.selected.id }) });
  const preview = await response.json();
  if (!response.ok || preview.success === false) throw Error(preview.message || 'Unable to load transfer details');
  document.querySelector('.modifier-modal-backdrop[data-order-transfer]')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modifier-modal-backdrop';
  backdrop.dataset.orderTransfer = 'true';
  backdrop.innerHTML = `<div class="modifier-modal order-transfer-modal"><header><div><h2>Transfer KOT / Item / Table</h2><p>Current check: ${esc(preview.order.table_no)} · ${esc(preview.order.customer_ref || preview.order.order_reference || preview.order.id)}</p></div><button type="button" class="secondary-btn" data-close-transfer>Close</button></header><div class="transfer-mode-tabs"><button type="button" class="active" data-mode="TABLE">Table Wise</button><button type="button" data-mode="KOT">KOT Wise</button><button type="button" data-mode="ITEM">Item Wise</button></div><div data-transfer-choices></div><label>Destination table<select data-target-table></select></label><label data-target-order-label hidden>Destination customer check<select data-target-order></select></label><p data-target-order-help class="status-message"></p><p data-transfer-status class="status-message"></p><div class="cart-actions"><button type="button" data-confirm-transfer>Transfer</button></div></div>`;
  document.body.appendChild(backdrop);
  let mode = 'TABLE';
  const grouped = (preview.items || []).reduce((result, item) => { (result[item.kot_id] ||= []).push(item); return result; }, {});
  const renderDestination = () => {
    const tableSelect = backdrop.querySelector('[data-target-table]');
    const currentTableId = Number(preview.order.table_id);
    const tables = (preview.tables || []).filter((table) => mode !== 'TABLE' || Number(table.id) !== currentTableId);
    tableSelect.innerHTML = '<option value="">Choose target table</option>' + tables.map((table) => `<option value="${table.id}">${esc(table.table_name)}${Number(table.id) === currentTableId ? ' (CURRENT TABLE)' : ` (${esc(table.status)})`}</option>`).join('');
    renderTargetOrders();
  };
  const renderTargetOrders = () => {
    const tableId = Number(backdrop.querySelector('[data-target-table]').value || 0);
    const label = backdrop.querySelector('[data-target-order-label]');
    const select = backdrop.querySelector('[data-target-order]');
    const help = backdrop.querySelector('[data-target-order-help]');
    if (mode === 'TABLE' || !tableId) { label.hidden = true; select.innerHTML = ''; help.textContent = mode === 'TABLE' ? 'The check remains separate and receives a new customer reference.' : ''; return; }
    const orders = (preview.targetOrders || []).filter((order) => Number(order.table_id) === tableId && Number(order.billing_ready || 0) !== 1);
    label.hidden = orders.length === 0;
    select.innerHTML = orders.length > 1 ? '<option value="">Choose customer check</option>' : '';
    select.innerHTML += orders.map((order) => `<option value="${order.id}">${esc(order.customer_name || 'Walk-in customer')} · ${esc(order.customer_ref || order.order_reference || order.id)}</option>`).join('');
    if (orders.length === 1) select.value = String(orders[0].id);
    help.textContent = orders.length === 0 ? 'A new customer check will be created.' : orders.length === 1 ? 'Items will merge into this customer check.' : 'Choose which customer check should receive the items.';
  };
  const renderChoices = () => {
    backdrop.querySelectorAll('[data-mode]').forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
    const choices = backdrop.querySelector('[data-transfer-choices]');
    if (mode === 'TABLE') return choices.innerHTML = '<p>The complete customer check will move together as a separate customer check with a new reference.</p>';
    choices.innerHTML = `<div class="split-item-list">${Object.entries(grouped).map(([kotId, items]) => mode === 'KOT'
      ? `<label><input type="checkbox" name="transferKot" value="${kotId}"><span><strong>KOT ${esc(items[0].suborder_no || kotId)}</strong> · ${items.length} item line(s) · ${esc(items[0].kitchen_name || 'Kitchen')}</span></label>`
      : items.map((item) => `<label><input type="checkbox" name="transferItem" value="${item.id}"><span>${esc(item.name)} × ${item.quantity} · KOT ${esc(item.suborder_no || kotId)}</span></label>`).join('')).join('')}</div>`;
  };
  renderChoices();
  renderDestination();
  backdrop.querySelector('[data-target-table]').onchange = renderTargetOrders;
  backdrop.querySelectorAll('[data-mode]').forEach((button) => button.onclick = () => { mode = button.dataset.mode; renderChoices(); renderDestination(); });
  backdrop.querySelector('[data-close-transfer]').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-confirm-transfer]').onclick = async () => {
    const status = backdrop.querySelector('[data-transfer-status]');
    const toTableId = Number(backdrop.querySelector('[data-target-table]').value || 0);
    if (!toTableId) return status.textContent = 'Choose a destination table.';
    const matchingOrders = mode === 'TABLE' ? [] : (preview.targetOrders || []).filter((order) => Number(order.table_id) === toTableId && Number(order.billing_ready || 0) !== 1);
    const targetOrderId = Number(backdrop.querySelector('[data-target-order]').value || 0) || null;
    if (matchingOrders.length > 1 && !targetOrderId) return status.textContent = 'Choose the destination customer check.';
    try {
      const transferResponse = await fetch('/orders/transfer', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ restaurantId, actor:{id:sessionUser.id,role:sessionUser.role}, orderId:state.selected.id, toTableId, targetOrderId, mode, kotIds:[...backdrop.querySelectorAll('input[name="transferKot"]:checked')].map((input) => Number(input.value)), itemIds:[...backdrop.querySelectorAll('input[name="transferItem"]:checked')].map((input) => Number(input.value)) }) });
      const result = await transferResponse.json();
      if (!transferResponse.ok || result.success === false) throw Error(result.message || 'Transfer failed');
      backdrop.remove();
      billingStatus.textContent = result.message;
      state.selected = null;
      transferBillingOrder.disabled = true;
      await load();
      if (result.targetOrderId) await showSubmittedOrder(result.targetOrderId);
    } catch (error) { status.textContent = error.message; }
  };
}

function openBillingSplit(data, submittedItems) {
  const eligible = submittedItems.filter((item) => Number(item.order_item_id) > 0);
  if (!eligible.length) return alert('There are no submitted items to split');
  document.querySelector('.modifier-modal-backdrop[data-billing-split]')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modifier-modal-backdrop';
  backdrop.dataset.billingSplit = 'true';
  backdrop.innerHTML = `<div class="modifier-modal"><header><h2>Split Bill</h2><button type="button" class="secondary-btn" data-close-split>Close</button></header><p>Select items for the new bill.</p><div class="split-item-list">${eligible.map((item) => `<label><input type="checkbox" value="${item.order_item_id}"><span>${esc(item.name)} × ${item.quantity} · ${money(item.price * item.quantity)}</span></label>`).join('')}</div><div class="cart-actions"><button type="button" data-create-split>Create Split Bill</button></div></div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('input')?.focus();
  backdrop.querySelector('[data-close-split]').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-create-split]').onclick = async () => {
    const itemKeys = [...backdrop.querySelectorAll('input:checked')].map((input) => Number(input.value));
    if (!itemKeys.length) return alert('Select at least one item to split');
    if (itemKeys.length >= eligible.length) return alert('Leave at least one item on the original bill');
    try {
      const response = await fetch('/orders/split-check', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ restaurantId, actor:{id:sessionUser.id,role:sessionUser.role}, orderId:data.order.id, itemKeys }) });
      const result = await response.json();
      if (!response.ok || result.success === false) throw Error(result.message || 'Split bill failed');
      backdrop.remove();
      await load();
      await showSubmittedOrder(result.orderId);
    } catch (error) { alert(error.message); }
  };
}

function openBillingMerge(data) {
  const candidates = state.orders.filter((order) => Number(order.id) !== Number(data.order.id) && Number(order.billing_ready) === 1 && order.payment_status !== 'PAID' && order.has_submitted_kot);
  if (Number(data.order.billing_ready) !== 1) return alert('Mark this order ready for billing before merging it');
  if (!candidates.length) return alert('There are no other bills ready for billing');
  document.querySelector('.modifier-modal-backdrop[data-billing-merge]')?.remove();
  const backdrop = document.createElement('div');
  backdrop.className = 'modifier-modal-backdrop';
  backdrop.dataset.billingMerge = 'true';
  backdrop.innerHTML = `<div class="modifier-modal"><header><h2>Merge Bill</h2><button type="button" class="secondary-btn" data-close-merge>Close</button></header><p>Select bills to combine with <strong>${esc(data.order.order_reference || data.order.id)}</strong>. The combined bill will be previewed before settlement.</p><div class="split-item-list">${candidates.map((order) => `<label><input type="checkbox" value="${order.id}"><span><strong>${esc(order.order_reference || `Order ${order.id}`)}</strong> · ${esc(order.table_no || order.order_type)} · ${money(billingAmount(order))}</span></label>`).join('')}</div><div class="cart-actions"><button type="button" class="primary-btn" data-create-merge>Merge Bill</button></div></div>`;
  document.body.appendChild(backdrop);
  backdrop.querySelector('input')?.focus();
  backdrop.querySelector('[data-close-merge]').onclick = () => backdrop.remove();
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
  backdrop.querySelector('[data-create-merge]').onclick = async () => {
    const selected = [...backdrop.querySelectorAll('input:checked')].map((input) => Number(input.value));
    if (!selected.length) return alert('Select at least one additional bill');
    const button = backdrop.querySelector('[data-create-merge]');
    button.disabled = true;
    try {
      const response = await fetch('/orders/merge-bills', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ restaurantId, actor:{id:sessionUser.id,role:sessionUser.role}, orderIds:[Number(data.order.id), ...selected] }) });
      const result = await response.json();
      if (!response.ok || result.success === false) throw Error(result.message || 'Merge bill failed');
      backdrop.remove();
      await load();
      await showSubmittedOrder(result.orderId);
    } catch (error) { alert(error.message); button.disabled = false; }
  };
}
showOrder = showSubmittedOrder;
function applySubmittedTotals() { state.orders.forEach(order => { if (order.has_submitted_kot) order.total_amount = Number(order.submitted_total || 0); }); renderTables(); renderRecent(); }
setTimeout(applySubmittedTotals, 0);
