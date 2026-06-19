const config = {
  restaurantId: localStorage.getItem("restaurantId") || "",
  posUrl: localStorage.getItem("posUrl") || "",
  saasUrl: localStorage.getItem("saasUrl") || ""
};

restaurantId.value = config.restaurantId;
posUrl.value = config.posUrl;
saasUrl.value = config.saasUrl;

function cleanBase(url) {
  return String(url || "").trim().replace(/\/$/, "");
}

function setBrand(app) {
  if (!app) return;
  brandName.textContent = app.name || "Restaurant Mobile";
  brandStatus.textContent = "Premium mobile app enabled";
  document.documentElement.style.setProperty("--primary", app.primaryColor || "#2563eb");
  document.documentElement.style.setProperty("--accent", app.accentColor || "#f59e0b");
  if (app.logoPath) {
    brandLogo.textContent = "";
    brandLogo.style.backgroundImage = `url("${app.logoPath}")`;
    brandLogo.style.backgroundSize = "cover";
    brandLogo.style.backgroundPosition = "center";
  }
}

async function checkPremiumAccess() {
  const base = cleanBase(posUrl.value);
  const restId = restaurantId.value.trim();
  if (!base || !restId) {
    brandStatus.textContent = "Enter POS URL and Restaurant ID.";
    return;
  }
  const res = await fetch(`${base}/mobile-app/config?restaurantId=${encodeURIComponent(restId)}`);
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Mobile app not enabled");
  setBrand(data.app);
}

saveConfig.addEventListener("click", async () => {
  try {
    localStorage.setItem("restaurantId", restaurantId.value.trim());
    localStorage.setItem("posUrl", cleanBase(posUrl.value));
    localStorage.setItem("saasUrl", cleanBase(saasUrl.value));
    await checkPremiumAccess();
  } catch (err) {
    brandStatus.textContent = err.message;
  }
});

document.querySelector(".role-grid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-role]");
  if (!button) return;
  const role = button.dataset.role;
  const restId = restaurantId.value.trim();
  const posBase = cleanBase(posUrl.value);
  const saasBase = cleanBase(saasUrl.value);
  const paths = {
    owner: `${saasBase}/owner-mobile.html?restaurantId=${encodeURIComponent(restId)}`,
    captain: `${posBase}/waiter.html?restaurantId=${encodeURIComponent(restId)}`,
    waiter: `${posBase}/waiter.html?restaurantId=${encodeURIComponent(restId)}`,
    cashier: `${posBase}/pos-live.html?restaurantId=${encodeURIComponent(restId)}`
  };
  if ((role === "owner" && !saasBase) || (role !== "owner" && !posBase)) {
    brandStatus.textContent = "Save POS/SaaS URL first.";
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

if (config.posUrl && config.restaurantId) {
  checkPremiumAccess().catch((err) => { brandStatus.textContent = err.message; });
}
