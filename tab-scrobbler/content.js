// Isolated-world half of the content script. Receives snapshots from page.js,
// runs them through the Tracker, and tells the background script when to send
// "now playing" and scrobbles. Keeping the timing here (rather than in the
// background) means it survives the background script being suspended.
(() => {
  'use strict';

  const api = globalThis.browser ?? globalThis.chrome;
  const { Tracker, cleanSnapshot } = globalThis.TabScrobbler;

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
    onScrobble: (track, timestamp) => send({ type: 'scrobble', track, timestamp, site: lastSnap && lastSnap.site }),
    unknownSeconds: () => unknownSeconds,
  });

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data || e.data.__tabScrobbler !== true) return;
    lastSnap = e.data.snap || null;
    lastSnapAt = Date.now();
    lastClean = cleanSnapshot(lastSnap);
    tracker.update(lastClean, Date.now());
  });

  // The popup asks each player tab what it currently sees. The tracker keeps
  // the last song through gaps, so only report it while the page shows a song.
  api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg && msg.type === 'getState') {
      const isSong = Boolean(lastClean && lastClean.artist && lastClean.title);
      sendResponse({
        site: lastSnap && lastSnap.site,
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
