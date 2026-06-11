# Project Handoff

Fixed location for ongoing implementation notes:

```text
C:\Users\prave\OneDrive\Desktop\Project\restaurant-platform\docs\project-handoff.md
```

Update this file whenever project modules, deployment steps, startup scripts, or operational assumptions change.

## 2026-06-11

### One-Time Commercial Readiness Execution

- Cancelled the scheduled automation and executed the requested plan immediately as a one-time implementation pass.
- Added SaaS organization, branch group, organization restaurant mapping, organization user, and support note migrations.
- Added SaaS `/organizations/*` APIs for organization creation, branch groups, restaurant assignment, consolidated reports, and central-menu readiness.
- Added SaaS support diagnostics endpoints under `/monitoring/diagnostics` and `/monitoring/support-notes`.
- Added SaaS admin dashboard sections for Organizations / Multi-Branch and Support Diagnostics.
- Added owner mobile dashboard page at `saas-backend/public/owner-mobile.html`.
- Added local POS schema support for electronic journal, fraud alerts, customer credit accounts, credit transactions, payment providers, notification templates/logs, and retention settings.
- Added POS routes for AI-style analytics, advanced reports, electronic journal, fraud alerts, customer credit, payment preparation, notifications, privacy helpers, diagnostics, disaster recovery, demo reset, and online ordering.
- Added POS Admin "Commercial Tools" section for analytics, advanced reports, journal, fraud alerts, credit aging, diagnostics, disaster check, and demo reset.
- Added public online ordering page at `pos-app/backend/public/online-order.html`.
- Added electronic journal hooks for KOT and bill print snapshots.
- Added basic fraud alert hooks for refunds, voids, and large order settlement patterns.
- Added local notification log queueing for order confirmation placeholders.
- Added docs for commercial readiness and disaster recovery.
- Added root `npm test` smoke check for syntax, required route registration, schema presence, and support page/doc presence.

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

## 2026-06-11

### New Module Expansion

- Added SaaS owner account tables, restaurant-owner assignment mapping, owner login, owner dashboard, owner password change/reset, and SaaS admin owner assignment controls.
- Added SaaS subscription tables for plans, subscriptions, payments, seeded TRIAL/MONTHLY/QUARTERLY/YEARLY plans, assign/renew, suspend/reactivate, expiry warning, days remaining, and SaaS admin subscription display.
- Added SaaS/POS remote monitoring with POS heartbeat, POS version, backup status, printer queue status, license status, last heartbeat, and online/offline dashboard.
- Added QR ordering page `qr-menu.html` and QR menu/order APIs. QR orders create normal POS orders, set `order_source = QR`, occupy the table, and create KOT print jobs through the existing KOT helper.
- Added reservation tables and APIs with BOOKED/ARRIVED/CANCELLED/COMPLETED status, table reservation display in POS bootstrap, and manager override protection for reserved table ordering.
- Added customer display page `customer-display.html` with read-only order items, subtotal, discount, tax, grand total, and payment-success status.
- Added expense categories, seeded Rent/Salary/Electricity/Gas/Internet/Other, enhanced expense entry, profit dashboard, and CSV export for OWNER/MANAGER_2.
- Added POS admin sections for QR links, reservations, expense entry, and profit dashboard.
- Verified changed JavaScript syntax and checked duplicate route registrations for the newly added APIs.
- Finalized the new modules with targeted hardening only:
  - Reserved-table ordering now requires an actual OWNER/MANAGER_2 role; clients cannot bypass it by sending a plain override flag.
  - SaaS subscription suspend/reactivate now updates only the latest subscription record so renewal history is preserved.
  - SaaS subscription summary query now groups by `t.created_at` so PostgreSQL can order the dashboard rows correctly.
  - SaaS owner, subscription, and monitoring POST routes now return validation JSON if a request body is missing instead of throwing raw Express errors.
  - Expense entry is explicitly limited to OWNER/MANAGER_2.
- Verified SaaS PostgreSQL migration completed and seeded TRIAL, MONTHLY, QUARTERLY, and YEARLY subscription plans.
- Verified SaaS protected API smoke flow with a short-lived DEV token: owner create, owner assignment, owner login/dashboard scoping, subscription assignment visibility, and POS heartbeat visibility.
- Verified POS smoke flow on RESTO87631: QR menu load, QR order creation with `order_source = QR`, table occupancy, customer display, KOT print job creation, reservation display as RESERVED, waiter block on reserved table, expense save, profit dashboard, and profit CSV export.
- Verified existing POS integration lightly: order save, KOT submit, bill settlement, invoice generation, table release, and print job visibility.
- Manual note: `ADMIN_EMAIL` and `ADMIN_PASSWORD` were not configured in the local SaaS `.env`, so real DEV admin password login was not verified in this pass.

### White-Label SaaS and Reseller/Partner Management

- Added SaaS partner tables for partners, partner users, restaurant mappings, branding, partner subscriptions, commissions, payouts, and SaaS audit logs.
- Added `/partners/*` APIs for partner login, create/list/update, partner users, branding, partner restaurant creation, partner-scoped restaurants, partner dashboard, commissions, payout marking, and partner-scoped subscription assignment.
- Added SaaS-side roles in the partner module: DEV_ADMIN, PARTNER_ADMIN, PARTNER_SUPPORT, ORG_OWNER, and RESTAURANT_OWNER are recognized for access modeling, with partner APIs enforcing DEV/admin or partner-token scoping.
- Partner admin can create restaurants under their partner; the route creates the tenant, license, optional subscription, partner mapping, and commission records without changing POS activation or license validation.
- Partner support can view dashboard/diagnostics but is blocked from subscription changes and payout marking.
- Added public branding lookup by custom domain and made SaaS admin/owner/partner login pages display partner brand/support details when a domain matches configured branding.
- Added SaaS admin dashboard sections for Partners, Partner Users, Partner Branding, Partner Restaurants, Partner Dashboard, Partner Commissions, and Partner Payouts.
- Added partner-facing pages `partner-login.html` and `partner-dashboard.html`.
- Verified SaaS migration, syntax checks, partner create, partner admin login, restaurant creation under partner, license validation, partner dashboard scoping, DEV admin all-restaurant visibility, commission calculation, payout marking, support-role subscription blocking, and public branding lookup.

### Marketplace / Add-on Module System

- Added SaaS marketplace tables for `modules`, `tenant_modules`, `module_pricing`, `module_usage_logs`, and `partner_allowed_modules`.
- Seeded default add-on modules: INVENTORY, KDS, LOYALTY, QR_ORDERING, RESERVATIONS, CLOUD_REPORTING, MULTI_BRANCH, and WHITE_LABEL.
- Existing tenants are seeded with all default modules enabled so existing licensed restaurants keep working after migration.
- Added SaaS APIs:
  - `GET /modules/list`
  - `POST /modules/create`
  - `POST /modules/update`
  - `GET /modules/pricing`
  - `POST /modules/usage`
  - `GET /tenants/modules`
  - `POST /tenants/modules/enable`
  - `POST /tenants/modules/disable`
- SaaS license validation now returns `enabledModules` for POS activation and license refresh.
- POS activation and daily license refresh cache enabled modules in local SQLite `system_config.enabled_modules`.
- POS backend blocks disabled add-on APIs with `Module not enabled for this restaurant` for inventory, purchase ordering, KDS, loyalty/customer CRM, QR ordering, reservations, and cloud reporting.
- POS admin bootstrap and live POS bootstrap expose enabled modules to frontend code.
- POS admin hides disabled inventory, reservation, QR, KDS, and customer UI entry points.
- Usage tracking is best-effort and offline-safe for QR orders, KDS status updates, cloud report uploads, and customer creation.
- SaaS admin dashboard now includes Marketplace controls for module catalog/pricing and per-restaurant enable/disable/trials, with monthly add-on charges included in subscription summary.
- Partner tokens can use tenant module APIs only within their restaurant scope; PARTNER_SUPPORT is blocked from module changes.
- Verified SaaS migration, syntax checks, module create, pricing list, tenant enable/disable, license response entitlements, usage logging, monthly module charge calculation, POS disabled-module backend block, and POS enabled-module API access.
- Known test note: one SaaS smoke script printed all expected success fields but the Node process ended with a Windows async assertion after output; the APIs themselves returned the expected data.
