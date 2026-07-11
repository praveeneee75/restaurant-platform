const express = require('express');
const pool = require('../db/db');
const { publicError } = require('../config');
const { sendInquiryNotification } = require('../services/emailService');
const authenticate = require('../middleware/authMiddleware');

const router = express.Router();
const attempts = new Map();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const INQUIRY_STATUSES = new Set(['NEW', 'CONTACTED', 'QUALIFIED', 'CLOSED']);

function allowed(ip) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (recent.length >= MAX_PER_WINDOW) return false;
  recent.push(now);
  attempts.set(ip, recent);
  return true;
}

router.post('/', async (req, res) => {
  const { name, businessName, email, phone, city, outletCount, message, website } = req.body || {};
  if (website) return res.json({ success: true, message: 'Thank you. We will contact you shortly.' });
  if (!allowed(req.ip)) return res.status(429).json({ success: false, message: 'Too many enquiries. Please try again later.' });
  if (!name || !email || !phone) return res.status(400).json({ success: false, message: 'Name, email and mobile number are required' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    return res.status(400).json({ success: false, message: 'Enter a valid email address' });
  }
  const normalizedPhone = String(phone).replace(/[^\d+]/g, '');
  if (!/^\+?\d{8,15}$/.test(normalizedPhone)) {
    return res.status(400).json({ success: false, message: 'Enter a valid mobile number with country code' });
  }
  const outlets = Math.min(Math.max(Number(outletCount) || 1, 1), 999);
  try {
    const result = await pool.query(
      `INSERT INTO sales_inquiries (name, business_name, email, phone, city, outlet_count, message)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        String(name).trim().slice(0, 120),
        String(businessName || '').trim().slice(0, 160) || null,
        String(email).trim().toLowerCase().slice(0, 200),
        normalizedPhone,
        String(city || '').trim().slice(0, 120) || null,
        outlets,
        String(message || '').trim().slice(0, 2000) || null
      ]
    );
    sendInquiryNotification({ name, businessName, email, phone: normalizedPhone, city, outletCount: outlets, message })
      .catch((err) => console.error('INQUIRY EMAIL ERROR:', err.message));
    res.status(201).json({ success: true, inquiryId: result.rows[0].id, message: 'Thank you. We will contact you shortly.' });
  } catch (err) {
    console.error('INQUIRY CREATE ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/', authenticate, async (_req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, business_name, email, phone, city, outlet_count, message, status, created_at
      FROM sales_inquiries
      ORDER BY CASE status WHEN 'NEW' THEN 0 WHEN 'CONTACTED' THEN 1 WHEN 'QUALIFIED' THEN 2 ELSE 3 END,
               created_at DESC
      LIMIT 500
    `);
    res.json({ success: true, inquiries: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.patch('/:id/status', authenticate, async (req, res) => {
  const status = String(req.body?.status || '').toUpperCase();
  if (!INQUIRY_STATUSES.has(status)) return res.status(400).json({ success: false, message: 'Invalid enquiry status' });
  try {
    const result = await pool.query(
      'UPDATE sales_inquiries SET status = $1 WHERE id = $2 RETURNING id, status',
      [status, req.params.id]
    );
    if (!result.rowCount) return res.status(404).json({ success: false, message: 'Enquiry not found' });
    res.json({ success: true, inquiry: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
