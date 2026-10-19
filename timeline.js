(function (root) {
  const validKey = /^(?:event|legacy)-[\w:-]{1,90}$/, validVideo = /^[\w-]{6,20}$/;
  function clean(entries, limit = Infinity) {
    const out = {}, now = Date.now() + 60000;
    for (const [key, e] of Object.entries(entries || {}).slice(0, limit)) {
      if (!validKey.test(key) || !e || !validVideo.test(e.videoId) || !['morning', 'evening'].includes(e.mode) ||
          !Number.isFinite(e.shownAt) || e.shownAt <= 0 || e.shownAt > now) continue;
      const stamp = n => Number.isFinite(n) && n >= e.shownAt && n <= now ? n : 0;
      out[key] = { videoId: e.videoId, mode: e.mode, shownAt: e.shownAt,
        title: String(e.title || '').slice(0, 220), channel: String(e.channel || '').slice(0, 100),
        length: /^\d{1,3}:[0-5]\d$/.test(e.length) ? e.length : '',
        startedAt: stamp(e.startedAt), finishedAt: stamp(e.finishedAt), legacy: e.legacy === true };
    }
    return out;
  }
  function merge(a, b) {
    const out = { ...a }, first = (x, y) => x && y ? Math.min(x, y) : x || y || 0;
    for (const [key, e] of Object.entries(b)) {
      const old = out[key];
      if (!old) out[key] = e;
      else if (old.videoId === e.videoId && old.mode === e.mode && old.shownAt === e.shownAt)
        out[key] = { ...old, startedAt: first(old.startedAt, e.startedAt), finishedAt: first(old.finishedAt, e.finishedAt) };
    }
    return out;
  }
  function backfill(entries, shown, catalog, excludeId) {
    const known = new Set(Object.values(entries).map(e => e.videoId)), out = {};
    for (const [id, at] of Object.entries(shown)) {
      if (id === excludeId || known.has(id) || !Number.isFinite(at) || at <= 0 || at > Date.now() + 60000) continue;
      const mode = Object.keys(catalog).find(m => catalog[m].some(v => v[0] === id));
      if (!mode) continue;
      const v = catalog[mode].find(v => v[0] === id);
      out[`legacy-${id}-${at}`] = { videoId: id, mode, shownAt: at, title: v[1], channel: v[2], length: v[3], startedAt: 0, finishedAt: 0, legacy: true };
    }
    return out;
  }
  const api = { clean, merge, backfill };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Timeline = api;
})(typeof window !== 'undefined' ? window : globalThis);
