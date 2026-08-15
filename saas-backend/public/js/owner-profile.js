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

const branchEsc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function branchField(code, key, label, value, type = 'text') {
  return `<label>${label}<input id="branch-${key}-${code}" type="${type}" value="${branchEsc(value)}"></label>`;
}

async function loadBranchProfiles() {
  try {
    const data = await ownerApi('/owners/branch-profiles');
    branchProfiles.innerHTML = data.branches.map((branch, index) => {
      const code = branch.restaurant_code;
      return `<details class="branch-profile-card" data-branch-code="${branchEsc(code)}" ${index === 0 ? 'open' : ''}>
        <summary><div><span class="eyebrow">${branchEsc(code)}</span><h3>${branchEsc(branch.name)}</h3></div><span class="sync-badge">Syncs on next POS authentication</span></summary>
        <div class="branch-profile-card-body">
        <div class="branch-profile-grid">
          ${branchField(code,'name','Display name',branch.name)}${branchField(code,'legalName','Legal name',branch.legal_name)}
          ${branchField(code,'gstin','GSTIN',branch.gstin || '')}${branchField(code,'fssaiLicenseNo','FSSAI licence / registration no.',branch.fssai_license_no || '')}
          ${branchField(code,'sacCode','Restaurant service SAC',branch.sac_code || '996331')}
          <label>State / union territory<select id="branch-state-${code}"></select></label>
          ${branchField(code,'stateCode','GST state code',branch.state_code || '')}
          ${branchField(code,'addressLine1','Address line 1',branch.address_line_1 || '')}${branchField(code,'addressLine2','Address line 2',branch.address_line_2 || '')}
          ${branchField(code,'city','City',branch.city || '')}${branchField(code,'country','Country',branch.country || 'India')}
          ${branchField(code,'phone','Branch phone',branch.phone || '')}${branchField(code,'email','Branch email',branch.email || '','email')}
          ${branchField(code,'currency','Currency',branch.currency || 'INR')}${branchField(code,'timezone','Timezone',branch.timezone || 'Asia/Kolkata')}
          ${branchField(code,'taxRate','GST rate (%)',branch.tax_rate ?? '5','number')}
          <label>Sales data storage<select id="branch-salesStorageMode-${code}"><option value="LOCAL_AND_ONLINE" ${branch.sales_storage_mode !== 'LOCAL_ONLY' ? 'selected' : ''}>Local + Online</option><option value="LOCAL_ONLY" ${branch.sales_storage_mode === 'LOCAL_ONLY' ? 'selected' : ''}>Local only</option></select></label>
        </div><button type="button" data-save-branch="${branchEsc(code)}">Save branch profile</button>
        </div>
      </details>`;
    }).join('') || '<p>No branches are assigned to this owner.</p>';
    data.branches.forEach((branch) => {
      const select = document.getElementById(`branch-state-${branch.restaurant_code}`);
      const codeInput = document.getElementById(`branch-stateCode-${branch.restaurant_code}`);
      window.KMasterIndiaStates?.populate(select, branch.state || '');
      if (select && codeInput) select.addEventListener('change', () => { codeInput.value = select.options[select.selectedIndex]?.dataset.stateCode || ''; });
      if (codeInput) codeInput.readOnly = true;
    });
  } catch (err) { branchProfiles.innerHTML = `<p>${branchEsc(err.message)}</p>`; }
}

branchProfiles.addEventListener('toggle', (event) => {
  const opened = event.target.closest('details.branch-profile-card');
  if (!opened?.open) return;
  branchProfiles.querySelectorAll('details.branch-profile-card[open]').forEach((details) => { if (details !== opened) details.open = false; });
}, true);

document.querySelectorAll('[data-profile-tab]').forEach((button) => button.addEventListener('click', () => {
  const selected = button.dataset.profileTab;
  document.querySelectorAll('[data-profile-tab]').forEach((tab) => tab.classList.toggle('active', tab === button));
  document.querySelectorAll('[data-profile-panel]').forEach((panel) => { panel.hidden = panel.dataset.profilePanel !== selected; });
}));

branchProfiles.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-save-branch]');
  if (!button) return;
  const code = button.dataset.saveBranch;
  const value = (key) => document.getElementById(`branch-${key}-${code}`)?.value.trim() || '';
  branchProfileMsg.innerText = 'Saving branch profile...'; button.disabled = true;
  try {
    const data = await ownerApi(`/owners/branch-profiles/${encodeURIComponent(code)}`, { method:'PUT', body:JSON.stringify({
      name:value('name'), legalName:value('legalName'), gstin:value('gstin'), fssaiLicenseNo:value('fssaiLicenseNo'), sacCode:value('sacCode'), taxRate:value('taxRate'), stateCode:value('stateCode'), addressLine1:value('addressLine1'), addressLine2:value('addressLine2'), city:value('city'), state:document.getElementById(`branch-state-${code}`)?.value || '', country:value('country'), phone:value('phone'), email:value('email'), currency:value('currency'), timezone:value('timezone'), salesStorageMode:document.getElementById(`branch-salesStorageMode-${code}`)?.value || 'LOCAL_AND_ONLINE'
    }) });
    branchProfileMsg.innerText = data.message;
  } catch (err) { branchProfileMsg.innerText = err.message; } finally { button.disabled = false; }
});

loadProfile();
loadBranchProfiles();
