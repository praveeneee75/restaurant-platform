(function initialiseUiFeedback() {
  let timer;

  function parsePosDateTime(value) {
    if (value instanceof Date || typeof value === 'number') return new Date(value);
    const source = String(value || '').trim();
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(source)
      ? `${source.replace(' ', 'T')}Z`
      : source;
    return new Date(normalized);
  }

  window.parsePosDateTime = parsePosDateTime;
  window.formatPosDateTime = function formatPosDateTime(value, options) {
    const date = parsePosDateTime(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleString(undefined, options);
  };
  window.formatPosTime = function formatPosTime(value, options = {}) {
    const date = parsePosDateTime(value);
    return Number.isNaN(date.getTime()) ? String(value || '') : date.toLocaleTimeString(undefined, options);
  };
  window.localIsoDate = function localIsoDate(value = new Date()) {
    const date = value instanceof Date ? value : parsePosDateTime(value);
    if (Number.isNaN(date.getTime())) return '';
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };

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

  window.appConfirm = function appConfirm(message, options = {}) {
    return new Promise((resolve) => {
      const previousFocus = document.activeElement;
      const backdrop = document.createElement('div');
      backdrop.className = 'app-confirm-backdrop';
      backdrop.innerHTML = `<section class="app-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="appConfirmMessage"><p id="appConfirmMessage"></p><div><button type="button" class="secondary-btn" data-confirm-cancel>Cancel</button><button type="button" class="danger-btn" data-confirm-accept>${options.acceptLabel || 'Delete'}</button></div></section>`;
      backdrop.querySelector('#appConfirmMessage').textContent = String(message || 'Are you sure?');
      const finish = (answer) => {
        document.removeEventListener('keydown', onKeyDown, true);
        backdrop.remove();
        requestAnimationFrame(() => {
          if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
          else document.querySelector('main input:not([disabled]), main select:not([disabled]), main button:not([disabled])')?.focus();
        });
        resolve(answer);
      };
      const onKeyDown = (event) => {
        if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        if (event.key === 'Enter') { event.preventDefault(); finish(true); }
      };
      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop || event.target.closest('[data-confirm-cancel]')) finish(false);
        if (event.target.closest('[data-confirm-accept]')) finish(true);
      });
      document.addEventListener('keydown', onKeyDown, true);
      document.body.appendChild(backdrop);
      backdrop.querySelector('[data-confirm-cancel]').focus();
    });
  };

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
