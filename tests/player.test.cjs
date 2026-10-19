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
function app({ signedIn = true, seed = {} } = {}) {
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
      focus() {}, querySelector: () => element(),
      replaceWith(node) { elements.set(this.id, node); },
      prepend(node) { elements.set(node.id, node); },
    };
  };
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) { const node = element(); node.id = id; elements.set(id, node); }
    return elements.get(id);
  };
  const recommendations = [];
  const requests = [];
  const instances = [], cues = [], timers = new Map(); let nextTimer = 0;
  const data = new Map(signedIn ? [['syncToken', JSON.stringify('test-only')]] : []);
  for (const [key, value] of Object.entries(seed)) data.set(key, JSON.stringify(value));
  let options, loadedId, player, playCalls = 0, pauseCalls = 0;
  let position = 20, duration = 600, state = -1, interval;
  const seeks = [];
  const context = vm.createContext({
    document: {
      body: element(), head: element(), getElementById: get, createElement: element,
      querySelector: get, querySelectorAll: () => [], addEventListener() {},
    },
    location: { hostname: 'localhost', pathname: '/', origin: 'http://localhost' }, navigator: {},
    matchMedia: () => ({ matches: true }),
    localStorage: { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) },
    addEventListener() {}, scrollTo() {}, AbortController, DOMException, URL,
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    setInterval(fn) { interval = fn; return 1; }, clearInterval() { interval = null; },
    fetch: (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return new Promise((resolve, reject) => { recommendations.push(resolve); options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))); });
    },
    YT: {
      PlayerState: { PLAYING: 1, PAUSED: 2, BUFFERING: 3, ENDED: 0, CUED: 5 },
      Player: function (_id, config) {
        options = config; loadedId = get('yt').src.match(/embed\/([^?]+)/)[1];
        instances.push(config);
        player = {
          cueVideoById(id) { loadedId = id; cues.push(id); },
          destroy() {},
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
  vm.runInContext(fs.readFileSync(path.join(root, 'timeline.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'library.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'rotation.js'), 'utf8'), context);
  vm.runInContext(script, context);
  return {
    get, context,
    construct: () => context.onYouTubeIframeAPIReady(),
    ready: () => options.events.onReady({ target: player }),
    blockPlayback: () => options.events.onAutoplayBlocked({ target: player }),
    error: data => options.events.onError({ data }),
    monitoring: () => !!interval,
    loaded: () => loadedId,
    isReady: () => vm.runInContext('ready', context),
    nativeState: value => { state = value; },
    playCalls: () => playCalls,
    pauseCalls: () => pauseCalls,
    seeks,
    requests,
    instances, cues,
    async respond(body, status = 200) {
      recommendations.shift()({ok: status < 400, status, json: async () => body});
      await new Promise(resolve => setImmediate(resolve));
    },
    timeout(ms) {
      for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.fn(); }
    },
    stored: key => JSON.parse(data.get(key) || 'null'),
    local: () => vm.runInContext('localData()', context),
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

test('API arriving before the recommendation never constructs an empty player', async () => {
  const a = app();
  a.construct();
  assert.equal(a.loaded(), undefined);
  assert.equal(a.instances.length, 0);
  const id = await a.recommend();
  assert.equal(a.selected(), id);
  a.ready();
  assert.equal(a.loaded(), id);
  assert.deepEqual(a.cues, []); // the initial video must not reload on ready
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

test('a recommendation arriving after API availability constructs the selected video; next reuses it', async () => {
  const a = app();
  a.construct();
  const id = await a.recommend();
  a.ready();
  assert.equal(a.loaded(), id);
  const pending = a.get('next').onclick();
  const nextId = await a.recommend(1);
  await pending;
  assert.equal(a.loaded(), nextId);
  assert.equal(a.instances.length, 1);
});

test('an exhausted queue stays hidden when the player becomes ready', async () => {
  const a = app();
  a.construct();
  await a.recommend(0, true);
  assert.equal(a.instances.length, 0);
  assert.equal(a.loaded(), undefined);
  assert.equal(a.get('card').hidden, true);
});

test('guest startup retains the selected video when the player becomes ready', () => {
  const a = app({ signedIn: false });
  a.construct(); a.ready();
  assert.equal(a.loaded(), a.selected());
  assert.ok(a.loaded());
});

test('native player is mounted before the API, with no loading overlay or click blocker', () => {
  const a = app({ signedIn: false });
  assert.match(a.get('yt').src, new RegExp('/embed/' + a.selected()));
  assert.equal(a.instances.length, 0);
  assert.equal(a.get('poster').hidden, true);
  assert.equal(html.includes('Loading player…'), false);
  assert.equal(a.get('poster').onclick, undefined);
  const frame = a.get('yt');
  a.construct(); a.ready();
  assert.equal(a.get('yt'), frame);
  assert.deepEqual(a.cues, []);
});

test('an exhausted queue hides the native player card', async () => {
  const a = app();
  a.construct();
  await a.recommend(0, true);
  assert.equal(a.get('card').hidden, true);
  assert.equal(a.get('poster').hidden, true);
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

test('Finish routine appears at thirty seconds remaining and hides when rewinding', () => {
  const a = playingApp();
  a.get('timeline').value = 569; a.get('timeline').oninput();
  assert.equal(a.get('finish-routine').hidden, true);
  a.get('finish-routine').onclick();
  assert.equal(a.stored('time'), null);
  a.get('timeline').value = 570; a.get('timeline').oninput();
  assert.equal(a.get('finish-routine').hidden, false);
  a.get('seek-back').onclick();
  assert.equal(a.get('finish-routine').hidden, true);
});

test('finishing a paused routine records credit and advances without counting it twice', () => {
  const a = playingApp(), id = a.selected();
  a.get('timeline').value = 575; a.get('timeline').oninput();
  a.state(2);
  a.get('finish-routine').onclick();
  assert.notEqual(a.selected(), id);
  const days = a.stored('doneDays');
  assert.equal(days.length, 1);
  assert.ok(a.stored('time')[days[0]][id] > 0);
  assert.equal(a.stored('sessions')[days[0]].length, 1);
  assert.equal(a.get('finish-routine').hidden, true);
  a.get('finish-routine').onclick();
  assert.deepEqual(Object.keys(a.stored('time')[days[0]]), [id]);
  assert.equal(a.get('card').classList.contains('big'), false);
});

test('signed-in completion credit goes into the next recommendation request', async () => {
  const a = app();
  a.construct();
  const id = await a.recommend();
  a.ready();
  a.state(1); a.tick();
  a.get('timeline').value = 580; a.get('timeline').oninput();
  const pending = a.get('finish-routine').onclick();
  assert.equal(a.get('finish-routine').hidden, true);
  const request = a.requests.at(-1);
  assert.match(request.url, /\/recommend$/);
  const [[day, durations]] = Object.entries(request.body.data.time);
  assert.ok(durations[id] > 0);
  assert.ok(request.body.data.days[day].length);
  a.get('finish-routine').onclick(); // no second completion while the next card loads
  await a.recommend(1); await pending;
  assert.deepEqual(Object.keys(a.stored('time')[day]), [id]);
});

test('Finish routine is unavailable while loading or during pre-roll', () => {
  const a = app({ signedIn: false });
  a.construct(); a.ready(); a.position(580); a.state(3);
  assert.equal(a.get('finish-routine').hidden, true);
  a.get('finish-routine').onclick();
  assert.equal(a.stored('time'), null);
});

test('stalled player exposes native playback and retry after ten seconds; recovery restores readiness', () => {
  const a = app({ signedIn: false });
  a.construct();
  const initial = a.instances[0];
  a.timeout(10000);
  assert.equal(a.get('poster').classList.contains('hidden'), true);
  assert.equal(a.get('player-help').hidden, false);
  const id = a.selected();
  a.get('retry-player').onclick();
  assert.equal(a.instances.length, 2);
  assert.equal(a.selected(), id); // retry does not consume another recommendation
  initial.events.onReady(); // late readiness from the destroyed player is ignored
  assert.equal(a.isReady(), false);
  a.ready();
  assert.equal(a.isReady(), true);
  assert.equal(a.get('player-help').hidden, true);
  a.timeout(10000);
  assert.equal(a.get('player-help').hidden, true);
});

test('missing API script falls back to an independent embed and follows new cards', () => {
  const a = app({ signedIn: false });
  a.timeout(10000);
  const first = a.get('yt');
  assert.match(first.src, new RegExp('/embed/' + a.selected()));
  assert.equal(a.get('player-help').hidden, false);
  a.timeout(10000);
  assert.equal(a.get('yt'), first); // repeated fallback must not restart native playback
  a.get('next').onclick();
  assert.match(a.get('yt').src, new RegExp('/embed/' + a.selected()));
  assert.notEqual(a.get('yt'), first);
  a.construct(); a.ready();
  assert.equal(a.get('player-help').hidden, true);
  assert.equal(a.isReady(), true);
});

test('a card change replaces a stalled player and ignores its late callbacks', () => {
  const a = app({ signedIn: false });
  a.construct();
  const stale = a.instances[0], initial = a.selected();
  a.get('next').onclick();
  assert.equal(a.instances.length, 2);
  assert.notEqual(a.selected(), initial);
  stale.events.onReady();
  stale.events.onStateChange({ data: 1 });
  assert.equal(a.isReady(), false);
  assert.equal(a.get('card').classList.contains('playing'), false);
  a.ready();
  assert.equal(a.loaded(), a.selected());
});

test('constructor failure reveals a usable embed rather than abandoning startup', () => {
  const a = app({ signedIn: false });
  a.context.YT.Player = function () { throw new Error('Test player unavailable'); };
  a.construct();
  assert.equal(a.get('player-help').hidden, false);
  assert.match(a.get('yt').src, new RegExp('/embed/' + a.selected()));
});

test('native fallback still lets the user record completion credit', () => {
  const a = app({ signedIn: false }), id = a.selected();
  a.timeout(10000);
  a.get('fallback-finish').onclick();
  const [day] = a.stored('doneDays');
  assert.ok(a.stored('time')[day][id] > 0);
  assert.notEqual(a.selected(), id);
  a.get('fallback-finish').onclick();
  assert.deepEqual(Object.keys(a.stored('time')[day]), [id]);
});

test('failure and retry stop the old playback timer before rebuilding the player', () => {
  const a = playingApp();
  assert.equal(a.monitoring(), true);
  a.error(5);
  assert.equal(a.monitoring(), false);
  a.get('retry-player').onclick();
  assert.equal(a.monitoring(), false);
  a.ready(); a.state(1);
  assert.equal(a.monitoring(), true);
});

test('late API attachment preserves native playback and starts progress tracking', () => {
  const a = app({ signedIn: false });
  const frame = a.get('yt');
  a.nativeState(1); // the user already started playback with YouTube's own button
  a.construct(); a.ready();
  assert.equal(a.get('yt'), frame);
  assert.deepEqual(a.cues, []);
  assert.equal(a.monitoring(), true);
  assert.equal(a.get('card').classList.contains('playing'), true);
  assert.equal(a.get('card').classList.contains('hushed'), false);
});

test('every shown card persists across Next and reload, and can be replayed without credit', () => {
  const a = app({ signedIn: false }), first = a.selected();
  a.get('next').onclick();
  assert.equal(Object.keys(a.stored('videoTimeline')).length, 2);
  const b = app({ signedIn: false, seed: { videoTimeline: a.stored('videoTimeline'), lastShown: a.stored('lastShown') } });
  const entries = b.stored('videoTimeline');
  assert.equal(Object.keys(entries).length, 3);
  const key = Object.keys(entries).find(key => entries[key].videoId === first);
  b.context.replayTimeline(key);
  assert.equal(b.selected(), first);
  assert.equal(Object.keys(b.stored('videoTimeline')).length, 4);
  assert.equal(b.stored('time'), null);
  assert.equal(b.stored('liked'), null);
  assert.equal(b.context.timelineItems(entries[key].channel).length > 0, true);
});

test('timeline distinguishes shown, started and finished appearances', () => {
  const a = app({ signedIn: false });
  const key = Object.keys(a.stored('videoTimeline'))[0];
  assert.equal(a.stored('videoTimeline')[key].startedAt, 0);
  a.construct(); a.ready(); a.state(1); a.tick();
  assert.ok(a.stored('videoTimeline')[key].startedAt);
  a.get('timeline').value = 580; a.get('timeline').oninput();
  a.get('finish-routine').onclick();
  assert.ok(a.stored('videoTimeline')[key].finishedAt);
});

test('old shown history is recovered as legacy entries, with one new entry for the current card', () => {
  const a = app({ signedIn: false, seed: { lastShown: { cacwri2wio4: 100000 } } });
  const entries = Object.values(a.stored('videoTimeline'));
  assert.equal(entries.filter(e => e.legacy).length, 1);
  assert.equal(entries.find(e => e.legacy).videoId, 'cacwri2wio4');
  assert.equal(entries.find(e => e.legacy).finishedAt, 0);
});

test('timeline batches drain without trimming older entries, and stale sync cannot erase a start', () => {
  const entries = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['event-batch-' + i, {
    videoId: 'cacwri2wio4', mode: 'morning', shownAt: 1000 + i,
    title: 'Routine', channel: 'Creator', length: '6:51', startedAt: 0, finishedAt: 0, legacy: false,
  }]));
  const a = app({ signedIn: false, seed: { videoTimeline: entries } });
  const batch = a.local().timeline;
  assert.equal(Object.keys(batch).length, 200);
  const emptyData = { days: {}, time: {}, shown: {}, liked: {}, blocked: {} };
  a.context.applySynced({ ...emptyData, timeline: batch });
  assert.equal(a.stored('timelinePending').length, 101);
  assert.equal(Object.keys(a.stored('videoTimeline')).length, 301);
  a.construct(); a.ready(); a.state(1); a.tick();
  const latestKey = a.stored('timelinePending').at(-1), latest = a.stored('videoTimeline')[latestKey];
  assert.ok(latest.startedAt);
  a.context.applySynced({ ...emptyData, timeline: { [latestKey]: { ...latest, startedAt: 0 } } });
  assert.ok(a.stored('videoTimeline')[latestKey].startedAt);
  assert.ok(a.stored('timelinePending').includes(latestKey));
});

test('explicit timeline replay can recover a thumbed-down card without changing automatic exclusions', () => {
  const a = app({ signedIn: false }), first = a.selected();
  const key = Object.keys(a.stored('videoTimeline'))[0];
  a.context.setBlocked(first, true); a.get('next').onclick();
  assert.notEqual(a.selected(), first);
  a.context.replayTimeline(key);
  a.context.applySynced(a.local());
  assert.equal(a.selected(), first);
  assert.deepEqual(a.stored('time'), {});
  a.get('next').onclick();
  assert.notEqual(a.selected(), first);
});

test('one searchable library contains liked videos and personal additions', () => {
  const a = app({ signedIn: false });
  const id = a.selected(); a.context.setLiked(id, true);
  a.get('favs').onclick();
  assert.equal(a.get('recent-sheet').classList.contains('show'), true);
  assert.equal(a.context.libraryItems().length, 1);
  assert.equal(a.context.libraryItems('this title does not exist').length, 0);
  a.get('filter-recent').onclick();
  assert.ok(a.context.timelineItems().some(([,e]) => e.videoId === id));
  assert.equal(a.get('recent-sheet').classList.contains('show'), true);
});

test('adding a video to both rotations persists without changing playback, likes or credit', () => {
  const a = app({ signedIn: false }), original = a.selected();
  a.context.importFixture = { type: 'video', target: 'both', videos: [{ id: 'newVid12345', title: 'My routine', channel: 'My creator', length: '20:00' }], selected: new Set(['newVid12345']) };
  vm.runInContext('importPreview = importFixture; saveImport();', a.context);
  assert.equal(Object.keys(a.stored('personalVideos')).length, 2);
  assert.equal(a.selected(), original);
  assert.equal(a.stored('time'), null); assert.equal(a.stored('liked'), null);
  assert.ok(vm.runInContext('pool("morning").some(v => v[0] === "newVid12345")', a.context));
  assert.ok(vm.runInContext('pool("evening").some(v => v[0] === "newVid12345")', a.context));
  const b = app({ signedIn: false, seed: {personalVideos: a.stored('personalVideos')} });
  b.get('filter-added').onclick();
  assert.equal(b.context.libraryItems('My creator').length, 2);
});

test('signed-in personal metadata joins recommendation requests and stale sync cannot undo removal', async () => {
  const v = {id:'newVid12345',mode:'morning',title:'Personal routine',channel:'Creator',length:'20:00',updatedAt:1000,removed:false};
  const a=app({seed:{personalVideos:{'morning:newVid12345':v}}});
  assert.ok(a.requests[0].body.ids.includes(v.id));
  assert.equal(a.requests[0].body.data.library['morning:newVid12345'].title, v.title);
  await a.recommend();
  const d={days:{},time:{},liked:{},blocked:{},library:{'morning:newVid12345':{...v,removed:true,updatedAt:2000}}};
  a.context.applySynced(d); a.context.applySynced({...d,library:{'morning:newVid12345':v}});
  assert.equal(a.stored('personalVideos')['morning:newVid12345'].removed,true);
  assert.equal(vm.runInContext('pool("morning").some(v => v[0] === "newVid12345")',a.context),false);
});

test('creator selection imports only chosen videos and saves a reusable creator source', () => {
  const a=app({signedIn:false});
  a.context.importFixture={type:'creator',target:'evening',creator:{id:'UCU0DZhN-8KFLYO6beSaYljg',title:'Tom Merrick'},videos:[{id:'newVid12345',title:'Selected routine',channel:'Creator',length:'12:00'},{id:'otherVid123',title:'Unselected routine',channel:'Creator',length:'10:00'}],selected:new Set(['newVid12345'])};
  vm.runInContext('importPreview=importFixture; saveImport()',a.context);
  assert.deepEqual(Object.keys(a.stored('personalVideos')),['evening:newVid12345']);
  assert.equal(a.stored('creators')['evening:UCU0DZhN-8KFLYO6beSaYljg'].title,'Tom Merrick');
});

test('an added routine still receives its full completion time through Finish routine', () => {
  const v={id:'newVid12345',mode:'morning',title:'Personal routine',channel:'Creator',length:'20:00',updatedAt:1000,removed:false};
  const a=app({signedIn:false,seed:{personalVideos:{['morning:'+v.id]:v}}});
  a.context.playLibraryVideo([v.id,v.title,v.channel,v.length],'morning');
  a.construct(); a.duration(1200); a.ready(); a.state(1); a.tick();
  a.get('timeline').value=1180; a.get('timeline').oninput();
  assert.equal(a.get('finish-routine').hidden,false); a.get('finish-routine').onclick();
  const [day]=a.stored('doneDays'); assert.equal(a.stored('time')[day][v.id],1200);
  assert.ok(Object.values(a.stored('videoTimeline')).some(e=>e.videoId===v.id && e.finishedAt));
});

test('editing an import discards its late lookup and keeps the latest rotation choice', async () => {
 const a=app({signedIn:false}); a.get('import-url').value='https://youtu.be/cacwri2wio4'; a.get('import-mode').value='morning';
 const stale=a.context.findImport();
 a.get('import-url').value='https://youtu.be/jj2AAH6jbHk'; a.get('import-url').oninput(); a.get('import-mode').value='evening';
 await a.respond({type:'video',videos:[{id:'cacwri2wio4',title:'Stale',channel:'Creator',length:'6:51'}]}); await stale;
 assert.equal(a.get('import-save').hidden,true);
 const latest=a.context.findImport();
 await a.respond({type:'video',videos:[{id:'jj2AAH6jbHk',title:'Latest',channel:'Creator',length:'13:54'}]}); await latest;
 a.get('import-save').onclick();
 assert.deepEqual(Object.keys(a.stored('personalVideos')),['evening:jj2AAH6jbHk']);
});

test('a timed-out import shows an inline retry message and leaves playback available', async () => {
 const a=app({signedIn:false}), id=a.selected();
 a.get('import-url').value='https://youtu.be/cacwri2wio4'; a.get('import-mode').value='morning';
 const pending=a.context.findImport(); a.timeout(20000); await pending;
 assert.match(a.get('import-status').textContent,/took too long/);
 assert.equal(a.get('import-find').disabled,false); assert.equal(a.get('import-save').hidden,true);
 assert.equal(a.selected(),id); assert.match(a.get('yt').src,new RegExp(id));
});

test('Next and reload circulate uncompleted cards despite old shown history', () => {
 const original=app({signedIn:false}), m=vm.runInContext('mode',original.context);
 const all=Object.values(original.context.VIDEOS).flat().map(v=>v[0]), available=original.context.VIDEOS[m].slice(0,2).map(v=>v[0]);
 const seed={lastShown:Object.fromEntries(available.map((id,i)=>[id,1000+i])),blocked:all.filter(id=>!available.includes(id))};
 const a=app({signedIn:false,seed});
 for(let i=0;i<8;i++){assert.ok(available.includes(a.selected()));a.get('next').onclick();}
 assert.deepEqual(a.stored('watched'),{}); assert.equal(a.get('card').hidden,false);
 assert.ok(Object.values(a.stored('videoTimeline')).every(e=>!e.startedAt&&!e.finishedAt));
 const b=app({signedIn:false,seed:{...seed,lastShown:a.stored('lastShown'),videoTimeline:a.stored('videoTimeline'),watched:a.stored('watched')}});
 assert.ok(available.includes(b.selected())); assert.deepEqual(b.stored('watched'),{});
 b.get('down').onclick(); const disliked=b.stored('blocked').find(id=>available.includes(id));
 for(let i=0;i<4;i++){assert.notEqual(b.selected(),disliked); b.get('next').onclick();}
});

test('starting a routine does not consume it; reaching completion credit does', () => {
 const a=app({signedIn:false}),id=a.selected(); a.construct();a.ready();a.state(1);a.tick();
 assert.deepEqual(a.stored('watched'),{});
 a.position(480);a.tick(); assert.ok(a.stored('watched')[id]);
 assert.ok(a.local().watched[id]);
});

test('embedding restrictions do not silently save a thumbs-down', () => {
 const a=app({signedIn:false}),id=a.selected();a.construct();a.ready();a.error(101);
 assert.equal(a.selected(),id);assert.equal(a.stored('blocked')?.includes(id)||false,false);
 assert.equal(a.get('player-help').hidden,false);assert.deepEqual(a.stored('watched'),{});
});
