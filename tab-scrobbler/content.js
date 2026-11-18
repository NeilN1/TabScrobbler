// Isolated-world half of the content script. Receives snapshots from page.js,
// runs them through the Tracker, and tells the background script when to send
// "now playing" and scrobbles. Keeping the timing here (rather than in the
// background) means it survives the background script being suspended.
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const { Tracker, cleanSnapshot } = globalThis.TabScrobbler;

  // Decided here, not taken from the page's message, so a script on one site
  // cannot pose as the other to dodge its filtering.
  const SITE = /(^|\.)music\.apple\.com$/.test(location.hostname)
    ? 'apple'
    : /(^|\.)accuradio\.com$/.test(location.hostname)
      ? 'accuradio'
      : 'siriusxm';

  let unknownSeconds = 60;
  let lastSnap = null;
  let lastClean = null;
  let lastSnapAt = 0;

  function send(msg) {
    try {
      const p = api.runtime.sendMessage(msg);
      if (p && p.catch) p.catch(() => {});
    } catch (e) {
      // The extension was reloaded or removed; this tab needs a refresh.
    }
  }

  const tracker = new Tracker({
    onNowPlaying: (track) => send({ type: 'nowPlaying', track }),
    onScrobble: (track, timestamp) => send({ type: 'scrobble', track, timestamp, site: SITE }),
    unknownSeconds: () => unknownSeconds,
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tabScrobbler !== true) return;
    lastSnap = e.data.snap && typeof e.data.snap === 'object' ? { ...e.data.snap, site: SITE } : null;
    lastSnapAt = Date.now();
    lastClean = cleanSnapshot(lastSnap);
    tracker.update(lastClean, Date.now());
    reportStatus();
  });

  // Tell the background script whether this tab is playing a song right now,
  // so the toolbar icon can show it. Sent only when the answer changes.
  let reportedPlaying = false;
  function reportStatus() {
    const fresh = Date.now() - lastSnapAt < 10000;
    const playing = Boolean(fresh && lastClean && lastClean.artist && lastClean.title && lastClean.playing);
    if (playing === reportedPlaying) return;
    reportedPlaying = playing;
    send({ type: 'status', playing });
  }
  // Catches a page that stops reporting altogether.
  setInterval(reportStatus, 5000);
  // Leaving the page (or entering the back/forward cache) ends playback here.
  window.addEventListener('pagehide', () => {
    if (reportedPlaying) send({ type: 'status', playing: false });
    reportedPlaying = false;
  });

  // The popup asks each player tab what it currently sees. The tracker keeps
  // the last song through gaps, so only report it while the page shows a song.
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'getState') {
      const isSong = Boolean(lastClean && lastClean.artist && lastClean.title);
      sendResponse({
        site: SITE,
        raw: lastSnap,
        state: isSong ? tracker.state() : null,
        staleSeconds: lastSnapAt ? Math.round((Date.now() - lastSnapAt) / 1000) : null,
      });
    }
  });

  function applySettings(s) {
    const n = Number(s.unknownSeconds);
    if (Number.isFinite(n) && n > 0) unknownSeconds = n;
  }
  api.storage.local.get(['unknownSeconds']).then(applySettings, () => {});
  api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.unknownSeconds) applySettings({ unknownSeconds: changes.unknownSeconds.newValue });
  });
})();
