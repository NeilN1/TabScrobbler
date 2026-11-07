// Background script: the only part that talks to Last.fm. Stateless between
// wake-ups; the scrobble queue lives in storage so nothing is lost when the
// browser suspends this script or Last.fm is unreachable.
'use strict';

// Chrome loads this file alone as a service worker; Firefox loads md5.js and
// lastfm.js first through the manifest's background.scripts list.
if (typeof importScripts === 'function') importScripts('md5.js', 'lastfm.js');

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const LastFm = globalThis.LastFm;

  const MAX_QUEUE = 500;
  const MAX_RECENT = 20;
  const MAX_AGE_SECONDS = 14 * 86400; // Last.fm rejects older scrobbles.

  async function getCfg() {
    const s = await api.storage.local.get(['apiKey', 'apiSecret', 'sessionKey', 'enabled']);
    return { ...s, enabled: s.enabled !== false, connected: Boolean(s.apiKey && s.apiSecret && s.sessionKey) };
  }

  // Queue reads and writes must not interleave.
  let chain = Promise.resolve();
  function serial(fn) {
    chain = chain.then(fn, fn);
    return chain;
  }

  async function noteError(err) {
    if (err.code === 9) await api.storage.local.remove(['sessionKey', 'username']);
    await api.storage.local.set({ lastError: err.message });
  }

  async function enqueue(item) {
    const { queue = [] } = await api.storage.local.get(['queue']);
    queue.push(item);
    await api.storage.local.set({ queue: queue.slice(-MAX_QUEUE) });
  }

  async function flush() {
    const cfg = await getCfg();
    const stored = await api.storage.local.get(['queue', 'recent']);
    const cutoff = Date.now() / 1000 - MAX_AGE_SECONDS;
    const queue = (stored.queue || []).filter((q) => q.timestamp > cutoff);
    let recent = stored.recent || [];

    while (cfg.connected && queue.length) {
      const item = queue[0];
      try {
        const res = await LastFm.scrobble(cfg, item.track, item.timestamp);
        queue.shift();
        recent.unshift({ ...item, status: res.accepted ? 'scrobbled' : 'ignored', note: res.message });
        await api.storage.local.remove(['lastError']);
      } catch (err) {
        if (err.retryable || err.blocking) {
          await noteError(err);
          break;
        }
        // Last.fm rejected this particular scrobble; retrying will not help.
        queue.shift();
        recent.unshift({ ...item, status: 'failed', note: err.message });
      }
      recent = recent.slice(0, MAX_RECENT);
      await api.storage.local.set({ queue, recent });
    }

    await api.storage.local.set({ queue, recent });
    if (queue.length) api.alarms.create('flush', { delayInMinutes: 5 });
    else api.alarms.clear('flush');
  }

  async function handle(msg) {
    if (!msg || typeof msg.type !== 'string') return null;

    if (msg.type === 'flush') {
      await serial(flush);
      return { ok: true };
    }

    const cfg = await getCfg();
    if (!cfg.enabled) return { ok: false };

    if (msg.type === 'nowPlaying') {
      if (!cfg.connected) return { ok: false };
      try {
        await LastFm.updateNowPlaying(cfg, msg.track);
      } catch (err) {
        // Now-playing is cosmetic; only credential problems are worth keeping.
        if (err.blocking) await noteError(err);
        return { ok: false };
      }
      return { ok: true };
    }

    if (msg.type === 'scrobble') {
      await serial(() => enqueue({ track: msg.track, timestamp: msg.timestamp, site: msg.site }));
      await serial(flush);
      return { ok: true };
    }

    return null;
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'getState') return false; // answered by content scripts
    handle(msg).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  });

  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'flush') serial(flush);
  });

  api.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install') api.runtime.openOptionsPage();
  });
})();
