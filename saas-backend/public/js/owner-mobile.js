const ownerToken = localStorage.getItem("ownerToken");
if (!ownerToken) window.location.href = "/owner-login.html";

async function api(url) {
  if (!window.SaasSession?.requireActive?.()) throw new Error("Session expired");
  const res = await fetch(url, { headers: { Authorization: `Bearer ${ownerToken}` } });
  if (window.SaasSession?.handleUnauthorized?.(res)) throw new Error("Session expired");
  const data = await res.json();
  if (!res.ok || data.success === false) {
    const error = new Error(data.message || "Request failed");
    Object.assign(error, data);
    throw error;
  }
  return data;
}

async function reportApi(path, restaurantId, fromDate, toDate) {
  try { return await api(`${path}?restaurantId=${encodeURIComponent(restaurantId)}&fromDate=${fromDate}&toDate=${toDate}`); }
  catch (error) {
    if (error.code !== 'POS_DIRECT_REQUIRED') throw error;
    if (!error.posUrl) throw new Error('Sales data is stored locally. Bring the POS online to retrieve this report.');
    const base = String(error.posUrl).replace(/\/$/, '');
    try {
      const response = await fetch(`${base}/owner-direct/reports?restaurantId=${encodeURIComponent(restaurantId)}&fromDate=${fromDate}&toDate=${toDate}`, { headers:{ Authorization:`Bearer ${ownerToken}` } });
      const live = await response.json();
      if (!response.ok || !live.success) throw new Error(live.message || 'Live POS report failed');
      return path.endsWith('/items') ? { success:true, items:live.items, source:'LIVE_POS' } : live;
    } catch (_) {
      throw new Error('Sales data is stored locally. Bring the POS online and ensure this device can reach the restaurant POS to retrieve the report.');
    }
  }
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
    reportApi('/owner/reports/summary', restaurantId, todayIso(), todayIso()),
    reportApi('/owner/reports/summary', restaurantId, monthStartIso(), todayIso()),
    reportApi('/owner/reports/items', restaurantId, monthStartIso(), todayIso()),
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
