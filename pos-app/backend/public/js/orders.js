const params = new URLSearchParams(window.location.search);
let restaurantId = params.get("restaurantId") || localStorage.getItem("restaurantId") || "";
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

const user = JSON.parse(localStorage.getItem("user") || '{"role":"OWNER","name":"Owner"}');
const actor = { id: user.id || null, name: user.name || user.username || user.role || "Owner", role: user.role || "OWNER" };
const state = { orders: [], partners: [], report: null };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => Number(value || 0).toFixed(2);

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function ensureRestaurantId() {
  if (restaurantId) return restaurantId;
  const data = await fetchJson("/system/info");
  restaurantId = data.activeRestaurantId || "";
  if (!restaurantId) throw new Error("POS is not activated.");
  localStorage.setItem("restaurantId", restaurantId);
  return restaurantId;
}

async function postJson(url, body = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantId, actor, ...body })
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

function partnerOptions(selectedId) {
  return `<option value="">Assign partner</option>${state.partners.map((partner) => `
    <option value="${partner.id}" ${String(partner.id) === String(selectedId || "") ? "selected" : ""}>${esc(partner.name)}</option>
  `).join("")}`;
}

function renderPartners() {
  partnersList.innerHTML = state.partners.map((partner) => `
    <div class="partner-row">
      <div>
        <strong>${esc(partner.name)}</strong>
        <small>${esc(partner.provider_code || "IN_HOUSE")} | ${esc(partner.integration_type || "MANUAL")} | ${partner.integration_enabled ? "Enabled" : "Manual only"}</small>
      </div>
      <div class="toolbar">
        <button type="button" class="secondary-btn" data-edit-partner="${partner.id}">Edit</button>
        <button type="button" class="danger-btn" data-delete-partner="${partner.id}">Delete</button>
      </div>
    </div>
  `).join("") || "<p>No delivery partners yet.</p>";
}

function visibleOrders() {
  return state.orders.filter((order) => {
    if (orderTypeFilter.value && order.order_type !== orderTypeFilter.value) return false;
    if (statusFilter.value && order.status !== statusFilter.value && order.delivery_status !== statusFilter.value) return false;
    return true;
  });
}

function renderOrders() {
  const orders = visibleOrders();
  ordersList.innerHTML = orders.map((order) => `
    <article class="order-card">
      <header>
        <div>
          <h3>#${order.id} ${esc(order.order_type || "")}</h3>
          <p>${esc(order.table_no || "No table")} · ${esc(order.created_at || "")}</p>
        </div>
        <span class="status-pill">${esc(order.status || "")}</span>
      </header>
      <p><strong>Total:</strong> ${money(order.total_amount)} ${Number(order.delivery_fee || 0) ? `+ delivery ${money(order.delivery_fee)}` : ""}</p>
      <p><strong>Payment:</strong> ${esc(order.payment_status || "UNPAID")}</p>
      ${order.customer_name || order.customer_phone ? `<p><strong>Customer:</strong> ${esc(order.customer_name || "")} ${esc(order.customer_phone || "")}</p>` : ""}
      ${order.delivery_address ? `<p><strong>Delivery:</strong> ${esc(order.delivery_address)}</p>` : ""}
      ${order.delivery_status ? `<p><strong>Delivery status:</strong> ${esc(order.delivery_status)}</p>` : ""}
      ${order.delivery_partner_name ? `<p><strong>Partner:</strong> ${esc(order.delivery_partner_name)} ${order.delivery_provider_code ? `(${esc(order.delivery_provider_code)})` : ""}</p>` : ""}
      ${order.partner_status ? `<p><strong>Partner status:</strong> ${esc(order.partner_status)} <small>${esc(order.last_partner_status_at || "")}</small></p>` : ""}
      ${order.external_order_id ? `<p><strong>External order:</strong> ${esc(order.external_order_id)}</p>` : ""}
      ${order.tracking_url ? `<p><a href="${esc(order.tracking_url)}" target="_blank">Open delivery tracking</a></p>` : ""}
      <div class="order-management-row">
        <select data-status-order="${order.id}">
          ${["RECEIVED", "ACCEPTED", "PREPARING", "READY_FOR_PICKUP", "OUT_FOR_DELIVERY", "DELIVERED", "CANCELLED"].map((status) => `<option value="${status}" ${status === (order.delivery_status || order.status) ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        <button type="button" data-update-status="${order.id}">Update Status</button>
        <button type="button" class="danger-btn" data-cancel-order="${order.id}">Cancel</button>
      </div>
      <div class="order-management-row">
        <select data-partner-order="${order.id}">${partnerOptions(order.delivery_partner_id)}</select>
        <button type="button" data-assign-partner="${order.id}">Assign Partner</button>
        <button type="button" class="secondary-btn" data-reopen-order="${order.id}">Reopen</button>
      </div>
      ${order.delivery_status ? `
        <div class="tracking-row">
          <input data-external-order="${order.id}" value="${esc(order.external_order_id || "")}" placeholder="Swiggy/Zomato order ID">
          <input data-tracking-url="${order.id}" value="${esc(order.tracking_url || "")}" placeholder="Tracking URL">
          <select data-partner-status="${order.id}">
            ${["PLACED", "ACCEPTED", "RIDER_ASSIGNED", "PICKED_UP", "OUT_FOR_DELIVERY", "DELIVERED", "FAILED", "CANCELLED"].map((status) => `<option value="${status}" ${status === (order.partner_status || "") ? "selected" : ""}>${status}</option>`).join("")}
          </select>
          <button type="button" class="secondary-btn" data-update-tracking="${order.id}">Save Tracking</button>
        </div>
      ` : ""}
    </article>
  `).join("") || "<p>No live orders found.</p>";
  ordersStatus.textContent = `${orders.length} live order${orders.length === 1 ? "" : "s"} shown`;
}

function renderReport() {
  const summary = state.report?.orderTypeSummary || [];
  ordersReport.innerHTML = summary.map((row) => `
    <article class="mini-report">
      <strong>${esc(row.order_type || "UNKNOWN")}</strong>
      <span>${row.order_count || row.count || 0} orders</span>
      <span>${money(row.sales || row.total || 0)}</span>
    </article>
  `).join("") || "<p>No order summary yet.</p>";
}

async function loadOrders() {
  ordersStatus.textContent = "Loading orders...";
  await ensureRestaurantId();
  const [ordersData, partnersData, reportData] = await Promise.all([
    fetchJson(`/orders/live?restaurantId=${encodeURIComponent(restaurantId)}`),
    fetchJson(`/delivery/partners?restaurantId=${encodeURIComponent(restaurantId)}&includeInactive=false`),
    fetchJson(`/reports/order-types?restaurantId=${encodeURIComponent(restaurantId)}`).catch(() => ({ orderTypeSummary: [] }))
  ]);
  state.orders = ordersData.orders || [];
  state.partners = partnersData.partners || [];
  state.report = reportData;
  renderPartners();
  renderOrders();
  renderReport();
}

partnerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await postJson("/delivery/partners/save", {
    id: partnerId.value || null,
    name: partnerName.value,
    phone: partnerPhone.value,
    providerCode: partnerProviderCode.value,
    integrationType: partnerIntegrationType.value,
    apiBaseUrl: partnerApiBaseUrl.value,
    merchantId: partnerMerchantId.value,
    externalStoreId: partnerExternalStoreId.value,
    integrationEnabled: partnerIntegrationEnabled.checked
  });
  partnerForm.reset();
  await loadOrders();
});

document.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  try {
    const id = button.dataset.updateStatus || button.dataset.assignPartner || button.dataset.cancelOrder || button.dataset.reopenOrder || button.dataset.editPartner || button.dataset.deletePartner;
    if (button.dataset.editPartner) {
      const partner = state.partners.find((row) => String(row.id) === String(id));
      if (!partner) return;
      partnerId.value = partner.id;
      partnerName.value = partner.name || "";
      partnerPhone.value = partner.phone || "";
      partnerProviderCode.value = partner.provider_code || "IN_HOUSE";
      partnerIntegrationType.value = partner.integration_type || "MANUAL";
      partnerApiBaseUrl.value = partner.api_base_url || "";
      partnerMerchantId.value = partner.merchant_id || "";
      partnerExternalStoreId.value = partner.external_store_id || "";
      partnerIntegrationEnabled.checked = Number(partner.integration_enabled || 0) === 1;
      partnerName.focus();
      return;
    }
    if (button.dataset.deletePartner) {
      if (!confirm("Delete this delivery partner?")) return;
      await postJson("/delivery/partners/delete", { id });
      await loadOrders();
      return;
    }
    if (button.dataset.updateStatus) {
      const status = document.querySelector(`[data-status-order="${id}"]`).value;
      await postJson("/orders/update-status", { orderId: id, status });
      await loadOrders();
      return;
    }
    if (button.dataset.assignPartner) {
      const deliveryPartnerId = document.querySelector(`[data-partner-order="${id}"]`).value;
      if (!deliveryPartnerId) throw new Error("Select a delivery partner first");
      await postJson("/orders/assign-delivery-partner", { orderId: id, deliveryPartnerId });
      await loadOrders();
      return;
    }
    if (button.dataset.cancelOrder) {
      if (!confirm("Cancel this order?")) return;
      await postJson("/orders/cancel", { orderId: id });
      await loadOrders();
      return;
    }
    if (button.dataset.reopenOrder) {
      await postJson("/orders/reopen", { orderId: id });
      await loadOrders();
      return;
    }
    if (button.dataset.updateTracking) {
      await postJson("/orders/delivery-tracking", {
        orderId: id,
        externalOrderId: document.querySelector(`[data-external-order="${id}"]`).value,
        trackingUrl: document.querySelector(`[data-tracking-url="${id}"]`).value,
        partnerStatus: document.querySelector(`[data-partner-status="${id}"]`).value
      });
      await loadOrders();
    }
  } catch (err) {
    ordersStatus.textContent = err.message;
    alert(err.message);
  }
});

refreshOrders.addEventListener("click", () => loadOrders().catch((err) => {
  ordersStatus.textContent = err.message;
}));
orderTypeFilter.addEventListener("change", renderOrders);
statusFilter.addEventListener("change", renderOrders);

loadOrders().catch((err) => {
  ordersStatus.textContent = err.message;
});
setInterval(() => loadOrders().catch(() => undefined), 5000);
