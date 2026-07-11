async function loadAppVersion() {
  const target = document.getElementById("appVersion");
  if (!target) return;
  try {
    const response = await fetch("/version", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "Unknown version");
    target.textContent = `${data.app || "POS"} ${data.posVersion || ""}`.trim();
  } catch (_) {
    target.textContent = "POS";
  }
}

loadAppVersion();
