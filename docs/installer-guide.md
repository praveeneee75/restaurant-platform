# Installer Guide

Use this guide when preparing or installing the local restaurant POS package on a Windows PC.

## 1. Install Node.js

Install the current LTS version of Node.js for Windows from https://nodejs.org.

Verify in Command Prompt:

```bat
node -v
npm -v
```

## 2. Install POS Package

Copy the installer package to a stable folder, for example:

```text
C:\RestaurantPOS
```

The production package should contain:

```text
pos-app\
print-agent\
scripts\
docs\
```

Do not include customer database files, backups, real `.env` files, or `node_modules` in the installer source package.

## 3. Install Dependencies

Run once:

```bat
cd C:\RestaurantPOS\pos-app
npm install

cd C:\RestaurantPOS\print-agent
npm install
```

For local SaaS development only:

```bat
cd C:\RestaurantPOS\saas-backend
npm install
```

## 4. Configure Environment

Copy each `.env.example` to `.env` and edit values:

```bat
copy pos-app\.env.example pos-app\.env
copy print-agent\.env.example print-agent\.env
```

For local SaaS development:

```bat
copy saas-backend\.env.example saas-backend\.env
```

Never put real secrets in `.env.example`.

## 5. Run Activation

Start POS:

```bat
scripts\start-pos.bat
```

Open:

```text
http://localhost:3000/activate.html
```

Enter the license and complete activation.

## 6. Configure Printer

Start the print agent:

```bat
scripts\start-print-agent.bat
```

Confirm the printer connection and kitchen printer settings. Then submit a test KOT from POS.

## 7. Configure OneDrive Backup

Open POS Admin:

```text
http://localhost:3000/admin.html
```

Set:

- Backup enabled
- Backup interval
- Local backup folder
- OneDrive synced folder path

Run a manual backup and confirm the file appears in the backup list.

## 8. Start POS

For local startup:

```bat
scripts\start-all-local.bat
```

For local SaaS development too:

```bat
set START_SAAS_LOCAL=1
scripts\start-all-local.bat
```

## 9. Test

Verify:

- POS login opens.
- Login works.
- POS Live opens.
- Admin opens.
- Create or open a table order.
- Submit KOT.
- KOT print job is processed.
- Settle bill.
- Run backup.

Health URLs:

- POS: `http://localhost:3000/health`
- Print Agent: `http://127.0.0.1:3100/health`

