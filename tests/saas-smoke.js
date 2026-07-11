const fs = require('fs');
const http = require('http');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

const root = path.resolve(__dirname, '..');
const saasRoot = path.join(root, 'saas-backend');
const port = Number(process.env.SAAS_SMOKE_PORT || 3499);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function walk(dir, predicate, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, predicate, out);
    if (entry.isFile() && predicate(full)) out.push(full);
  }
  return out;
}

function request(targetPath) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const req = http.get({ hostname: '127.0.0.1', port, path: targetPath, timeout: 10000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body, ms: Date.now() - startedAt, headers: res.headers }));
    });
    req.on('timeout', () => req.destroy(new Error(`${targetPath} timeout`)));
    req.on('error', reject);
  });
}

async function waitForServer(child) {
  let lastError;
  for (let i = 0; i < 20; i += 1) {
    if (child.exitCode !== null) throw new Error(`SaaS server exited early with code ${child.exitCode}`);
    try {
      return await request('/health');
    } catch (err) {
      lastError = err;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw lastError || new Error('SaaS server did not start');
}

async function main() {
  walk(path.join(saasRoot, 'src'), (name) => name.endsWith('.js')).forEach((file) => {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  });

  walk(path.join(saasRoot, 'public'), (name) => /\.(html|js|css)$/i.test(name)).forEach((file) => {
    const content = fs.readFileSync(file, 'utf8');
    assert(!content.includes('\u0000'), `Corrupted null bytes found in ${path.relative(root, file)}`);
  });
  const adminHtml = fs.readFileSync(path.join(saasRoot, 'public', 'admin.html'), 'utf8');
  const sessionJs = fs.readFileSync(path.join(saasRoot, 'public', 'js', 'saas-session.js'), 'utf8');
  const downloadsHtml = fs.readFileSync(path.join(saasRoot, 'public', 'downloads.html'), 'utf8');
  assert(!adminHtml.includes('Open Online Ordering'), 'Online ordering link must not appear in SaaS admin');
  assert(!adminHtml.includes('restaurantMobilePosUrl'), 'Legacy mobile POS URL must not appear in customer onboarding');
  assert(adminHtml.includes('restaurantOwnerPhone'), 'Customer mobile number field missing');
  assert(!sessionJs.includes('data-session-forward'), 'Forward navigation must not appear in SaaS');
  assert(downloadsHtml.includes('id="desktop-app"'), 'Desktop download portal anchor missing');
  assert(downloadsHtml.includes('id="mobile-app"'), 'Mobile download portal anchor missing');

  const child = spawn(process.execPath, ['src/app.js'], {
    cwd: saasRoot,
    env: { ...process.env, PORT: String(port), SAAS_SLOW_REQUEST_MS: '750' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  try {
    const health = await waitForServer(child);
    const pages = ['/website.html', '/mobile-download.html', '/login.html', '/admin.html', '/downloads.html', '/owner-login.html', '/owner-change-password.html', '/owner-dashboard.html', '/partner-login.html', '/partner-dashboard.html', '/owner-mobile.html'];
    const pageResults = {};
    for (const page of pages) {
      const res = await request(page);
      pageResults[page] = { status: res.status, ms: res.ms, ok: res.status === 200 && res.body.startsWith('<!DOCTYPE html>') };
      assert(pageResults[page].ok, `SaaS page failed: ${page}`);
      assert(res.ms <= Number(process.env.SAAS_STATIC_PAGE_BUDGET_MS || 750), `SaaS page too slow: ${page} ${res.ms}ms`);
    }
    const warmHealth = await request('/health');
    assert(health.status === 200, `SaaS health failed: ${health.status}`);
    assert(warmHealth.status === 200, `SaaS warm health failed: ${warmHealth.status}`);
    assert(warmHealth.ms <= Number(process.env.SAAS_HEALTH_BUDGET_MS || 750), `SaaS warm health too slow: ${warmHealth.ms}ms`);
    assert(Number(health.headers['x-response-time-ms']) >= 0, 'SaaS response time header missing');
    console.log(JSON.stringify({ health: { status: health.status, ms: health.ms }, warmHealth: { status: warmHealth.status, ms: warmHealth.ms }, pages: pageResults }, null, 2));
  } finally {
    child.kill();
  }
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
