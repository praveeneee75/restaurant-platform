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

function showLoginView(message) {
  loginView.hidden = false;
  dashboardView.hidden = true;
  webviewPanel.hidden = true;
  appFrame.src = "about:blank";
  if (message) loginStatus.textContent = message;
}

function showDashboardView(message) {
  loginView.hidden = true;
  dashboardView.hidden = false;
  dashboardTitle.textContent = state.restaurant?.name || localStorage.getItem("restaurantName") || "Mobile Dashboard";
  dashboardStatus.textContent = message || `Signed in as ${state.user?.role || "user"}.`;
}

function rememberRestaurant(restaurant) {
  if (!restaurant?.restaurantId) return;
  localStorage.setItem("restaurantId", restaurant.restaurantId);
  localStorage.setItem("restaurantName", restaurant.name || restaurant.restaurantId);
  localStorage.setItem("currency", restaurant.currency || "INR");
  if (restaurant.posUrl) localStorage.setItem("posUrl", restaurantPosUrl(restaurant));
}

function savedRestaurant() {
  const restaurantId = localStorage.getItem("restaurantId");
  if (!restaurantId) return null;
  return {
    restaurantId,
    name: localStorage.getItem("restaurantName") || restaurantId,
    posUrl: localStorage.getItem("posUrl") || DEV_POS_URL,
    currency: localStorage.getItem("currency") || "INR",
    savedOnly: true
  };
}

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

async function fetchRestaurantDirectory() {
  const bases = [MOBILE_DIRECTORY_URL, "http://localhost:4000"]
    .map(cleanBase)
    .filter((base, index, all) => base && all.indexOf(base) === index);
  let lastError = null;
  for (const base of bases) {
    try {
      const data = await fetchJson(`${base}/mobile/restaurants`);
      localStorage.setItem("mobileDirectoryUrl", base);
      return data;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Directory unavailable");
}

function renderRestaurantOptions() {
  restaurantSelect.innerHTML = state.restaurants.length
    ? `<option value="">Select restaurant</option>` + state.restaurants.map((restaurant) => (
      `<option value="${esc(restaurant.restaurantId)}">${esc(restaurant.name)} (${esc(restaurant.restaurantId)})</option>`
    )).join("")
    : `<option value="">No mobile-enabled restaurants</option>`;
}

async function useRestaurant(restaurant) {
  if (!restaurant) return;
  state.restaurant = restaurant;
  restaurantSelect.value = restaurant.restaurantId;
  rememberRestaurant(restaurant);
  activeRestaurantName.textContent = `${restaurant.name} active`;
  await checkPremiumAccess(restaurant);
}

async function checkPremiumAccess(restaurant) {
  if (!restaurant?.restaurantId) throw new Error("Select a restaurant.");
  const base = restaurantPosUrl(restaurant);
  const data = await fetchJson(`${base}/mobile-app/config?restaurantId=${encodeURIComponent(restaurant.restaurantId)}`);
  if (data.app?.restaurantId && data.app.restaurantId !== restaurant.restaurantId) {
    restaurant.restaurantId = data.app.restaurantId;
    localStorage.setItem("restaurantId", restaurant.restaurantId);
  }
  if (data.app?.name) restaurant.name = data.app.name;
  if (data.app?.currency) restaurant.currency = data.app.currency;
  rememberRestaurant(restaurant);
  setBrand(data.app);
  return data;
}

async function loadRestaurants() {
  restaurantSelect.innerHTML = `<option value="">Loading...</option>`;
  try {
    const data = await fetchRestaurantDirectory();
    state.restaurants = (data.restaurants || []).map((restaurant) => ({
      restaurantId: restaurant.restaurantId || restaurant.restaurant_id || restaurant.restaurant_code,
      name: restaurant.name || restaurant.restaurantName || restaurant.restaurant_name || restaurant.displayName || restaurant.display_name || "Restaurant",
      posUrl: restaurant.posUrl || restaurant.pos_url || "",
      currency: restaurant.currency || "INR"
    })).filter((restaurant) => restaurant.restaurantId);
    renderRestaurantOptions();
    const previous = localStorage.getItem("restaurantId");
    if (previous && state.restaurants.some((restaurant) => restaurant.restaurantId === previous)) {
      await useRestaurant(state.restaurants.find((restaurant) => restaurant.restaurantId === previous));
    } else if (state.restaurants.length === 1) {
      await useRestaurant(state.restaurants[0]);
    }
    loginStatus.textContent = state.restaurants.length ? "Login with your POS username and PIN." : "No restaurant has active mobile access.";
  } catch (err) {
    const fallback = savedRestaurant();
    if (!fallback) {
      restaurantSelect.innerHTML = `<option value="">Directory unavailable</option>`;
      loginStatus.textContent = err.message;
      return;
    }
    state.restaurants = [fallback];
    renderRestaurantOptions();
    try {
      await useRestaurant(fallback);
      loginStatus.textContent = "Login with your POS username and PIN.";
    } catch (configErr) {
      loginStatus.textContent = configErr.message || "Directory unavailable. Using saved restaurant.";
    }
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
    showRoleGrid(data.user.role);
    showDashboardView(`Signed in as ${data.user.role}.`);
  } catch (err) {
    loginStatus.textContent = err.message;
  }
}

restaurantSelect.addEventListener("change", async () => {
  state.restaurant = selectedRestaurant();
  if (!state.restaurant) return;
  rememberRestaurant(state.restaurant);
  activeRestaurantName.textContent = `${state.restaurant.name} active`;
  try {
    await checkPremiumAccess(state.restaurant);
    loginStatus.textContent = "Login with your POS username and PIN.";
  } catch (err) {
    loginStatus.textContent = err.message;
  }
});

loginButton.addEventListener("click", login);
logoutButton.addEventListener("click", () => {
  state.user = null;
  localStorage.removeItem("user");
  showRoleGrid("");
  showLoginView("Logged out. Login with your POS username and PIN.");
});

document.querySelector(".role-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  const role = button.dataset.role;
  const restaurant = state.restaurant || selectedRestaurant();
  const restId = restaurant?.restaurantId || localStorage.getItem("restaurantId");
  const posBase = restaurantPosUrl(restaurant);
  const mobileParams = new URLSearchParams({
    restaurantId: restId || "",
    mobileUserId: String(state.user?.id || ""),
    mobileUserName: state.user?.name || state.user?.username || "Mobile user",
    mobileRole: state.user?.role || ""
  });
  const paths = {
    owner: `${posBase}/admin.html?${mobileParams.toString()}`,
    captain: `${posBase}/waiter.html?${mobileParams.toString()}`,
    waiter: `${posBase}/waiter.html?${mobileParams.toString()}`,
    cashier: `${posBase}/pos-live.html?${mobileParams.toString()}`
  };
  if (!restId || !posBase || !state.user) {
    showLoginView("Login first.");
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
if (state.user) {
  showDashboardView(`Signed in as ${state.user.role}.`);
} else {
  showLoginView();
}
