async function loadBranding() {
  try {
    const res = await fetch(`/partners/branding/public?domain=${encodeURIComponent(window.location.hostname)}`);
    const data = await res.json();
    if (!data.success || !data.branding) return;
    loginTitle.innerText = `${data.branding.brand_name || data.branding.partner_name} Partner Login`;
    if (data.branding.primary_color) document.documentElement.style.setProperty("--brand-primary", data.branding.primary_color);
    if (data.branding.support_email || data.branding.support_phone) {
      brandSupport.innerText = `Support: ${data.branding.support_email || ""} ${data.branding.support_phone || ""}`.trim();
    }
  } catch (_) {}
}

async function partnerLogin() {
  if (!email.value || !password.value) {
    msg.innerText = "Enter email and password";
    return;
  }
  try {
    const res = await fetch("/partners/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.value, password: password.value })
    });
    const data = await res.json();
    if (!data.success) {
      msg.innerText = data.message;
      return;
    }
    localStorage.setItem("partnerToken", data.token);
    localStorage.setItem("partnerUser", JSON.stringify(data.user));
    window.location.href = "/partner-dashboard.html";
  } catch (err) {
    msg.innerText = "Server error";
  }
}

loadBranding();
