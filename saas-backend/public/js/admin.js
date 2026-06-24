const token = localStorage.getItem("adminToken");
const planBuilderState = { plans: [], modules: [], includedByPlan: {} };
const messagingProviders = [];

if (!token) {
  window.location.href = "/login.html";
}

function showSaasView(viewName = "overview") {
  const viewId = `view-${viewName}`;
  const target = document.getElementById(viewId) || document.getElementById("view-overview");
  if (!target) return;

  const activeView = target.id.replace("view-", "");
  document.querySelectorAll(".saas-view").forEach((section) => {
    section.classList.toggle("active", section === target);
  });
  document.querySelectorAll(".saas-nav-btn").forEach((button) => {
    button.classList.toggle("active", button.dataset.saasView === activeView);
  });

  if (window.saasViewTitle) window.saasViewTitle.innerText = target.dataset.title || "K'Master POS";
  if (window.saasViewHint) window.saasViewHint.innerText = target.dataset.hint || "";
  if (location.hash !== `#${activeView}`) history.replaceState(null, "", `#${activeView}`);
}

document.addEventListener("click", (event) => {
  const navButton = event.target.closest("[data-saas-view]");
  if (navButton) {
    showSaasView(navButton.dataset.saasView);
    return;
  }

  const viewLink = event.target.closest("[data-saas-view-link]");
  if (viewLink) {
    showSaasView(viewLink.dataset.saasViewLink);
  }
});

window.addEventListener("hashchange", () => {
  showSaasView((location.hash || "#overview").slice(1));
});

async function api(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {})
    }
  });
  const data = await res.json();
  if (!res.ok || data.success === false) throw new Error(data.message || "Request failed");
  return data;
}

async function loadTenants() {
  try {
    const data = await api("/tenants/list");
    const tbody = document.querySelector("#tenantTable tbody");
    const reportSelect = document.getElementById("reportRestaurant");
    const ownerRestaurant = document.getElementById("ownerRestaurantSelect");
    const subscriptionRestaurantSelect = document.getElementById("subscriptionRestaurant");
    const moduleRestaurantSelect = document.getElementById("moduleRestaurant");
    const messagingRestaurantSelect = document.getElementById("messagingRestaurant");
    const orgRestaurant = document.getElementById("orgRestaurantSelect");
    const supportRestaurantSelect = document.getElementById("supportRestaurant");
    tbody.innerHTML = "";
    if (reportSelect) reportSelect.innerHTML = "";
    if (ownerRestaurant) ownerRestaurant.innerHTML = "";
    if (subscriptionRestaurantSelect) subscriptionRestaurantSelect.innerHTML = "";
    if (moduleRestaurantSelect) moduleRestaurantSelect.innerHTML = "";
    if (messagingRestaurantSelect) messagingRestaurantSelect.innerHTML = "";
    if (orgRestaurant) orgRestaurant.innerHTML = "";
    if (supportRestaurantSelect) supportRestaurantSelect.innerHTML = "";
    data.tenants.forEach((tenant) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${tenant.name}</td>
        <td>${tenant.restaurant_code}</td>
        <td>${tenant.license_key}</td>
        <td><input type="date" value="${tenant.expires_at ? tenant.expires_at.split("T")[0] : ""}" id="exp-${tenant.restaurant_code}"></td>
        <td>
          <select id="status-${tenant.restaurant_code}">
            <option value="ACTIVE" ${tenant.status === "ACTIVE" ? "selected" : ""}>ACTIVE</option>
            <option value="INACTIVE" ${tenant.status === "INACTIVE" ? "selected" : ""}>INACTIVE</option>
          </select>
        </td>
        <td>${tenant.last_sync_at ? new Date(tenant.last_sync_at).toLocaleString() : "Not synced"}<br>${tenant.sync_status || ""}</td>
        <td>${money(tenant.today_revenue || 0)}</td>
        <td><button onclick="updateLicense('${tenant.restaurant_code}')">Save</button></td>
      `;
      tbody.appendChild(row);
      if (reportSelect) {
        const option = document.createElement("option");
        option.value = tenant.restaurant_code;
        option.textContent = `${tenant.name} (${tenant.restaurant_code})`;
        reportSelect.appendChild(option);
      }
      [ownerRestaurant, subscriptionRestaurantSelect, moduleRestaurantSelect, messagingRestaurantSelect, orgRestaurant, supportRestaurantSelect].forEach((select) => {
        if (!select) return;
        const option = document.createElement("option");
        option.value = tenant.restaurant_code;
        option.textContent = `${tenant.name} (${tenant.restaurant_code})`;
        select.appendChild(option);
      });
    });
    if (reportSelect && reportSelect.value) loadOwnerReports();
    if (moduleRestaurantSelect && moduleRestaurantSelect.value) loadTenantModules();
    if (messagingRestaurantSelect && messagingRestaurantSelect.value) loadMessagingAccount();
  } catch (err) {
    document.getElementById("createMsg").innerText = err.message;
  }
}

async function loadOrganizations() {
  try {
    const data = await api("/organizations/list");
    orgSelect.innerHTML = data.organizations.map((org) => `<option value="${org.id}">${org.name}</option>`).join("");
    document.querySelector("#orgTable tbody").innerHTML = data.organizations.map((org) => `<tr><td>${org.name}</td><td>${org.status}</td><td>${org.restaurant_count || 0}</td><td>${org.active_licenses || 0}</td></tr>`).join("");
    if (orgSelect.value) await Promise.all([loadBranchGroups(), loadOrganizationRestaurants(), loadOrganizationReport()]);
  } catch (err) {
    orgMsg.innerText = err.message;
  }
}

async function createOrganization() {
  try {
    await api("/organizations/create", { method: "POST", body: JSON.stringify({ name: orgName.value.trim(), email: orgEmail.value.trim() }) });
    orgMsg.innerText = "Organization created";
    orgName.value = "";
    orgEmail.value = "";
    loadOrganizations();
  } catch (err) {
    orgMsg.innerText = err.message;
  }
}

async function loadBranchGroups() {
  if (!orgSelect.value) return;
  const data = await api(`/organizations/branch-groups?organizationId=${orgSelect.value}`);
  orgBranchGroupSelect.innerHTML = `<option value="">No group</option>` + data.groups.map((group) => `<option value="${group.id}">${group.name}</option>`).join("");
}

async function saveBranchGroup() {
  try {
    await api("/organizations/branch-groups/save", { method: "POST", body: JSON.stringify({ organizationId: orgSelect.value, name: branchGroupName.value.trim() }) });
    branchGroupName.value = "";
    orgMsg.innerText = "Branch group saved";
    loadBranchGroups();
  } catch (err) {
    orgMsg.innerText = err.message;
  }
}

async function assignOrganizationRestaurant() {
  try {
    await api("/organizations/restaurants/assign", { method: "POST", body: JSON.stringify({ organizationId: orgSelect.value, restaurantCode: orgRestaurantSelect.value, branchGroupId: orgBranchGroupSelect.value || null, branchName: orgBranchName.value.trim() }) });
    orgMsg.innerText = "Restaurant assigned";
    await Promise.all([loadOrganizationRestaurants(), loadOrganizationReport()]);
  } catch (err) {
    orgMsg.innerText = err.message;
  }
}

async function loadOrganizationRestaurants() {
  if (!orgSelect.value) return;
  const data = await api(`/organizations/restaurants?organizationId=${orgSelect.value}`);
  document.querySelector("#orgBranchesTable tbody").innerHTML = data.restaurants.map((row) => `<tr><td>${row.name} (${row.restaurant_code})</td><td>${row.branch_group || ""}</td><td>${row.license_status}</td><td>${row.online_status}</td></tr>`).join("");
}

async function loadOrganizationReport() {
  if (!orgSelect.value) return;
  const data = await api(`/organizations/reports/consolidated?organizationId=${orgSelect.value}&fromDate=${monthStartIso()}&toDate=${todayIso()}`);
  orgNetSales.innerText = money(data.summary.net_sales);
  orgOrders.innerText = data.summary.orders_count || 0;
}

async function loadSupportDiagnostics() {
  try {
    const data = await api(`/monitoring/diagnostics?restaurantId=${supportRestaurant.value}`);
    supportDiagnostics.textContent = JSON.stringify(data, null, 2);
    supportMsg.innerText = "Diagnostics loaded";
  } catch (err) {
    supportMsg.innerText = err.message;
  }
}

async function saveSupportNote() {
  try {
    await api("/monitoring/support-notes", { method: "POST", body: JSON.stringify({ restaurantId: supportRestaurant.value, note: supportNote.value.trim() }) });
    supportNote.value = "";
    supportMsg.innerText = "Support note saved";
    loadSupportDiagnostics();
  } catch (err) {
    supportMsg.innerText = err.message;
  }
}

async function loadOwners() {
  try {
    const data = await api("/owners/list");
    ownerSelect.innerHTML = data.owners.map((owner) => `<option value="${owner.id}">${owner.name} (${owner.email})</option>`).join("");
    document.querySelector("#ownerTable tbody").innerHTML = data.owners.map((owner) => `
      <tr><td>${owner.name}</td><td>${owner.email}</td><td>${owner.active ? "Active" : "Disabled"}</td><td>${owner.reset_required ? "Yes" : "No"}</td></tr>
    `).join("");
  } catch (err) {
    ownerMsg.innerText = err.message;
  }
}

async function createOwner() {
  try {
    await api("/owners/create", {
      method: "POST",
      body: JSON.stringify({ name: ownerName.value.trim(), email: ownerEmail.value.trim(), password: ownerPassword.value })
    });
    ownerMsg.innerText = "Owner created";
    ownerName.value = "";
    ownerEmail.value = "";
    ownerPassword.value = "";
    loadOwners();
  } catch (err) {
    ownerMsg.innerText = err.message;
  }
}

async function assignOwner() {
  try {
    const data = await api("/owners/assign", { method: "POST", body: JSON.stringify({ ownerId: ownerSelect.value, restaurantCode: ownerRestaurantSelect.value }) });
    ownerMsg.innerText = data.message;
  } catch (err) {
    ownerMsg.innerText = err.message;
  }
}

async function removeOwner() {
  try {
    const data = await api("/owners/remove", { method: "POST", body: JSON.stringify({ ownerId: ownerSelect.value, restaurantCode: ownerRestaurantSelect.value }) });
    ownerMsg.innerText = data.message;
  } catch (err) {
    ownerMsg.innerText = err.message;
  }
}

async function resetOwnerPassword() {
  try {
    const data = await api("/owners/reset-password", { method: "POST", body: JSON.stringify({ ownerId: ownerSelect.value, password: ownerResetPassword.value }) });
    ownerMsg.innerText = data.message;
    ownerResetPassword.value = "";
    loadOwners();
  } catch (err) {
    ownerMsg.innerText = err.message;
  }
}

async function loadSubscriptions() {
  try {
    const [plans, summary] = await Promise.all([api("/subscriptions/plans"), api("/subscriptions/summary")]);
    const planOptions = plans.plans.map((plan) => {
      const modules = (plan.included_modules || []).join(", ");
      return `<option value="${plan.code}" data-days="${plan.duration_days}" data-modules="${modules}">${plan.code} (${plan.duration_days} days)</option>`;
    }).join("");
    subscriptionPlan.innerHTML = planOptions;
    if (window.createPlan) {
      createPlan.innerHTML = planOptions;
      if ([...createPlan.options].some((option) => option.value === "PREMIUM")) createPlan.value = "PREMIUM";
      updateCreateReview();
    }
    syncPartnerPlanOptions();
    document.querySelector("#subscriptionTable tbody").innerHTML = summary.subscriptions.map((row) => `
      <tr>
        <td>${row.name} (${row.restaurant_code})</td>
        <td>${row.plan_code || "None"}</td>
        <td>${row.status || "Not assigned"}</td>
        <td>${row.expires_at ? row.expires_at.split("T")[0] : ""}</td>
        <td>${row.days_remaining ?? ""}</td>
        <td>${row.expiry_warning ? "Yes" : "No"}</td>
        <td>${money(row.paid_amount || 0)}</td>
        <td>${money(row.monthly_module_charges || 0)}</td>
      </tr>
    `).join("");
  } catch (err) {
    subscriptionMsg.innerText = err.message;
  }
}

async function loadModules() {
  try {
    const data = await api("/modules/list");
    tenantModuleSelect.innerHTML = data.modules.map((module) => `<option value="${module.code}">${module.name}</option>`).join("");
    document.querySelector("#moduleTable tbody").innerHTML = data.modules.map((module) => `
      <tr>
        <td>${module.code}</td>
        <td>${module.name}</td>
        <td>${module.category || ""}</td>
        <td>${module.status}</td>
        <td>${(module.pricing || []).map((price) => `${price.billing_cycle} ${money(price.price)} ${price.currency}`).join(", ")}</td>
      </tr>
    `).join("");
    loadTenantModules();
  } catch (err) {
    moduleMsg.innerText = err.message;
  }
}

async function createModule() {
  try {
    await api("/modules/create", {
      method: "POST",
      body: JSON.stringify({
        code: moduleCode.value.trim(),
        name: moduleName.value.trim(),
        description: moduleDescription.value.trim(),
        category: moduleCategory.value.trim(),
        status: moduleStatus.value,
        pricing: [{ billingCycle: "MONTHLY", price: moduleMonthlyPrice.value || 0, currency: moduleCurrency.value || "INR" }]
      })
    });
    moduleMsg.innerText = "Module saved";
    moduleCode.value = "";
    moduleName.value = "";
    moduleCategory.value = "";
    moduleDescription.value = "";
    moduleMonthlyPrice.value = "";
    loadModules();
  } catch (err) {
    moduleMsg.innerText = err.message;
  }
}

async function loadTenantModules() {
  const restaurantId = moduleRestaurant.value;
  if (!restaurantId) return;
  try {
    const data = await api(`/tenants/modules?restaurantId=${encodeURIComponent(restaurantId)}`);
    moduleMonthlyTotal.innerText = money(data.monthlyModuleCharges);
    moduleEnabledList.innerText = (data.enabledModules || []).join(", ") || "None";
    document.querySelector("#tenantModuleTable tbody").innerHTML = data.modules.map((module) => `
      <tr>
        <td>${module.name} (${module.code})</td>
        <td>${module.enabled ? "Enabled" : "Disabled"}</td>
        <td>${module.trial_ends_at ? new Date(module.trial_ends_at).toLocaleDateString() : ""}</td>
        <td>${money(module.monthly_price)} ${module.currency}</td>
      </tr>
    `).join("");
  } catch (err) {
    moduleMsg.innerText = err.message;
  }
}

async function enableTenantModule() {
  try {
    await api("/tenants/modules/enable", {
      method: "POST",
      body: JSON.stringify({ restaurantId: moduleRestaurant.value, moduleCode: tenantModuleSelect.value, trialDays: tenantModuleTrialDays.value || 0 })
    });
    moduleMsg.innerText = "Module enabled";
    loadTenantModules();
  } catch (err) {
    moduleMsg.innerText = err.message;
  }
}

async function disableTenantModule() {
  try {
    await api("/tenants/modules/disable", {
      method: "POST",
      body: JSON.stringify({ restaurantId: moduleRestaurant.value, moduleCode: tenantModuleSelect.value })
    });
    moduleMsg.innerText = "Module disabled";
    loadTenantModules();
  } catch (err) {
    moduleMsg.innerText = err.message;
  }
}

function renderPlanFeatureGrid() {
  if (!window.planFeatureGrid || !window.planBuilderSelect) return;
  const planCode = planBuilderSelect.value;
  const included = new Set(planBuilderState.includedByPlan[planCode] || []);
  planFeatureGrid.innerHTML = planBuilderState.modules.map((module) => `
    <label class="feature-check">
      <input type="checkbox" value="${module.code}" ${included.has(module.code) ? "checked" : ""}>
      <span><strong>${module.name}</strong><small>${module.code} · ${module.category || "GENERAL"}</small></span>
    </label>
  `).join("");
}

async function loadPlanBuilder() {
  if (!window.planBuilderSelect || !window.planFeatureGrid) return;
  try {
    const data = await api("/subscriptions/plan-modules");
    planBuilderState.plans = data.plans || [];
    planBuilderState.modules = data.modules || [];
    planBuilderState.includedByPlan = data.includedByPlan || {};
    const previous = planBuilderSelect.value;
    planBuilderSelect.innerHTML = planBuilderState.plans.map((plan) => `<option value="${plan.code}">${plan.code} - ${plan.name}</option>`).join("");
    if (previous && [...planBuilderSelect.options].some((option) => option.value === previous)) planBuilderSelect.value = previous;
    if (!planBuilderSelect.value && [...planBuilderSelect.options].some((option) => option.value === "PREMIUM")) planBuilderSelect.value = "PREMIUM";
    renderPlanFeatureGrid();
  } catch (err) {
    planBuilderMsg.innerText = err.message;
  }
}

async function savePlanFeatures() {
  try {
    const selected = [...planFeatureGrid.querySelectorAll("input[type='checkbox']:checked")].map((input) => input.value);
    const data = await api("/subscriptions/plan-modules", {
      method: "POST",
      body: JSON.stringify({
        planCode: planBuilderSelect.value,
        moduleCodes: selected,
        applyToExisting: planApplyExisting.checked
      })
    });
    planBuilderMsg.innerText = data.message;
    planApplyExisting.checked = false;
    await loadPlanBuilder();
    await loadSubscriptions();
    await loadModules();
    if (window.messagingRestaurant?.value) await loadMessagingAccount();
  } catch (err) {
    planBuilderMsg.innerText = err.message;
  }
}

function renderMessagingProviders() {
  if (!window.messagingProvider) return;
  messagingProvider.innerHTML = messagingProviders.map((provider) => `<option value="${provider.code}">${provider.name}</option>`).join("");
  renderMessagingProviderHelp();
}

function renderMessagingProviderHelp() {
  if (!window.messagingProviderHelp || !window.messagingProvider) return;
  const selected = messagingProviders.find((provider) => provider.code === messagingProvider.value);
  messagingProviderHelp.innerHTML = selected
    ? `<p><strong>${selected.name}</strong></p><p>${selected.bestFor}</p><p>For India, keep DLT entity ID, approved templates and sender/header records with the provider account.</p>`
    : "<p>Choose a provider to see setup guidance.</p>";
}

async function loadMessagingProviders() {
  if (!window.messagingProvider) return;
  try {
    const data = await api("/messaging/providers");
    messagingProviders.splice(0, messagingProviders.length, ...(data.providers || []));
    renderMessagingProviders();
  } catch (err) {
    if (window.messagingMsg) messagingMsg.innerText = err.message;
  }
}

function renderMessagingCampaigns(campaigns = []) {
  const tbody = document.querySelector("#messagingCampaignTable tbody");
  if (!tbody) return;
  tbody.innerHTML = campaigns.map((campaign) => `
    <tr>
      <td>${campaign.campaign_name}</td>
      <td>${campaign.channel}</td>
      <td>${campaign.audience}</td>
      <td>${campaign.status}</td>
      <td>${campaign.recipients_estimate ?? 0}</td>
      <td>${campaign.created_at ? new Date(campaign.created_at).toLocaleString() : ""}</td>
    </tr>
  `).join("");
}

async function loadMessagingAccount() {
  if (!window.messagingRestaurant || !messagingRestaurant.value) return;
  try {
    const data = await api(`/messaging/account?restaurantId=${encodeURIComponent(messagingRestaurant.value)}`);
    const account = data.account || {};
    messagingProvider.value = account.provider || messagingProvider.value || "SMPP";
    messagingAccountName.value = account.provider_account_name || "";
    messagingSenderId.value = account.sender_id || "";
    messagingStatus.value = account.status || "DRAFT";
    messagingSmsEnabled.checked = account.sms_enabled !== false;
    messagingWhatsappEnabled.checked = account.whatsapp_enabled === true;
    messagingEmailEnabled.checked = account.email_enabled === true;
    messagingSmppHost.value = account.smpp_host || "";
    messagingSmppPort.value = account.smpp_port || "";
    messagingSmppSystemId.value = account.smpp_system_id || "";
    messagingSmppPassword.value = "";
    messagingApiBaseUrl.value = account.api_base_url || "";
    messagingApiKey.value = "";
    messagingWhatsappBusinessId.value = account.whatsapp_business_id || "";
    messagingEmailFrom.value = account.email_from_address || "";
    messagingNotes.value = account.notes || "";
    renderMessagingProviderHelp();
    renderMessagingCampaigns(data.campaigns || []);
    messagingMsg.innerText = data.enabled ? "Messaging module is enabled for this restaurant." : "Messaging module is not enabled. Add it in Plan Builder or tenant modules.";
  } catch (err) {
    messagingMsg.innerText = err.message;
  }
}

async function saveMessagingAccount() {
  try {
    const data = await api("/messaging/account", {
      method: "POST",
      body: JSON.stringify({
        restaurantId: messagingRestaurant.value,
        provider: messagingProvider.value,
        providerAccountName: messagingAccountName.value,
        senderId: messagingSenderId.value,
        status: messagingStatus.value,
        smsEnabled: messagingSmsEnabled.checked,
        whatsappEnabled: messagingWhatsappEnabled.checked,
        emailEnabled: messagingEmailEnabled.checked,
        smppHost: messagingSmppHost.value,
        smppPort: messagingSmppPort.value,
        smppSystemId: messagingSmppSystemId.value,
        smppPassword: messagingSmppPassword.value,
        apiBaseUrl: messagingApiBaseUrl.value,
        apiKey: messagingApiKey.value,
        whatsappBusinessId: messagingWhatsappBusinessId.value,
        emailFromAddress: messagingEmailFrom.value,
        notes: messagingNotes.value
      })
    });
    messagingMsg.innerText = data.message;
    messagingSmppPassword.value = "";
    messagingApiKey.value = "";
    await loadMessagingAccount();
  } catch (err) {
    messagingMsg.innerText = err.message;
  }
}

async function createMessagingCampaign() {
  try {
    const data = await api("/messaging/campaigns", {
      method: "POST",
      body: JSON.stringify({
        restaurantId: messagingRestaurant.value,
        channel: campaignChannel.value,
        audience: campaignAudience.value,
        campaignName: campaignName.value,
        messageBody: campaignMessage.value,
        scheduledAt: campaignSchedule.value || null
      })
    });
    messagingMsg.innerText = data.message;
    campaignName.value = "";
    campaignMessage.value = "";
    campaignSchedule.value = "";
    await loadMessagingAccount();
  } catch (err) {
    messagingMsg.innerText = err.message;
  }
}

async function assignSubscription() {
  try {
    await api("/subscriptions/assign", {
      method: "POST",
      body: JSON.stringify({
        restaurantCode: subscriptionRestaurant.value,
        planCode: subscriptionPlan.value,
        startsAt: subscriptionStart.value,
        paymentAmount: subscriptionAmount.value || 0,
        paymentMode: subscriptionMode.value,
        referenceNo: subscriptionRef.value
      })
    });
    subscriptionMsg.innerText = "Subscription assigned";
    loadSubscriptions();
    loadTenants();
  } catch (err) {
    subscriptionMsg.innerText = err.message;
  }
}

async function suspendSubscription() {
  try {
    const data = await api("/subscriptions/suspend", { method: "POST", body: JSON.stringify({ restaurantCode: subscriptionRestaurant.value }) });
    subscriptionMsg.innerText = data.message;
    loadSubscriptions();
  } catch (err) {
    subscriptionMsg.innerText = err.message;
  }
}

async function reactivateSubscription() {
  try {
    const data = await api("/subscriptions/reactivate", { method: "POST", body: JSON.stringify({ restaurantCode: subscriptionRestaurant.value }) });
    subscriptionMsg.innerText = data.message;
    loadSubscriptions();
  } catch (err) {
    subscriptionMsg.innerText = err.message;
  }
}

async function loadMonitoring() {
  try {
    const data = await api("/monitoring/status");
    document.querySelector("#monitoringTable tbody").innerHTML = data.restaurants.map((row) => `
      <tr>
        <td>${row.name} (${row.restaurant_code})</td>
        <td>${row.online_status}</td>
        <td>${row.pos_version || ""}</td>
        <td>${row.backup_status || ""}</td>
        <td>${row.printer_status || ""}</td>
        <td>${row.license_status || ""}</td>
        <td>${row.last_heartbeat_at ? new Date(row.last_heartbeat_at).toLocaleString() : "Never"}</td>
      </tr>
    `).join("");
  } catch (err) {
    alert(err.message);
  }
}

async function loadPartners() {
  try {
    const data = await api("/partners/list");
    partnerSelect.innerHTML = data.partners.map((partner) => `<option value="${partner.id}">${partner.name}</option>`).join("");
    document.querySelector("#partnerTable tbody").innerHTML = data.partners.map((partner) => `
      <tr>
        <td>${partner.name}</td>
        <td>${partner.business_name || ""}</td>
        <td>${partner.status}</td>
        <td>${money(partner.commission_percent || 0)}</td>
        <td>${partner.restaurant_count || 0}</td>
        <td>${partner.active_licenses || 0}</td>
      </tr>
    `).join("");
    syncPartnerPlanOptions();
    if (partnerSelect.value) {
      await Promise.all([loadPartnerUsers(), loadPartnerBranding(), loadPartnerRestaurants(), loadPartnerDashboard(), loadPartnerCommissions()]);
    }
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

function selectedPartnerId() {
  return partnerSelect.value;
}

function syncPartnerPlanOptions() {
  if (!window.partnerRestaurantPlan || !window.subscriptionPlan) return;
  partnerRestaurantPlan.innerHTML = subscriptionPlan.innerHTML;
}

async function createPartner() {
  try {
    await api("/partners/create", {
      method: "POST",
      body: JSON.stringify({
        name: partnerName.value.trim(),
        businessName: partnerBusinessName.value.trim(),
        email: partnerEmail.value.trim(),
        phone: partnerPhone.value.trim(),
        commissionPercent: partnerCommission.value || 0
      })
    });
    partnerMsg.innerText = "Partner created";
    partnerName.value = "";
    partnerBusinessName.value = "";
    partnerEmail.value = "";
    partnerPhone.value = "";
    partnerCommission.value = "";
    loadPartners();
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function updatePartner() {
  try {
    await api("/partners/update", {
      method: "POST",
      body: JSON.stringify({ partnerId: selectedPartnerId(), status: partnerStatus.value })
    });
    partnerMsg.innerText = "Partner updated";
    loadPartners();
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function createPartnerUser() {
  try {
    await api("/partners/users/create", {
      method: "POST",
      body: JSON.stringify({
        partnerId: selectedPartnerId(),
        name: partnerUserName.value.trim(),
        email: partnerUserEmail.value.trim(),
        password: partnerUserPassword.value,
        role: partnerUserRole.value
      })
    });
    partnerMsg.innerText = "Partner user created";
    partnerUserName.value = "";
    partnerUserEmail.value = "";
    partnerUserPassword.value = "";
    loadPartnerUsers();
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function loadPartnerUsers() {
  const partnerId = selectedPartnerId();
  if (!partnerId) return;
  try {
    const data = await api(`/partners/users?partnerId=${encodeURIComponent(partnerId)}`);
    document.querySelector("#partnerUserTable tbody").innerHTML = data.users.map((user) => `
      <tr>
        <td>${user.name}</td>
        <td>${user.email}</td>
        <td>${user.role}</td>
        <td>${user.active ? "Active" : "Disabled"}</td>
      </tr>
    `).join("");
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function loadPartnerBranding() {
  const partnerId = selectedPartnerId();
  if (!partnerId) return;
  try {
    const data = await api(`/partners/branding?partnerId=${encodeURIComponent(partnerId)}`);
    const branding = data.branding || {};
    brandName.value = branding.brand_name || "";
    brandLogo.value = branding.logo_url || "";
    brandPrimary.value = branding.primary_color || "";
    brandSecondary.value = branding.secondary_color || "";
    brandSupportEmail.value = branding.support_email || "";
    brandSupportPhone.value = branding.support_phone || "";
    brandDomain.value = branding.custom_domain || "";
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function savePartnerBranding() {
  try {
    await api("/partners/branding", {
      method: "POST",
      body: JSON.stringify({
        partnerId: selectedPartnerId(),
        brandName: brandName.value.trim(),
        logoUrl: brandLogo.value.trim(),
        primaryColor: brandPrimary.value.trim(),
        secondaryColor: brandSecondary.value.trim(),
        supportEmail: brandSupportEmail.value.trim(),
        supportPhone: brandSupportPhone.value.trim(),
        customDomain: brandDomain.value.trim()
      })
    });
    partnerMsg.innerText = "Branding saved";
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function createPartnerRestaurant() {
  try {
    const data = await api("/partners/restaurants/create", {
      method: "POST",
      body: JSON.stringify({
        partnerId: selectedPartnerId(),
        name: partnerRestaurantName.value.trim(),
        expiryDate: partnerRestaurantExpiry.value,
        planCode: partnerRestaurantPlan.value,
        paymentAmount: partnerRestaurantPayment.value || 0
      })
    });
    partnerMsg.innerText = `Restaurant created: ${data.restaurantCode}`;
    partnerRestaurantName.value = "";
    partnerRestaurantPayment.value = "";
    await Promise.all([loadPartnerRestaurants(), loadPartnerDashboard(), loadPartnerCommissions(), loadTenants()]);
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function loadPartnerRestaurants() {
  const partnerId = selectedPartnerId();
  if (!partnerId) return;
  try {
    const data = await api(`/partners/restaurants?partnerId=${encodeURIComponent(partnerId)}`);
    document.querySelector("#partnerRestaurantTable tbody").innerHTML = data.restaurants.map((row) => `
      <tr>
        <td>${row.name} (${row.restaurant_code})</td>
        <td>${row.license_status}</td>
        <td>${row.online_status}</td>
        <td>${row.pos_version || ""}</td>
        <td>${row.backup_status || ""}</td>
        <td>${row.printer_status || ""}</td>
        <td>${row.last_sync_at ? new Date(row.last_sync_at).toLocaleString() : "Not synced"}</td>
      </tr>
    `).join("");
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function loadPartnerDashboard() {
  const partnerId = selectedPartnerId();
  if (!partnerId) return;
  try {
    const data = await api(`/partners/dashboard?partnerId=${encodeURIComponent(partnerId)}`);
    const summary = data.summary || {};
    partnerTotalRestaurants.innerText = summary.total_restaurants || 0;
    partnerActiveLicenses.innerText = summary.active_licenses || 0;
    partnerExpiredLicenses.innerText = summary.expired_licenses || 0;
    partnerMrr.innerText = money(summary.monthly_recurring_revenue || 0);
    partnerOnline.innerText = summary.online_restaurants || 0;
    partnerOffline.innerText = summary.offline_restaurants || 0;
    partnerMsg.innerText = (data.supportAlerts || []).length ? `${data.supportAlerts.length} support alert(s)` : "Partner dashboard loaded";
  } catch (err) {
    partnerMsg.innerText = err.message;
  }
}

async function loadPartnerCommissions() {
  const partnerId = selectedPartnerId();
  if (!partnerId) return;
  try {
    const data = await api(`/partners/commissions?partnerId=${encodeURIComponent(partnerId)}`);
    partnerRevenue.innerText = money(data.totals.revenue);
    partnerCommissionTotal.innerText = money(data.totals.commission);
    partnerCommissionPending.innerText = money(data.totals.pending);
    partnerCommissionPaid.innerText = money(data.totals.paid);
    document.querySelector("#partnerCommissionTable tbody").innerHTML = data.commissions.map((row) => `
      <tr>
        <td>${row.payout_status === "PAID" ? "" : `<input type="checkbox" class="partner-commission-check" value="${row.id}">`}</td>
        <td>${row.restaurant_name || ""} (${row.restaurant_code || ""})</td>
        <td>${money(row.revenue_amount)}</td>
        <td>${money(row.commission_percent)}</td>
        <td>${money(row.commission_amount)}</td>
        <td>${row.payout_status}</td>
        <td>${row.created_at ? new Date(row.created_at).toLocaleString() : ""}</td>
      </tr>
    `).join("");
  } catch (err) {
    partnerCommissionMsg.innerText = err.message;
  }
}

async function markPartnerPayoutPaid() {
  const commissionIds = [...document.querySelectorAll(".partner-commission-check:checked")].map((box) => box.value);
  if (commissionIds.length === 0) {
    partnerCommissionMsg.innerText = "Select commissions to mark paid";
    return;
  }
  try {
    const data = await api("/partners/payouts/mark-paid", {
      method: "POST",
      body: JSON.stringify({ partnerId: selectedPartnerId(), commissionIds, referenceNo: partnerPayoutRef.value.trim() })
    });
    partnerCommissionMsg.innerText = `Payout marked paid: ${money(data.payout.amount)}`;
    partnerPayoutRef.value = "";
    loadPartnerCommissions();
  } catch (err) {
    partnerCommissionMsg.innerText = err.message;
  }
}

function money(value) {
  return Number(value || 0).toFixed(2);
}

function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function monthStartIso() {
  const date = new Date();
  date.setDate(1);
  return date.toISOString().slice(0, 10);
}

function reportDateRange() {
  const fromDate = reportFromDate.value || monthStartIso();
  const toDate = reportToDate.value || todayIso();
  return { fromDate, toDate };
}

async function reportSummary(restaurantId, fromDate, toDate) {
  return api(`/owner/reports/summary?restaurantId=${encodeURIComponent(restaurantId)}&fromDate=${fromDate}&toDate=${toDate}`);
}

async function loadOwnerReports() {
  const restaurantId = reportRestaurant.value;
  if (!restaurantId) return;
  const { fromDate, toDate } = reportDateRange();
  reportMsg.innerText = "";
  try {
    const [range, today, yesterday, items, sync] = await Promise.all([
      reportSummary(restaurantId, fromDate, toDate),
      reportSummary(restaurantId, todayIso(), todayIso()),
      reportSummary(restaurantId, todayIso(-1), todayIso(-1)),
      api(`/owner/reports/items?restaurantId=${encodeURIComponent(restaurantId)}&fromDate=${fromDate}&toDate=${toDate}`),
      api(`/owner/reports/sync-status?restaurantId=${encodeURIComponent(restaurantId)}`)
    ]);
    todaySales.innerText = money(today.totals.netSales);
    yesterdaySales.innerText = money(yesterday.totals.netSales);
    mtdSales.innerText = money(range.totals.netSales);
    reportOrders.innerText = range.totals.ordersCount;
    paymentSummary.innerText = `Cash ${money(range.totals.cashTotal)} | Card ${money(range.totals.cardTotal)} | UPI ${money(range.totals.upiTotal)}`;
    syncStatus.innerText = sync.status ? `${sync.status.status} ${new Date(sync.status.created_at).toLocaleString()}` : "Not synced";
    const tbody = document.querySelector("#topItemsTable tbody");
    tbody.innerHTML = "";
    items.items.forEach((item) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${item.item_name}</td>
        <td>${Number(item.quantity_sold || 0)}</td>
        <td>${money(item.total_sales)}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    reportMsg.innerText = err.message;
  }
}

async function requestCloudSync() {
  const restaurantId = reportRestaurant.value;
  if (!restaurantId) return;
  try {
    const data = await api("/owner/reports/request-sync", {
      method: "POST",
      body: JSON.stringify({ restaurantId })
    });
    reportMsg.innerText = data.message;
    loadOwnerReports();
  } catch (err) {
    reportMsg.innerText = err.message;
  }
}

async function updateLicense(code) {
  try {
    const data = await api("/tenants/update-license", {
      method: "POST",
      body: JSON.stringify({
        restaurantCode: code,
        expiresAt: document.getElementById(`exp-${code}`).value,
        status: document.getElementById(`status-${code}`).value
      })
    });
    alert(data.message);
  } catch (err) {
    alert(err.message);
  }
}

function showCreateStep(step) {
  [1, 2, 3].forEach((index) => {
    document.getElementById(`createStep${index}`)?.classList.toggle("active", index === step);
    document.getElementById(`createStep${index}Tab`)?.classList.toggle("active", index === step);
  });
  updateCreateReview();
}

function updateCreateReview() {
  if (!window.createReview) return;
  const plan = createPlan?.selectedOptions?.[0];
  createReview.innerHTML = `
    <strong>${restaurantName.value.trim() || "New restaurant"}</strong>
    <span>${restaurantCountry.value.trim() || "India"} / ${restaurantCurrency.value || "INR"}</span>
    <span>Package: ${createPlan.value || "Select package"}${plan?.dataset.modules ? ` with ${plan.dataset.modules}` : ""}</span>
    <span>Expiry: ${expiryDate.value || "Calculated from package duration"}</span>
  `;
}

async function createRestaurant() {
  try {
    if (!restaurantName.value.trim()) {
      showCreateStep(1);
      createMsg.innerText = "Restaurant name is required.";
      return;
    }
    const data = await api("/tenants/create", {
      method: "POST",
      body: JSON.stringify({
        name: restaurantName.value.trim(),
        country: restaurantCountry.value.trim(),
        currency: restaurantCurrency.value,
        mobilePosUrl: restaurantMobilePosUrl.value.trim(),
        expiryDate: expiryDate.value,
        planCode: createPlan.value,
        startsAt: createStartDate.value,
        paymentAmount: createPaymentAmount.value,
        paymentMode: createPaymentMode.value,
        referenceNo: createPaymentRef.value.trim()
      })
    });
    document.getElementById("createMsg").innerText = `Customer Created

Restaurant ID: ${data.restaurantCode}
License Key: ${data.licenseKey}`;
    restaurantName.value = "";
    restaurantContact.value = "";
    restaurantMobilePosUrl.value = "";
    createPaymentAmount.value = "";
    createPaymentRef.value = "";
    showCreateStep(1);
    loadTenants();
    loadSubscriptions();
  } catch (err) {
    document.getElementById("createMsg").innerText = err.message;
  }
}

async function loadReleases() {
  try {
    const data = await api("/updates/list");
    const tbody = document.querySelector("#releaseTable tbody");
    tbody.innerHTML = "";
    data.releases.forEach((release) => {
      const row = document.createElement("tr");
      row.innerHTML = `
        <td>${release.version}</td>
        <td>${release.status}</td>
        <td>${release.mandatory_update ? "Yes" : "No"}</td>
        <td>${(release.files || []).map((file) => file.file_name).join(", ")}</td>
        <td>${release.release_notes || ""}</td>
        <td>${release.status === "ACTIVE" ? "Active" : `<button onclick="activateRelease('${release.id}')">Activate</button>`}</td>
      `;
      tbody.appendChild(row);
    });
  } catch (err) {
    document.getElementById("releaseMsg").innerText = err.message;
  }
}

async function createRelease() {
  try {
    await api("/updates/create", {
      method: "POST",
      body: JSON.stringify({
        version: releaseVersion.value.trim(),
        releaseNotes: releaseNotes.value.trim(),
        mandatoryUpdate: releaseMandatory.checked,
        files: [{
          file_name: releaseFileName.value.trim(),
          file_url: releaseFileUrl.value.trim(),
          checksum: releaseChecksum.value.trim()
        }]
      })
    });
    releaseMsg.innerText = "Release created";
    releaseVersion.value = "";
    releaseNotes.value = "";
    releaseMandatory.checked = false;
    releaseFileName.value = "";
    releaseFileUrl.value = "";
    releaseChecksum.value = "";
    loadReleases();
  } catch (err) {
    releaseMsg.innerText = err.message;
  }
}

async function activateRelease(id) {
  try {
    await api("/updates/activate", {
      method: "POST",
      body: JSON.stringify({ id })
    });
    releaseMsg.innerText = "Release activated";
    loadReleases();
  } catch (err) {
    releaseMsg.innerText = err.message;
  }
}

reportFromDate.value = monthStartIso();
reportToDate.value = todayIso();
subscriptionStart.value = todayIso();
if (window.createStartDate) createStartDate.value = todayIso();
[window.restaurantName, window.restaurantCountry, window.restaurantCurrency, window.expiryDate, window.createPlan].forEach((element) => {
  element?.addEventListener("input", updateCreateReview);
  element?.addEventListener("change", updateCreateReview);
});
partnerSelect?.addEventListener("change", () => {
  loadPartnerUsers();
  loadPartnerBranding();
  loadPartnerRestaurants();
  loadPartnerDashboard();
  loadPartnerCommissions();
});
moduleRestaurant?.addEventListener("change", () => loadTenantModules());
planBuilderSelect?.addEventListener("change", renderPlanFeatureGrid);
messagingRestaurant?.addEventListener("change", () => loadMessagingAccount());
messagingProvider?.addEventListener("change", renderMessagingProviderHelp);
orgSelect?.addEventListener("change", () => {
  loadBranchGroups();
  loadOrganizationRestaurants();
  loadOrganizationReport();
});
loadTenants();
loadReleases();
loadOwners();
loadSubscriptions();
loadMonitoring();
loadPartners();
loadModules();
loadPlanBuilder();
loadMessagingProviders();
loadMessagingAccount();
loadOrganizations();
showSaasView((location.hash || "#overview").slice(1));
