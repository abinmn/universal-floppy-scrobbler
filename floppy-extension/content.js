// JioHotstar extraction follows upstream HotstarParser. Netflix player/metadata
// extraction is in netflix-page.js, which runs in the page's main world.
(() => {
  const SOURCE = 'floppy-browser-scrobbler';
  const netflix = location.hostname === 'www.netflix.com';
  let lastNetflixMessage = null;
  let lastNetflixAt = 0;
  let lastUrl = location.href;
  let pollTimer = null;
  let inactive = false;

  function send(sample) {
    if (inactive) return;
    try {
      const request = chrome.runtime.sendMessage({kind: 'sample', sample});
      if (request && typeof request.catch === 'function') request.catch(() => {});
    } catch (_) {
      // A reloaded extension invalidates content scripts in already-open tabs.
      // Stop this old script; refreshing the tab injects the new version.
      inactive = true;
      if (pollTimer !== null) clearInterval(pollTimer);
    }
  }

  function contentId() {
    return /\/(?:movies|shows)\/.+\/(\d+)(?:\/|$)/.exec(location.pathname)?.[1] || null;
  }

  function matchesId(url, id) {
    return !!url && ((/\/(\d+)\/watch\/?$/.exec(url) || /\/(\d+)\/?$/.exec(url))?.[1] === id);
  }

  function hotstarLd(id) {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const data = JSON.parse(script.textContent || '');
        const types = Array.isArray(data['@type']) ? data['@type'] : [data['@type']];
        if (types.includes('Movie') && matchesId(data.url, id)) return data;
        if (types.includes('TVSeries')) {
          const season = Array.isArray(data.containsSeason) ? data.containsSeason[0] : data.containsSeason;
          if (matchesId(season?.episode?.url, id)) return data;
        }
      } catch (_) { /* Ignore unrelated JSON-LD. */ }
    }
    return null;
  }

  function hotstarItem(id) {
    const heading = document.querySelector('h1')?.textContent?.trim() || '';
    const ld = hotstarLd(id);
    if (location.pathname.includes('/movies/')) {
      const title = ld?.['@type'] === 'Movie' ? ld.name : heading;
      return title ? {type: 'movie', title, year: Number(ld?.releaseYear) || 0} : null;
    }
    if (!location.pathname.includes('/shows/')) return null;
    const season = Array.isArray(ld?.containsSeason) ? ld.containsSeason[0] : ld?.containsSeason;
    const episode = season?.episode;
    if (episode && Number(season?.seasonNumber) >= 0 && Number(episode.episodeNumber) > 0) {
      return {type: 'episode', title: episode.name || '', seriesTitle: ld.name || heading,
        season: Number(season.seasonNumber), episode: Number(episode.episodeNumber), year: 0};
    }
    if (!heading) return null;
    for (const element of document.querySelectorAll('[aria-label]')) {
      const match = /^(.+?),\s*Season\s*(\d+),\s*Episode\s*(\d+),\s*(.+)$/i.exec(element.getAttribute('aria-label') || '');
      if (match && match[1].trim() === heading) {
        return {type: 'episode', seriesTitle: heading, season: Number(match[2]),
          episode: Number(match[3]), title: match[4].trim(), year: 0};
      }
    }
    for (const element of document.querySelectorAll('p, span')) {
      if (element.children.length) continue;
      const match = /^S(\d+)\s*E(\d+)\s+(.+)$/.exec(element.textContent?.trim() || '');
      if (match) return {type: 'episode', seriesTitle: heading, season: Number(match[1]),
        episode: Number(match[2]), title: match[3].trim(), year: 0};
    }
    return null;
  }

  function hotstarSample() {
    const id = contentId();
    const video = document.querySelector('#video-container video');
    if (!id || !video || !Number.isFinite(video.duration) || video.duration <= 0) return null;
    const item = hotstarItem(id);
    if (!item) return null;
    return {key: `hotstar:${id}`, item, position: Math.round(video.currentTime),
      duration: Math.round(video.duration), paused: video.paused, ended: video.ended};
  }

  window.addEventListener('message', (event) => {
    if (!netflix || event.source !== window || event.origin !== location.origin ||
        event.data?.source !== SOURCE || event.data?.kind !== 'playback') return;
    const {id, item, position, duration, paused} = event.data;
    if (!/^\d+$/.test(id) || !item || !Number.isFinite(position) || !Number.isFinite(duration)) return;
    lastNetflixMessage = {key: `netflix:${id}`, item, position, duration, paused, ended: false};
    lastNetflixAt = Date.now();
    send(lastNetflixMessage);
  });

  pollTimer = setInterval(() => {
    const changed = location.href !== lastUrl;
    lastUrl = location.href;
    if (netflix) {
      if (changed || Date.now() - lastNetflixAt > 10000) {
        lastNetflixMessage = null;
        send(null);
      }
    } else {
      send(hotstarSample());
    }
  }, 2000);
})();
