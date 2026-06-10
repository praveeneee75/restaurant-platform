const token = localStorage.getItem("adminToken");

if (!token) {
  window.location.href = "/login.html";
}

async function api(url, options = {}) {
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

async function loadTenants() {
  try {
    const data = await api("/tenants/list");
    const tbody = document.querySelector("#tenantTable tbody");
    const reportSelect = document.getElementById("reportRestaurant");
    tbody.innerHTML = "";
    if (reportSelect) reportSelect.innerHTML = "";
    data.tenants.forEach((tenant) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${tenant.name}</td>
        <td>${tenant.restaurant_code}</td>
        <td>${tenant.license_key}</td>
        <td><input type="date" value="${tenant.expires_at ? tenant.expires_at.split("T")[0] : ""}" id="exp-${tenant.restaurant_code}"></td>
        <td>
          <select id="status-${tenant.restaurant_code}">
            <option value="ACTIVE" ${tenant.status === "ACTIVE" ? "selected" : ""}>ACTIVE</option>
            <option value="INACTIVE" ${tenant.status === "INACTIVE" ? "selected" : ""}>INACTIVE</option>
          </select>
        </td>
        <td>${tenant.last_sync_at ? new Date(tenant.last_sync_at).toLocaleString() : "Not synced"}<br>${tenant.sync_status || ""}</td>
        <td>${money(tenant.today_revenue || 0)}</td>
        <td><button onclick="updateLicense('${tenant.restaurant_code}')">Save</button></td>
      `;
      tbody.appendChild(row);
      if (reportSelect) {
        const option = document.createElement("option");
        option.value = tenant.restaurant_code;
        option.textContent = `${tenant.name} (${tenant.restaurant_code})`;
        reportSelect.appendChild(option);
      }
    });
    if (reportSelect && reportSelect.value) loadOwnerReports();
  } catch (err) {
    document.getElementById("createMsg").innerText = err.message;
  }
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function monthStartIso() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function reportDateRange() {
  const fromDate = reportFromDate.value || monthStartIso();
  const toDate = reportToDate.value || todayIso();
  return { fromDate, toDate };
}

async function reportSummary(restaurantId, fromDate, toDate) {
  return api(`/owner/reports/summary?restaurantId=${encodeURIComponent(restaurantId)}&fromDate=${fromDate}&toDate=${toDate}`);
}

async function loadOwnerReports() {
  const restaurantId = reportRestaurant.value;
  if (!restaurantId) return;
  const { fromDate, toDate } = reportDateRange();
  reportMsg.innerText = "";
  try {
    const [range, today, yesterday, items, sync] = await Promise.all([
      reportSummary(restaurantId, fromDate, toDate),
      reportSummary(restaurantId, todayIso(), todayIso()),
      reportSummary(restaurantId, todayIso(-1), todayIso(-1)),
      api(`/owner/reports/items?restaurantId=${encodeURIComponent(restaurantId)}&fromDate=${fromDate}&toDate=${toDate}`),
      api(`/owner/reports/sync-status?restaurantId=${encodeURIComponent(restaurantId)}`)
    ]);
    todaySales.innerText = money(today.totals.netSales);
    yesterdaySales.innerText = money(yesterday.totals.netSales);
    mtdSales.innerText = money(range.totals.netSales);
    reportOrders.innerText = range.totals.ordersCount;
    paymentSummary.innerText = `Cash ${money(range.totals.cashTotal)} | Card ${money(range.totals.cardTotal)} | UPI ${money(range.totals.upiTotal)}`;
    syncStatus.innerText = sync.status ? `${sync.status.status} ${new Date(sync.status.created_at).toLocaleString()}` : "Not synced";
    const tbody = document.querySelector("#topItemsTable tbody");
    tbody.innerHTML = "";
    items.items.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.item_name}</td>
        <td>${Number(item.quantity_sold || 0)}</td>
        <td>${money(item.total_sales)}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    reportMsg.innerText = err.message;
  }
}

async function requestCloudSync() {
  const restaurantId = reportRestaurant.value;
  if (!restaurantId) return;
  try {
    const data = await api("/owner/reports/request-sync", {
      method: "POST",
      body: JSON.stringify({ restaurantId })
    });
    reportMsg.innerText = data.message;
    loadOwnerReports();
  } catch (err) {
    reportMsg.innerText = err.message;
  }
}

async function updateLicense(code) {
  try {
    const data = await api("/tenants/update-license", {
      method: "POST",
      body: JSON.stringify({
        restaurantCode: code,
        expiresAt: document.getElementById(`exp-${code}`).value,
        status: document.getElementById(`status-${code}`).value
      })
    });
    alert(data.message);
  } catch (err) {
    alert(err.message);
  }
}

async function createRestaurant() {
  try {
    const data = await api("/tenants/create", {
      method: "POST",
      body: JSON.stringify({
        name: document.getElementById("restaurantName").value,
        expiryDate: document.getElementById("expiryDate").value
      })
    });
    document.getElementById("createMsg").innerText = `Restaurant Created

Restaurant ID: ${data.restaurantCode}
License Key: ${data.licenseKey}`;
    loadTenants();
  } catch (err) {
    document.getElementById("createMsg").innerText = err.message;
  }
}

async function loadReleases() {
  try {
    const data = await api("/updates/list");
    const tbody = document.querySelector("#releaseTable tbody");
    tbody.innerHTML = "";
    data.releases.forEach((release) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${release.version}</td>
        <td>${release.status}</td>
        <td>${release.mandatory_update ? "Yes" : "No"}</td>
        <td>${(release.files || []).map((file) => file.file_name).join(", ")}</td>
        <td>${release.release_notes || ""}</td>
        <td>${release.status === "ACTIVE" ? "Active" : `<button onclick="activateRelease('${release.id}')">Activate</button>`}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    document.getElementById("releaseMsg").innerText = err.message;
  }
}

async function createRelease() {
  try {
    await api("/updates/create", {
      method: "POST",
      body: JSON.stringify({
        version: releaseVersion.value.trim(),
        releaseNotes: releaseNotes.value.trim(),
        mandatoryUpdate: releaseMandatory.checked,
        files: [{
          file_name: releaseFileName.value.trim(),
          file_url: releaseFileUrl.value.trim(),
          checksum: releaseChecksum.value.trim()
        }]
      })
    });
    releaseMsg.innerText = "Release created";
    releaseVersion.value = "";
    releaseNotes.value = "";
    releaseMandatory.checked = false;
    releaseFileName.value = "";
    releaseFileUrl.value = "";
    releaseChecksum.value = "";
    loadReleases();
  } catch (err) {
    releaseMsg.innerText = err.message;
  }
}

async function activateRelease(id) {
  try {
    await api("/updates/activate", {
      method: "POST",
      body: JSON.stringify({ id })
    });
    releaseMsg.innerText = "Release activated";
    loadReleases();
  } catch (err) {
    releaseMsg.innerText = err.message;
  }
}

loadTenants();
loadReleases();
reportFromDate.value = monthStartIso();
reportToDate.value = todayIso();
