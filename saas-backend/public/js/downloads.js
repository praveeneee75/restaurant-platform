function fileSize(size) {
  const value = Number(size || 0);
  if (!value) return "";
  if (value > 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(Math.round(value / 1024), 1)} KB`;
}

async function loadLatestRelease() {
  try {
    const res = await fetch("/updates/installers");
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || "Unable to load installers");
    const availableCount = (data.platforms || []).filter((platform) => platform.available).length;
    downloadStatus.innerText = availableCount
      ? `Choose your installer${data.version ? ` for version ${data.version}` : ""}.`
      : "Installers are not published yet. Please contact K'Master support.";
    installerPanel.innerHTML = (data.platforms || []).map((platform) => `
      <article class="installer-card">
        <h4>${platform.label}</h4>
        <p>${platform.help}</p>
        ${platform.available
          ? `<a class="download-button" href="${platform.fileUrl}" download>${platform.fileName}${fileSize(platform.size) ? ` (${fileSize(platform.size)})` : ""}</a>`
          : `<button type="button" disabled>Coming soon</button>`}
      </article>
    `).join("");
    sourcePackageLink.href = data.sourcePackage?.fileUrl || "/updates/download/pos-app.zip";
  } catch (err) {
    downloadStatus.innerText = err.message;
  }
}

function goHome() {
  window.location.href = localStorage.getItem("ownerToken")
    ? "/owner-dashboard.html"
    : "/owner-login.html";
}

document.getElementById("downloadBackButton")?.addEventListener("click", () => {
  if (history.length > 1) history.back();
  else goHome();
});
document.getElementById("downloadHomeButton")?.addEventListener("click", (event) => {
  if (event.currentTarget?.tagName === "A") return;
  goHome();
});

loadLatestRelease();
