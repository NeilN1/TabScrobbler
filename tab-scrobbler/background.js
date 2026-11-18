// Background script: the only part that talks to Last.fm. Stateless between
// wake-ups; the scrobble queue lives in storage so nothing is lost when the
// browser suspends this script or Last.fm is unreachable.
'use strict';

// Chrome loads this file alone as a service worker; Firefox loads md5.js and
// lastfm.js first through the manifest's background.scripts list.
if (typeof importScripts === 'function') importScripts('config.js', 'md5.js', 'lastfm.js');

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const LastFm = globalThis.LastFm;
  const CONFIG = globalThis.TabScrobblerConfig || {};
  const configured = Boolean(CONFIG.apiKey && CONFIG.apiSecret && !/PASTE_/.test(CONFIG.apiKey + CONFIG.apiSecret));

  const MAX_QUEUE = 500;
  const MAX_RECENT = 20;
  const MAX_AGE_SECONDS = 14 * 86400; // Last.fm rejects older scrobbles.

  // The application key ships in config.js; only the user's session is stored.
  async function getCfg() {
    const s = await api.storage.local.get(['sessionKey', 'enabled']);
    return {
      apiKey: CONFIG.apiKey,
      apiSecret: CONFIG.apiSecret,
      sessionKey: s.sessionKey,
      enabled: s.enabled !== false,
      connected: configured && Boolean(s.sessionKey),
    };
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
    // Retry later only when a retry can do something; a missing session is
    // fixed by the user reconnecting, which flushes.
    if (queue.length && cfg.connected) api.alarms.create('flush', { delayInMinutes: 5 });
    else api.alarms.clear('flush');
  }

  // Only this extension's content scripts can send these, but check the shape
  // anyway so a bad entry can never wedge the queue or the popup.
  function validTrack(t) {
    if (!t || typeof t !== 'object') return null;
    const str = (v) => (typeof v === 'string' ? v.slice(0, 300) : '');
    const track = { artist: str(t.artist), title: str(t.title), album: str(t.album) };
    if (!track.artist || !track.title) return null;
    track.duration = Number.isFinite(t.duration) && t.duration > 0 ? t.duration : 0;
    return track;
  }

  let lastNowPlayingAt = 0;

  async function handle(msg, sender) {
    if (!msg || typeof msg.type !== 'string') return null;

    if (msg.type === 'status') {
      const tabId = sender && sender.tab && sender.tab.id;
      if (Number.isInteger(tabId)) await setTabPlaying(tabId, msg.playing === true);
      return { ok: true };
    }

    if (msg.type === 'flush') {
      await serial(flush);
      return { ok: true };
    }

    const cfg = await getCfg();
    if (!cfg.enabled) return { ok: false };
    const track = validTrack(msg.track);
    if (!track) return { ok: false };

    if (msg.type === 'nowPlaying') {
      if (!cfg.connected) return { ok: false };
      if (Date.now() - lastNowPlayingAt < 10000) return { ok: false };
      lastNowPlayingAt = Date.now();
      try {
        await LastFm.updateNowPlaying(cfg, track);
      } catch (err) {
        // Now-playing is cosmetic; only credential problems are worth keeping.
        if (err.blocking) await noteError(err);
        return { ok: false };
      }
      return { ok: true };
    }

    if (msg.type === 'scrobble') {
      const timestamp = Number.isInteger(msg.timestamp) ? msg.timestamp : Math.floor(Date.now() / 1000);
      await serial(() => enqueue({ track, timestamp, site: ['apple', 'accuradio', 'ytmusic', 'spotify'].includes(msg.site) ? msg.site : 'siriusxm' }));
      await serial(flush);
      return { ok: true };
    }

    return null;
  }

  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'getState') return false; // answered by content scripts
    handle(msg, sender).then(sendResponse, (err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  });

  api.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'flush') serial(flush);
  });

  // Which player tabs are playing a song right now, as reported by their
  // content scripts. Kept in session storage because this script is suspended
  // between events; it empties itself when the browser restarts.
  const session = api.storage.session;
  let memoryTabs = {};
  async function getPlayingTabs() {
    if (!session) return memoryTabs;
    const s = await session.get(['playingTabs']);
    return s.playingTabs || {};
  }
  let iconChain = Promise.resolve();
  function setTabPlaying(tabId, playing) {
    const run = async () => {
      const tabs = await getPlayingTabs();
      if (Boolean(tabs[tabId]) === playing) return;
      if (playing) tabs[tabId] = true;
      else delete tabs[tabId];
      if (session) await session.set({ playingTabs: tabs });
      else memoryTabs = tabs;
      await updateIcon();
    };
    iconChain = iconChain.then(run, run);
    return iconChain;
  }
  api.tabs.onRemoved.addListener((tabId) => setTabPlaying(tabId, false));

  // Toolbar icon: purple only while a track is playing and will be scrobbled;
  // grey when nothing is playing, scrobbling is switched off, or no Last.fm
  // account is connected. Grey is also the manifest's default icon.
  async function updateIcon() {
    const cfg = await getCfg();
    const playing = Object.keys(await getPlayingTabs()).length > 0;
    const active = cfg.enabled && cfg.connected && playing;
    const suffix = active ? '' : '-grey';
    const why = !cfg.enabled ? 'scrobbling is off' : !cfg.connected ? 'not connected to Last.fm' : 'nothing playing';
    try {
      await api.action.setIcon({ path: { 48: `icons/icon-48${suffix}.png`, 128: `icons/icon-128${suffix}.png` } });
      await api.action.setTitle({ title: active ? 'Tab Scrobbler (scrobbling)' : `Tab Scrobbler (${why})` });
    } catch (e) {
      // Cosmetic only.
    }
  }
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.enabled || changes.sessionKey)) updateIcon();
  });
  // The browser forgets a custom icon on restart; this runs on every start
  // of the background script.
  api.runtime.onStartup.addListener(updateIcon);
  updateIcon();

  api.runtime.onInstalled.addListener((details) => {
    // Builds before 1.0.4 kept a user-supplied API key and secret in storage.
    api.storage.local.remove(['apiKey', 'apiSecret']);
    if (details.reason === 'install') api.runtime.openOptionsPage();
  });
})();
