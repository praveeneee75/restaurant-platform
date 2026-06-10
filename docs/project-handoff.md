# Project Handoff

Fixed location for ongoing implementation notes:

```text
C:\Users\prave\OneDrive\Desktop\Project\restaurant-platform\docs\project-handoff.md
```

Update this file whenever project modules, deployment steps, startup scripts, or operational assumptions change.

## 2026-06-09

### Windows Installer & Startup Automation

- Added POS, print-agent, and SaaS npm start/dev scripts.
- Added Windows startup BAT files and browser shortcut BAT files.
- Added POS `/health`.
- Added print-agent `/health`.
- Added installer and Windows service documentation.
- Added installer staging placeholders under `dist/restaurant-pos`.

### SaaS Cloud Deployment Preparation

- Added production config module for SaaS environment variables.
- Added CORS configuration through `CORS_ORIGIN`.
- Added SaaS `/health`.
- Added idempotent PostgreSQL migration script.
- Added `npm run migrate`.
- Updated POS `.env.example` to use cloud `SAAS_URL` placeholder.
- Added cloud deployment guide for Render, Railway, DigitalOcean App Platform, and Azure App Service.
- Verified local production-mode SaaS health, login, tenant creation, and license validation.

### Auto Update System

- Added SaaS release management tables and APIs.
- Added POS /version, /updates/check, /updates/download, and /updates/logs.
- Added SQLite update_logs table through the migration/schema runner.
- Added SaaS admin release management UI.
- Added POS admin update check/download UI.
- Update downloads stage files under pos-app/updates/staging and do not overwrite app files.
- Verified release creation, activation, update check, active-order blocking, staging download, and offline fallback.

### Audit & Compliance Dashboard

- Added reusable POS audit helper with sensitive value masking.
- Extended restaurant SQLite audit_logs with restaurant, user, role, and IP metadata.
- Added compliance_events through schema and migration runner.
- Added POS audit APIs for logs, compliance summary, and CSV export.
- Added OWNER/MANAGER_2 audit viewing and OWNER-only export checks.
- Added audit/compliance logging for failed login, item create/update/delete, price change, order cancel, manual discount, refund, settlement, backup restore, and expired license detection.
- Added POS admin Audit section with filters, compliance cards, log table, event table, and CSV export action.
- Verified audit CRUD/payment/refund/cancel flows and role blocking on RESTO87631 test data.

### Restaurant Settings & Configuration Center

- Centralized local POS settings in restaurant SQLite `system_config`.
- Added default settings seed for restaurant profile, POS behaviour, billing, KOT, and backup configuration.
- Added migration runner entry `013_restaurant_settings_center` and SQL seed script `011_restaurant_settings_center.sql`.
- Added POS APIs: `GET /settings`, `POST /settings/update`, and `POST /settings/reset-defaults`.
- Restricted settings updates/reset to OWNER and MANAGER_2.
- Added settings validation for currency, timezone, invoice prefix, booleans, percentages, backup interval, and enabled-backup folder path.
- Integrated invoice prefix, service charge, round-off, restaurant bill profile, KOT header/footer, and POS currency display.
- Added POS Admin Settings section with Restaurant Profile, POS Behaviour, Billing, Kitchen / KOT, and Backup groups.
- Verified settings load/save, validation rejection, unauthorized update blocking, KOT payload settings, bill payload settings, and service charge application.

### Staff Attendance, Shift Management & Cash Register

- Added restaurant SQLite tables for `staff_attendance`, `cash_register_sessions`, and `cash_drawer_movements`.
- Added `payments.cash_register_session_id` so cash payments can attach to the active register.
- Added migration runner entry `014_staff_attendance_cash_register` and SQL script `012_staff_attendance_cash_register.sql`.
- Added settings defaults for clock-in enforcement, open-register cash payments, cashier register close, and discrepancy threshold.
- Added attendance APIs for clock in, clock out, current status, and reports.
- Added cash register APIs for open, close, current session, cash movements, and reports.
- Integrated cash settlement with active register sessions and expected cash calculation.
- Added live POS Shift & Cash controls and Admin Staff & Cash reports.
- Verified clock-in duplicate prevention, clock-out, register open duplicate prevention, cash movement, cash payment attachment, discrepancy close, reports, and unauthorized report blocking.

### Purchase Ordering & Supplier Billing

- Extended supplier, purchase order, purchase item, and stock movement schema for GSTIN, PO numbers, taxes, received timestamps, and PO-linked stock movements.
- Added `supplier_payments` table for supplier bill payments.
- Added migration runner entry `015_purchase_ordering_supplier_billing` and SQL script `013_purchase_ordering_supplier_billing.sql`.
- Added purchase order APIs for create, list, detail, update, cancel, receive, and purchase reports.
- Added supplier payment APIs for add, list, and outstanding summary.
- Receiving a purchase order increases ingredient stock and writes PURCHASE stock movements linked to the PO.
- Added Admin purchase UI fields for supplier GSTIN, PO tax, PO receive/cancel actions, supplier payments, outstanding balances, and purchase reports.
- Verified supplier creation, ingredient creation, PO creation, receiving, stock increase, payment add, outstanding summary, reports, unauthorized role blocking, and audit logging.

### Role-Based Access Control & Permission Matrix

- Added restaurant SQLite RBAC tables: `roles`, `permissions`, and `role_permissions`.
- Added seeded default roles: OWNER, MANAGER_2, MANAGER_1, CASHIER, WAITER, and KITCHEN.
- Added seeded permission codes across ADMIN, ORDERS, BILLING, REPORTS, INVENTORY, KITCHEN, and SYSTEM modules.
- Replaced the old static permission helper with database-backed `hasPermission(db, role, permissionCode)`.
- Added migration runner entry `016_role_based_access_control` and SQL script `014_role_based_access_control.sql`.
- Added POS APIs: `GET /permissions/bootstrap` and `POST /permissions/update`.
- Added Admin Permission Matrix section with role x permission checkboxes.
- Added front-end guards to hide sensitive admin sections/actions based on current role permissions.
- Enforced permission checks on settings, reports, refunds, order creation, bill settlement, order cancel, inventory management, purchase orders, backup restore, audit view/export, and related report paths.
- Verified OWNER full matrix, WAITER blocked from reports/settings/refunds, CASHIER settlement allowed but refund blocked, MANAGER_2 refund/report access, live permission toggle behavior, and backend unauthorized blocking.

### Multi-Device Waiter Ordering & Local Network Sync

- Added `/network/info` for hostname, local IP addresses, POS/waiter URL examples, port, and active restaurant ID.
- Added restaurant SQLite `order_locks` and `device_sessions` tables plus `orders.updated_at`.
- Added migration runner entry `017_multi_device_waiter_sync` and SQL script `015_multi_device_waiter_sync.sql`.
- Added mobile waiter page `waiter.html`, `waiter.js`, and `waiter.css`.
- Added lock APIs for lock, renew, unlock, and force unlock.
- Added device session heartbeat, device list, and force logout APIs.
- Added Admin Devices section for active waiter device monitoring.
- Order save now verifies lock ownership when a lock is supplied, blocks settled order edits, and rejects stale updates by `updated_at`.
- Waiter UI polls every 5 seconds and renews locks every 30 seconds.
- Added local setup guide `docs/mobile-waiter-setup.md`.
- Verified network info, table lock conflict, force unlock, lock expiry, waiter save, stale update rejection, KOT print job creation, device monitor listing, and settled order edit blocking.

### Cloud Reporting Sync for Owners

- Added restaurant SQLite `cloud_sync_queue` and `cloud_sync_status` tables for offline-safe reporting sync.
- Added migration runner entry `018_cloud_reporting_sync` and SQL script `016_cloud_reporting_sync.sql`.
- Added local POS settings for cloud sync token, enablement, last sync status, and previous-seven-days sync tracking.
- POS activation and daily license validation now store the SaaS-provided `syncToken` locally in `system_config`.
- Added POS daily summary builder that sends only aggregated sales, tax, discount, refund, payment mode, order count, and item sales data; it does not send customer PII, raw notes, PINs, hashes, or full SQLite databases.
- Added POS APIs: `POST /cloud-sync/run`, `GET /cloud-sync/status`, and `GET /cloud-sync/queue`.
- Added POS background scheduler that retries queued reports every 15 minutes, syncs today's report, and syncs the previous 7 days once per day.
- Added SaaS license `sync_token`, reporting tables `tenant_daily_reports`, `tenant_item_sales`, and `tenant_sync_logs`.
- Added SaaS receive endpoint `POST /sync/daily-report`, validating restaurant code plus sync token or license key before upserting summary data.
- Added SaaS owner/admin report APIs: `GET /owner/reports/summary`, `GET /owner/reports/items`, `GET /owner/reports/sync-status`, and `POST /owner/reports/request-sync`.
- Updated SaaS admin dashboard with owner cloud report cards, restaurant selector, date range, payment summary, top selling items, last sync status, and request-sync action.
- Verified POS syntax, SaaS route syntax, and offline POS sync behavior with SaaS unreachable: POS health stayed OK, sync failed gracefully, and queue/status recorded the failure.
- Known limitation: SaaS Request Sync records an owner request in `tenant_sync_logs`; POS does not yet poll SaaS for request-sync commands.
