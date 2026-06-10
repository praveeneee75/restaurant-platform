-- Preserve customer-facing combo quantity when combo components are split into kitchen-routed order rows.

ALTER TABLE order_items ADD COLUMN combo_quantity INTEGER;
