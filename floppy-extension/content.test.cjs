const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function load(sendMessage) {
  let tick;
  let cleared = false;
  const context = {
    chrome: {runtime: {sendMessage}},
    location: {hostname: 'www.hotstar.com', href: 'https://www.hotstar.com/in', pathname: '/in'},
    document: {querySelector: () => null, querySelectorAll: () => []},
    window: {addEventListener() {}},
    setInterval: (callback) => { tick = callback; return 1; },
    clearInterval: () => { cleared = true; },
    Date
  };
  vm.runInNewContext(fs.readFileSync(__dirname + '/content.js', 'utf8'), context);
  return {tick: () => tick(), wasCleared: () => cleared};
}

test('old content script stops quietly when extension context is invalidated', () => {
  const page = load(() => { throw new Error('Extension context invalidated.'); });
  assert.doesNotThrow(() => page.tick());
  assert.equal(page.wasCleared(), true);
});

test('callback-style sendMessage without a Promise does not throw', () => {
  const page = load(() => undefined);
  assert.doesNotThrow(() => page.tick());
  assert.equal(page.wasCleared(), false);
});
