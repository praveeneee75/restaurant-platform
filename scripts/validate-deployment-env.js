const fs = require('fs');
const path = require('path');

const mode = String(process.argv[2] || '').toLowerCase();
const processMode = process.argv[3] === '--process';
const envPath = path.resolve(process.argv[3] || 'deploy/.env');

if (!['local', 'production'].includes(mode)) {
  console.error('Usage: node scripts/validate-deployment-env.js <local|production> <env-file>');
  process.exit(2);
}

if (!processMode && !fs.existsSync(envPath)) {
  console.error(`Environment file not found: ${envPath}`);
  process.exit(1);
}

const values = processMode ? { ...process.env } : {};
if (!processMode) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator < 1) continue;
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

const errors = [];
const required = mode === 'production'
  ? ['NODE_ENV', 'DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'JWT_SECRET', 'CORS_ORIGIN']
  : ['NODE_ENV'];

for (const key of required) {
  if (!values[key]) errors.push(`${key} is missing`);
}

if (mode === 'production') {
  if (values.NODE_ENV !== 'production') errors.push('NODE_ENV must be production');
  if ((values.JWT_SECRET || '').length < 32 || /change_me|replace_with|example\.com/i.test(values.JWT_SECRET || '')) {
    errors.push('JWT_SECRET must be a real secret of at least 32 characters');
  }
  if (/change_me|replace_with|example\.com/i.test(values.DB_PASSWORD || '')) errors.push('DB_PASSWORD still contains a template value');
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(Object.values(values).join('\n'))) errors.push('production environment contains a localhost or loopback value');
  for (const key of ['OWNER_PORTAL_URL', 'DOWNLOAD_PORTAL_URL', 'MOBILE_DOWNLOAD_BASE_URL']) {
    if (values[key] && !/^https:\/\//i.test(values[key])) errors.push(`${key} must use HTTPS`);
  }
}

if (errors.length) {
  console.error(`Environment validation failed for ${mode}:`);
  errors.forEach((error) => console.error(`- ${error}`));
  process.exit(1);
}

console.log(`Environment validation passed for ${mode}: ${processMode ? 'process environment' : envPath}`);
