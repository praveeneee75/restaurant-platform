const token = localStorage.getItem("ownerToken");
if (!token) window.location.replace("/owner-login.html");

async function saveOwnerPassword() {
  const currentPassword = document.getElementById("currentPassword").value;
  const newPassword = document.getElementById("newPassword").value;
  const confirmPassword = document.getElementById("confirmPassword").value;
  const button = document.getElementById("changePasswordButton");
  const msg = document.getElementById("msg");

  if (newPassword !== confirmPassword) {
    msg.textContent = "New passwords do not match";
    return;
  }
  if (newPassword.length < 10 || !/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword)) {
    msg.textContent = "Use at least 10 characters with uppercase, lowercase and a number";
    return;
  }

  button.disabled = true;
  msg.textContent = "Saving...";
  try {
    const res = await fetch("/owners/change-password", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || "Password change failed");
    localStorage.setItem("ownerToken", data.token);
    localStorage.setItem("ownerUser", JSON.stringify(data.owner));
    localStorage.setItem("ownerToken:session", JSON.stringify({ loginAt: Date.now(), lastActiveAt: Date.now() }));
    msg.textContent = "Password saved";
    window.location.replace("/owner-dashboard.html");
  } catch (error) {
    msg.textContent = error.message;
    button.disabled = false;
  }
}

document.getElementById("changePasswordButton").addEventListener("click", saveOwnerPassword);
document.getElementById("confirmPassword").addEventListener("keydown", (event) => {
  if (event.key === "Enter") saveOwnerPassword();
});
document.getElementById("logoutButton").addEventListener("click", () => window.SaasSession.logout());
