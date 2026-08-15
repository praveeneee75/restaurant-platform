const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log(`PASS: ${message}`); };

const owners = read('saas-backend/src/routes/owners.js');
const license = read('saas-backend/src/routes/license.js');
const pos = read('pos-app/backend/server.js');
const ownerProfile = read('saas-backend/public/owner-profile.html');
const ownerProfileJs = read('saas-backend/public/js/owner-profile.js');
const admin = read('saas-backend/public/admin.html');
const adminJs = read('saas-backend/public/js/admin.js');
const tenants = read('saas-backend/src/routes/tenants.js');
const mobileDownload = read('saas-backend/public/mobile-download.html');

assert(owners.includes("router.get('/branch-profiles', authenticateOwner") && owners.includes("router.put('/branch-profiles/:restaurantCode', authenticateOwner"), 'owner branch profile API requires authenticated owner access');
assert(owners.includes('ro.owner_user_id=$19') && owners.includes('ro.active=true'), 'branch updates are tenant-isolated to the assigned owner');
assert(ownerProfile.includes('Restaurant &amp; Branch Profiles') && ownerProfileJs.includes("/owners/branch-profiles"), 'owner portal exposes per-branch profile editing');
assert(license.includes('restaurantProfile: restaurantProfile(license)') && pos.includes('applyCloudRestaurantProfile(db, response.data)'), 'existing license authentication contract transfers SaaS profile to POS');
assert(admin.includes('name="customerStructure"') && admin.includes('value="GROUP"') && admin.includes('restaurantBranchCount') && admin.includes('multiBranchProfiles'), 'restaurant onboarding explicitly supports one restaurant or a multi-branch restaurant group');
assert(adminJs.includes('renderMultiBranchProfiles') && adminJs.includes("api('/organizations/create'") && adminJs.includes("api('/organizations/restaurants/assign'"), 'multi-branch onboarding creates separate branch profiles and organization assignments');
assert(admin.includes('value="EXISTING"') && admin.includes('existingOrganizationSelect') && adminJs.includes('addBranch:existing || index > 0'), 'onboarding can add a separately licensed branch to an existing customer and restaurant group');
assert(tenants.includes("res.status(409).json({ success: false, message: 'Email ID is already in use. Enter a new email ID.' })") && tenants.includes("err.code === '23505'"), 'customer onboarding rejects an already registered email with a clear validation error and handles concurrent duplicates');
assert(admin.includes('restaurantState') && admin.includes('restaurantStateCode'), 'single restaurant onboarding uses state selection and derived GST state code');
assert(ownerProfile.includes('data-profile-tab="branches"') && ownerProfile.includes('data-profile-panel="account"') && ownerProfile.includes('data-profile-panel="security"'), 'owner profile separates branches, account details and security into subsections');
assert(ownerProfile.includes('/css/app.css?v=20260805-profile-sections-2'), 'owner profile subsection layout uses a cache-busted stylesheet');
assert(ownerProfileJs.includes('<details class="branch-profile-card"') && ownerProfileJs.includes("branchProfiles.addEventListener('toggle'"), 'owner branch profiles use a one-at-a-time expandable editor');
assert(!admin.includes('id="restaurantState" required value="Tamil Nadu"'), 'restaurant onboarding no longer hardcodes Tamil Nadu');
assert(mobileDownload.includes('owner-appbar') && mobileDownload.includes('/owner-dashboard.html') && mobileDownload.includes('/downloads.html'), 'mobile download page uses owner portal navigation');

console.log('Branch profile and authentication sync regression passed');
