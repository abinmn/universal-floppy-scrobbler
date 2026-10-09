const form = document.querySelector('#settings');
const urlInput = document.querySelector('#url');
const tokenInput = document.querySelector('#token');
const status = document.querySelector('#status');

function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

chrome.storage.local.get(['floppyUrl', 'floppyToken', 'lastStatus'], (stored) => {
  urlInput.value = stored.floppyUrl || '';
  tokenInput.value = stored.floppyToken || '';
  const message = stored.lastStatus || '';
  setStatus(message, /^Connected|^Scrobbled/.test(message) ? 'success' : message ? 'error' : 'info');
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  setStatus('Connecting…');
  try {
    const url = new URL(urlInput.value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
      throw new Error('Enter an HTTP or HTTPS Floppy base URL without credentials, query, or fragment.');
    }
    const baseUrl = url.href.replace(/\/+$/, '');
    const originPattern = `${url.origin}/*`;
    const allowed = await chrome.permissions.request({origins: [originPattern]});
    if (!allowed) throw new Error('Floppy host access was not granted.');
    const token = tokenInput.value.trim();
    const response = await fetch(`${baseUrl}/api/v1/user/preferences/`, {
      headers: {'X-API-Key': token},
      cache: 'no-store', redirect: 'error'
    });
    if (!response.ok) throw new Error(`Floppy connection failed (HTTP ${response.status}).`);
    await chrome.storage.local.set({floppyUrl: baseUrl, floppyToken: token, lastStatus: 'Connected to Floppy.'});
    setStatus('Connected to Floppy. Start a movie or episode in this browser.', 'success');
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  }
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.lastStatus) {
    const message = changes.lastStatus.newValue || '';
    setStatus(message, /^Connected|^Scrobbled/.test(message) ? 'success' : message ? 'error' : 'info');
  }
});
