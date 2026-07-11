# Android Release Signing

K'Master mobile release builds can use either environment variables or a local
properties file.

## Recommended local setup

1. Create `mobile-app/android-signing.properties` from
   `mobile-app/android-signing.properties.example`.
2. Set `storeFile` to the full path of your keystore.
3. Fill `storePassword`, `keyAlias`, and `keyPassword`.
4. Keep the properties file and keystore private. They are ignored by Git.

## Supported environment variables

```text
KMASTER_ANDROID_KEYSTORE
KMASTER_ANDROID_STORE_PASSWORD
KMASTER_ANDROID_KEY_ALIAS
KMASTER_ANDROID_KEY_PASSWORD
```

## Build command

```text
npm.cmd --prefix mobile-app run build:android:release
```

## Current local keystore

The current machine generated a release keystore at:

`mobile-app/android/app/kmaster-release.keystore`

Back it up before publishing any APK built with it. Future updates to the same
Android app must be signed with the same keystore.
