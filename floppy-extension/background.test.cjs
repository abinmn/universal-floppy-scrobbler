const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function harness(results) {
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

test('playback transition sends start once and stop with latest position', async () => {
  const {api, requests} = harness([{title: 'The Matrix', year: 1999, source: 'tmdb', media_id: '603'}]);
  const sample = {key: 'netflix:1', item: {type: 'movie', title: 'The Matrix', year: 1999},
    position: 10, duration: 8100, paused: false};
  await api.handleSample(7, sample);
  await api.handleSample(7, {...sample, position: 4000});
  await api.handleSample(7, {...sample, position: 7000});
  await api.stop(7);
  const actions = requests.filter((request) => request.url.includes('/scrobble/'))
    .map((request) => JSON.parse(request.options.body));
  assert.deepEqual(actions.map((action) => action.action), ['start', 'stop']);
  assert.equal(actions[1].position_seconds, 7000);
});
