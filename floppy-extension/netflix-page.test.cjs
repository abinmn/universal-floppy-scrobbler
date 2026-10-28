const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const flush = () => new Promise((resolve) => setImmediate(resolve));

function series(currentEpisode) {
  return {type: 'show', title: 'The Diplomat', year: 2023, currentEpisode,
    hiddenEpisodeNumbers: false,
    seasons: [{seq: 3, episodes: [{id: 81772104, seq: 2, title: 'Last Dance at the Country Club'}]}]};
}

function load(metadata) {
  const messages = [];
  const requests = [];
  let tick;
  let now = 100000;
  const playing = {videoId: 81772104, currentTime: 418921, duration: 2794124, playing: true, paused: false};
  const context = {
    Date: {now: () => now},
    location: {pathname: '/watch/81772104', origin: 'https://www.netflix.com'},
    window: {netflix: {appContext: {state: {playerApp: {getState: () => ({
      videoPlayer: {playbackStateBySessionId: {main: playing}},
    })}}}}, postMessage: (message) => messages.push(message)},
    fetch: async (url) => {
      requests.push(url);
      return {ok: true, json: async () => ({video: metadata(requests.length)})};
    },
    setInterval: (callback) => {tick = callback;},
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/netflix-page.js', 'utf8'), context);
  return {messages, requests, playing, tick: async (milliseconds = 2000) => {now += milliseconds; tick(); await flush();}};
}

for (const currentEpisode of [undefined, 81772103, '81772104']) {
  test(`Netflix series uses playing ID when currentEpisode is ${currentEpisode}`, async () => {
    const page = load(() => series(currentEpisode));
    await flush();
    assert.equal(page.messages[0].item?.seriesTitle, 'The Diplomat');
    assert.equal(page.messages[0].item?.season, 3);
    assert.equal(page.messages[0].item?.episode, 2);
    assert.equal(page.messages[0].position, 419);
  });
}

test('Netflix tries the next endpoint when a successful response cannot resolve the episode', async () => {
  const page = load((attempt) => attempt === 1 ? {...series(81772104), seasons: []} : series(81772104));
  await flush();
  assert.equal(page.messages[0].item?.episode, 2);
  assert.equal(page.requests.length, 2);
});

test('Netflix retries unresolved metadata after cooldown instead of caching null forever', async () => {
  let ready = false;
  const page = load(() => ready ? series(81772104) : {...series(81772104), seasons: []});
  await flush();
  const attempts = page.requests.length;
  ready = true;
  await page.tick();
  assert.equal(page.requests.length, attempts);
  await page.tick(30000);
  assert.ok(page.requests.length > attempts);
  assert.equal(page.messages.at(-1).item?.episode, 2);
});

test('Netflix movie extraction remains supported', async () => {
  const page = load(() => ({type: 'movie', title: 'Test movie', year: 2026}));
  await flush();
  assert.equal(page.messages[0].item.type, 'movie');
  assert.equal(page.messages[0].item.title, 'Test movie');
});
