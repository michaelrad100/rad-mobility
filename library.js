(function (root) {
  const videoID = /^[\w-]{11}$/, channelID = /^UC[\w-]{22}$/;
  const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';
  function clean(records, creators = false) {
    const out = {};
    for (const [key, e] of Object.entries(records || {})) {
      if (!e || typeof e.id !== 'string' || !['morning', 'evening'].includes(e.mode) || !(creators ? channelID : videoID).test(e.id) ||
          key !== `${e.mode}:${e.id}` || !Number.isFinite(e.updatedAt) || e.updatedAt <= 0 || e.updatedAt > Date.now() + 60000) continue;
      if (!creators && (!/^\d{1,3}:[0-5]\d$/.test(e.length) || seconds(e.length) <= 0 || seconds(e.length) > 4 * 3600)) continue;
      out[key] = { id: e.id, mode: e.mode, title: text(e.title, 220),
        ...(creators ? {} : { channel: text(e.channel, 100), length: e.length }),
        updatedAt: e.updatedAt, removed: e.removed === true };
    }
    return out;
  }
  function merge(a, b) {
    const out = { ...a };
    for (const [key, e] of Object.entries(b)) if (!out[key] || e.updatedAt > out[key].updatedAt) out[key] = e;
    return out;
  }
  function seconds(length) { return String(length).split(':').reduce((n, x) => n * 60 + Number(x), 0); }
  function pool(base, records, mode) {
    const out = new Map(base[mode].map(v => [v[0], v]));
    for (const e of Object.values(records)) if (!e.removed && e.mode === mode && !out.has(e.id)) out.set(e.id, [e.id, e.title, e.channel, e.length]);
    return [...out.values()];
  }
  function parseURL(input) {
    let u;
    try { u = new URL(input.trim()); } catch { throw new Error('Paste a YouTube video or creator URL.'); }
    if (u.protocol !== 'https:' || u.username || u.password || u.port || !['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtu.be'].includes(u.hostname))
      throw new Error('Use an https://youtube.com or https://youtu.be URL.');
    const parts = u.pathname.split('/').filter(Boolean);
    const id = u.hostname.endsWith('youtu.be') ? parts[0] : parts[0] === 'watch' ? u.searchParams.get('v') : ['shorts', 'embed', 'live'].includes(parts[0]) ? parts[1] : null;
    if (id && videoID.test(id)) return { type: 'video', id, url: `https://www.youtube.com/watch?v=${id}` };
    if (u.searchParams.has('list')) throw new Error('Paste an individual video or creator URL, rather than a playlist.');
    const path = /^@[\p{L}\p{N}_.-]{1,100}$/u.test(parts[0] || '') ? parts[0]
      : ['channel', 'c', 'user'].includes(parts[0]) && /^[\w.-]{1,100}$/.test(parts[1] || '') ? parts.slice(0, 2).join('/') : '';
    if (path) return { type: 'creator', url: `https://www.youtube.com/${path}` };
    throw new Error('Paste a YouTube video or creator URL.');
  }
  const api = { clean, merge, pool, parseURL, seconds };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Library = api;
})(typeof window !== 'undefined' ? window : globalThis);
