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

  const restaurantId = localStorage.getItem('restaurantId');
  if (restaurantId && window.posDesktop?.startPrintWorker) window.posDesktop.startPrintWorker(restaurantId).catch(() => {});

  const nav = document.querySelector('.app-home-nav');
  if (nav && !nav.querySelector('.zoom-help')) {
    const help = document.createElement('span');
    help.className = 'zoom-help';
    help.title = 'Use Ctrl and + to zoom in, Ctrl and - to zoom out, or Ctrl and 0 to reset';
    help.textContent = 'Zoom: Ctrl + / Ctrl − / Ctrl 0';
    nav.appendChild(help);
  }
}());
