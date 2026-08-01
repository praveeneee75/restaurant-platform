const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('pos-app/backend/public/admin.html');
const admin = read('pos-app/backend/public/js/admin-dashboard.js');
const server = read('pos-app/backend/server.js');
const thermal = read('pos-app/electron/thermalEscPos.js');
const electron = read('pos-app/electron/main.js');

for (const template of ['BORDERED', 'BORDERLESS', 'COMPACT', 'MODERN', 'MINIMAL']) {
  if (!html.includes(`value="${template}"`)) throw new Error(`Missing bill template ${template}`);
}
for (const font of ['FONT_A', 'FONT_B', 'FONT_C', 'FONT_D']) {
  if (!html.includes(`value="${font}"`) || !admin.includes(`value="${font}"`) || !server.includes(`'${font}'`)) throw new Error(`Missing printer font ${font}`);
}
for (const size of ['SMALL', 'COMPACT', 'NORMAL', 'LARGE', 'TALL']) {
  if (!admin.includes(`value="${size}"`) || !server.includes(`'${size}'`)) throw new Error(`Missing section size ${size}`);
}
for (const alignment of ['LEFT', 'CENTER', 'RIGHT']) {
  if (!admin.includes(`value="${alignment}"`) || !server.includes(`'${alignment}'`)) throw new Error(`Missing section alignment ${alignment}`);
}
if (!thermal.includes('FONT_C: 2') || !thermal.includes('FONT_D: 3')) throw new Error('RAW printer font mapping is incomplete');
if (!thermal.includes("template === 'MODERN'") || !thermal.includes("template === 'MINIMAL'")) throw new Error('RAW template rendering is incomplete');
if (!electron.includes("template === 'MODERN'") || !electron.includes("template === 'MINIMAL'")) throw new Error('HTML template rendering is incomplete');
if (!admin.includes("...flatPrintStyles('bill')") || !admin.includes("...flatPrintStyles('kot')")) throw new Error('Bill/KOT per-section settings are not persisted');
console.log('Print customisation regression passed.');
