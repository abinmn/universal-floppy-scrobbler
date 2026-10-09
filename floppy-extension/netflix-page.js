// Adapted from upstream NetflixApi/NetflixParser. Runs in Netflix's page world so
// the site's player state and authenticated metadata API remain accessible.
(() => {
  const SOURCE = 'floppy-browser-scrobbler';
  const metadataCache = new Map();
  const pendingMetadata = new Map();
  const failedAt = new Map();
  let lastId = null;
  let lastSent = 0;

  async function metadataFor(id, netflix) {
    if (metadataCache.has(id)) return metadataCache.get(id);
    if (Date.now() - (failedAt.get(id) || 0) < 30000) return null;
    if (pendingMetadata.has(id)) return pendingMetadata.get(id);
    const pending = fetchMetadata(id, netflix);
    pendingMetadata.set(id, pending);
    try { return await pending; }
    finally { pendingMetadata.delete(id); }
  }

  async function fetchMetadata(id, netflix) {
    const models = netflix?.reactContext?.models;
    const authUrl = models?.userInfo?.data?.authURL || '';
    const build = models?.serverDefs?.data?.BUILD_IDENTIFIER;
    const bases = ['https://www.netflix.com/nq/website/memberapi/release'];
    if (build) bases.push(`https://www.netflix.com/nq/website/memberapi/${build}`);
    if (build) bases.push(`https://www.netflix.com/api/shakti/${build}`);
    bases.push('https://www.netflix.com/api/shakti/mre');
    for (const base of bases) {
      for (const suffix of ['', `&authURL=${encodeURIComponent(authUrl)}`]) {
        try {
          const response = await fetch(`${base}/metadata?languages=en-US&movieid=${encodeURIComponent(id)}${suffix}`, {credentials: 'include'});
          if (!response.ok) continue;
          const data = await response.json();
          if (data?.video) {
            const item = parseMetadata(data.video);
            metadataCache.set(id, item);
            return item;
          }
        } catch (_) { /* Try the next endpoint. */ }
      }
    }
    failedAt.set(id, Date.now());
    return null;
  }

  function parseMetadata(video) {
    if (video.type === 'movie') return {type: 'movie', title: video.title, year: video.year || 0};
    if (video.type !== 'show') return null;
    for (const season of video.seasons || []) {
      const episode = (season.episodes || []).find((value) => value.id === video.currentEpisode);
      if (episode && !video.hiddenEpisodeNumbers && season.seq > 0 && episode.seq > 0) {
        return {type: 'episode', title: episode.title, seriesTitle: video.title,
          year: video.year || 0, season: season.seq, episode: episode.seq};
      }
    }
    return null;
  }

  async function sample() {
    if (!location.pathname.startsWith('/watch/')) return;
    const netflix = window.netflix;
    const sessions = netflix?.appContext?.state?.playerApp?.getState?.()?.videoPlayer?.playbackStateBySessionId;
    if (!sessions) return;
    const entries = Object.values(sessions).filter(Boolean);
    const playing = entries.find((entry) => entry.playing) || entries.find((entry) => !entry.paused) || entries[0];
    if (!playing?.videoId || !Number.isFinite(playing.duration) || playing.duration <= 0) return;
    const id = String(playing.videoId);
    const now = Date.now();
    if (id !== lastId) lastId = id;
    if (now - lastSent < 1500) return;
    lastSent = now;
    const item = await metadataFor(id, netflix);
    if (lastId !== id || !location.pathname.startsWith('/watch/')) return;
    const scale = playing.duration > 86400 ? 1000 : 1;
    window.postMessage({source: SOURCE, kind: 'playback', id, item,
      position: Math.round(playing.currentTime / scale), duration: Math.round(playing.duration / scale),
      paused: !!playing.paused}, location.origin);
  }

  setInterval(() => { void sample(); }, 2000);
  void sample();
})();
