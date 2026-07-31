const CHANNEL = 'tonext-api-v95';
const DEFAULT_TIMEOUT = 90000;

export function getBackendUrl() {
  return localStorage.getItem('tonext_backend_url') || '';
}

export function setBackendUrl(url) {
  const normalized = String(url || '').trim().replace(/\/+$/, '');

  if (
    normalized &&
    !/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/i.test(normalized)
  ) {
    throw new Error(
      'Use the deployed Apps Script Web App URL ending in /exec.'
    );
  }

  localStorage.setItem('tonext_backend_url', normalized);
  return normalized;
}

export function apiRequest(
  action,
  payload = {},
  token = '',
  timeout = DEFAULT_TIMEOUT
) {
  const endpoint = getBackendUrl();

  if (!endpoint) {
    return Promise.reject(
      new Error('Apps Script backend URL is not configured.')
    );
  }

  if (!navigator.onLine) {
    return Promise.reject(new Error('The device is offline.'));
  }

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;

    const frameName =
      `tonext_api_${requestId.replace(/[^a-z0-9]/gi, '')}`;

    const iframe = document.createElement('iframe');
    const form = document.createElement('form');
    let completed = false;

    const timer = setTimeout(() => {
      finish(
        new Error(
          'The server did not respond. Check that the Apps Script deployment ' +
          'uses Execute as: Me, Who has access: Anyone, and that the frontend ' +
          'origin is listed in ALLOWED_ORIGINS.'
        )
      );
    }, timeout);

    iframe.name = frameName;
    iframe.hidden = true;
    iframe.setAttribute('aria-hidden', 'true');

    form.method = 'POST';
    form.action = endpoint;
    form.target = frameName;
    form.acceptCharset = 'UTF-8';
    form.hidden = true;

    const fields = {
      action,
      payload: JSON.stringify(payload ?? {}),
      token: token || '',
      requestId,
      clientOrigin: location.origin
    };

    Object.entries(fields).forEach(([name, value]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = name;
      input.value = value;
      form.appendChild(input);
    });

    function onMessage(event) {
      const message = event.data;

      if (
        !message ||
        message.channel !== CHANNEL ||
        message.requestId !== requestId
      ) {
        return;
      }

      if (message.ok) {
        finish(null, message.data);
      } else {
        finish(
          new Error(message.error || 'Server request failed.')
        );
      }
    }

    function finish(error, data) {
      if (completed) return;
      completed = true;

      clearTimeout(timer);
      window.removeEventListener('message', onMessage);

      setTimeout(() => {
        iframe.remove();
        form.remove();
      }, 0);

      if (error) reject(error);
      else resolve(data);
    }

    window.addEventListener('message', onMessage);

    document.body.appendChild(iframe);
    document.body.appendChild(form);

    /*
     * Waiting one animation frame makes the named iframe available as a
     * form target before Android Chrome submits the request.
     */
    requestAnimationFrame(() => {
      try {
        form.submit();
      } catch (error) {
        finish(error);
      }
    });
  });
}

export const Api = {
  login: (username, password, deviceId) =>
    apiRequest('login', { username, password, deviceId }),

  validate: token =>
    apiRequest('validate', {}, token),

  pull: (token, deviceId, since = '') =>
    apiRequest('pull', { deviceId, since }, token, 120000),

  syncBatch: (token, deviceId, operations) =>
    apiRequest(
      'syncBatch',
      { deviceId, operations },
      token,
      180000
    ),

  listUsers: token =>
    apiRequest('listUsers', {}, token),

  createUser: (token, user) =>
    apiRequest('createUser', user, token),

  changePassword: (token, currentPassword, newPassword) =>
    apiRequest(
      'changePassword',
      { currentPassword, newPassword },
      token
    ),

  ping: () =>
    apiRequest('ping', {})
};