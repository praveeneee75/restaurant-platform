const { spawnSync } = require('node:child_process');
const path = require('node:path');

const posDir = path.resolve(__dirname, '..', 'pos-app');
const electron = process.platform === 'win32'
  ? path.join(posDir, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(posDir, 'node_modules', '.bin', 'electron');
const probe = path.resolve(__dirname, 'electron-native-probe.js');
const check = spawnSync(electron, [probe], {
  cwd: posDir,
  encoding: 'utf8'
});

if (check.status !== 0) {
  process.stderr.write(check.stderr || 'Electron native-module verification failed.\n');
  process.exit(check.status || 1);
}

const abi = String(check.stdout || '').trim().split(/\r?\n/).pop();
if (!/^\d+$/.test(abi)) {
  process.stderr.write(`Unable to determine Electron ABI. Output: ${check.stdout}\n`);
  process.exit(1);
}
console.log(`Electron native modules verified for NODE_MODULE_VERSION ${abi}`);
