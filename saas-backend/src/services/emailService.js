const nodemailer = require('nodemailer');

function emailConfig() {
  return {
    enabled: String(process.env.EMAIL_ENABLED || '').toLowerCase() === 'true',
    host: process.env.EMAIL_SMTP_HOST || '',
    port: Number(process.env.EMAIL_SMTP_PORT || 587),
    secure: String(process.env.EMAIL_SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.EMAIL_SMTP_USER || '',
    password: process.env.EMAIL_SMTP_PASSWORD || '',
    fromName: process.env.EMAIL_FROM_NAME || "K'Master POS",
    fromAddress: process.env.EMAIL_FROM_ADDRESS || '',
    replyTo: process.env.EMAIL_REPLY_TO || '',
    ownerPortalUrl: process.env.OWNER_PORTAL_URL || 'https://owner.kmasterpos.com',
    downloadsUrl: process.env.DOWNLOAD_PORTAL_URL || 'https://downloads.kmasterpos.com'
  };
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) return 'Not specified';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString().slice(0, 10);
}

function createTransport(config) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000
  });
}

function readiness(config) {
  const missing = [
    ['EMAIL_SMTP_HOST', config.host],
    ['EMAIL_SMTP_USER', config.user],
    ['EMAIL_SMTP_PASSWORD', config.password],
    ['EMAIL_FROM_ADDRESS', config.fromAddress]
  ].filter(([, value]) => !value).map(([key]) => key);
  if (!config.enabled) return { ready: false, reason: 'Email notifications are disabled' };
  if (missing.length) return { ready: false, reason: `Email is not configured (${missing.join(', ')})` };
  return { ready: true };
}

async function sendRestaurantWelcomeEmail(details) {
  const config = emailConfig();
  const status = readiness(config);
  if (!status.ready) return { sent: false, reason: status.reason };

  const desktopPath = `${config.downloadsUrl.replace(/\/$/, '')}/#desktop-app`;
  const mobilePath = `${config.downloadsUrl.replace(/\/$/, '')}/#mobile-app`;
  const temporaryPasswordLine = details.temporaryPassword
    ? `Temporary password: ${details.temporaryPassword}\nYou must change this password after your first login.`
    : 'Use your existing owner password. This restaurant has been added to your account.';
  const temporaryPasswordHtml = details.temporaryPassword
    ? `<p><strong>Temporary password:</strong> ${escapeHtml(details.temporaryPassword)}<br>You must change this password after your first login.</p>`
    : '<p>Use your existing owner password. This restaurant has been added to your account.</p>';

  const text = `Welcome to K'Master POS

Your restaurant account is ready.

Restaurant: ${details.restaurantName}
Restaurant code: ${details.restaurantCode}
Plan: ${details.planName || 'Standard'}
License key: ${details.licenseKey}
License valid until: ${formatDate(details.expiresAt)}

Owner portal: ${config.ownerPortalUrl}
Login email: ${details.ownerEmail}
Contact mobile: ${details.ownerPhone}
${temporaryPasswordLine}

Desktop app download page: ${desktopPath}
Mobile app download page: ${mobilePath}

For your security, these are portal paths only. Installer files are not attached to this email.
`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033;line-height:1.55">
      <h1 style="font-size:26px">Welcome to K'Master POS</h1>
      <p>Your restaurant account is ready.</p>
      <h2 style="font-size:18px">Restaurant and licence</h2>
      <p>
        <strong>Restaurant:</strong> ${escapeHtml(details.restaurantName)}<br>
        <strong>Restaurant code:</strong> ${escapeHtml(details.restaurantCode)}<br>
        <strong>Plan:</strong> ${escapeHtml(details.planName || 'Standard')}<br>
        <strong>License key:</strong> ${escapeHtml(details.licenseKey)}<br>
        <strong>Valid until:</strong> ${escapeHtml(formatDate(details.expiresAt))}
      </p>
      <h2 style="font-size:18px">Owner login</h2>
      <p><strong>Owner portal:</strong> <a href="${escapeHtml(config.ownerPortalUrl)}">${escapeHtml(config.ownerPortalUrl)}</a><br>
      <strong>Login email:</strong> ${escapeHtml(details.ownerEmail)}<br>
      <strong>Contact mobile:</strong> ${escapeHtml(details.ownerPhone)}</p>
      ${temporaryPasswordHtml}
      <h2 style="font-size:18px">App download pages</h2>
      <p><strong>Desktop app:</strong> <a href="${escapeHtml(desktopPath)}">${escapeHtml(desktopPath)}</a><br>
      <strong>Mobile app:</strong> <a href="${escapeHtml(mobilePath)}">${escapeHtml(mobilePath)}</a></p>
      <p style="color:#5e687b">These are portal paths only. Installer files are not attached to this email.</p>
    </div>`;

  await createTransport(config).sendMail({
    from: { name: config.fromName, address: config.fromAddress },
    to: details.ownerEmail,
    replyTo: config.replyTo || undefined,
    subject: `K'Master POS account ready - ${details.restaurantName}`,
    text,
    html
  });
  return { sent: true, reason: 'Welcome email sent' };
}

async function sendInquiryNotification(inquiry) {
  const config = emailConfig();
  const status = readiness(config);
  if (!status.ready) return { sent: false, reason: status.reason };
  const salesAddress = process.env.SALES_NOTIFICATION_EMAIL || config.replyTo || config.fromAddress;
  await createTransport(config).sendMail({
    from: { name: config.fromName, address: config.fromAddress },
    to: salesAddress,
    replyTo: inquiry.email,
    subject: `New K'Master POS enquiry - ${inquiry.businessName || inquiry.name}`,
    text: `New website enquiry

Name: ${inquiry.name}
Business: ${inquiry.businessName || 'Not provided'}
Email: ${inquiry.email}
Mobile: ${inquiry.phone}
City: ${inquiry.city || 'Not provided'}
Outlets: ${inquiry.outletCount}
Message: ${inquiry.message || 'Not provided'}
`
  });
  return { sent: true, reason: 'Sales notification sent' };
}

function restaurantListText(restaurants = []) {
  return restaurants.map((restaurant) => `- ${restaurant.name} (${restaurant.restaurant_code})`).join('\n');
}

function restaurantListHtml(restaurants = []) {
  return restaurants.map((restaurant) => `
    <li>
      <strong>${escapeHtml(restaurant.name)}</strong><br>
      Restaurant code: ${escapeHtml(restaurant.restaurant_code)}
    </li>
  `).join('');
}

async function sendOwnerTemporaryPasswordEmail(details) {
  const config = emailConfig();
  const status = readiness(config);
  if (!status.ready) return { sent: false, reason: status.reason };

  const text = `K'Master POS temporary password

We received a password reset request for this owner login:

Username: ${details.ownerEmail}
Temporary password: ${details.temporaryPassword}

Restaurants:
${restaurantListText(details.restaurants)}

Open the owner portal and sign in. You will be asked to create a new password.
Owner portal: ${config.ownerPortalUrl}
`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033;line-height:1.55">
      <h1 style="font-size:24px">Temporary owner password</h1>
      <p>We received a password reset request for this owner login.</p>
      <p><strong>Username:</strong> ${escapeHtml(details.ownerEmail)}<br>
      <strong>Temporary password:</strong> ${escapeHtml(details.temporaryPassword)}</p>
      <h2 style="font-size:18px">Restaurants</h2>
      <ul>${restaurantListHtml(details.restaurants)}</ul>
      <p>Open the owner portal and sign in. You will be asked to create a new password.</p>
      <p><a href="${escapeHtml(config.ownerPortalUrl)}">${escapeHtml(config.ownerPortalUrl)}</a></p>
    </div>`;

  await createTransport(config).sendMail({
    from: { name: config.fromName, address: config.fromAddress },
    to: details.notificationEmail,
    replyTo: config.replyTo || undefined,
    subject: "K'Master POS temporary owner password",
    text,
    html
  });
  return { sent: true, reason: 'Temporary password email sent' };
}

async function sendOwnerUsernameRecoveryEmail(details) {
  const config = emailConfig();
  const status = readiness(config);
  if (!status.ready) return { sent: false, reason: status.reason };

  const text = `K'Master POS owner username

Owner username: ${details.ownerEmail}

Restaurants:
${restaurantListText(details.restaurants)}

Owner portal: ${config.ownerPortalUrl}
`;

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#172033;line-height:1.55">
      <h1 style="font-size:24px">Owner username</h1>
      <p><strong>Owner username:</strong> ${escapeHtml(details.ownerEmail)}</p>
      <h2 style="font-size:18px">Restaurants</h2>
      <ul>${restaurantListHtml(details.restaurants)}</ul>
      <p><a href="${escapeHtml(config.ownerPortalUrl)}">${escapeHtml(config.ownerPortalUrl)}</a></p>
    </div>`;

  await createTransport(config).sendMail({
    from: { name: config.fromName, address: config.fromAddress },
    to: details.notificationEmail,
    replyTo: config.replyTo || undefined,
    subject: "K'Master POS owner username",
    text,
    html
  });
  return { sent: true, reason: 'Owner username email sent' };
}

module.exports = {
  sendRestaurantWelcomeEmail,
  sendInquiryNotification,
  sendOwnerTemporaryPasswordEmail,
  sendOwnerUsernameRecoveryEmail
};
