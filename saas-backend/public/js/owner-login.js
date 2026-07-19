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
  const ownerEmail = email.value.trim();
  if (!ownerEmail) { msg.innerText = "Email is required."; email.focus(); return; }
  if (!email.checkValidity()) { msg.innerText = "Enter a valid email address."; email.focus(); return; }
  if (!password.value) { msg.innerText = "Password is required."; password.focus(); return; }
  let res;
  let data;
  try {
    res = await fetch("/owners/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: ownerEmail, password: password.value })
    });
    data = await res.json();
  } catch (_) {
    msg.innerText = "Unable to reach the server. Check your connection and try again.";
    return;
  }
  if (!res.ok || !data.success) {
    msg.innerText = data.message || "Login failed";
    return;
  }
  localStorage.setItem("ownerToken", data.token);
  localStorage.setItem("ownerUser", JSON.stringify(data.owner));
  localStorage.removeItem("adminToken");
  localStorage.removeItem("partnerToken");
  localStorage.removeItem("partnerUser");
  localStorage.setItem("ownerToken:session", JSON.stringify({ loginAt: Date.now(), lastActiveAt: Date.now() }));
  window.location.href = data.owner.resetRequired
    ? "/owner-change-password.html"
    : "/owner-dashboard.html";
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.target === email || event.target === password)) ownerLogin();
});

loadBranding();
