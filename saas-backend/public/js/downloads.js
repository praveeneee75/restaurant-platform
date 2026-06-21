async function loadLatestRelease() {
  try {
    const res = await fetch("/updates/latest");
    const data = await res.json();
    if (!res.ok || data.success === false) throw new Error(data.message || "Unable to load release");
    if (!data.updateAvailable && !data.version) {
      downloadStatus.innerText = "No active POS release is available yet.";
      releasePanel.innerHTML = "";
      return;
    }
    downloadStatus.innerText = `Latest POS version ${data.version}`;
    const files = data.files || [];
    releasePanel.innerHTML = `
      <div class="cards">
        <div class="card">Version<strong>${data.version}</strong></div>
        <div class="card">Update Type<strong>${data.mandatory_update ? "Mandatory" : "Optional"}</strong></div>
      </div>
      <p>${data.release_notes || ""}</p>
      <table>
        <thead><tr><th>File</th><th>Checksum</th><th>Download</th></tr></thead>
        <tbody>
          ${files.map((file) => `
            <tr>
              <td>${file.file_name}</td>
              <td><code>${file.checksum || ""}</code></td>
              <td><a href="${file.file_url}" target="_blank" rel="noopener">Download</a></td>
            </tr>
          `).join("") || `<tr><td colspan="3">No files attached.</td></tr>`}
        </tbody>
      </table>
    `;
  } catch (err) {
    downloadStatus.innerText = err.message;
  }
}

loadLatestRelease();
