let passwordLookupReady = false;
let usernameLookupReady = false;

function clearRecoveryState() {
  msg.textContent = "";
  passwordLookupReady = false;
  usernameLookupReady = false;
  passwordRestaurants.innerHTML = "";
  usernameRestaurants.innerHTML = "";
  sendPasswordButton.hidden = true;
  sendUsernameButton.hidden = true;
}

function setRecoveryMode(mode) {
  const hasMode = mode === "password" || mode === "username";
  const passwordMode = mode === "password";
  recoveryChoice.hidden = hasMode;
  passwordPanel.hidden = !passwordMode;
  usernamePanel.hidden = mode !== "username";
  recoveryTitle.innerText = passwordMode
    ? "Forgot Password"
    : mode === "username"
      ? "Forgot Username"
      : "Account Recovery";
  clearRecoveryState();
  if (hasMode && location.hash !== `#${mode}`) history.replaceState(null, "", `#${mode}`);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function restaurantList(restaurants) {
  return `
    <div class="recovery-list">
      <strong>Restaurants found</strong>
      <ul>
        ${(restaurants || []).map((restaurant) => `
          <li>${escapeHtml(restaurant.name)} <span>${escapeHtml(restaurant.restaurant_code)}</span></li>
        `).join("")}
      </ul>
    </div>
  `;
}

async function recoveryPost(url, body) {
  msg.textContent = "Checking...";
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function lookupPasswordRestaurants() {
  passwordLookupReady = false;
  sendPasswordButton.hidden = true;
  passwordRestaurants.innerHTML = "";
  try {
    const data = await recoveryPost("/owners/recovery/password/lookup", { username: recoveryUsername.value.trim() });
    passwordRestaurants.innerHTML = restaurantList(data.restaurants);
    passwordLookupReady = true;
    sendPasswordButton.hidden = false;
    msg.textContent = "Confirm and send a temporary password.";
  } catch (err) {
    msg.textContent = err.message;
  }
}

async function sendTemporaryPassword() {
  if (!passwordLookupReady) return lookupPasswordRestaurants();
  try {
    const data = await recoveryPost("/owners/recovery/password/send", { username: recoveryUsername.value.trim() });
    passwordRestaurants.innerHTML = restaurantList(data.restaurants);
    sendPasswordButton.hidden = true;
    msg.textContent = "Temporary password sent to the notification email.";
  } catch (err) {
    msg.textContent = err.message;
  }
}

async function lookupUsernameRestaurants() {
  usernameLookupReady = false;
  sendUsernameButton.hidden = true;
  usernameRestaurants.innerHTML = "";
  try {
    const data = await recoveryPost("/owners/recovery/username/lookup", { notificationEmail: notificationEmail.value.trim() });
    usernameRestaurants.innerHTML = restaurantList(data.restaurants);
    usernameLookupReady = true;
    sendUsernameButton.hidden = false;
    msg.textContent = "Confirm and send the username.";
  } catch (err) {
    msg.textContent = err.message;
  }
}

async function sendOwnerUsername() {
  if (!usernameLookupReady) return lookupUsernameRestaurants();
  try {
    const data = await recoveryPost("/owners/recovery/username/send", { notificationEmail: notificationEmail.value.trim() });
    usernameRestaurants.innerHTML = restaurantList(data.restaurants);
    sendUsernameButton.hidden = true;
    msg.textContent = "Username sent to the notification email.";
  } catch (err) {
    msg.textContent = err.message;
  }
}

window.addEventListener("hashchange", () => {
  setRecoveryMode(location.hash === "#username" ? "username" : location.hash === "#password" ? "password" : "");
});

setRecoveryMode(location.hash === "#username" ? "username" : location.hash === "#password" ? "password" : "");
