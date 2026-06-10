const express = require('express');
const pool = require('../db/db');
const authenticate = require('../middleware/authMiddleware');
const { publicError } = require('../config');

const router = express.Router();

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
