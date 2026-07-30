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
