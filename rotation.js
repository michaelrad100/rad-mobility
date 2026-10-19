(function (root) {
  const COOLDOWN = 3 * 864e5, validID = /^[\w-]{6,20}$/;
  function merge(a, b) {
    const out = { ...a };
    for (const [id, at] of Object.entries(b || {})) out[id] = Math.max(out[id] || 0, at);
    return out;
  }
  // Only completion evidence migrates into watched history. Offers and starts
  // remain useful in the timeline, but never consume a routine's eligibility.
  function watched(data = {}, now = Date.now()) {
    const out = {};
    const keep = (id, at) => { if (validID.test(id) && Number.isFinite(at) && at > 0 && at <= now + 60000) out[id] = Math.max(out[id] || 0, at); };
    for (const [id, at] of Object.entries(data.watched || {})) keep(id, at);
    const recovered = {};
    for (const [day, videos] of Object.entries(data.time || {})) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      const dayTime = Date.parse(day + 'T12:00:00Z');
      if (!Number.isFinite(dayTime) || dayTime > now + 864e5) continue;
      const at = Math.min(now, dayTime);
      for (const [id, seconds] of Object.entries(videos || {})) if (Number.isFinite(seconds) && seconds > 0) recovered[id] = Math.max(recovered[id] || 0, at);
    }
    for (const [id, at] of Object.entries(recovered)) if (!out[id]) keep(id, at);
    for (const e of Object.values(data.timeline || {})) if (e && e.finishedAt) keep(e.videoId, e.finishedAt);
    return out;
  }
  function choose(ids, data, excludeId, now = Date.now(), random = Math.random) {
    ids = [...new Set(ids)];
    const views = data.watched || {}, shown = data.shown || {};
    let eligible = ids.filter(id => !data.blocked?.[id]?.[0] && (!views[id] || (data.liked?.[id]?.[0]
      ? now - views[id] >= COOLDOWN
      : ids.filter(other => other !== id && (views[other] || 0) > views[id]).length >= 60)));
    const other = eligible.filter(id => id !== excludeId);
    if (other.length) eligible = other;
    const fresh = eligible.filter(id => !views[id]);
    const favorites = eligible.filter(id => views[id] && data.liked?.[id]?.[0]);
    const repeats = eligible.filter(id => views[id] && !data.liked?.[id]?.[0]);
    const ordinary = fresh.length ? fresh : repeats;
    let candidates = favorites.length && (!ordinary.length || random() < 0.4) ? favorites : ordinary;
    // Spread offers around without treating any of them as watched or exhausted.
    const oldest = Math.min(...candidates.map(id => shown[id] || 0));
    candidates = candidates.filter(id => (shown[id] || 0) === oldest);
    return candidates.length ? candidates[Math.floor(random() * candidates.length)] : null;
  }
  function remaining(ids, data) {
    return [...new Set(ids)].filter(id => !data.blocked?.[id]?.[0] && !data.watched?.[id]).length;
  }
  const api = { COOLDOWN, merge, watched, choose, remaining };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Rotation = api;
})(typeof window !== 'undefined' ? window : globalThis);
