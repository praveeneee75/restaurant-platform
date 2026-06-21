const { execFileSync } = require('child_process');

const services = [
  { key: 'pos', name: 'POS', port: 3000 },
  { key: 'saas', name: 'SaaS', port: 4000 },
  { key: 'mobile', name: 'Mobile', port: 4300 }
];

const requestedService = (process.argv[2] || 'all').toLowerCase();

function printHelp() {
  console.log(`
Usage:
  npm.cmd run stop:all
  npm.cmd run stop:pos
  npm.cmd run stop:saas
  npm.cmd run stop:mobile

Advanced:
  node scripts/stop-service.js all
  node scripts/stop-service.js pos
  node scripts/stop-service.js saas
  node scripts/stop-service.js mobile
`);
}

function pidsForPort(port) {
  try {
    const output = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const pids = new Set();
    output.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed.startsWith('TCP')) return;
      const parts = trimmed.split(/\s+/);
      const localAddress = parts[1] || '';
      const state = parts[3] || '';
      const pid = parts[4] || '';
      if ((localAddress.endsWith(`:${port}`) || localAddress.includes(`:${port}`)) && state === 'LISTENING' && /^\d+$/.test(pid)) {
        pids.add(pid);
      }
    });
    return [...pids];
  } catch (err) {
    console.error(`[stop] Could not inspect port ${port}: ${err.message}`);
    return [];
  }
}

function stopPid(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'pipe' });
    } else {
      process.kill(Number(pid), 'SIGTERM');
    }
    return true;
  } catch (err) {
    console.error(`[stop] Could not stop process ${pid}: ${err.message}`);
    return false;
  }
}

const selectedServices = requestedService === 'all'
  ? services
  : services.filter((service) => service.key === requestedService);

if (selectedServices.length === 0) {
  console.error(`[stop] Unknown service "${requestedService}".`);
  printHelp();
  process.exit(1);
}

let stoppedCount = 0;
selectedServices.forEach((service) => {
  const pids = pidsForPort(service.port);
  if (pids.length === 0) {
    console.log(`[${service.name}] no server is listening on port ${service.port}`);
    return;
  }
  pids.forEach((pid) => {
    if (stopPid(pid)) {
      stoppedCount += 1;
      console.log(`[${service.name}] stopped process ${pid} on port ${service.port}`);
    }
  });
});

if (stoppedCount === 0) {
  console.log('[stop] Nothing needed to be stopped.');
}
