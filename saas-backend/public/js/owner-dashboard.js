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
    ownerStatus.innerText = "Assigned restaurants";
    ownerRestaurants.innerHTML = data.restaurants.map((row) => `
      <tr>
        <td>${row.name}</td>
        <td>${row.restaurant_code}</td>
        <td>${row.subscription_status || "Not assigned"}</td>
        <td>${row.days_remaining ?? ""}</td>
        <td>${row.pos_status || "OFFLINE"}</td>
        <td>${row.pos_version || ""}</td>
        <td>${row.backup_status || ""}</td>
        <td>${row.printer_status || ""}</td>
        <td>${row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toLocaleString() : "Never"}</td>
      </tr>
    `).join("") || `<tr><td colspan="9">No restaurants assigned.</td></tr>`;
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
