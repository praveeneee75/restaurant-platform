const token = localStorage.getItem("ownerToken");
if (!token) window.location.href = "/owner-login.html";

async function ownerApi(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function loadDashboard() {
  try {
    const data = await ownerApi("/owners/dashboard");
    const posDownloadUrl = "/downloads.html";
    ownerStatus.innerText = "Assigned restaurants";
    organizationCards.innerHTML = (data.organizations || []).map((org) => `
      <div class="card">
        ${org.name}
        <strong>${Number(org.today_net_sales || 0).toFixed(2)}</strong>
        <small>${org.branch_count} branches | ${org.online_branches} online | ${org.today_orders} orders today</small>
      </div>
    `).join("") || `<div class="card">Overall view<strong>Branch grouping not assigned</strong></div>`;
    ownerRestaurants.innerHTML = data.restaurants.map((row) => `
      <tr>
        <td>${row.name}</td>
        <td>${row.restaurant_code}</td>
        <td><code>${row.license_key || ""}</code></td>
        <td>${row.package_name || row.package_code || "Not assigned"}</td>
        <td>${row.subscription_status || "Not assigned"}</td>
        <td>${row.license_expires_at ? new Date(row.license_expires_at).toLocaleDateString() : ""}</td>
        <td>${row.days_remaining ?? ""}</td>
        <td>${row.pos_status || "OFFLINE"}</td>
        <td>${row.pos_version || ""}</td>
        <td>${row.backup_status || ""}</td>
        <td>${row.printer_status || ""}</td>
        <td>${row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toLocaleString() : "Never"}</td>
        <td><a href="${posDownloadUrl}" target="_blank" rel="noopener">Installer</a></td>
      </tr>
    `).join("") || `<tr><td colspan="13">No restaurants assigned.</td></tr>`;
  } catch (err) {
    ownerStatus.innerText = err.message;
  }
}

async function changePassword() {
  try {
    await ownerApi("/owners/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    });
    passwordMsg.innerText = "Password changed";
    currentPassword.value = "";
    newPassword.value = "";
  } catch (err) {
    passwordMsg.innerText = err.message;
  }
}

loadDashboard();
setInterval(loadDashboard, 30000);
