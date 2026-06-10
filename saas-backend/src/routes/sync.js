const express = require('express');
const pool = require('../db/db');
const { publicError } = require('../config');

const router = express.Router();

function numeric(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function validDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

async function logSync(db, tenantId, restaurantCode, status, message) {
  await db.query(
    `INSERT INTO tenant_sync_logs (tenant_id, restaurant_code, sync_type, status, message)
     VALUES ($1, $2, 'DAILY_REPORT', $3, $4)`,
    [tenantId || null, restaurantCode || null, status, message || null]
  );
}

router.post('/daily-report', async (req, res) => {
  const { restaurantId, licenseKey, syncToken, reportDate, summary, itemSales } = req.body;

  if (!restaurantId || (!syncToken && !licenseKey) || !validDate(reportDate) || !summary) {
    return res.status(400).json({ success: false, message: 'restaurantId, sync token or license key, reportDate and summary are required' });
  }

  try {
    const tenantResult = await pool.query(
      `
      SELECT t.id AS tenant_id, t.restaurant_code, l.status, l.expires_at
      FROM tenants t
      JOIN licenses l ON l.tenant_id = t.id
      WHERE t.restaurant_code = $1
        AND (
          ($2::text IS NOT NULL AND l.sync_token = $2)
          OR ($3::text IS NOT NULL AND l.license_key = $3)
        )
      LIMIT 1
      `,
      [restaurantId, syncToken || null, licenseKey || null]
    );

    if (tenantResult.rowCount === 0) {
      return res.status(401).json({ success: false, message: 'Invalid sync credentials' });
    }

    const tenant = tenantResult.rows[0];
    if (tenant.status !== 'ACTIVE' || new Date(tenant.expires_at) < new Date()) {
      await logSync(pool, tenant.tenant_id, restaurantId, 'FAILED', 'License inactive or expired');
      return res.status(403).json({ success: false, message: 'License inactive or expired' });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
      `
      INSERT INTO tenant_daily_reports (
        tenant_id, report_date, gross_sales, net_sales, tax_amount, discount_amount,
        refunds_amount, orders_count, cash_total, card_total, upi_total, updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
      ON CONFLICT (tenant_id, report_date) DO UPDATE SET
        gross_sales = EXCLUDED.gross_sales,
        net_sales = EXCLUDED.net_sales,
        tax_amount = EXCLUDED.tax_amount,
        discount_amount = EXCLUDED.discount_amount,
        refunds_amount = EXCLUDED.refunds_amount,
        orders_count = EXCLUDED.orders_count,
        cash_total = EXCLUDED.cash_total,
        card_total = EXCLUDED.card_total,
        upi_total = EXCLUDED.upi_total,
        updated_at = NOW()
      `,
      [
        tenant.tenant_id,
        reportDate,
        numeric(summary.grossSales),
        numeric(summary.netSales),
        numeric(summary.taxAmount),
        numeric(summary.discountAmount),
        numeric(summary.refundsAmount),
        Math.max(0, Math.trunc(numeric(summary.ordersCount))),
        numeric(summary.cashTotal),
        numeric(summary.cardTotal),
        numeric(summary.upiTotal)
      ]
      );

      await client.query('DELETE FROM tenant_item_sales WHERE tenant_id = $1 AND report_date = $2', [tenant.tenant_id, reportDate]);
      for (const item of Array.isArray(itemSales) ? itemSales : []) {
        if (!item?.itemName) continue;
        await client.query(
          `INSERT INTO tenant_item_sales (tenant_id, report_date, item_name, quantity_sold, total_sales)
           VALUES ($1, $2, $3, $4, $5)`,
          [tenant.tenant_id, reportDate, String(item.itemName).slice(0, 200), numeric(item.quantitySold), numeric(item.totalSales)]
        );
      }

      await logSync(client, tenant.tenant_id, restaurantId, 'SUCCESS', `Daily report received for ${reportDate}`);
      await client.query('COMMIT');
      client.release();
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      client.release();
      throw err;
    }
    res.json({ success: true, message: 'Daily report synced' });
  } catch (err) {
    console.error('DAILY REPORT SYNC ERROR:', err.message);
    res.status(500).json({ success: false, message: publicError(err) });
  }
});

module.exports = router;
