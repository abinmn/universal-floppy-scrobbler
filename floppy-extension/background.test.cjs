const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(results, episodes = {}) {
  const requests = [];
  const storage = {floppyUrl: 'https://floppy.example', floppyToken: 'test-token'};
  const chrome = {
    storage: {local: {
      get: async () => storage,
      set: async (values) => Object.assign(storage, values)
    }},
    runtime: {onMessage: {addListener() {}}},
    tabs: {onRemoved: {addListener() {}}}
  };
  const fetch = async (url, options) => {
    requests.push({url, options});
    if (url.includes('/search/')) return {ok: true, json: async () => ({results}), text: async () => ''};
    if (url.includes('/media/tv/tmdb/')) {
      const key = new URL(url).pathname;
      if (episodes[key]?.errorStatus) return {ok: false, status: episodes[key].errorStatus, text: async () => 'Lookup failed'};
      return key in episodes ? {ok: true, json: async () => episodes[key]} :
        {ok: false, status: 404, text: async () => 'Episode not found'};
    }
    return {ok: true, json: async () => ({detail: 'ok'}), text: async () => ''};
  };
  const context = vm.createContext({chrome, fetch, URL, Map, Date, Promise, console});
  const source = fs.readFileSync(__dirname + '/background.js', 'utf8');
  vm.runInContext(source + '\nglobalThis.api = {resolveItem, sendScrobble, handleSample, stop};', context);
  return {api: context.api, requests, storage};
}

test('movie scrobble uses a matched TMDB ID and completion threshold', async () => {
  const {api, requests} = harness([{title: 'The Matrix', year: 1999, source: 'tmdb', media_id: '603'}]);
  const session = {sample: {item: {type: 'movie', title: 'The Matrix', year: 1999}, position: 8000, duration: 8100}, ids: null};
  await api.sendScrobble('stop', session);
  const sent = JSON.parse(requests.at(-1).options.body);
  assert.equal(sent.media_type, 'movie');
  assert.equal(sent.ids.tmdb, '603');
  assert.equal(sent.completed, true);
  assert.equal(requests.at(-1).options.headers['X-API-Key'], 'test-token');
});

const diplomatResults = [
  {title: 'The Diplomat', year: 2023, source: 'tmdb', media_id: '203857'},
  {title: 'The Diplomat', year: 2023, source: 'tmdb', media_id: '203762'},
  {title: 'The Diplomat', year: 2019, source: 'tmdb', media_id: '93020'},
];
const diplomatEpisode = {type: 'episode', seriesTitle: 'The Diplomat',
  title: 'Last Dance at the Country Club', year: 0, season: 3, episode: 2};
const diplomatDetails = {title: 'Last Dance at the Country Club', details: {season_number: 3, episode_number: 2}};

test('same-named series resolve by episode title and numbers when Netflix has no year', async () => {
  const {api, requests} = harness(diplomatResults, {
    '/api/v1/media/tv/tmdb/203857/3/2/': diplomatDetails,
  });
  await api.sendScrobble('start', {sample: {item: diplomatEpisode, position: 514, duration: 2794}});
  const sent = JSON.parse(requests.at(-1).options.body);
  assert.equal(sent.ids.tmdb, '203857');
  assert.equal(sent.season_number, 3);
  assert.equal(sent.episode_number, 2);
});

test('two series sharing a release year still require episode disambiguation', async () => {
  const {api} = harness(diplomatResults, {
    '/api/v1/media/tv/tmdb/203762/3/2/': diplomatDetails,
  });
  assert.equal((await api.resolveItem({...diplomatEpisode, year: 2023})).tmdb, '203762');
});

test('ambiguous or mismatched episode details do not create a scrobble', async () => {
  for (const details of [
    {'/api/v1/media/tv/tmdb/203857/3/2/': diplomatDetails,
     '/api/v1/media/tv/tmdb/203762/3/2/': diplomatDetails},
    {'/api/v1/media/tv/tmdb/203857/3/2/': {...diplomatDetails, title: 'Another episode'}},
    {'/api/v1/media/tv/tmdb/203857/3/2/': {...diplomatDetails, details: {season_number: 1, episode_number: 2}}},
  ]) {
    const {api, requests} = harness(diplomatResults, details);
    await assert.rejects(() => api.resolveItem(diplomatEpisode), /safely match/);
    assert.equal(requests.filter((request) => request.url.includes('/scrobble/')).length, 0);
  }
});

test('episode match cache does not resolve a different same-named series automatically', async () => {
  const {api} = harness(diplomatResults, {
    '/api/v1/media/tv/tmdb/203857/3/2/': diplomatDetails,
  });
  await api.resolveItem(diplomatEpisode);
  await assert.rejects(() => api.resolveItem({...diplomatEpisode, title: 'Other title', episode: 3}), /safely match/);
});

test('failed candidate lookup prevents accepting an unverified match', async () => {
  const {api, requests} = harness(diplomatResults, {
    '/api/v1/media/tv/tmdb/203857/3/2/': diplomatDetails,
    '/api/v1/media/tv/tmdb/203762/3/2/': {errorStatus: 403},
  });
  await assert.rejects(() => api.resolveItem(diplomatEpisode), /Floppy HTTP 403/);
  assert.equal(requests.filter((request) => request.url.includes('/scrobble/')).length, 0);
});

test('metadata HTTP 500 offers explicit matches and a saved choice bypasses the failing lookup', async () => {
  const {api, requests, storage} = harness(diplomatResults, {
    '/api/v1/media/tv/tmdb/203857/3/2/': {errorStatus: 500},
  });
  const sample = {key: 'netflix:81772104', item: diplomatEpisode, position: 514, duration: 2794, paused: false};
  await api.handleSample(7, sample);
  assert.match(storage.lastStatus, /Floppy HTTP 500.*TMDB 203857/);
  assert.equal(storage.pendingMatch.title, 'The Diplomat');
  assert.equal(storage.pendingMatch.candidates.length, 3);
  assert.equal(requests.filter((request) => request.url.includes('/scrobble/')).length, 0);
  storage.titleCorrections = {[storage.pendingMatch.key]: '203857'};
  const lookups = requests.length;
  await api.handleSample(7, {...sample, position: 520});
  assert.equal(requests.length, lookups + 1);
  const body = JSON.parse(requests.at(-1).options.body);
  assert.equal(body.ids.tmdb, '203857');
  assert.equal(body.season_number, 3);
  assert.equal(body.episode_number, 2);
  assert.equal(storage.lastStatus, 'Tracking The Diplomat — Last Dance at the Country Club.');
});

test('saved title choice persists across episodes and is scoped to media type', async () => {
  const {api, requests, storage} = harness([]);
  storage.titleCorrections = {'tv:the diplomat:': '203857'};
  assert.equal((await api.resolveItem({...diplomatEpisode, episode: 3})).tmdb, '203857');
  assert.equal(requests.length, 0);
  await assert.rejects(() => api.resolveItem({type: 'movie', title: 'The Diplomat', year: 0}), /safely match/);
});

test('episode scrobble sends show ID and season and episode numbers', async () => {
  const {api, requests} = harness([{title: 'Dark', year: 2017, source: 'tmdb', media_id: '70523'}]);
  const session = {sample: {item: {type: 'episode', title: 'Secrets', seriesTitle: 'Dark', year: 2017, season: 1, episode: 1}, position: 900, duration: 3600}, ids: null};
  await api.sendScrobble('stop', session);
  const sent = JSON.parse(requests.at(-1).options.body);
  assert.equal(sent.media_type, 'episode');
  assert.equal(sent.ids.tmdb, '70523');
  assert.equal(sent.season_number, 1);
  assert.equal(sent.episode_number, 1);
  assert.equal(sent.completed, false);
});

test('ambiguous title does not create a scrobble', async () => {
  const {api, requests} = harness([
    {title: 'Crash', source: 'tmdb', media_id: '1'},
    {title: 'Crash', source: 'tmdb', media_id: '2'}
  ]);
  await assert.rejects(() => api.resolveItem({type: 'movie', title: 'Crash', year: 0}), /safely match/);
  assert.equal(requests.filter((request) => request.url.includes('/scrobble/')).length, 0);
});

test('a unique movie spelling variant requires the same release year', async () => {
  const {api} = harness([{title: 'Pradhama Drishtiya Kuttakkar', year: 2026, source: 'tmdb', media_id: '1544847'}]);
  const item = {type: 'movie', title: 'Pradhama Drishtya Kuttakkar', year: 2026};
  assert.equal((await api.resolveItem(item)).tmdb, '1544847');
  await assert.rejects(() => api.resolveItem({...item, year: 2025}), /safely match/);
  await assert.rejects(() => api.resolveItem({...item, year: 0}), /safely match/);
});

test('ambiguous spelling variants and unrelated titles are rejected', async () => {
  const {api} = harness([
    {title: 'Pradhama Drishtiya Kuttakkar', year: 2026, source: 'tmdb', media_id: '1'},
    {title: 'Pradhama Drishtyaa Kuttakkar', year: 2026, source: 'tmdb', media_id: '2'},
  ]);
  await assert.rejects(() => api.resolveItem({type: 'movie', title: 'Pradhama Drishtya Kuttakkar', year: 2026}), /safely match/);
  await assert.rejects(() => api.resolveItem({type: 'movie', title: 'An unrelated movie', year: 2026}), /safely match/);
});

test('playback transition sends start once and stop with latest position', async () => {
  const {api, requests, storage} = harness([{title: 'The Matrix', year: 1999, source: 'tmdb', media_id: '603'}]);
  const sample = {key: 'netflix:1', item: {type: 'movie', title: 'The Matrix', year: 1999},
    position: 10, duration: 8100, paused: false};
  await api.handleSample(7, sample);
  assert.equal(storage.lastStatus, 'Tracking The Matrix.');
  await api.handleSample(7, {...sample, position: 4000});
  await api.handleSample(7, {...sample, position: 7000});
  await api.stop(7);
  const actions = requests.filter((request) => request.url.includes('/scrobble/'))
    .map((request) => JSON.parse(request.options.body));
  assert.deepEqual(actions.map((action) => action.action), ['start', 'stop']);
  assert.equal(actions[1].position_seconds, 7000);
});
