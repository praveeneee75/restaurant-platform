# Mobile Waiter Setup

Mobile waiter ordering works over the restaurant local network. Internet is not required after POS activation.

## Requirements

- POS backend must be running on the restaurant POS PC.
- Waiter phones and the POS PC must be connected to the same Wi-Fi/LAN.
- The print agent continues to run on the POS PC.
- KOT, KDS, billing, backup, and reports continue to use the local POS SQLite database.

## Find the POS URL

Open this endpoint on the POS PC:

```text
http://localhost:3000/network/info
```

Use one of the returned waiter URLs on waiter devices, for example:

```text
http://192.168.1.10:3000/waiter.html
```

## Waiter Login

1. Activate POS on the POS PC.
2. Create waiter users in POS Admin.
3. Give the role `orders.create` permission in Admin > Permissions.
4. Open `/login.html` or `/waiter.html` from the waiter phone.
5. Login with username and PIN.

## Table Locking

- Selecting a table locks it for 2 minutes.
- The waiter page renews the lock while the page is open.
- Another waiter sees that the table is already being edited.
- OWNER or MANAGER_2 can force unlock from Admin or the lock API.

## Notes

- Use the POS PC local IP address, not the SaaS cloud URL.
- If phones cannot open the page, check Windows Firewall and Wi-Fi isolation settings.
- WebSocket sync is not required yet; the waiter UI polls every 5 seconds.
