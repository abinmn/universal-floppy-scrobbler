const sessions = new Map();
const titleCache = new Map();
const tabQueues = new Map();
const STOP_AFTER_MISSING_MS = 12000;

function normalized(title) {
  return String(title || '').normalize('NFKD').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function validSample(sample) {
  if (!sample || typeof sample.key !== 'string' || !/^(netflix|hotstar):\d+$/.test(sample.key)) return false;
  const item = sample.item;
  if (!item || !['movie', 'episode'].includes(item.type) || (item.type === 'movie' && !item.title) ||
      (item.type === 'episode' && (!item.seriesTitle || !Number.isInteger(item.season) || !Number.isInteger(item.episode) || item.episode < 1))) return false;
  return Number.isFinite(sample.position) && Number.isFinite(sample.duration) && sample.duration > 0;
}

async function config() {
  const {floppyUrl, floppyToken} = await chrome.storage.local.get(['floppyUrl', 'floppyToken']);
  if (!floppyUrl || !floppyToken) throw new Error('Set the Floppy URL and API token in the extension popup.');
  const url = new URL(floppyUrl);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid Floppy URL.');
  return {base: url.href.replace(/\/+$/, ''), token: floppyToken};
}

async function floppyRequest(path, options = {}) {
  const {base, token} = await config();
  const response = await fetch(`${base}${path}`, {
    ...options,
    headers: {'X-API-Key': token, ...(options.body ? {'Content-Type': 'application/json'} : {})},
    cache: 'no-store', redirect: 'error'
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Floppy HTTP ${response.status}: ${detail.slice(0, 160)}`);
  }
  return response.json();
}

async function resolveItem(item) {
  const mediaType = item.type === 'movie' ? 'movie' : 'tv';
  const query = item.type === 'movie' ? item.title : item.seriesTitle;
  const cacheKey = `${mediaType}:${normalized(query)}:${item.year || ''}`;
  if (titleCache.has(cacheKey)) return titleCache.get(cacheKey);
  const response = await floppyRequest(`/api/v1/search/${mediaType}/?search=${encodeURIComponent(query)}&limit=20`);
  const results = Array.isArray(response.results) ? response.results : [];
  const exact = results.filter((result) => normalized(result.title) === normalized(query) && result.source === 'tmdb');
  const yearMatch = item.year ? exact.find((result) => Number(result.year) === Number(item.year)) : null;
  const result = yearMatch || (exact.length === 1 ? exact[0] : null);
  if (!result?.media_id) throw new Error(`Could not safely match ${query} in Floppy's TMDB catalog.`);
  const resolved = {tmdb: String(result.media_id)};
  titleCache.set(cacheKey, resolved);
  return resolved;
}

async function sendScrobble(action, session) {
  const sample = session.sample;
  const ids = session.ids || await resolveItem(sample.item);
  session.ids = ids;
  const item = sample.item;
  const body = {
    action, media_type: item.type, ids, title: item.title,
    position_seconds: Math.max(0, Math.round(sample.position)),
    duration_seconds: Math.max(1, Math.round(sample.duration))
  };
  if (item.type === 'episode') {
    body.series_title = item.seriesTitle;
    body.season_number = item.season;
    body.episode_number = item.episode;
  }
  if (action === 'stop') body.completed = sample.position / sample.duration >= 0.8 || !!sample.ended;
  await floppyRequest('/api/v1/scrobble/', {method: 'POST', body: JSON.stringify(body)});
  if (action === 'stop' && body.completed) await chrome.storage.local.set({lastStatus: `Scrobbled ${item.type === 'episode' ? item.seriesTitle + ' — ' : ''}${item.title}.`});
}

async function stop(tabId) {
  const session = sessions.get(tabId);
  if (!session) return;
  sessions.delete(tabId);
  if (!session.started) return;
  try { await sendScrobble('stop', session); }
  catch (error) { await chrome.storage.local.set({lastStatus: error.message || String(error)}); }
}

async function handleSample(tabId, sample) {
  const current = sessions.get(tabId);
  if (!validSample(sample)) {
    if (current && Date.now() - current.lastSeen > STOP_AFTER_MISSING_MS) await stop(tabId);
    return;
  }
  if (current && current.sample.key !== sample.key) await stop(tabId);
  let session = sessions.get(tabId);
  if (!session) {
    session = {sample, lastSeen: Date.now(), started: false, paused: true, ids: null};
    sessions.set(tabId, session);
  }
  session.sample = sample;
  session.lastSeen = Date.now();
  if (sample.ended) {
    await stop(tabId);
    return;
  }
  const action = !sample.paused && !session.started ? 'start' :
    sample.paused && session.started && !session.paused ? 'pause' :
    !sample.paused && session.started && session.paused ? 'start' : null;
  if (!action) return;
  try {
    await sendScrobble(action, session);
    session.started = true;
    session.paused = !!sample.paused;
  } catch (error) {
    await chrome.storage.local.set({lastStatus: error.message || String(error)});
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.kind !== 'sample' || !sender.tab?.id || !sender.url) return;
  const host = new URL(sender.url).hostname;
  if (host !== 'www.netflix.com' && host !== 'www.hotstar.com' && !host.endsWith('.hotstar.com') &&
      host !== 'www.jiohotstar.com' && !host.endsWith('.jiohotstar.com')) return;
  const tabId = sender.tab.id;
  const previous = tabQueues.get(tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => handleSample(tabId, message.sample));
  tabQueues.set(tabId, next);
  void next.finally(() => { if (tabQueues.get(tabId) === next) tabQueues.delete(tabId); });
  void next.then(() => sendResponse({ok: true}), (error) => sendResponse({ok: false, error: String(error)}));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  const previous = tabQueues.get(tabId) || Promise.resolve();
  void previous.catch(() => {}).then(() => stop(tabId));
});
