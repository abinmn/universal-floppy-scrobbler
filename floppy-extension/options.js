const form = document.querySelector('#settings');
const urlInput = document.querySelector('#url');
const tokenInput = document.querySelector('#token');
const status = document.querySelector('#status');
const matchForm = document.querySelector('#match-settings');
const matchChoice = document.querySelector('#match-choice');
const matchPreview = document.querySelector('#match-preview');
let pendingMatch = null;
document.querySelector('.brand-name').textContent = `Floppy · v${chrome.runtime.getManifest().version}`;

function renderMatch(match) {
  if (match?.key === pendingMatch?.key) return;
  pendingMatch = match || null;
  matchForm.hidden = !match;
  matchChoice.replaceChildren();
  matchPreview.hidden = true;
  if (!match) return;
  document.querySelector('#match-label').textContent = `Choose the correct match for ${match.title}`;
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Select a title…';
  matchChoice.append(placeholder);
  for (const candidate of match.candidates) {
    const option = document.createElement('option');
    option.value = candidate.media_id;
    option.textContent = `${candidate.title} (${candidate.year || 'year unknown'}) · TMDB ${candidate.media_id}`;
    matchChoice.append(option);
  }
}

matchChoice.addEventListener('change', () => {
  matchPreview.hidden = !matchChoice.value;
  if (pendingMatch && /^\d+$/.test(matchChoice.value)) {
    matchPreview.href = `https://www.themoviedb.org/${pendingMatch.mediaType}/${matchChoice.value}`;
  }
});

matchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!pendingMatch?.candidates.some((candidate) => candidate.media_id === matchChoice.value)) return;
  try {
    const {titleCorrections = {}} = await chrome.storage.local.get('titleCorrections');
    titleCorrections[pendingMatch.key] = matchChoice.value;
    await chrome.storage.local.set({titleCorrections, pendingMatch: null,
      lastStatus: `Match saved for ${pendingMatch.title}. Resume playback to start tracking.`});
    renderMatch(null);
  } catch (error) {
    setStatus(error.message || String(error), 'error');
  }
});

function setStatus(message, kind = 'info') {
  status.textContent = message;
  status.dataset.kind = kind;
}

chrome.storage.local.get(['floppyUrl', 'floppyToken', 'lastStatus', 'pendingMatch'], (stored) => {
  urlInput.value = stored.floppyUrl || '';
  tokenInput.value = stored.floppyToken || '';
  const message = stored.lastStatus || '';
  setStatus(message, /^(Connected|Scrobbled|Tracking|Paused|Match saved)/.test(message) ? 'success' : message ? 'error' : 'info');
  renderMatch(stored.pendingMatch);
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
  if (changes.pendingMatch) renderMatch(changes.pendingMatch.newValue);
  if (changes.lastStatus) {
    const message = changes.lastStatus.newValue || '';
    setStatus(message, /^(Connected|Scrobbled|Tracking|Paused|Match saved)/.test(message) ? 'success' : message ? 'error' : 'info');
  }
});
