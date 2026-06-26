const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const pool = require('../db/db');

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function tokenFromRequest(req) {
  const header = req.headers.authorization || '';
  const parts = header.split(' ');
  return parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : null;
}

function decodedExpiry(token) {
  const decoded = jwt.decode(token);
  return decoded?.exp ? new Date(decoded.exp * 1000) : new Date(Date.now() + 8 * 60 * 60 * 1000);
}

async function revokeToken(token) {
  if (!token) return;
  await pool.query(
    `INSERT INTO revoked_tokens (token_hash, expires_at)
     VALUES ($1, $2)
     ON CONFLICT (token_hash) DO UPDATE SET revoked_at = NOW(), expires_at = EXCLUDED.expires_at`,
    [tokenHash(token), decodedExpiry(token)]
  );
}

async function isTokenRevoked(token) {
  if (!token) return true;
  const result = await pool.query(
    'SELECT 1 FROM revoked_tokens WHERE token_hash = $1 AND expires_at > NOW() LIMIT 1',
    [tokenHash(token)]
  );
  return result.rowCount > 0;
}

module.exports = {
  tokenFromRequest,
  revokeToken,
  isTokenRevoked
};
