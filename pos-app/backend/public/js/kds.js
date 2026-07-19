const restaurantId = new URLSearchParams(window.location.search).get("restaurantId") || localStorage.getItem("restaurantId");
if (restaurantId) localStorage.setItem("restaurantId", restaurantId);

const user = JSON.parse(localStorage.getItem("user") || '{"role":"KITCHEN"}');
const actor = { id: user.id, role: user.role || "KITCHEN", username: user.username };
const allowedRoles = ["OWNER", "MANAGER_2", "KITCHEN"];
if (!allowedRoles.includes(String(actor.role).toUpperCase())) { window.location.replace(`/login.html?returnTo=${encodeURIComponent(window.location.pathname)}`); throw new Error("KDS access required"); }
document.querySelectorAll('[data-role-nav="availability"]').forEach((el) => { el.hidden = !['OWNER', 'MANAGER_1', 'MANAGER_2'].includes(String(actor.role).toUpperCase()); });
document.querySelectorAll("[data-logout]").forEach((button) => button.addEventListener("click", () => { localStorage.clear(); window.location.href = "/login.html"; }));
if (String(actor.role).toUpperCase() === "KITCHEN") document.getElementById("kdsBackBtn").hidden = true;
const state = { kitchens: [], kitchenIds: [], lastPendingIds: new Set(), firstLoad: true };

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

function minutesSince(value) {
  const normalized = String(value || "").trim().replace(" ", "T");
  const created = new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
  const diff = Math.max(Date.now() - created.getTime(), 0);
  const minutes = Math.floor(diff / 60000);
  return minutes < 1 ? "Just now" : `${minutes} min`;
}

function parseKdsTime(value) {
  const raw = String(value || '').trim();
  const normalized = raw.replace(' ', 'T');
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(normalized) ? normalized : `${normalized}Z`);
}

function formatStartTime(value) {
  const date = parseKdsTime(value);
  return Number.isNaN(date.getTime()) ? 'Unavailable' : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function elapsedLabel(value) {
  const date = parseKdsTime(value);
  if (Number.isNaN(date.getTime())) return 'Unavailable';
  const seconds = Math.max(Math.floor((Date.now() - date.getTime()) / 1000), 0);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours ? `${hours}h ${String(minutes).padStart(2, '0')}m` : `${minutes}m ${String(secs).padStart(2, '0')}s`;
}

function beep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.04;
    oscillator.connect(gain);
    gain.connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + 0.16);
  } catch (_) {}
}

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ restaurantId, actor, ...body })
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

function renderKitchenOptions() {
  kitchenSelectOptions.innerHTML = state.kitchens.map((kitchen) => `<label><input type="checkbox" data-kitchen-id="${kitchen.id}" ${state.kitchenIds.includes(Number(kitchen.id))?'checked':''}> ${esc(kitchen.name)}</label>`).join("");
  const selected = state.kitchens.filter((kitchen) => state.kitchenIds.includes(Number(kitchen.id))).map((kitchen) => kitchen.name);
  kitchenSelectLabel.textContent = selected.length === state.kitchens.length ? 'All kitchens' : selected.length ? selected.join(', ') : 'Select kitchens';
}

function goBack() {
  if (window.history.length > 1) window.history.back();
  else window.location.href = "/admin.html";
}

async function boot() {
  if (!restaurantId) {
    kdsStatus.textContent = "POS is not activated";
    return;
  }
  if (!allowedRoles.includes(actor.role)) {
    kdsStatus.textContent = "KDS access denied";
    document.querySelector(".kds-board").hidden = true;
    return;
  }
  const data = await fetch(`/admin/bootstrap?restaurantId=${encodeURIComponent(restaurantId)}`).then((res) => res.json());
  if (!data.success) throw new Error(data.message);
  const restaurantName = data.restaurant?.name || data.settings?.restaurantName || restaurantId;
  const nameElement = document.getElementById("kdsRestaurantName");
  if (nameElement) nameElement.textContent = restaurantName;
  state.kitchens = data.kitchens || [];
  const requested = new URLSearchParams(window.location.search).get("kitchenId");
  const stored = localStorage.getItem("kdsKitchenIds");
  state.kitchenIds = String(requested || stored || state.kitchens.map(k=>k.id).join(',')).split(',').map(Number).filter(id=>state.kitchens.some(k=>Number(k.id)===id));
  renderKitchenOptions();
  await loadOrders();
}

function renderCard(order, item) {
  const actions = {
    PENDING: `<button data-item-status="PREPARING" data-order-item="${item.orderItemId}">Start</button><button class="danger-btn" data-item-status="CANCELLED" data-order-item="${item.orderItemId}">Cancel</button>`,
    PREPARING: `<button data-item-status="READY" data-order-item="${item.orderItemId}">Ready</button>`,
    READY: `<button data-item-status="SERVED" data-order-item="${item.orderItemId}">Served</button>`
  }[item.status] || "";
  return `
    <article class="kds-card">
      <header><strong>#${esc(item.kotReference || `${order.orderId}-${item.kotSequence || 1}`)}</strong><span>${esc(order.tableName || "Parcel")}</span></header>
      <h3>${esc(item.name)}</h3>
      <p>Qty ${item.quantity} · Started ${esc(formatStartTime(item.startTime || order.createdAt))}</p>
      ${item.status === 'PENDING' || item.status === 'PREPARING' ? `<p class="kds-timer" data-start-time="${esc(item.startTime || order.createdAt)}">Pending <strong>${esc(elapsedLabel(item.startTime || order.createdAt))}</strong></p>` : ''}
      ${(item.modifiers || []).map((modifier) => `<small>- ${esc(modifier.name)}</small>`).join("")}
      ${item.notes ? `<p class="kds-item-note"><strong>Note:</strong> ${esc(item.notes)}</p>` : ""}
      <div class="kds-actions">${actions}</div>
    </article>
  `;
}

function renderOrders(orders) {
  const buckets = { PENDING: [], PREPARING: [], READY: [] };
  orders.forEach((order) => {
    order.items.forEach((item) => {
      if (buckets[item.status]) buckets[item.status].push(renderCard(order, item));
    });
  });
  kdsPending.innerHTML = buckets.PENDING.join("") || "<p>No new orders</p>";
  kdsPreparing.innerHTML = buckets.PREPARING.join("") || "<p>Nothing preparing</p>";
  kdsReady.innerHTML = buckets.READY.join("") || "<p>Nothing ready</p>";
  updateTimers();

  const pendingIds = new Set(orders.flatMap((order) => order.items.filter((item) => item.status === "PENDING").map((item) => item.orderItemId)));
  const hasNewPending = [...pendingIds].some((id) => !state.lastPendingIds.has(id));
  if (!state.firstLoad && hasNewPending) beep();
  state.lastPendingIds = pendingIds;
  state.firstLoad = false;
  kdsStatus.textContent = `${orders.length} open order${orders.length === 1 ? "" : "s"}`;
}

function updateTimers() {
  document.querySelectorAll('.kds-timer[data-start-time]').forEach((timer) => {
    timer.innerHTML = `Pending <strong>${esc(elapsedLabel(timer.dataset.startTime))}</strong>`;
  });
}

async function loadOrders() {
  if (!state.kitchenIds.length || !allowedRoles.includes(actor.role)) { renderOrders([]); return; }
  localStorage.setItem("kdsKitchenIds", state.kitchenIds.join(','));
  const data = await fetch(`/kds/orders?restaurantId=${encodeURIComponent(restaurantId)}&kitchenIds=${encodeURIComponent(state.kitchenIds.join(','))}&role=${encodeURIComponent(actor.role)}`).then((res) => res.json());
  if (!data.success) {
    kdsStatus.textContent = data.message;
    return;
  }
  renderOrders(data.orders);
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target) return;
  if (target.dataset.itemStatus) {
    target.disabled = true;
    const previousText = target.textContent;
    target.textContent = "Updating...";
    try {
      await postJson("/kds/item-status", { orderItemId: target.dataset.orderItem, status: target.dataset.itemStatus });
      kdsStatus.textContent = `Item marked ${target.dataset.itemStatus}`;
      await loadOrders();
    } catch (err) {
      kdsStatus.textContent = err.message;
      alert(err.message);
      target.disabled = false;
      target.textContent = previousText;
    }
  }
});

kitchenSelectOptions.addEventListener("change", async () => {
  state.kitchenIds = [...kitchenSelectOptions.querySelectorAll('[data-kitchen-id]:checked')].map(input=>Number(input.dataset.kitchenId));
  renderKitchenOptions();
  state.firstLoad = true;
  await loadOrders();
});

refreshKds.addEventListener("click", loadOrders);
setInterval(updateTimers, 1000);
kdsBackBtn.addEventListener("click", goBack);

boot().catch((err) => {
  kdsStatus.textContent = err.message;
});

setInterval(loadOrders, 5000);
