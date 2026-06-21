const express = require('express');
const fs = require('fs');
const path = require('path');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();
const rootDir = path.resolve(__dirname, '../../..');
const posAppDir = path.join(rootDir, 'pos-app');

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = (year - 1980) << 9 | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

function shouldSkipPosPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized === ''
    || normalized.startsWith('node_modules/')
    || normalized.startsWith('data/')
    || normalized.startsWith('backups/')
    || normalized.startsWith('updates/staging/')
    || normalized.startsWith('.npm-cache/')
    || normalized.includes('/tmp-')
    || normalized.endsWith('.db')
    || normalized.endsWith('.log')
    || normalized === '.env';
}

function listPosFiles(dir = posAppDir, prefix = '') {
  if (!fs.existsSync(posAppDir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const relativePath = path.join(prefix, entry.name);
    if (shouldSkipPosPath(relativePath)) return [];
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return listPosFiles(fullPath, relativePath);
    if (!entry.isFile()) return [];
    return [{ fullPath, zipPath: `kmaster-pos/${relativePath.replace(/\\/g, '/')}` }];
  });
}

function buildStoredZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  files.forEach((file) => {
    const data = fs.readFileSync(file.fullPath);
    const name = Buffer.from(file.zipPath, 'utf8');
    const crc = crc32(data);
    const { time, day } = dosDateTime(fs.statSync(file.fullPath).mtime);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);

    offset += local.length + name.length + data.length;
  });

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, ...centralParts, end]);
}

function rowsToRelease(rows) {
  if (rows.length === 0) return null;
  const first = rows[0];
  return {
    id: first.id,
    version: first.version,
    release_notes: first.release_notes || '',
    mandatory_update: first.mandatory_update,
    status: first.status,
    created_at: first.created_at,
    files: rows.filter((row) => row.file_id).map((row) => ({
      id: row.file_id,
      file_name: row.file_name,
      file_url: row.file_url,
      checksum: row.checksum || ''
    }))
  };
}

router.get('/latest', async (_req, res) => {
  try {
    const releaseResult = await pool.query(`
      SELECT *
      FROM releases
      WHERE status = 'ACTIVE'
      ORDER BY created_at DESC
      LIMIT 1
    `);
    if (releaseResult.rowCount === 0) {
      return res.json({ success: true, updateAvailable: false, release: null });
    }

    const releaseId = releaseResult.rows[0].id;
    const files = await pool.query('SELECT * FROM release_files WHERE release_id = $1 ORDER BY created_at', [releaseId]);
    res.json({
      success: true,
      version: releaseResult.rows[0].version,
      release_notes: releaseResult.rows[0].release_notes || '',
      mandatory_update: releaseResult.rows[0].mandatory_update,
      files: files.rows,
      checksum: files.rows[0]?.checksum || ''
    });
  } catch (err) {
    console.error('LATEST UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/download/pos-app.zip', async (_req, res) => {
  try {
    const files = listPosFiles();
    if (files.length === 0) return res.status(404).json({ success: false, message: 'POS app package is not available' });
    const zip = buildStoredZip(files);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="kmaster-pos-app.zip"');
    res.setHeader('Content-Length', String(zip.length));
    res.send(zip);
  } catch (err) {
    console.error('POS DOWNLOAD ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/list', authenticate, async (_req, res) => {
  try {
    const rows = await pool.query(`
      SELECT r.*, f.id AS file_id, f.file_name, f.file_url, f.checksum
      FROM releases r
      LEFT JOIN release_files f ON f.release_id = r.id
      ORDER BY r.created_at DESC, f.created_at
    `);
    const releases = [];
    const byId = new Map();
    rows.rows.forEach((row) => {
      if (!byId.has(row.id)) {
        byId.set(row.id, rowsToRelease([row]));
        releases.push(byId.get(row.id));
      } else if (row.file_id) {
        byId.get(row.id).files.push({
          id: row.file_id,
          file_name: row.file_name,
          file_url: row.file_url,
          checksum: row.checksum || ''
        });
      }
    });
    res.json({ success: true, releases });
  } catch (err) {
    console.error('LIST UPDATES ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/create', authenticate, async (req, res) => {
  const { version, releaseNotes, release_notes, mandatoryUpdate, mandatory_update, files } = req.body;
  if (!version || !Array.isArray(files) || files.length === 0) {
    return res.status(400).json({ success: false, message: 'Version and at least one release file are required' });
  }
  if (files.some((file) => !file.file_name || !file.file_url)) {
    return res.status(400).json({ success: false, message: 'Each file needs a name and URL' });
  }

  try {
    const created = await pool.query('BEGIN')
      .then(async () => {
        const release = await pool.query(`
          INSERT INTO releases (version, release_notes, mandatory_update, status)
          VALUES ($1, $2, $3, 'DRAFT')
          RETURNING *
        `, [version, releaseNotes || release_notes || '', Boolean(mandatoryUpdate ?? mandatory_update)]);
        for (const file of files) {
          await pool.query(`
            INSERT INTO release_files (release_id, file_name, file_url, checksum)
            VALUES ($1, $2, $3, $4)
          `, [release.rows[0].id, file.file_name, file.file_url, file.checksum || null]);
        }
        await pool.query('COMMIT');
        return release.rows[0];
      });
    res.json({ success: true, release: created });
  } catch (err) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('CREATE UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/activate', authenticate, async (req, res) => {
  const { id, version } = req.body;
  if (!id && !version) {
    return res.status(400).json({ success: false, message: 'Release id or version required' });
  }

  try {
    const result = await pool.query(`
      UPDATE releases
      SET status = 'ACTIVE'
      WHERE ${id ? 'id = $1' : 'version = $1'}
      RETURNING *
    `, [id || version]);
    if (result.rowCount === 0) return res.status(404).json({ success: false, message: 'Release not found' });
    await pool.query("UPDATE releases SET status = 'ARCHIVED' WHERE id != $1 AND status = 'ACTIVE'", [result.rows[0].id]);
    res.json({ success: true, release: result.rows[0] });
  } catch (err) {
    console.error('ACTIVATE UPDATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
