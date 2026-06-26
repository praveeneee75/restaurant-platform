async function loadBranding() {
  try {
    const res = await fetch(`/partners/branding/public?domain=${encodeURIComponent(window.location.hostname)}`);
    const data = await res.json();
    if (!data.success || !data.branding) return;
    if (window.loginTitle) loginTitle.innerText = `${data.branding.brand_name || data.branding.partner_name} Admin Login`;
    if (window.brandSupport && (data.branding.support_email || data.branding.support_phone)) {
      brandSupport.innerText = `Support: ${data.branding.support_email || ""} ${data.branding.support_phone || ""}`.trim();
    }
  } catch (_) {}
}

async function login() {

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  if (!email || !password) {
    document.getElementById("msg").innerText = "Enter email and password";
    return;
  }

  try {

    const res = await fetch("/auth/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        email,
        password
      })
    });

    const data = await res.json();

    if (!data.success) {
      document.getElementById("msg").innerText = data.message;
      return;
    }

    localStorage.setItem("adminToken", data.token);
    localStorage.removeItem("ownerToken");
    localStorage.removeItem("ownerUser");
    localStorage.removeItem("partnerToken");
    localStorage.removeItem("partnerUser");
    localStorage.setItem("adminToken:session", JSON.stringify({ loginAt: Date.now(), lastActiveAt: Date.now() }));

    window.location.href = "/admin.html";

  } catch (err) {

    console.error(err);
    document.getElementById("msg").innerText = "Server error";

  }
}

loadBranding();
