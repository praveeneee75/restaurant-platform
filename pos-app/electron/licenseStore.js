const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const STORE_VERSION = 1;

function storePath() {
  return path.join(app.getPath('userData'), 'license.entitlement');
}

function readEntitlement() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const encrypted = fs.readFileSync(storePath());
    const payload = JSON.parse(safeStorage.decryptString(encrypted));
    if (payload.version !== STORE_VERSION || !payload.restaurantId || !payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

function writeEntitlement(entitlement) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure operating-system storage is unavailable');
  }
  const payload = {
    version: STORE_VERSION,
    restaurantId: entitlement.restaurantId,
    restaurantName: entitlement.restaurantName || entitlement.restaurantId,
    expiresAt: entitlement.expiresAt,
    status: entitlement.status || 'ACTIVE',
    lastOnlineCheckAt: entitlement.lastOnlineCheckAt || new Date().toISOString()
  };
  const target = storePath();
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, safeStorage.encryptString(JSON.stringify(payload)), { mode: 0o600 });
  fs.renameSync(temporary, target);
  return payload;
}

function removeEntitlement() {
  try {
    fs.rmSync(storePath(), { force: true });
  } catch {
    // A missing or locked cache should not prevent activation.
  }
}

function isExpired(entitlement, now = Date.now()) {
  const expiry = new Date(entitlement?.expiresAt).getTime();
  return !Number.isFinite(expiry) || expiry <= now || entitlement.status !== 'ACTIVE';
}

function checkedToday(entitlement, now = new Date()) {
  const checked = new Date(entitlement?.lastOnlineCheckAt);
  return Number.isFinite(checked.getTime())
    && checked.getFullYear() === now.getFullYear()
    && checked.getMonth() === now.getMonth()
    && checked.getDate() === now.getDate();
}

module.exports = {
  checkedToday,
  isExpired,
  readEntitlement,
  removeEntitlement,
  writeEntitlement
};
