const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'pos-app', 'dist-installers');
const targetDir = path.join(root, 'saas-backend', 'downloads', 'pos-installers');
const installerPattern = /\.(exe|msi|dmg|pkg|appimage|deb|rpm)$/i;

if (!fs.existsSync(sourceDir)) {
  console.error(`Installer output folder not found: ${sourceDir}`);
  console.error('Build installers first, for example: npm.cmd --prefix pos-app run dist:win');
  process.exit(1);
}

fs.mkdirSync(targetDir, { recursive: true });
const copied = fs.readdirSync(sourceDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && installerPattern.test(entry.name))
  .map((entry) => {
    const source = path.join(sourceDir, entry.name);
    const target = path.join(targetDir, entry.name);
    fs.copyFileSync(source, target);
    return entry.name;
  });

if (copied.length === 0) {
  console.error(`No installer files found in ${sourceDir}`);
  process.exit(1);
}

console.log(`Published ${copied.length} installer(s):`);
copied.forEach((name) => console.log(`- ${name}`));
