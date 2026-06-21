const { spawn } = require('child_process');
const path = require('path');

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const useShell = process.platform === 'win32';
const root = path.resolve(__dirname, '..');

const services = [
  {
    name: 'POS',
    cwd: path.join(root, 'pos-app'),
    args: ['start'],
    url: 'http://localhost:3000'
  },
  {
    name: 'SaaS',
    cwd: path.join(root, 'saas-backend'),
    args: ['start'],
    url: 'http://localhost:4000'
  },
  {
    name: 'Mobile',
    cwd: path.join(root, 'mobile-app'),
    args: ['run', 'start:4300'],
    url: 'http://localhost:4300'
  }
];

const children = [];
let shuttingDown = false;

function prefixLines(name, stream, chunk) {
  String(chunk)
    .split(/\r?\n/)
    .filter(Boolean)
    .forEach((line) => stream.write(`[${name}] ${line}\n`));
}

function startService(service) {
  const command = useShell ? `${npmCmd} ${service.args.join(' ')}` : npmCmd;
  const args = useShell ? [] : service.args;
  const child = spawn(command, args, {
    cwd: service.cwd,
    env: process.env,
    shell: useShell,
    stdio: ['ignore', 'pipe', 'pipe']
  });

  children.push(child);
  console.log(`[${service.name}] starting in ${service.cwd}`);
  console.log(`[${service.name}] ${service.url}`);

  child.stdout.on('data', (chunk) => prefixLines(service.name, process.stdout, chunk));
  child.stderr.on('data', (chunk) => prefixLines(service.name, process.stderr, chunk));
  child.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.log(`[${service.name}] exited with ${reason}`);
    if (!shuttingDown && code !== 0) {
      console.log('[all] one service stopped unexpectedly; shutting down the others');
      stopAll(1);
    }
  });
}

function stopAll(exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  children.forEach((child) => {
    if (!child.killed) child.kill();
  });
  setTimeout(() => process.exit(exitCode), 500);
}

process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));

services.forEach(startService);
console.log('[all] POS, SaaS and mobile preview are starting. Press Ctrl+C to stop all.');
