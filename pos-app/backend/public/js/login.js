async function login() {

  const username = document.getElementById("username").value;
  const pin = document.getElementById("pin").value;

  const restaurantId = localStorage.getItem("restaurantId");

  if (!restaurantId) {
    document.getElementById("msg").innerText =
      "POS not activated. Please activate first.";
    return;
  }

  if (!username || !pin) {
    document.getElementById("msg").innerText =
      "Enter username and PIN";
    return;
  }

  try {

    const res = await fetch("/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        restaurantId,
        username,
        pin
      })
    });

    const data = await res.json();   // ✅ FIRST parse response

    if (!data.success) {
      document.getElementById("msg").innerText = data.message;
      return;
    }

    // Save logged-in user
    localStorage.setItem("user", JSON.stringify(data.user));

    // Force PIN change for default admin
    if (data.forcePasswordChange) {
      window.location.href = "/change-pin.html";
      return;
    }

    const role = data.user.role;

    // Redirect based on role
    if (role === "KITCHEN") {

      window.location.href = "/kds.html";

    } else if (role === "OWNER" || role === "MANAGER_2") {

      window.location.href = "/admin.html";

    } else {

      window.location.href = "/pos-live.html";

    }

  } catch (err) {

    console.error(err);
    document.getElementById("msg").innerText = "Server error";

  }

}
