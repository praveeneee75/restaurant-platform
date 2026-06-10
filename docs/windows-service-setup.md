# Windows Service Setup

This project can run the POS backend and print agent as normal console apps or as Windows services. Use services for production restaurant PCs where the POS should start automatically after Windows starts.

## Option A: NSSM

NSSM is usually the simplest production option.

1. Download NSSM from https://nssm.cc/download.
2. Extract it, for example to `C:\Tools\nssm`.
3. Open Command Prompt as Administrator.

Install POS backend:

```bat
C:\Tools\nssm\win64\nssm.exe install RestaurantPOS
```

In the NSSM window:

- Path: `C:\Program Files\nodejs\npm.cmd`
- Startup directory: `C:\RestaurantPOS\pos-app`
- Arguments: `run start`

Install Print Agent:

```bat
C:\Tools\nssm\win64\nssm.exe install RestaurantPrintAgent
```

In the NSSM window:

- Path: `C:\Program Files\nodejs\npm.cmd`
- Startup directory: `C:\RestaurantPOS\print-agent`
- Arguments: `run start`

Start services:

```bat
net start RestaurantPOS
net start RestaurantPrintAgent
```

Stop services:

```bat
net stop RestaurantPOS
net stop RestaurantPrintAgent
```

Uninstall services:

```bat
C:\Tools\nssm\win64\nssm.exe remove RestaurantPOS confirm
C:\Tools\nssm\win64\nssm.exe remove RestaurantPrintAgent confirm
```

## Option B: node-windows

Install the helper globally:

```bat
npm install -g node-windows
```

Create service install scripts only on the target machine, so local paths are correct. The service should run:

- POS backend: `node backend/server.js` from the `pos-app` folder.
- Print agent: `node src/index.js` from the `print-agent` folder.

## Health Checks

After starting services, verify:

- POS: `http://localhost:3000/health`
- Print Agent: `http://127.0.0.1:3100/health`

If a service does not start, check:

- Node.js is installed.
- `npm install` has been run in that app folder.
- `.env` exists and is configured from `.env.example`.
- The service account has permission to read/write POS `data` and `backups` folders.

