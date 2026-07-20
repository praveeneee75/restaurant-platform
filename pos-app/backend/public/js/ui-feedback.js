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
  const shortcutRoutes = [
    ['F1', 'a[href*="mode=DINE_IN"]'], ['F2', 'a[href*="mode=PARCEL"]'],
    ['F3', 'a[href*="mode=PARTY"]'], ['F4', 'a[href="/billing.html"]'],
    ['F5', '[data-role-nav="invoices"]'], ['F6', '[data-role-nav="kds"]'],
    ['F8', '[data-role-nav="availability"]'],
    ['F9', '[data-role-nav="live-orders"]']
  ];
  if (nav) {
    shortcutRoutes.forEach(([key, selector]) => {
      const link = nav.querySelector(selector);
      if (link) link.dataset.posShortcut = key;
    });
    const notifications = nav.querySelector('[data-notification-center]');
    if (notifications) notifications.dataset.posShortcut = 'F10';
  }
  if (nav && !nav.querySelector('.zoom-help')) {
    const help = document.createElement('span');
    help.className = 'zoom-help';
    help.title = 'Use Ctrl and + to zoom in, Ctrl and - to zoom out, or Ctrl and 0 to reset';
    help.textContent = 'Zoom: Ctrl + / Ctrl − / Ctrl 0';
    nav.appendChild(help);
  }

  document.addEventListener('keydown', (event) => {
    if (!/^F(?:[1-9]|1[0-2])$/.test(event.key) || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const openModal = document.querySelector('.modal-backdrop:not([hidden])');
    if (openModal) return;
    const navigation = document.querySelector(`[data-pos-shortcut="${event.key}"]`);
    const action = document.querySelector(`[data-action-shortcut="${event.key}"]`);
    const target = navigation && !navigation.hidden ? navigation : action && !action.hidden && !action.disabled ? action : null;
    if (!target) return;
    event.preventDefault();
    target.click();
  });
}());
