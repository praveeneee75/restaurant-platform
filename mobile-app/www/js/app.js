function cleanBase(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

const MOBILE_DIRECTORY_URL = cleanBase(window.MOBILE_DIRECTORY_URL || localStorage.getItem("mobileDirectoryUrl") || "http://localhost:4000");
const DEV_POS_URL = cleanBase(window.DEV_POS_URL || localStorage.getItem("devPosUrl") || "http://localhost:3000");
const state = {
  restaurants: [],
  restaurant: null,
  user: JSON.parse(localStorage.getItem("user") || "null")
};

function setBrand(app) {
  if (!app) return;
  const selectedName = state.restaurant?.name || app.name || localStorage.getItem("restaurantName") || "Restaurant";
  brandName.textContent = app.name || selectedName || "Restaurant Mobile";
  activeRestaurantName.textContent = selectedName ? `${selectedName} active` : "No restaurant selected";
  brandStatus.textContent = app.enabled ? "Premium mobile app enabled" : "Mobile app access disabled";
  document.documentElement.style.setProperty("--primary", app.primaryColor || "#2563eb");
  document.documentElement.style.setProperty("--accent", app.accentColor || "#f59e0b");
  if (app.logoPath) {
    brandLogo.textContent = "";
    brandLogo.style.backgroundImage = `url("${app.logoPath}")`;
    brandLogo.style.backgroundSize = "cover";
    brandLogo.style.backgroundPosition = "center";
  }
}

function selectedRestaurant() {
  return state.restaurants.find((restaurant) => restaurant.restaurantId === restaurantSelect.value) || null;
}

function restaurantPosUrl(restaurant) {
  return cleanBase(restaurant?.posUrl || DEV_POS_URL);
}

async function fetchJson(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function checkPremiumAccess(restaurant) {
  if (!restaurant?.restaurantId) throw new Error("Select a restaurant.");
  const base = restaurantPosUrl(restaurant);
  const data = await fetchJson(`${base}/mobile-app/config?restaurantId=${encodeURIComponent(restaurant.restaurantId)}`);
  if (data.app?.restaurantId && data.app.restaurantId !== restaurant.restaurantId) {
    restaurant.restaurantId = data.app.restaurantId;
    localStorage.setItem("restaurantId", restaurant.restaurantId);
  }
  setBrand(data.app);
  return data;
}

async function loadRestaurants() {
  restaurantSelect.innerHTML = `<option value="">Loading...</option>`;
  try {
    const data = await fetchJson(`${MOBILE_DIRECTORY_URL}/mobile/restaurants`);
    state.restaurants = (data.restaurants || []).map((restaurant) => ({
      restaurantId: restaurant.restaurantId || restaurant.restaurant_id || restaurant.restaurant_code,
      name: restaurant.name || restaurant.restaurantName || restaurant.restaurant_name || restaurant.displayName || restaurant.display_name || "Restaurant",
      posUrl: restaurant.posUrl || restaurant.pos_url || "",
      currency: restaurant.currency || "INR"
    })).filter((restaurant) => restaurant.restaurantId);
    restaurantSelect.innerHTML = state.restaurants.length
      ? `<option value="">Select restaurant</option>` + state.restaurants.map((restaurant) => (
        `<option value="${esc(restaurant.restaurantId)}">${esc(restaurant.name)} (${esc(restaurant.restaurantId)})</option>`
      )).join("")
      : `<option value="">No mobile-enabled restaurants</option>`;
    const previous = localStorage.getItem("restaurantId");
    if (previous && state.restaurants.some((restaurant) => restaurant.restaurantId === previous)) {
      restaurantSelect.value = previous;
      state.restaurant = selectedRestaurant();
      activeRestaurantName.textContent = `${state.restaurant.name} active`;
      await checkPremiumAccess(state.restaurant);
    } else if (state.restaurants.length === 1) {
      state.restaurant = state.restaurants[0];
      restaurantSelect.value = state.restaurant.restaurantId;
      localStorage.setItem("restaurantId", state.restaurant.restaurantId);
      localStorage.setItem("restaurantName", state.restaurant.name);
      activeRestaurantName.textContent = `${state.restaurant.name} active`;
      await checkPremiumAccess(state.restaurant);
    }
    loginStatus.textContent = state.restaurants.length ? "Login with your POS username and PIN." : "No restaurant has active mobile access.";
  } catch (err) {
    restaurantSelect.innerHTML = `<option value="">Directory unavailable</option>`;
    loginStatus.textContent = err.message;
  }
}

function showRoleGrid(role) {
  const roleRules = {
    owner: ["OWNER", "MANAGER", "MANAGER_2"],
    captain: ["OWNER", "MANAGER", "MANAGER_1", "MANAGER_2", "CAPTAIN", "WAITER"],
    waiter: ["OWNER", "MANAGER", "MANAGER_1", "MANAGER_2", "CAPTAIN", "WAITER"],
    cashier: ["OWNER", "MANAGER", "MANAGER_1", "MANAGER_2", "CASHIER"]
  };
  document.querySelectorAll("[data-role]").forEach((button) => {
    button.hidden = !roleRules[button.dataset.role]?.includes(role);
  });
}

async function login() {
  state.restaurant = selectedRestaurant();
  if (!state.restaurant) {
    loginStatus.textContent = "Select a restaurant.";
    return;
  }
  if (!username.value.trim() || !pin.value.trim()) {
    loginStatus.textContent = "Enter username and PIN.";
    return;
  }
  try {
    await checkPremiumAccess(state.restaurant);
    const base = restaurantPosUrl(state.restaurant);
    const data = await fetchJson(`${base}/mobile-app/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        restaurantId: state.restaurant.restaurantId,
        username: username.value.trim(),
        pin: pin.value.trim()
      })
    });
    state.user = data.user;
    if (data.restaurant?.name) state.restaurant.name = data.restaurant.name;
    localStorage.setItem("restaurantId", state.restaurant.restaurantId);
    localStorage.setItem("restaurantName", state.restaurant.name);
    localStorage.setItem("posUrl", base);
    localStorage.setItem("user", JSON.stringify(data.user));
    activeRestaurantName.textContent = `${state.restaurant.name} active`;
    loginStatus.textContent = `Logged in to ${state.restaurant.name} as ${data.user.role}`;
    showRoleGrid(data.user.role);
  } catch (err) {
    loginStatus.textContent = err.message;
  }
}

restaurantSelect.addEventListener("change", async () => {
  state.restaurant = selectedRestaurant();
  if (!state.restaurant) return;
  localStorage.setItem("restaurantId", state.restaurant.restaurantId);
  localStorage.setItem("restaurantName", state.restaurant.name);
  activeRestaurantName.textContent = `${state.restaurant.name} active`;
  try {
    await checkPremiumAccess(state.restaurant);
    loginStatus.textContent = "Login with your POS username and PIN.";
  } catch (err) {
    loginStatus.textContent = err.message;
  }
});

loginButton.addEventListener("click", login);

document.querySelector(".role-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  const role = button.dataset.role;
  const restaurant = state.restaurant || selectedRestaurant();
  const restId = restaurant?.restaurantId || localStorage.getItem("restaurantId");
  const posBase = restaurantPosUrl(restaurant);
  const paths = {
    owner: `${posBase}/admin.html?restaurantId=${encodeURIComponent(restId)}`,
    captain: `${posBase}/waiter.html?restaurantId=${encodeURIComponent(restId)}`,
    waiter: `${posBase}/waiter.html?restaurantId=${encodeURIComponent(restId)}`,
    cashier: `${posBase}/pos-live.html?restaurantId=${encodeURIComponent(restId)}`
  };
  if (!restId || !posBase || !state.user) {
    loginStatus.textContent = "Login first.";
    return;
  }
  activeRole.textContent = button.textContent;
  appFrame.src = paths[role];
  webviewPanel.hidden = false;
});

closeFrame.addEventListener("click", () => {
  appFrame.src = "about:blank";
  webviewPanel.hidden = true;
});

showRoleGrid(state.user?.role || "");
loadRestaurants();
