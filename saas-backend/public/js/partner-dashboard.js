const partnerToken = localStorage.getItem("partnerToken");
const partnerUser = JSON.parse(localStorage.getItem("partnerUser") || "{}");

if (!partnerToken) window.location.href = "/partner-login.html";

async function partnerApi(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${partnerToken}`,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

async function loadPartnerDashboard() {
  try {
    partnerTitle.innerText = `${partnerUser.partnerName || "Partner"} Dashboard`;
    const [dashboard, restaurants, commissions] = await Promise.all([
      partnerApi("/partners/dashboard"),
      partnerApi("/partners/restaurants"),
      partnerApi("/partners/commissions")
    ]);
    const summary = dashboard.summary || {};
    totalRestaurants.innerText = summary.total_restaurants || 0;
    activeLicenses.innerText = summary.active_licenses || 0;
    expiredLicenses.innerText = summary.expired_licenses || 0;
    mrr.innerText = money(summary.monthly_recurring_revenue);
    onlineRestaurants.innerText = summary.online_restaurants || 0;
    offlineRestaurants.innerText = summary.offline_restaurants || 0;
    partnerStatus.innerText = (dashboard.supportAlerts || []).length ? `${dashboard.supportAlerts.length} support alert(s)` : "All clear";
    restaurantRows.innerHTML = restaurants.restaurants.map((row) => `
      <tr>
        <td>${row.name} (${row.restaurant_code})</td>
        <td>${row.license_status}</td>
        <td>${row.online_status}</td>
        <td>${row.pos_version || ""}</td>
        <td>${row.backup_status || ""}</td>
        <td>${row.printer_status || ""}</td>
        <td>${row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : "Not synced"}</td>
      </tr>
    `).join("");
    commissionSummary.innerText = `Revenue ${money(commissions.totals.revenue)} | Commission ${money(commissions.totals.commission)} | Pending ${money(commissions.totals.pending)}`;
    commissionRows.innerHTML = commissions.commissions.map((row) => `
      <tr>
        <td>${row.restaurant_name || ""} (${row.restaurant_code || ""})</td>
        <td>${money(row.revenue_amount)}</td>
        <td>${money(row.commission_amount)}</td>
        <td>${row.payout_status}</td>
      </tr>
    `).join("");
  } catch (err) {
    partnerStatus.innerText = err.message;
  }
}

loadPartnerDashboard();
