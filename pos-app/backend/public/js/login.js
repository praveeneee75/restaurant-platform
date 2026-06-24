async function login() {
  const username = document.getElementById("username").value.trim();
  const pin = document.getElementById("pin").value.trim();
  const msg = document.getElementById("msg");
  const requestUnlockButton = document.getElementById("requestUnlockButton");
  requestUnlockButton.hidden = true;

  const restaurantId = localStorage.getItem("restaurantId");

  if (!restaurantId) {
    msg.innerText = "POS not activated. Please activate first.";
    return;
  }

  if (!username || !pin) {
    msg.innerText = "Enter username and PIN";
    return;
  }

  try {
    const res = await fetch("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, username, pin })
    });

    const data = await res.json();

    if (!data.success) {
      msg.innerText = data.message;
      requestUnlockButton.hidden = !data.locked;
      return;
    }

    localStorage.setItem("user", JSON.stringify(data.user));

    if (data.forcePasswordChange) {
      window.location.href = "/change-pin.html";
      return;
    }

    const role = data.user.role;
    if (role === "KITCHEN") {
      window.location.href = "/kds.html";
    } else if (role === "OWNER" || role === "MANAGER_2") {
      window.location.href = "/admin.html";
    } else {
      window.location.href = "/pos-live.html";
    }
  } catch (err) {
    console.error(err);
    msg.innerText = "Server error";
  }
}

async function requestUnlock() {
  const username = document.getElementById("username").value.trim();
  const msg = document.getElementById("msg");
  const restaurantId = localStorage.getItem("restaurantId");

  if (!restaurantId || !username) {
    msg.innerText = "Enter username before requesting unlock";
    return;
  }

  try {
    const res = await fetch("/users/request-unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, username })
    });
    const data = await res.json();
    msg.innerText = data.message || (data.success ? "Unlock request sent" : "Unable to send unlock request");
  } catch (err) {
    console.error(err);
    msg.innerText = "Server error";
  }
}

document.getElementById("loginButton").addEventListener("click", login);
document.getElementById("requestUnlockButton").addEventListener("click", requestUnlock);
document.getElementById("pin").addEventListener("keydown", (event) => {
  if (event.key === "Enter") login();
});
