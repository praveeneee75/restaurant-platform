const ownerToken = localStorage.getItem("ownerToken");
if (!ownerToken) window.location.href = "/owner-login.html";

async function api(url) {
  if (!window.SaasSession?.requireActive?.()) throw new Error("Session expired");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${ownerToken}` } });
  if (window.SaasSession?.handleUnauthorized?.(res)) throw new Error("Session expired");
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function todayIso(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function monthStartIso() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

async function loadRestaurants() {
  const data = await api("/owners/dashboard");
  restaurantSelect.innerHTML = data.restaurants.map((row) => `<option value="${row.restaurant_code}">${row.name}</option>`).join("");
  const selected = data.restaurants.find((row) => row.restaurant_code === restaurantSelect.value) || data.restaurants[0];
  if (selected) {
    licenseStatus.textContent = selected.license_status || "-";
    posStatus.textContent = selected.pos_status || "-";
    backupStatus.textContent = selected.backup_status || "-";
  }
  await loadReports();
}

async function loadReports() {
  const restaurantId = restaurantSelect.value;
  if (!restaurantId) return;
  const [today, month, items, sync] = await Promise.all([
    api(`/owner/reports/summary?restaurantId=${restaurantId}&fromDate=${todayIso()}&toDate=${todayIso()}`),
    api(`/owner/reports/summary?restaurantId=${restaurantId}&fromDate=${monthStartIso()}&toDate=${todayIso()}`),
    api(`/owner/reports/items?restaurantId=${restaurantId}&fromDate=${monthStartIso()}&toDate=${todayIso()}`),
    api(`/owner/reports/sync-status?restaurantId=${restaurantId}`)
  ]);
  todaySales.textContent = money(today.totals.netSales);
  monthSales.textContent = money(month.totals.netSales);
  syncStatus.textContent = sync.status?.status || "Not synced";
  topItems.innerHTML = items.items.slice(0, 10).map((item) => `<tr><td>${item.item_name}</td><td>${Number(item.quantity_sold || 0)}</td><td>${money(item.total_sales)}</td></tr>`).join("");
  status.textContent = "Updated";
}

refresh.addEventListener("click", () => loadRestaurants().catch((err) => { status.textContent = err.message; }));
restaurantSelect.addEventListener("change", () => loadReports().catch((err) => { status.textContent = err.message; }));
loadRestaurants().catch((err) => { status.textContent = err.message; });
