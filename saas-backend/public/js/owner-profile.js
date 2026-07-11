let token = localStorage.getItem("ownerToken");
if (!token) window.location.replace("/owner-login.html");

async function ownerApi(url, options = {}) {
  if (!window.SaasSession?.requireActive?.()) throw new Error("Session expired");
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {})
    }
  });
  if (window.SaasSession?.handleUnauthorized?.(res)) throw new Error("Session expired");
  const data = await res.json();
  if (data.passwordChangeRequired) {
    window.location.replace("/owner-change-password.html");
    throw new Error(data.message);
  }
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function loadProfile() {
  try {
    const data = await ownerApi("/owners/profile");
    profileUsername.value = data.profile.username || "";
    profileName.value = data.profile.name || "";
    profileMobile.value = data.profile.mobileNumber || "";
    profileNotificationEmail.value = data.profile.notificationEmail || "";
  } catch (err) {
    profileMsg.innerText = err.message;
  }
}

async function saveProfile() {
  profileMsg.innerText = "";
  try {
    const data = await ownerApi("/owners/profile", {
      method: "POST",
      body: JSON.stringify({
        name: profileName.value.trim(),
        mobileNumber: profileMobile.value.trim(),
        notificationEmail: profileNotificationEmail.value.trim()
      })
    });
    if (data.owner) localStorage.setItem("ownerUser", JSON.stringify(data.owner));
    profileMsg.innerText = data.message || "Profile saved";
  } catch (err) {
    profileMsg.innerText = err.message;
  }
}

async function changePassword() {
  passwordMsg.innerText = "";
  try {
    if (newPassword.value !== confirmPassword.value) {
      passwordMsg.innerText = "New passwords do not match";
      return;
    }
    if (newPassword.value.length < 10 || !/[A-Z]/.test(newPassword.value) || !/[a-z]/.test(newPassword.value) || !/\d/.test(newPassword.value)) {
      passwordMsg.innerText = "Use at least 10 characters with uppercase, lowercase and a number";
      return;
    }
    const data = await ownerApi("/owners/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    });
    if (data.token) {
      token = data.token;
      localStorage.setItem("ownerToken", data.token);
    }
    if (data.owner) localStorage.setItem("ownerUser", JSON.stringify(data.owner));
    currentPassword.value = "";
    newPassword.value = "";
    confirmPassword.value = "";
    passwordMsg.innerText = "Password changed";
  } catch (err) {
    passwordMsg.innerText = err.message;
  }
}

loadProfile();
