async function loadBranding() {
  try {
    const res = await fetch(`/partners/branding/public?domain=${encodeURIComponent(window.location.hostname)}`);
    const data = await res.json();
    if (!data.success || !data.branding) return;
    if (window.loginTitle) loginTitle.innerText = `${data.branding.brand_name || data.branding.partner_name} Owner Login`;
    if (window.brandSupport && (data.branding.support_email || data.branding.support_phone)) {
      brandSupport.innerText = `Support: ${data.branding.support_email || ""} ${data.branding.support_phone || ""}`.trim();
    }
  } catch (_) {}
}

async function ownerLogin() {
  msg.innerText = "";
  const res = await fetch("/owners/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: email.value.trim(), password: password.value })
  });
  const data = await res.json();
  if (!res.ok || !data.success) {
    msg.innerText = data.message || "Login failed";
    return;
  }
  localStorage.setItem("ownerToken", data.token);
  localStorage.setItem("ownerUser", JSON.stringify(data.owner));
  window.location.href = "/owner-dashboard.html";
}

loadBranding();
