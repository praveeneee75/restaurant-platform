const express = require('express');
const pool = require('../db/db');
const { requireOwner, requireOwnedTenant } = require('../middleware/ownerScope');
const { publicError } = require('../config');

const router = express.Router();

router.use(requireOwner, requireOwnedTenant);

function dateRange(query) {
  const today = new Date().toISOString().slice(0, 10);
  const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.fromDate || '')) ? query.fromDate : today;
  const toDate = /^\d{4}-\d{2}-\d{2}$/.test(String(query.toDate || '')) ? query.toDate : fromDate;
  return { fromDate, toDate };
}

router.get('/summary', async (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  try {
    const tenant = req.tenant;
    const { fromDate, toDate } = dateRange(req.query);
    const rows = await pool.query(
      `
      SELECT report_date, gross_sales, net_sales, tax_amount, discount_amount,
             refunds_amount, orders_count, cash_total, card_total, upi_total, updated_at
      FROM tenant_daily_reports
      WHERE tenant_id = $1 AND report_date BETWEEN $2 AND $3
      ORDER BY report_date DESC
      `,
      [tenant.id, fromDate, toDate]
    );
    const totals = rows.rows.reduce((sum, row) => ({
      grossSales: sum.grossSales + Number(row.gross_sales || 0),
      netSales: sum.netSales + Number(row.net_sales || 0),
      taxAmount: sum.taxAmount + Number(row.tax_amount || 0),
      discountAmount: sum.discountAmount + Number(row.discount_amount || 0),
      refundsAmount: sum.refundsAmount + Number(row.refunds_amount || 0),
      ordersCount: sum.ordersCount + Number(row.orders_count || 0),
      cashTotal: sum.cashTotal + Number(row.cash_total || 0),
      cardTotal: sum.cardTotal + Number(row.card_total || 0),
      upiTotal: sum.upiTotal + Number(row.upi_total || 0)
    }), {
      grossSales: 0,
      netSales: 0,
      taxAmount: 0,
      discountAmount: 0,
      refundsAmount: 0,
      ordersCount: 0,
      cashTotal: 0,
      cardTotal: 0,
      upiTotal: 0
    });
    res.json({ success: true, tenant, fromDate, toDate, totals, reports: rows.rows });
  } catch (err) {
    console.error('OWNER SUMMARY ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/items', async (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  try {
    const tenant = req.tenant;
    const { fromDate, toDate } = dateRange(req.query);
    const result = await pool.query(
      `
      SELECT item_name, SUM(quantity_sold) AS quantity_sold, SUM(total_sales) AS total_sales
      FROM tenant_item_sales
      WHERE tenant_id = $1 AND report_date BETWEEN $2 AND $3
      GROUP BY item_name
      ORDER BY total_sales DESC
      LIMIT 50
      `,
      [tenant.id, fromDate, toDate]
    );
    res.json({ success: true, items: result.rows });
  } catch (err) {
    console.error('OWNER ITEM REPORT ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.get('/sync-status', async (req, res) => {
  const { restaurantId } = req.query;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  try {
    const tenant = req.tenant;
    const result = await pool.query(
      `SELECT sync_type, status, message, created_at
       FROM tenant_sync_logs
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 20`,
      [tenant.id]
    );
    res.json({ success: true, status: result.rows[0] || null, logs: result.rows });
  } catch (err) {
    console.error('OWNER SYNC STATUS ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

router.post('/request-sync', async (req, res) => {
  const { restaurantId } = req.body;
  if (!restaurantId) return res.status(400).json({ success: false, message: 'restaurantId required' });

  try {
    const tenant = req.tenant;
    await pool.query(
      `INSERT INTO tenant_remote_commands (tenant_id, restaurant_code, command_type, payload, status, requested_by, expires_at)
       VALUES ($1, $2, 'REQUEST_SYNC', '{}'::jsonb, 'PENDING', $3, NOW() + INTERVAL '24 hours')`,
      [tenant.id, tenant.restaurant_code, req.user.id]
    );
    res.json({ success: true, message: 'Sync command queued. POS will execute and acknowledge it when online.' });
  } catch (err) {
    console.error('OWNER REQUEST SYNC ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
