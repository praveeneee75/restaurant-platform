const express = require('express');
const fs = require('fs');
const path = require('path');
const QRCode = require('qrcode');
const pool = require('../db/db');
const { publicError } = require('../config');

const router = express.Router();
const installerDir = path.join(__dirname, '../../downloads/mobile-installers');

function androidInstaller() {
  if (!fs.existsSync(installerDir)) return null;
  const entries = fs.readdirSync(installerDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.apk'))
    .map((entry) => {
      const fullPath = path.join(installerDir, entry.name);
      const stats = fs.statSync(fullPath);
      return { fileName: entry.name, fullPath, size: stats.size, updatedAt: stats.mtime };
    })
    .sort((a, b) => b.updatedAt - a.updatedAt);
  if (!entries.length) return null;
  const match = entries[0].fileName.match(/(\d+\.\d+\.\d+)/);
  return { ...entries[0], version: match?.[1] || null };
}

function downloadBaseUrl() {
  return String(process.env.MOBILE_DOWNLOAD_BASE_URL || 'https://www.kmasterpos.com').replace(/\/$/, '');
}

function safeIosUrl() {
  const value = String(process.env.IOS_APP_URL || '').trim();
  return /^https:\/\//i.test(value) ? value : '';
}

router.get('/download-info', (_req, res) => {
  const android = androidInstaller();
  const iosUrl = safeIosUrl();
  res.json({
    success: true,
    smartUrl: `${downloadBaseUrl()}/mobile/download`,
    qrUrl: '/mobile/download/qr.png',
    android: {
      available: Boolean(android),
      version: android?.version || null,
      fileName: android?.fileName || null,
      size: android?.size || null,
      downloadUrl: android ? '/mobile/download/android' : null
    },
    ios: {
      available: Boolean(iosUrl),
      downloadUrl: iosUrl || null,
      distribution: iosUrl ? 'APP_STORE_OR_TESTFLIGHT' : 'NOT_PUBLISHED'
    }
  });
});

router.get('/download/qr.png', async (_req, res) => {
  try {
    const png = await QRCode.toBuffer(`${downloadBaseUrl()}/mobile/download`, {
      type: 'png',
      width: 360,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#111827', light: '#ffffff' }
    });
    res.set({
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=3600',
      'Content-Disposition': 'inline; filename="KMaster-Mobile-Download-QR.png"'
    });
    res.send(png);
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/download/android', (_req, res) => {
  const installer = androidInstaller();
  if (!installer) return res.status(404).json({ success: false, message: 'Android app is not published yet' });
  res.set('Cache-Control', 'private, no-store');
  return res.download(installer.fullPath, installer.fileName);
});

router.get('/download', (req, res) => {
  const userAgent = String(req.headers['user-agent'] || '');
  if (/android/i.test(userAgent)) return res.redirect(302, '/mobile/download/android');
  if (/iphone|ipad|ipod/i.test(userAgent)) {
    const iosUrl = safeIosUrl();
    return res.redirect(302, iosUrl || '/mobile-download.html?platform=ios');
  }
  return res.redirect(302, '/mobile-download.html');
});

router.get('/restaurants', async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        t.restaurant_code AS "restaurantId",
        t.name,
        t.country,
        COALESCE(t.currency, 'INR') AS currency,
        COALESCE(NULLIF(t.mobile_pos_url, ''), hb.payload->>'mobilePosUrl', '') AS "posUrl",
        l.expires_at AS "expiresAt"
      FROM tenants t
      JOIN licenses l ON l.tenant_id = t.id
      LEFT JOIN pos_heartbeats hb ON hb.restaurant_code = t.restaurant_code
      JOIN tenant_modules tm ON tm.tenant_id = t.id AND tm.enabled = true
      JOIN modules m ON m.id = tm.module_id AND m.status = 'ACTIVE' AND m.code = 'MOBILE_APP'
      LEFT JOIN LATERAL (
        SELECT status, expires_at
        FROM subscriptions
        WHERE tenant_id = t.id
        ORDER BY created_at DESC
        LIMIT 1
      ) s ON true
      WHERE l.status = 'ACTIVE'
        AND l.expires_at > NOW()
        AND COALESCE(s.status, 'ACTIVE') = 'ACTIVE'
        AND COALESCE(s.expires_at, l.expires_at::date) >= CURRENT_DATE
      ORDER BY t.name
    `);
    res.json({ success: true, restaurants: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
