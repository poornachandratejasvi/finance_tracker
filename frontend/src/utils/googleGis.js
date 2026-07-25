// Google Identity Services (GIS) helpers — Client-ID-only, no secret / credentials.json.

export const loadGis = () =>
  new Promise((resolve, reject) => {
    if (window.google?.accounts) return resolve();
    const existing = document.getElementById('gis-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', reject);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.id = 'gis-script';
    s.onload = () => resolve();
    s.onerror = reject;
    document.body.appendChild(s);
  });

// Prompt the user for a short-lived OAuth access token for the given scope.
export const requestAccessToken = (clientId, scope = 'https://www.googleapis.com/auth/drive.file') =>
  new Promise((resolve, reject) => {
    loadGis()
      .then(() => {
        if (!window.google?.accounts?.oauth2) {
          reject(new Error('Google Identity Services unavailable'));
          return;
        }
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: clientId,
          scope,
          callback: (resp) => {
            if (resp && resp.access_token) resolve(resp.access_token);
            else reject(new Error(resp?.error || 'Authorization was cancelled'));
          },
          error_callback: (err) => reject(new Error(err?.message || 'Authorization failed')),
        });
        client.requestAccessToken();
      })
      .catch(reject);
  });
