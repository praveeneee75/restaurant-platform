const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'saas-backend', 'public');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

const dashboard = read('owner-dashboard.html');
const profile = read('owner-profile.html');
const downloads = read('downloads.html');
const downloadsJs = read(path.join('js', 'downloads.js'));
const control = read('owner-control.html');
const css = read(path.join('css', 'app.css'));

for (const [name, html] of Object.entries({ dashboard, profile, downloads })) {
  assert(html.includes('owner-appbar'), `${name} must use the shared compact owner app bar`);
  assert(html.includes('owner-appbrand'), `${name} must use the shared owner brand`);
  assert(html.includes('class="owner-actions'), `${name} must use the shared owner action bar`);
  for (const label of ['Dashboard', 'Owner control', 'Downloads', 'Profile', 'Sign out']) {
    assert(html.includes(label), `${name} is missing ${label}`);
  }
}

assert(control.includes('class="od-top-actions"'), 'Owner control must retain the compact action bar');
for (const label of ['Dashboard', 'Owner control', 'Downloads', 'Profile', 'Sync', 'Notifications', 'Settings', 'Sign out']) {
  assert(control.includes(label), `Owner control is missing ${label}`);
}
assert(css.includes('.download-nav button,\n.download-nav a,\n.owner-actions a,\n.owner-actions button'),
  'Links and buttons must share one visual control rule');
assert(css.includes('.owner-appbar'), 'Shared owner app bar CSS is missing');
assert(css.includes('min-height: 44px'), 'Owner navigation controls must have a consistent height');
assert(downloads.includes('id="androidDownloadLink"') && downloads.includes('/mobile/download/android'),
  'Downloads page must expose the published Android APK instead of placeholder copy');
assert(downloads.includes('id="mobileDownloadStatus"') && downloadsJs.includes('loadMobileRelease'),
  'Downloads page must load current mobile release information');
assert(css.includes('@media (max-width: 1100px)') && css.includes('grid-template-columns: repeat(5, minmax(0, 1fr))'),
  'Owner navigation must reflow before zoomed desktop widths can push actions off-screen');

console.log(JSON.stringify({
  success: true,
  pages: ['owner-dashboard.html', 'owner-control.html', 'downloads.html', 'owner-profile.html'],
  sharedControlHeight: 44
}, null, 2));
