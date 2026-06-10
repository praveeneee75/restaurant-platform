-- Restaurant Settings & Configuration Center
-- Safe to run repeatedly against each restaurant SQLite database.
-- Existing databases receive updated_at through the Node migration helper.

CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO system_config (key, value) VALUES
('restaurant_display_name', 'Restaurant POS'),
('legal_name', ''),
('gstin', ''),
('address_line_1', ''),
('address_line_2', ''),
('city', ''),
('state', ''),
('country', 'India'),
('phone', ''),
('email', ''),
('currency', 'INR'),
('timezone', 'Asia/Kolkata'),
('logo_path', ''),
('default_order_type', 'DINE_IN'),
('allow_non_invoice_orders', '1'),
('allow_discount', '1'),
('allow_manual_price_override', '0'),
('allow_refund', '1'),
('allow_order_cancel', '1'),
('require_manager_pin_for_discount', '0'),
('require_manager_pin_for_refund', '1'),
('require_manager_pin_for_void', '1'),
('invoice_prefix', 'INV'),
('invoice_reset_frequency', 'DAILY'),
('show_tax_on_bill', '1'),
('show_qr_on_bill', '0'),
('upi_id', ''),
('service_charge_enabled', '0'),
('service_charge_percent', '0'),
('round_off_enabled', '1'),
('auto_print_kot', '1'),
('print_kot_on_save', '0'),
('print_kot_on_submit', '1'),
('allow_kot_reprint', '1'),
('kot_header_text', ''),
('kot_footer_text', ''),
('backup_enabled', '0'),
('backup_folder_path', ''),
('onedrive_folder_path', ''),
('backup_interval_minutes', '60'),
('last_backup_at', ''),
('last_sync_at', '');
