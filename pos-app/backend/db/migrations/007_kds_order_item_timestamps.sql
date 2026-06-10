-- Kitchen Display System item lifecycle timestamps.

ALTER TABLE order_items ADD COLUMN started_at DATETIME;
ALTER TABLE order_items ADD COLUMN ready_at DATETIME;
ALTER TABLE order_items ADD COLUMN served_at DATETIME;
