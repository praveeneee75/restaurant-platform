# White-label mobile app build guide

The mobile app source is in `mobile-app/`. It is a Capacitor shell that loads the
same POS/SaaS pages used by restaurant staff, with role shortcuts for owner,
captain, waiter, and cashier workflows.

## Premium module requirement

Enable the `MOBILE_APP` module for the restaurant in the SaaS Marketplace before
testing. The POS endpoint `/mobile-app/config?restaurantId=RESTOXXXX` blocks the
app when the module is not enabled.

## Required tools

Install these on the build PC:

- Node.js LTS
- Android Studio
- Android SDK Platform Tools
- JDK 17 or newer

Verify:

```powershell
java -version
adb version
node -v
npm -v
```

## Build debug APK

```powershell
cd C:\Users\prave\OneDrive\Desktop\Project\restaurant-platform\mobile-app
npm install
npx cap add android
npx cap sync android
cd android
.\gradlew assembleDebug
```

The debug APK will be created at:

```text
C:\Users\prave\OneDrive\Desktop\Project\restaurant-platform\mobile-app\android\app\build\outputs\apk\debug\app-debug.apk
```

## Test on Android device

1. Connect the phone and POS PC to the same Wi-Fi.
2. Allow Windows Firewall for the POS port, usually `3000`.
3. Install the APK:

```powershell
adb install -r C:\Users\prave\OneDrive\Desktop\Project\restaurant-platform\mobile-app\android\app\build\outputs\apk\debug\app-debug.apk
```

4. Open the app and enter:

- Restaurant ID: `RESTOXXXX`
- POS URL: `http://POS-PC-IP:3000`
- SaaS URL: your SaaS backend URL

5. Tap each role:

- Owner opens SaaS owner dashboard.
- Captain opens waiter ordering.
- Waiter opens waiter ordering.
- Cashier opens live POS.

## Notes

- The app supports local HTTP POS URLs for restaurant LAN usage.
- POS remains offline-capable after activation.
- Branding comes from POS settings and can be controlled per restaurant.
- Production release APK/AAB signing should use a private keystore that is not
  committed to Git.
