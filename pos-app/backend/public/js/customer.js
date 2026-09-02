const restaurantId = new URLSearchParams(window.location.search).get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);
const user = JSON.parse(localStorage.getItem("user") || '{"role":"OWNER"}');
const actor = { id: user.id, role: user.role || "OWNER", username: user.username };
document.querySelectorAll('[data-role-nav="reports"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2', 'CASHIER'].includes(String(actor.role).toUpperCase()); });
const state = { customers: [], selectedCustomerId: null, reports: null, query: "" };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const money = (value) => Number(value || 0).toFixed(2);

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

async function loadCustomers() {
  const data = await fetch(`/customers/list?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  state.customers = data.customers;
  renderCustomers();
  renderExecutiveSummary();
}

function filteredCustomers() {
  const query = state.query.trim().toLowerCase();
  if (!query) return state.customers;
  return state.customers.filter((customer) => [customer.name, customer.phone, customer.email].some((value) => String(value || "").toLowerCase().includes(query)));
}

function renderCustomers() {
  const rows = filteredCustomers();
  customersTable.innerHTML = rows.map((customer) => `
    <tr>
      <td>${esc(customer.name)}</td><td>${esc(customer.phone)}</td><td>${esc(customer.email || "")}</td><td>${customer.loyaltyBalance || 0}</td>
      <td class="action-cell"><button class="mini-btn" data-profile="${customer.id}">Customer 360</button><button class="mini-btn" data-edit="${customer.id}">Edit</button><button class="danger-btn" data-delete="${customer.id}">Delete</button></td>
    </tr>
  `).join("") || '<tr><td colspan="5">No customers match this search.</td></tr>';
  customerPageStatus.textContent = `${state.customers.length} customers`;
  customerSearchStatus.textContent = state.query ? `${rows.length} matching customer(s)` : "All active customers";
}

function renderExecutiveSummary() {
  const totalPoints = state.customers.reduce((sum, customer) => sum + Number(customer.loyaltyBalance || 0), 0);
  const totalSpend = (state.reports?.topCustomers || []).reduce((sum, customer) => sum + Number(customer.total_spend || 0), 0);
  const repeatCustomers = (state.reports?.repeatCustomers || []).length;
  const inactiveCustomers = (state.reports?.inactiveCustomers || []).length;
  crmExecutiveSummary.innerHTML = `
    <article><span>Active customers</span><strong>${state.customers.length}</strong><small>Customer directory</small></article>
    <article><span>Loyalty liability</span><strong>${totalPoints} pts</strong><small>Current point balances</small></article>
    <article><span>Top-customer spend</span><strong>INR ${money(totalSpend)}</strong><small>Reported customer value</small></article>
    <article><span>Repeat customers</span><strong>${repeatCustomers}</strong><small>${inactiveCustomers} inactive</small></article>`;
}

async function loadReports() {
  const data = await fetch(`/customers/reports?restaurantId=${encodeURIComponent(restaurantId)}&role=${encodeURIComponent(actor.role)}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  state.reports = data;
  customerReports.innerHTML = `
    <h3>Top Customers</h3>${data.topCustomers.map((row) => `<p>${esc(row.name)}: ${money(row.total_spend)}</p>`).join("") || "<p>No data</p>"}
    <h3>Repeat Customers</h3>${data.repeatCustomers.map((row) => `<p>${esc(row.name)}: ${row.visits} visits</p>`).join("") || "<p>No repeats</p>"}
    <h3>Inactive Customers</h3>${data.inactiveCustomers.map((row) => `<p>${esc(row.name)}: ${esc(row.last_visit || "No visits")}</p>`).join("") || "<p>No inactive customers</p>"}
    <h3>Birthdays This Month</h3>${data.birthdayCustomers.map((row) => `<p>${esc(row.name)}: ${esc(row.birthday)}</p>`).join("") || "<p>No birthdays</p>"}
    <h3>Loyalty</h3>${data.loyaltySummary.map((row) => `<p>${esc(row.type)}: ${row.points}</p>`).join("") || "<p>No loyalty activity</p>"}
  `;
  renderExecutiveSummary();
}

function fillCustomer(customer = {}) {
  crmCustomerId.value = customer.id || "";
  crmName.value = customer.name || "";
  crmPhone.value = customer.phone || "";
  crmEmail.value = customer.email || "";
  crmBirthday.value = customer.birthday || "";
  crmAddress.value = customer.address || "";
}

async function loadProfile(customerId) {
  state.selectedCustomerId = customerId;
  const data = await fetch(`/customers/profile?restaurantId=${encodeURIComponent(restaurantId)}&customerId=${customerId}&role=${encodeURIComponent(actor.role)}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  profileTitle.textContent = `${data.customer.name} · ${data.customer.loyaltyBalance} pts`;
  const earned = data.ledger.filter((row) => ["EARN", "ADJUSTMENT"].includes(String(row.type).toUpperCase())).reduce((sum, row) => sum + Number(row.points || 0), 0);
  const redeemed = data.ledger.filter((row) => String(row.type).toUpperCase() === "REDEEM").reduce((sum, row) => sum + Number(row.points || 0), 0);
  customerProfile.innerHTML = `
    <p class="customer-contact">${esc(data.customer.phone)} ${data.customer.email ? "· " + esc(data.customer.email) : ""}</p>
    <div class="customer-value-grid"><article><span>Lifetime spend</span><strong>INR ${money(data.totalSpend)}</strong></article><article><span>Visits</span><strong>${data.visitCount}</strong></article><article><span>Available points</span><strong>${data.customer.loyaltyBalance}</strong></article><article><span>Earned / redeemed</span><strong>${earned} / ${redeemed}</strong></article></div>
    <h3>Visit History</h3><div class="crm-timeline">${data.visits.map((visit) => `<p><strong>Order #${visit.order_id}</strong><span>INR ${money(visit.amount)}</span><small>${esc(window.formatPosDateTime(visit.visit_at))}</small></p>`).join("") || "<p>No visits</p>"}</div>
    <h3>Loyalty Ledger</h3><div class="loyalty-ledger">${data.ledger.map((row) => `<p><span class="status-pill ${String(row.type).toUpperCase() === "REDEEM" ? "warning" : "success"}">${esc(row.type)}</span><strong>${row.points} pts</strong><span>${esc(row.note || "")}</span><small>${esc(window.formatPosDateTime(row.created_at))}</small></p>`).join("") || "<p>No loyalty activity</p>"}</div>
    <h3>Notes</h3>${data.notes.map((note) => `<p>${esc(note.note)} · ${esc(window.formatPosDateTime(note.created_at))}</p>`).join("") || "<p>No notes</p>"}
  `;
}

customerForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const payload = { id: crmCustomerId.value || null, name: crmName.value, phone: crmPhone.value, email: crmEmail.value, birthday: crmBirthday.value, address: crmAddress.value };
  const data = await postJson(payload.id ? "/customers/update" : "/customers/create", payload);
  if (!data.success) return alert(data.message);
  fillCustomer();
  await loadCustomers();
  await loadReports();
});

customerNoteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.selectedCustomerId || !customerNote.value.trim()) return;
  const data = await postJson("/customers/notes/create", { customerId: state.selectedCustomerId, note: customerNote.value });
  if (!data.success) return alert(data.message);
  customerNote.value = "";
  await loadProfile(state.selectedCustomerId);
});

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.profile) await loadProfile(Number(target.dataset.profile));
  if (target.dataset.edit) fillCustomer(state.customers.find((customer) => customer.id === Number(target.dataset.edit)));
  if (target.dataset.delete && confirm("Delete this customer?")) {
    const data = await postJson("/customers/delete", { id: Number(target.dataset.delete) });
    if (!data.success) return alert(data.message);
    await loadCustomers();
    await loadReports();
  }
});

refreshCustomers.addEventListener("click", async () => {
  await loadCustomers();
  await loadReports();
});

searchCustomers.addEventListener("click", () => {
  state.query = customerSearch.value;
  renderCustomers();
});
customerSearch.addEventListener("keydown", (event) => {
  if (event.key === "Enter") { event.preventDefault(); searchCustomers.click(); }
});
clearCustomerSearch.addEventListener("click", () => {
  customerSearch.value = "";
  state.query = "";
  renderCustomers();
});

Promise.all([loadCustomers(), loadReports()]).catch((err) => {
  customerPageStatus.textContent = err.message;
});
