const restaurantId = new URLSearchParams(window.location.search).get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);
const user = JSON.parse(localStorage.getItem("user") || '{"role":"OWNER"}');
const actor = { id: user.id, role: user.role || "OWNER", username: user.username };
const state = { customers: [], selectedCustomerId: null };

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
  const data = await fetch(`/customers/list?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  state.customers = data.customers;
  customersTable.innerHTML = state.customers.map((customer) => `
    <tr>
      <td>${esc(customer.name)}</td><td>${esc(customer.phone)}</td><td>${esc(customer.email || "")}</td><td>${customer.loyaltyBalance || 0}</td>
      <td><button class="mini-btn" data-profile="${customer.id}">Profile</button><button class="mini-btn" data-edit="${customer.id}">Edit</button><button class="danger-btn" data-delete="${customer.id}">Delete</button></td>
    </tr>
  `).join("");
  customerPageStatus.textContent = `${state.customers.length} customers`;
}

async function loadSettings() {
  const data = await fetch(`/loyalty/settings?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  loyaltyEarnAmount.value = data.earnAmount;
  loyaltyPointValue.value = data.pointValue;
}

async function loadReports() {
  const data = await fetch(`/customers/reports?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  customerReports.innerHTML = `
    <h3>Top Customers</h3>${data.topCustomers.map((row) => `<p>${esc(row.name)}: ${money(row.total_spend)}</p>`).join("") || "<p>No data</p>"}
    <h3>Repeat Customers</h3>${data.repeatCustomers.map((row) => `<p>${esc(row.name)}: ${row.visits} visits</p>`).join("") || "<p>No repeats</p>"}
    <h3>Inactive Customers</h3>${data.inactiveCustomers.map((row) => `<p>${esc(row.name)}: ${esc(row.last_visit || "No visits")}</p>`).join("") || "<p>No inactive customers</p>"}
    <h3>Birthdays This Month</h3>${data.birthdayCustomers.map((row) => `<p>${esc(row.name)}: ${esc(row.birthday)}</p>`).join("") || "<p>No birthdays</p>"}
    <h3>Loyalty</h3>${data.loyaltySummary.map((row) => `<p>${esc(row.type)}: ${row.points}</p>`).join("") || "<p>No loyalty activity</p>"}
  `;
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
  const data = await fetch(`/customers/profile?restaurantId=${encodeURIComponent(restaurantId)}&customerId=${customerId}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  profileTitle.textContent = `${data.customer.name} · ${data.customer.loyaltyBalance} pts`;
  customerProfile.innerHTML = `
    <p>${esc(data.customer.phone)} ${data.customer.email ? "· " + esc(data.customer.email) : ""}</p>
    <p>Total spend: ${money(data.totalSpend)} · Visits: ${data.visitCount}</p>
    <h3>Visit History</h3>${data.visits.map((visit) => `<p>#${visit.order_id}: ${money(visit.amount)} · ${esc(visit.visit_at)}</p>`).join("") || "<p>No visits</p>"}
    <h3>Loyalty Ledger</h3>${data.ledger.map((row) => `<p>${esc(row.type)} ${row.points}: ${esc(row.note || "")}</p>`).join("") || "<p>No loyalty activity</p>"}
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

loyaltySettingsForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await postJson("/loyalty/settings", { earnAmount: loyaltyEarnAmount.value, pointValue: loyaltyPointValue.value });
  if (!data.success) return alert(data.message);
  customerPageStatus.textContent = "Loyalty settings saved";
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

Promise.all([loadCustomers(), loadSettings(), loadReports()]).catch((err) => {
  customerPageStatus.textContent = err.message;
});
