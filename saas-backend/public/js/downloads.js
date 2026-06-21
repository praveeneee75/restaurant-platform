function usableDownloadUrl(url) {
  if (!url) return false;
  try {
    const parsed = new URL(url, window.location.origin);
    const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    return !isLocalHost || parsed.origin === window.location.origin;
  } catch (_) {
    return false;
  }
}

async function loadLatestRelease() {
  try {
    const res = await fetch("/updates/latest");
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || "Unable to load release");
    const releaseFiles = (data.files || []).filter((file) => usableDownloadUrl(file.file_url));
    const files = releaseFiles.length
      ? releaseFiles
      : [{ file_name: "K'Master POS App Package", file_url: "/updates/download/pos-app.zip", checksum: "" }];
    downloadStatus.innerText = data.version ? `Latest POS version ${data.version}` : "POS app package is ready to download.";
    releasePanel.innerHTML = `
      <div class="cards">
        <div class="card">Version<strong>${data.version || "Current"}</strong></div>
        <div class="card">Update Type<strong>${data.mandatory_update ? "Mandatory" : "Optional"}</strong></div>
      </div>
      <p>${data.release_notes || "Download the POS package, install dependencies, then activate with the restaurant code and license key from the owner dashboard."}</p>
      <table>
        <thead><tr><th>File</th><th>Checksum</th><th>Download</th></tr></thead>
        <tbody>
          ${files.map((file) => `
            <tr>
              <td>${file.file_name}</td>
              <td><code>${file.checksum || ""}</code></td>
              <td><a href="${file.file_url}" target="_blank" rel="noopener">Download</a></td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;
  } catch (err) {
    downloadStatus.innerText = err.message;
  }
}

loadLatestRelease();
