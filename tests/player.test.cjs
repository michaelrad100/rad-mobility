const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];

// Run the actual app with controlled recommendation and YouTube readiness events.
// No account credentials, network calls, or browser storage are used.
function app({ signedIn = true } = {}) {
  const element = () => {
    const classes = new Set();
    return {
      classList: {
        add: (...names) => names.forEach(n => classes.add(n)),
        remove: (...names) => names.forEach(n => classes.delete(n)),
        contains: n => classes.has(n),
        toggle(n, on = !classes.has(n)) { on ? classes.add(n) : classes.delete(n); },
      },
      style: {}, content: '2.4', textContent: '', hidden: false,
      setAttribute() {}, appendChild() {}, addEventListener() {},
    };
  };
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const recommendations = [];
  const data = new Map(signedIn ? [['syncToken', JSON.stringify('test-only')]] : []);
  let options, loadedId, player, playCalls = 0, pauseCalls = 0;
  let position = 20, duration = 600, state = -1, interval;
  const seeks = [];
  const context = vm.createContext({
    document: {
      body: element(), getElementById: get, createElement: element,
      querySelector: get, querySelectorAll: () => [], addEventListener() {},
    },
    location: { hostname: 'localhost', pathname: '/' }, navigator: {},
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) },
    addEventListener() {}, setTimeout() {}, clearTimeout() {},
    setInterval(fn) { interval = fn; return 1; }, clearInterval() { interval = null; },
    fetch: () => new Promise(resolve => recommendations.push(resolve)),
    YT: {
      PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3, ENDED: 0, CUED: 5 },
      Player: function (_id, config) {
        options = config; loadedId = config.videoId;
        player = {
          cueVideoById(id) { loadedId = id; },
          playVideo() { playCalls++; },
          pauseVideo() { pauseCalls++; },
          getCurrentTime: () => position, getDuration: () => duration, getPlayerState: () => state,
          seekTo: (at, allowSeekAhead) => seeks.push([at, allowSeekAhead]),
          stopVideo() { loadedId = undefined; }, mute() {}, unMute() {},
        };
        return player;
      },
    },
  });
  context.window = context;
  vm.runInContext(fs.readFileSync(path.join(root, 'videos.js'), 'utf8'), context);
  vm.runInContext(script, context);
  return {
    get, context,
    construct: () => context.onYouTubeIframeAPIReady(),
    ready: () => options.events.onReady({ target: player }),
    blockPlayback: () => options.events.onAutoplayBlocked({ target: player }),
    loaded: () => loadedId,
    playCalls: () => playCalls,
    pauseCalls: () => pauseCalls,
    seeks,
    position: at => { position = at; },
    duration: seconds => { duration = seconds; },
    state(value) { state = value; options.events.onStateChange({ data: value }); },
    tick() { interval?.(); },
    selected: () => get('applink').href?.split('v=')[1],
    async recommend(index = 0, empty = false) {
      const id = vm.runInContext(`VIDEOS[mode][${index}][0]`, context);
      recommendations.shift()({ ok: true, status: 200, json: async () => ({
        id: empty ? null : id, data: { days: {}, time: {}, shown: {}, liked: {}, blocked: {} },
      }) });
      await new Promise(resolve => setImmediate(resolve));
      return id;
    },
  };
}

test('signed-in recommendation arriving between player construction and readiness is playable', async () => {
  const a = app();
  a.construct();
  assert.equal(a.loaded(), undefined);
  const id = await a.recommend();
  assert.equal(a.selected(), id);
  a.ready();
  assert.equal(a.loaded(), id);
});

test('a mode change before player readiness cues the latest card, not the initial video', async () => {
  const a = app();
  const first = await a.recommend();
  a.construct();
  assert.equal(a.loaded(), first);
  a.get('mode').onclick();
  const latest = await a.recommend();
  assert.notEqual(latest, first);
  a.ready();
  assert.equal(a.loaded(), latest);
});

test('a recommendation arriving after player readiness is still cued', async () => {
  const a = app();
  a.construct(); a.ready();
  const id = await a.recommend();
  assert.equal(a.loaded(), id);
  const pending = a.get('next').onclick();
  const nextId = await a.recommend(1);
  await pending;
  assert.equal(a.loaded(), nextId);
});

test('an exhausted queue stays hidden when the player becomes ready', async () => {
  const a = app();
  a.construct();
  await a.recommend(0, true);
  a.ready();
  assert.equal(a.loaded(), undefined);
  assert.equal(a.get('card').hidden, true);
});

test('guest startup retains the selected video when the player becomes ready', () => {
  const a = app({ signedIn: false });
  a.construct(); a.ready();
  assert.equal(a.loaded(), a.selected());
  assert.ok(a.loaded());
});

test('the visible poster is an actual button whose tap starts the ready player synchronously', async () => {
  assert.match(html, /<button[^>]*id="poster"[^>]*aria-label="Play video"/);
  const a = app();
  a.construct();
  await a.recommend();
  assert.equal(a.get('poster').disabled, true);
  assert.equal(a.get('player-status').textContent, 'Loading player…');
  a.get('poster').onclick();
  assert.equal(a.playCalls(), 0);
  a.ready();
  assert.equal(a.get('poster').disabled, false);
  a.get('poster').onclick();
  assert.equal(a.playCalls(), 1);
  assert.equal(a.get('player-status').textContent, 'Starting…');
});

test('the play button remains disabled without a selected routine', async () => {
  const a = app();
  a.construct(); a.ready();
  await a.recommend(0, true);
  assert.equal(a.get('poster').disabled, true);
  a.get('poster').onclick();
  assert.equal(a.playCalls(), 0);
});

test('blocked scripted playback reveals the native player and removes tap shields', () => {
  const a = app({ signedIn: false });
  a.construct(); a.ready();
  a.get('card').classList.add('playing', 'endzone', 'big');
  a.get('paused').classList.add('show');
  a.blockPlayback();
  assert.equal(a.get('poster').classList.contains('hidden'), true);
  assert.equal(a.get('paused').classList.contains('show'), false);
  for (const name of ['playing', 'endzone', 'big']) {
    assert.equal(a.get('card').classList.contains(name), false);
  }
  assert.equal(a.get('toast').textContent, "Tap YouTube's play button to start.");
});

function playingApp() {
  const a = app({ signedIn: false });
  a.construct(); a.ready(); a.state(1); a.tick();
  return a;
}

test('side taps seek ten seconds, accumulate rapid taps, and clamp to the video bounds', () => {
  const a = playingApp();
  a.get('seek-ahead').onclick();
  a.get('seek-ahead').onclick();
  assert.deepEqual(a.seeks, [[30, true], [40, true]]);
  a.get('seek-back').onclick();
  assert.equal(a.seeks.at(-1)[0], 30);
  a.get('timeline').value = 3; a.get('timeline').oninput();
  a.get('seek-back').onclick();
  assert.equal(a.seeks.at(-1)[0], 0);
  a.get('timeline').value = 598; a.get('timeline').oninput();
  a.get('seek-ahead').onclick();
  assert.equal(a.seeks.at(-1)[0], 600);
});

test('scrubbing previews the chosen position and preserves paused playback', () => {
  const a = playingApp();
  a.state(2);
  a.get('timeline').onpointerdown();
  a.get('timeline').value = 275; a.get('timeline').oninput();
  assert.equal(a.seeks.at(-1)[0], 275);
  assert.equal(a.get('seek-time').textContent, '4:35 / 10:00');
  a.get('timeline').onchange();
  assert.equal(a.playCalls(), 0);
  assert.equal(a.get('paused').classList.contains('show'), true);
  a.get('play-toggle').onclick();
  assert.equal(a.playCalls(), 1);
});

test('touching the slider without moving it does not freeze subsequent progress updates', () => {
  const a = playingApp();
  a.get('timeline').onpointerdown(); a.get('timeline').onpointerup();
  a.position(21); a.tick();
  assert.equal(a.get('timeline').value, 21);
  a.get('play-toggle').onclick();
  assert.equal(a.pauseCalls(), 1);
});

test('rewinding clears the end-screen shield and selecting a new routine resets the timeline', () => {
  const a = playingApp();
  a.get('timeline').value = 590; a.get('timeline').oninput();
  assert.equal(a.get('card').classList.contains('endzone'), true);
  a.get('timeline').value = 100; a.get('timeline').oninput();
  assert.equal(a.get('card').classList.contains('endzone'), false);
  a.get('next').onclick();
  assert.equal(a.get('timeline').value, 0);
  assert.equal(a.get('timeline').disabled, true);
});

test('seek controls do not act before readiness or during the muted pre-roll', () => {
  const a = app({ signedIn: false });
  a.get('seek-ahead').onclick();
  a.construct(); a.ready();
  a.get('seek-ahead').onclick();
  assert.deepEqual(a.seeks, []);
});
