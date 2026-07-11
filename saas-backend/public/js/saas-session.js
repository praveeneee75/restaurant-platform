(function () {
  const configs = {
    admin: { tokenKey: "adminToken", userKey: "adminUser", loginUrl: "/login.html", homeUrl: "/admin.html", logoutUrl: "/auth/logout", label: "Admin" },
    owner: { tokenKey: "ownerToken", userKey: "ownerUser", loginUrl: "/owner-login.html", homeUrl: "/owner-dashboard.html", logoutUrl: "/owners/logout", label: "Owner" },
    partner: { tokenKey: "partnerToken", userKey: "partnerUser", loginUrl: "/partner-login.html", homeUrl: "/partner-dashboard.html", logoutUrl: "/partners/logout", label: "Partner" }
  };
  const idleMs = 30 * 60 * 1000;
  const warningMs = 5 * 60 * 1000;
  const scope = document.currentScript?.dataset.sessionScope || document.body?.dataset.sessionScope || "";
  const cfg = configs[scope] || null;
  const protectedPage = Boolean(cfg);
  const stateKey = cfg ? `${cfg.tokenKey}:session` : "";

  function token() {
    return cfg ? localStorage.getItem(cfg.tokenKey) : "";
  }

  function parseJwt(value) {
    try {
      const payload = value.split(".")[1];
      return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    } catch (_) {
      return {};
    }
  }

  function sessionState() {
    try {
      return JSON.parse(localStorage.getItem(stateKey) || "{}");
    } catch (_) {
      return {};
    }
  }

  function saveSessionState(next) {
    if (!cfg) return;
    localStorage.setItem(stateKey, JSON.stringify({ ...sessionState(), ...next }));
  }

  function clearSession() {
    if (!cfg) return;
    localStorage.removeItem(cfg.tokenKey);
    localStorage.removeItem(stateKey);
    if (cfg.userKey) localStorage.removeItem(cfg.userKey);
  }

  function redirectToLogin(reason) {
    if (!cfg) return;
    clearSession();
    const url = new URL(cfg.loginUrl, location.origin);
    if (reason) url.searchParams.set("reason", reason);
    window.location.replace(url.toString());
  }

  function tokenExpired() {
    const value = token();
    if (!value) return true;
    const exp = parseJwt(value).exp;
    return exp ? Date.now() >= exp * 1000 : false;
  }

  function idleExpired() {
    const lastActiveAt = Number(sessionState().lastActiveAt || 0);
    return lastActiveAt > 0 && Date.now() - lastActiveAt > idleMs;
  }

  function touch() {
    if (!protectedPage || !token()) return;
    if (tokenExpired() || idleExpired()) {
      redirectToLogin(tokenExpired() ? "expired" : "idle");
      return;
    }
    saveSessionState({ lastActiveAt: Date.now() });
    updateSessionStatus();
  }

  async function logout(reason = "logout") {
    const currentToken = token();
    try {
      if (cfg?.logoutUrl && currentToken) {
        await fetch(cfg.logoutUrl, { method: "POST", headers: { Authorization: `Bearer ${currentToken}` } });
      }
    } catch (_) {
      // Local logout must still happen if the network is down.
    }
    redirectToLogin(reason);
  }

  function updateSessionStatus() {
    if (!protectedPage) return;
    const el = document.getElementById("sessionStatus");
    if (!el) return;
    const lastActiveAt = Number(sessionState().lastActiveAt || Date.now());
    const remaining = Math.max(idleMs - (Date.now() - lastActiveAt), 0);
    const minutes = Math.ceil(remaining / 60000);
    el.textContent = remaining <= warningMs ? `Session expires in ${minutes} min` : `${cfg.label} session active`;
    el.classList.toggle("session-warning", remaining <= warningMs);
  }

  function isHomeLocation() {
    if (!cfg?.homeUrl) return false;
    const home = new URL(cfg.homeUrl, location.origin);
    return location.pathname === home.pathname && !location.hash;
  }

  function updateNavigationControls() {
    const nav = document.querySelector(".session-nav");
    if (!nav) return;
    const canShowBack = protectedPage && !isHomeLocation();
    const canShowHome = protectedPage && !isHomeLocation();
    const back = nav.querySelector("[data-session-back]");
    const home = nav.querySelector("[data-session-home]");
    if (back) back.hidden = !canShowBack;
    if (home) home.hidden = !canShowHome;
  }

  function addNavigation() {
    if (document.body?.classList.contains("auth-page")) return;
    const nav = document.createElement("div");
    nav.className = "session-nav";
    nav.innerHTML = `
      <button type="button" data-session-back aria-label="Go back">Back</button>
      <a href="${cfg?.homeUrl || "/login.html"}" data-session-home>Home</a>
      ${protectedPage ? `<button type="button" data-session-logout>Logout</button><span id="sessionStatus" class="session-status"></span>` : ""}
    `;
    const target = document.querySelector(".saas-quick-actions") || document.querySelector(".auth-panel") || document.body;
    if (target.classList?.contains("saas-quick-actions")) target.prepend(nav);
    else if (target.classList?.contains("auth-panel")) target.appendChild(nav);
    else document.body.insertBefore(nav, document.body.firstChild);
    updateNavigationControls();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-session-back]")) {
      if (history.length > 1) history.back();
      setTimeout(updateNavigationControls, 100);
      return;
    }
    if (event.target.closest("[data-session-logout]")) {
      logout();
    }
  });

  window.addEventListener("popstate", () => {
    setTimeout(updateNavigationControls, 100);
  });

  window.addEventListener("hashchange", () => {
    updateNavigationControls();
  });

  ["click", "keydown", "mousemove", "touchstart"].forEach((name) => {
    document.addEventListener(name, () => touch(), { passive: true });
  });

  if (protectedPage) {
    if (!token()) redirectToLogin("required");
    else if (tokenExpired()) redirectToLogin("expired");
    else {
      const state = sessionState();
      if (!state.loginAt) saveSessionState({ loginAt: Date.now(), lastActiveAt: Date.now() });
      else if (!state.lastActiveAt) saveSessionState({ lastActiveAt: Date.now() });
      if (idleExpired()) redirectToLogin("idle");
      setInterval(() => {
        if (tokenExpired() || idleExpired()) redirectToLogin(tokenExpired() ? "expired" : "idle");
        else updateSessionStatus();
      }, 30000);
    }
  }

  window.SaasSession = {
    touch,
    logout,
    requireActive() {
      if (!protectedPage) return true;
      if (!token() || tokenExpired() || idleExpired()) {
        redirectToLogin(!token() ? "required" : tokenExpired() ? "expired" : "idle");
        return false;
      }
      touch();
      return true;
    },
    handleUnauthorized(response) {
      if (response && response.status === 401) {
        redirectToLogin("expired");
        return true;
      }
      return false;
    },
    startSession(extra = {}) {
      if (!cfg) return;
      saveSessionState({ loginAt: Date.now(), lastActiveAt: Date.now(), ...extra });
    },
    updateNavigationControls,
    token
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => { addNavigation(); updateSessionStatus(); });
  } else {
    addNavigation();
    updateSessionStatus();
  }
})();
