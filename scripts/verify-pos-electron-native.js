const { spawnSync } = require('node:child_process');
const path = require('node:path');

const posDir = path.resolve(__dirname, '..', 'pos-app');
const electron = process.platform === 'win32'
  ? path.join(posDir, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(posDir, 'node_modules', '.bin', 'electron');
const probe = path.resolve(__dirname, 'electron-native-probe.js');
const check = spawnSync(electron, [probe], {
  cwd: posDir,
  encoding: 'utf8',
  env: {
    ...process.env,
    // CI runners do not provide an interactive Windows desktop. Running the
    // probe in Electron's Node mode still uses Electron's native-module ABI.
    ELECTRON_RUN_AS_NODE: '1'
  }
});

if (check.status !== 0) {
  const details = [
    check.error && check.error.stack,
    check.stderr,
    check.stdout
  ].filter(Boolean).join('\n');
  process.stderr.write(details || `Electron native-module verification failed (status=${check.status}, signal=${check.signal || 'none'}).\n`);
  process.exit(check.status || 1);
}

const abi = String(check.stdout || '').trim().split(/\r?\n/).pop();
if (!/^\d+$/.test(abi)) {
  process.stderr.write(`Unable to determine Electron ABI. Output: ${check.stdout}\n`);
  process.exit(1);
}
console.log(`Electron native modules verified for NODE_MODULE_VERSION ${abi}`);
