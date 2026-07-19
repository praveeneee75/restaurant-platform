(function initialiseNavigationNotifications() {
  const button = document.querySelector('[data-notification-center]');
  const count = button?.querySelector('[data-notification-count]');
  if (!button || !count) return;

  let messages = [];

  async function json(url) {
    const response = await fetch(url, { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok || data.success === false) throw new Error(data.message || 'Notification request failed');
    return data;
  }

  async function activeRestaurantId() {
    const stored = localStorage.getItem('restaurantId');
    if (stored) return stored;
    const system = await json('/system/info').catch(() => ({}));
    return system.activeRestaurantId || '';
  }

  async function refresh() {
    const restaurantId = await activeRestaurantId();
    if (!restaurantId) return;
    const [latest, activation, qr] = await Promise.all([
      json(`/updates/check?restaurantId=${encodeURIComponent(restaurantId)}`).catch(() => ({})),
      json('/activation/status').catch(() => ({})),
      json(`/qr/orders/pending?restaurantId=${encodeURIComponent(restaurantId)}`).catch(() => ({ orders: [] }))
    ]);
    messages = [];
    let notificationTotal = 0;
    if (latest.updateAvailable) { messages.push(`New POS update available: ${latest.latestVersion}`); notificationTotal += 1; }
    if (activation.expiresAt) {
      const days = Math.ceil((new Date(activation.expiresAt).getTime() - Date.now()) / 86400000);
      if (days <= 30) { messages.push(days < 0 ? 'POS licence has expired.' : `POS licence expires in ${days} day(s).`); notificationTotal += 1; }
    }
    const pendingQr = (qr.orders || []).length;
    if (pendingQr) { messages.push(`${pendingQr} QR order${pendingQr === 1 ? '' : 's'} waiting for approval.`); notificationTotal += pendingQr; }
    count.textContent = String(notificationTotal);
    count.hidden = false;
    button.title = messages.join(' | ') || 'No new notifications';
  }

  button.addEventListener('click', () => {
    alert(messages.length ? `Notifications\n\n${messages.join('\n\n')}` : 'No new notifications');
  });
  refresh().catch(() => undefined);
  window.setInterval(() => refresh().catch(() => undefined), 10000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(() => undefined); });
  window.addEventListener('pos:notifications-changed', () => refresh().catch(() => undefined));
})();
