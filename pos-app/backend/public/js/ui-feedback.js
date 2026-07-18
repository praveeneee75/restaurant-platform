(function initialiseUiFeedback() {
  let timer;

  function toastElement() {
    let toast = document.getElementById('appFeedbackToast');
    if (toast) return toast;
    toast = document.createElement('div');
    toast.id = 'appFeedbackToast';
    toast.className = 'pos-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.hidden = true;
    document.body.appendChild(toast);
    return toast;
  }

  function showAppMessage(message) {
    const toast = toastElement();
    toast.textContent = String(message || '');
    toast.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(() => { toast.hidden = true; }, 5200);
  }

  // Electron's native blocking alert can occasionally return without restoring
  // editable focus to Chromium. Keep messages inside the renderer instead.
  window.appAlert = showAppMessage;
  window.alert = showAppMessage;
}());
