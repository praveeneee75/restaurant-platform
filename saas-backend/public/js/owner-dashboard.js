const token = localStorage.getItem("ownerToken");
if (!token) window.location.href = "/owner-login.html";
try {
  const ownerUser = JSON.parse(localStorage.getItem("ownerUser") || "{}");
  if (ownerUser.resetRequired) window.location.replace("/owner-change-password.html");
} catch (_) {
  window.location.replace("/owner-login.html");
}

async function ownerApi(url, options = {}) {
  if (!window.SaasSession?.requireActive?.()) throw new Error("Session expired");
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {})
    }
  });
  if (window.SaasSession?.handleUnauthorized?.(res)) throw new Error("Session expired");
  const data = await res.json();
  if (data.passwordChangeRequired) {
    window.location.replace("/owner-change-password.html");
    throw new Error(data.message);
  }
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

function formatDateOnly(value) {
  if (!value) return "Not set";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not set" : date.toLocaleDateString();
}

function daysRemaining(value) {
  if (!value) return "Not set";
  const expiry = new Date(value);
  if (Number.isNaN(expiry.getTime())) return "Not set";
  const expiryEnd = new Date(expiry.getFullYear(), expiry.getMonth(), expiry.getDate(), 23, 59, 59, 999);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const days = Math.max(Math.ceil((expiryEnd - todayStart) / 86400000), 0);
  return days === 1 ? "1 day" : `${days} days`;
}

function money(value) {
  return Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function firstRestaurant(restaurants = []) {
  return restaurants[0] || {};
}

function renderAppCards(data) {
  const restaurant = firstRestaurant(data.restaurants);
  appCards.innerHTML = `
    <article class="app-download-card">
      <div>
        <span class="app-card-kicker">Desktop</span>
        <h3>Desktop POS App</h3>
        <p>Install this on the billing counter computer. This computer becomes the main POS for the restaurant.</p>
      </div>
      <a class="download-button" href="/downloads.html">Download desktop POS</a>
    </article>
    <article class="app-download-card">
      <div>
        <span class="app-card-kicker">Phone / Tablet</span>
        <h3>Mobile App</h3>
        <p>Install this on phones or tablets for owner access, waiter ordering, captain ordering, or cashier use.</p>
      </div>
      <a id="mobileSmartDownload" class="download-button" href="/mobile/download">Download mobile app</a>
      <p id="mobileDownloadStatus">Checking mobile release...</p>
      <figure class="app-qr">
        <img id="mobileDownloadQr" src="/mobile/download/qr.png" alt="QR code for the mobile app download">
        <figcaption>Scan on the phone or tablet.</figcaption>
      </figure>
    </article>
    <article class="app-download-card app-credential-card">
      <div>
        <span class="app-card-kicker">Credentials</span>
        <h3>What You Need</h3>
        <dl>
          <dt>Restaurant code</dt>
          <dd><code>${restaurant.restaurant_code || "Shown below"}</code></dd>
          <dt>License key</dt>
          <dd><code>${restaurant.license_key || "Shown below"}</code></dd>
          <dt>Owner login</dt>
          <dd>${data.owner?.email || "Your owner username"} + your owner password</dd>
        </dl>
      </div>
    </article>
  `;
}

function renderOwnerSteps(data) {
  const restaurant = firstRestaurant(data.restaurants);
  ownerSteps.innerHTML = `
    <article class="owner-step-card">
      <strong>1. Activate the desktop POS</strong>
      <p>Download the desktop POS on the billing counter computer. Open it, then enter the restaurant code and license key.</p>
      <p><b>Restaurant code:</b> <code>${restaurant.restaurant_code || "Shown in the branch table"}</code></p>
      <p><b>License key:</b> <code>${restaurant.license_key || "Shown in the branch table"}</code></p>
    </article>
    <article class="owner-step-card">
      <strong>2. Owner/admin login over internet</strong>
      <p>In the POS login screen, use your owner email and owner password. This gives owner-level access when internet is available.</p>
      <p><b>Username:</b> <code>${data.owner?.email || "Owner email"}</code></p>
      <p><b>Password:</b> Your owner portal password.</p>
    </article>
    <article class="owner-step-card">
      <strong>3. Staff/mobile login on Wi-Fi</strong>
      <p>Keep the desktop POS app open. Connect the phone/tablet to the same Wi-Fi as the desktop POS, then login with the staff POS username and PIN created inside POS.</p>
      <p>If the phone says it cannot reach POS, check Wi-Fi first and reopen the desktop POS app.</p>
    </article>
  `;
}

async function loadDashboard() {
  try {
    const data = await ownerApi("/owners/dashboard");
    const owner = data.owner || JSON.parse(localStorage.getItem("ownerUser") || "{}");
    ownerWelcome.innerText = `Welcome, ${owner.name || "Owner"}`;
    ownerStatus.innerText = `${data.restaurants.length} restaurant${data.restaurants.length === 1 ? "" : "s"} assigned to your account.`;

    renderAppCards(data);
    renderOwnerSteps(data);
    loadMobileDownload();

    const onlineCount = data.restaurants.filter((restaurant) => restaurant.pos_status === "ONLINE").length;
    organizationCards.innerHTML = (data.organizations || []).map((org) => `
      <div class="card">
        <span>${org.name}</span>
        <strong>${money(org.today_net_sales)}</strong>
        <small>${org.branch_count} branches | ${org.online_branches} online | ${org.today_orders} orders today</small>
        <small>This month: ${money(org.month_net_sales)} | ${org.month_orders || 0} orders</small>
      </div>
    `).join("") || `
      <div class="card">
        <span>All restaurants</span>
        <strong>${data.restaurants.length}</strong>
        <small>${onlineCount} online now | ${data.restaurants.length - onlineCount} offline</small>
      </div>
    `;

    ownerRestaurants.innerHTML = data.restaurants.map((row) => `
      <tr>
        <td data-label="Restaurant"><strong>${row.name}</strong></td>
        <td data-label="Code"><code>${row.restaurant_code}</code></td>
        <td data-label="License Key"><code>${row.license_key || "-"}</code></td>
        <td data-label="Package">${row.package_name || row.package_code || "Not assigned"}</td>
        <td data-label="License Expiry">${formatDateOnly(row.license_expires_at)}</td>
        <td data-label="Days Left">${daysRemaining(row.license_expires_at)}</td>
        <td data-label="POS Status"><span class="status-pill ${row.pos_status === "ONLINE" ? "status-ok" : "status-muted"}">${row.pos_status || "OFFLINE"}</span></td>
        <td data-label="Version">${row.pos_version || "-"}</td>
        <td data-label="Last Online">${row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toLocaleString() : "Never"}</td>
        <td data-label="Installer"><a href="/downloads.html">Download</a></td>
      </tr>
    `).join("") || `<tr><td colspan="10">No restaurants assigned.</td></tr>`;
  } catch (err) {
    ownerStatus.innerText = err.message;
  }
}

async function loadMobileDownload() {
  try {
    const res = await fetch("/mobile/download-info", { cache: "no-store" });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Mobile release information unavailable");
    mobileSmartDownload.href = data.smartUrl || "/mobile/download";
    mobileDownloadQr.src = `${data.qrUrl}?v=${encodeURIComponent(data.android.version || "latest")}`;
    mobileDownloadStatus.textContent = data.android.available
      ? `Android ${data.android.version || ""} APK ready.`
      : "Android app is not published yet.";
  } catch (err) {
    if (window.mobileDownloadStatus) mobileDownloadStatus.textContent = err.message;
  }
}

loadDashboard();
setInterval(loadDashboard, 30000);
