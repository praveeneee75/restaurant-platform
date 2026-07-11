async function activate() {
  const restaurantId = document.getElementById("restaurantId").value.trim().toUpperCase();
  const licenseKey = document.getElementById("licenseKey").value.trim();
  const button = document.getElementById("activateButton");
  const msg = document.getElementById("msg");

  if (!restaurantId || !licenseKey) {
    msg.innerText = "Enter both the restaurant code and license key.";
    return;
  }

  button.disabled = true;
  button.innerText = "Validating...";
  msg.innerText = "Connecting securely to K'Master POS...";
  try {
    const res = await fetch("/activate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, licenseKey })
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || `Activation failed (${res.status})`);

    localStorage.clear();
    localStorage.setItem("restaurantId", restaurantId);
    msg.innerText = "Activation complete. Opening POS...";
    window.location.href = `/activation-complete.html?restaurantId=${encodeURIComponent(restaurantId)}`;
  } catch (error) {
    msg.innerText = error.message === "Failed to fetch"
      ? "Internet access is required for first activation."
      : error.message;
    button.disabled = false;
    button.innerText = "Activate POS";
  }
}

document.getElementById("activateButton").addEventListener("click", activate);
document.getElementById("licenseKey").addEventListener("keydown", (event) => {
  if (event.key === "Enter") activate();
});
