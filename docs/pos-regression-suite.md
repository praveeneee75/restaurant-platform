# POS Regression Suite

The release gate for desktop, Android, and iOS POS screens. Android and iOS load the shared `pos-live.html` and `waiter.html` screens, so these cases must pass against the shared POS backend before any package is published.

## Release Gate

| ID | Scenario | Expected result | Previous failure | Automated check |
|---|---|---|---|---|
| POS-001 | Activate with valid restaurant code and license | Activation succeeds and POS login opens | Wrong native SQLite ABI caused generic activation failure | Package native-module check |
| POS-002 | Login after activation | Login succeeds without activation error | Packaged build and local Node ABI were mixed | `npm run test:pos` |
| POS-003 | Select table A, add items, select table B | B shows only B's saved order or a blank new order | A's cart was reused/moved to B | UI table-isolation check plus API smoke |
| POS-004 | Switch rapidly between three tables | Final selected table owns the visible cart | Delayed responses could repaint stale state | Active-table request guard |
| POS-005 | Change quantity from menu tile | Inline `- quantity +` controls update only the selected table | Controls disappeared from the item surface | UI source check |
| POS-006 | Edit an unsent item | Selecting the order line opens editing | Separate edit action was unclear/missing | UI source check |
| POS-007 | Submit KOT without changes | Button is disabled | Duplicate KOT risk | POS smoke/manual |
| POS-008 | Add item after KOT | Button enables and sends only the new suborder | KOT flow regressed during edit changes | POS smoke/manual |
| POS-009 | Move Table | Only Move Table transfers an order | Normal table selection transferred the order | UI source check |
| POS-010 | Android and iOS cashier/waiter screens | Same table isolation and editing behavior as desktop | Platform behavior drift | Shared-page check |
| POS-011 | Build final package | Installer contains Electron-compatible native modules and post-build restores Node modules | Repeated ABI mismatch releases | Build hook and artifact check |
| POS-012 | Production release | Manifest, file size, and checksum match the built artifact | Partial or wrong installer was published | Deployment verification |

A release is blocked if any case fails. The installer must be built only after the source checks and `npm run test:pos` pass; production promotion happens only after the remote checksum matches the local artifact.
