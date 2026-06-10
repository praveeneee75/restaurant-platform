const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { dbPathForRestaurant } = require('./migrationRunner');

const DEFAULT_CONFIG = {
  backup_enabled: '0',
  backup_folder_path: '',
  onedrive_folder_path: '',
  backup_interval_minutes: '60',
  last_backup_at: '',
  last_sync_at: ''
};

const restoreLocks = new Set();

function timestamp() {
  const compact = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return compact.slice(0, 8) + '_' + compact.slice(8);
}

function nowIso() {
  return new Date().toISOString();
}

function defaultBackupDir() {
  return path.join(__dirname, '../../backups');
}

function safeRestaurantId(restaurantId) {
  return String(restaurantId || '').trim();
}

function backupFilename(restaurantId) {
  return `restaurant_${safeRestaurantId(restaurantId)}_${timestamp()}.db`;
}

function uniqueBackupPath(folderPath, restaurantId) {
  const parsed = path.parse(backupFilename(restaurantId));
  let candidate = path.join(folderPath, parsed.base);
  let counter = 1;
  while (fs.existsSync(candidate)) {
    candidate = path.join(folderPath, `${parsed.name}_${counter}${parsed.ext}`);
    counter += 1;
  }
  return candidate;
}

function backupPattern(restaurantId) {
  return new RegExp(`^restaurant_${safeRestaurantId(restaurantId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d{8}_\\d{6}(?:_\\d+)?\\.db$`);
}

function getConfig(db) {
  const config = { ...DEFAULT_CONFIG };
  db.prepare('SELECT key, value FROM system_config').all().forEach((row) => {
    if (Object.prototype.hasOwnProperty.call(config, row.key)) config[row.key] = row.value || '';
  });
  return config;
}

function setConfig(db, values) {
  const setConfigValue = db.prepare(`
    INSERT INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
  `);
  Object.entries(values).forEach(([key, value]) => {
    if (Object.prototype.hasOwnProperty.call(DEFAULT_CONFIG, key)) setConfigValue.run(key, String(value ?? ''));
  });
}

function logBackup(db, restaurantId, type, status, message, filePath) {
  db.prepare(`
    INSERT INTO backup_logs (restaurant_id, type, status, message, file_path)
    VALUES (?, ?, ?, ?, ?)
  `).run(safeRestaurantId(restaurantId), type, status, message || null, filePath || null);
}

function configuredBackupDir(db) {
  const config = getConfig(db);
  return config.backup_folder_path && config.backup_folder_path.trim() ? config.backup_folder_path.trim() : '';
}

function ensureFolder(folderPath) {
  fs.mkdirSync(folderPath, { recursive: true });
}

function ensureDatabaseAvailable(source) {
  let checkDb;
  try {
    checkDb = new Database(source);
    checkDb.pragma('busy_timeout = 250');
    checkDb.exec('BEGIN IMMEDIATE; ROLLBACK;');
    return { available: true };
  } catch (err) {
    return { available: false, message: 'Database is currently locked or open in another tool. Close DB Browser and try again.' };
  } finally {
    if (checkDb) checkDb.close();
  }
}

function backupFiles(folderPath, restaurantId) {
  if (!fs.existsSync(folderPath)) return [];
  const pattern = backupPattern(restaurantId);
  return fs.readdirSync(folderPath)
    .filter((filename) => pattern.test(filename))
    .map((filename) => {
      const filePath = path.join(folderPath, filename);
      const stat = fs.statSync(filePath);
      return { filename, filePath, size: stat.size, created_at: stat.birthtime || stat.mtime, mtimeMs: stat.mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function pruneBackups(folderPath, restaurantId, keep = 20) {
  backupFiles(folderPath, restaurantId).slice(keep).forEach((file) => {
    try {
      fs.unlinkSync(file.filePath);
    } catch (err) {
      console.warn('Old backup cleanup skipped:', err.message);
    }
  });
}

function backupRestaurantDatabase(db, restaurantId, options = {}) {
  const source = dbPathForRestaurant(restaurantId);
  if (!fs.existsSync(source)) {
    logBackup(db, restaurantId, 'LOCAL_BACKUP', 'FAILED', 'Restaurant database file is missing', null);
    return { success: false, backupPath: null, message: 'Restaurant database file is missing' };
  }

  const folderPath = options.folderPath || configuredBackupDir(db);
  if (!folderPath) {
    logBackup(db, restaurantId, 'LOCAL_BACKUP', 'FAILED', 'Backup folder path is required', null);
    return { success: false, backupPath: null, message: 'Backup folder path is required' };
  }

  const availability = ensureDatabaseAvailable(source);
  if (!availability.available) {
    logBackup(db, restaurantId, 'LOCAL_BACKUP', 'FAILED', availability.message, null);
    return { success: false, backupPath: null, message: availability.message };
  }

  try {
    ensureFolder(folderPath);
    const target = uniqueBackupPath(folderPath, restaurantId);
    const backupTime = nowIso();
    setConfig(db, { last_backup_at: backupTime, backup_folder_path: folderPath });
    fs.copyFileSync(source, target);
    pruneBackups(folderPath, restaurantId, 20);
    logBackup(db, restaurantId, 'LOCAL_BACKUP', 'SUCCESS', 'Backup created', target);
    return { success: true, backupPath: target, message: 'Backup created' };
  } catch (err) {
    logBackup(db, restaurantId, 'LOCAL_BACKUP', 'FAILED', err.message, null);
    return { success: false, backupPath: null, message: err.message };
  }
}

function listBackups(db, restaurantId) {
  const folderPath = configuredBackupDir(db);
  if (!folderPath) return [];
  return backupFiles(folderPath, restaurantId).map((file) => ({
    filename: file.filename,
    size: file.size,
    created_at: file.created_at
  }));
}

function syncLatestBackupToOneDrive(db, restaurantId) {
  const config = getConfig(db);
  const oneDrivePath = (config.onedrive_folder_path || '').trim();
  if (!oneDrivePath) {
    logBackup(db, restaurantId, 'ONEDRIVE_SYNC', 'FAILED', 'OneDrive folder path is not configured', null);
    return { success: false, syncPath: null, message: 'OneDrive folder path is not configured' };
  }
  if (!fs.existsSync(oneDrivePath)) {
    logBackup(db, restaurantId, 'ONEDRIVE_SYNC', 'FAILED', 'OneDrive folder path does not exist', oneDrivePath);
    return { success: false, syncPath: null, message: 'OneDrive folder path does not exist' };
  }

  const backupDir = configuredBackupDir(db);
  if (!backupDir) {
    logBackup(db, restaurantId, 'ONEDRIVE_SYNC', 'FAILED', 'Backup folder path is required', null);
    return { success: false, syncPath: null, message: 'Backup folder path is required' };
  }
  const latest = backupFiles(backupDir, restaurantId)[0];
  if (!latest) {
    logBackup(db, restaurantId, 'ONEDRIVE_SYNC', 'FAILED', 'No backups available to sync', null);
    return { success: false, syncPath: null, message: 'No backups available to sync' };
  }

  try {
    const target = path.join(oneDrivePath, latest.filename);
    fs.copyFileSync(latest.filePath, target);
    setConfig(db, { last_sync_at: nowIso() });
    logBackup(db, restaurantId, 'ONEDRIVE_SYNC', 'SUCCESS', 'Backup copied to OneDrive folder', target);
    return { success: true, syncPath: target, message: 'Backup copied to OneDrive folder' };
  } catch (err) {
    logBackup(db, restaurantId, 'ONEDRIVE_SYNC', 'FAILED', err.message, oneDrivePath);
    return { success: false, syncPath: null, message: err.message };
  }
}

function restoreBackup(db, restaurantId, filename) {
  const cleanFilename = path.basename(String(filename || ''));
  if (!backupPattern(restaurantId).test(cleanFilename)) {
    logBackup(db, restaurantId, 'RESTORE', 'FAILED', 'Invalid backup filename', cleanFilename);
    return { success: false, message: 'Invalid backup filename' };
  }
  if (restoreLocks.has(restaurantId)) return { success: false, message: 'Restore already in progress' };

  const folderPath = configuredBackupDir(db);
  if (!folderPath) {
    logBackup(db, restaurantId, 'RESTORE', 'FAILED', 'Backup folder path is required', cleanFilename);
    return { success: false, message: 'Backup folder path is required' };
  }
  const source = path.join(folderPath, cleanFilename);
  const target = dbPathForRestaurant(restaurantId);
  if (!fs.existsSync(source)) {
    logBackup(db, restaurantId, 'RESTORE', 'FAILED', 'Backup file not found', source);
    return { success: false, message: 'Backup file not found' };
  }

  restoreLocks.add(restaurantId);
  let dbClosed = false;
  try {
    const safety = backupRestaurantDatabase(db, restaurantId, { folderPath });
    if (!safety.success) throw new Error(`Safety backup failed: ${safety.message}`);
    db.close();
    dbClosed = true;
    fs.copyFileSync(source, target);
    const restoredDb = new Database(target);
    logBackup(restoredDb, restaurantId, 'RESTORE', 'SUCCESS', 'Backup restored. Restart may be required.', source);
    restoredDb.close();
    return { success: true, message: 'Backup restored. Restart may be required.', safetyBackupPath: safety.backupPath, dbClosed: true };
  } catch (err) {
    try {
      logBackup(db, restaurantId, 'RESTORE', 'FAILED', err.message, source);
    } catch (_) {
      // The DB may already be closed during restore; returning the error keeps POS responsive.
    }
    return { success: false, message: err.message, dbClosed };
  } finally {
    restoreLocks.delete(restaurantId);
  }
}

function dueForScheduledBackup(config) {
  if (config.backup_enabled !== '1') return false;
  const interval = Math.max(Number(config.backup_interval_minutes || 60), 1);
  if (!config.last_backup_at) return true;
  const last = new Date(config.last_backup_at).getTime();
  return !Number.isFinite(last) || Date.now() - last >= interval * 60 * 1000;
}

module.exports = {
  DEFAULT_CONFIG,
  backupRestaurantDatabase,
  getConfig,
  setConfig,
  listBackups,
  logBackup,
  syncLatestBackupToOneDrive,
  restoreBackup,
  dueForScheduledBackup
};
