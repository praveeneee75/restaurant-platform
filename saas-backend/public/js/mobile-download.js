function detectedPlatform() {
  const requested = new URLSearchParams(location.search).get("platform");
  if (requested) return requested;
  if (/android/i.test(navigator.userAgent)) return "android";
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";
  return "desktop";
}

async function loadDownloads() {
  try {
    const response = await fetch("/mobile/download-info", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "Release information unavailable");
    const platform = detectedPlatform();
    androidDownloadLink.hidden = !data.android.available;
    if (data.android.available) androidDownloadLink.href = data.android.downloadUrl;
    iosDownloadLink.hidden = !data.ios.available;
    if (data.ios.available) iosDownloadLink.href = data.ios.downloadUrl;

    if (platform === "android") {
      mobilePlatformTitle.textContent = "Android app";
      mobilePlatformMessage.textContent = data.android.available
        ? `K'Master POS Mobile ${data.android.version || ""} is ready to download.`
        : "The Android app has not been published yet.";
      mobileInstallHelp.textContent = data.android.available
        ? "After downloading, open the APK and approve installation from this trusted source when Android asks."
        : "";
      iosDownloadLink.hidden = true;
    } else if (platform === "ios") {
      mobilePlatformTitle.textContent = "iPhone and iPad";
      mobilePlatformMessage.textContent = data.ios.available
        ? "Continue to the official App Store or TestFlight release."
        : "The iPhone and iPad release is awaiting App Store or TestFlight publishing.";
      mobileInstallHelp.textContent = "For security, iOS apps are distributed through Apple rather than as an unsigned file.";
      androidDownloadLink.hidden = true;
    } else {
      mobilePlatformTitle.textContent = "Mobile downloads";
      mobilePlatformMessage.textContent = "Open this page on the phone or tablet that will use K'Master POS.";
      mobileInstallHelp.textContent = data.ios.available
        ? "Android and iPhone/iPad distribution are available."
        : "Android is available. The iPhone/iPad release is awaiting Apple publishing.";
    }
  } catch (err) {
    mobilePlatformMessage.textContent = err.message;
  }
}

loadDownloads();
