# Commercial Readiness Checklist

This pass is additive. Existing activation, login, order, billing, print, backup, inventory, RBAC, and reporting flows remain the source of truth.

## New SaaS Capabilities

- Organizations and branch groups are available through `/organizations/*`.
- Restaurants can be assigned to organizations for consolidated SaaS reporting.
- Owner mobile dashboard is available at `/owner-mobile.html`.
- Support diagnostics are available through `/monitoring/diagnostics` and support notes through `/monitoring/support-notes`.

## New POS Capabilities

- AI-style analytics summary: `/analytics/dashboard`.
- Advanced reports: `/reports/advanced` and `/reports/advanced/export`.
- Electronic journal search/export: `/journal/search` and `/journal/export`.
- Fraud alert review and threshold settings: `/fraud/alerts` and `/fraud/settings`.
- Customer credit accounts and credit payments: `/credit/*`.
- Payment gateway preparation: `/payments/providers`, `/payments/intent`, `/payments/transaction-status`.
- Notification placeholders: `/notifications/templates` and `/notifications/send-placeholder`.
- Privacy export/anonymize helpers: `/privacy/customer-export` and `/privacy/customer-anonymize`.
- Diagnostics and disaster checks: `/diagnostics`, `/disaster/check`, `/disaster/restore-latest-backup`.
- Demo data reset for demos: `/demo/reset`.
- Public online ordering page: `/online-order.html`.

## Verification

Run:

```text
npm test
```

The smoke test checks JavaScript syntax, required route registration, key schema additions, and required support pages/docs.

## Known Limitations

- Payment gateway routes are preparation-only and do not call live Stripe/Razorpay APIs.
- Notification routes create local placeholder logs only; SMS, email, and WhatsApp providers are not connected.
- Disaster restore uses the existing local backup service and may still require POS restart after replacing the SQLite file.
- Central menu management remains a SaaS placeholder because menu data still lives in each restaurant's local POS database.
