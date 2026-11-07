// Runs in the page's own JavaScript world (manifest "world": "MAIN") so it can
// see what the player exposes: Apple's MusicKit instance, the Media Session
// metadata, and the player DOM. Posts one snapshot per second to content.js.
// It has no access to extension APIs.
(() => {
  'use strict';

  const host = location.hostname;
  const site = /(^|\.)music\.apple\.com$/.test(host)
    ? 'apple'
    : /(^|\.)siriusxm\.(com|ca)$/.test(host)
      ? 'siriusxm'
      : null;
  if (!site || window.top !== window) return;

  const text = (v) => (typeof v === 'string' ? v : '');

  function mediaSessionInfo() {
    const ms = navigator.mediaSession;
    const md = ms && ms.metadata;
    return {
      title: text(md && md.title),
      artist: text(md && md.artist),
      album: text(md && md.album),
      state: ms ? ms.playbackState : 'none',
    };
  }

  // ---- Apple Music: read MusicKit directly --------------------------------

  function musicKit() {
    try {
      return (window.MusicKit && window.MusicKit.getInstance && window.MusicKit.getInstance()) || null;
    } catch (e) {
      return null; // MusicKit throws until the page has configured it.
    }
  }

  // MusicKit's own events keep snapshots flowing even when the browser slows
  // this tab's timers down in the background.
  let hookedMk = null;
  function hookApple() {
    const mk = musicKit();
    if (!mk || hookedMk === mk) return;
    hookedMk = mk;
    for (const ev of ['playbackTimeDidChange', 'playbackStateDidChange', 'nowPlayingItemDidChange']) {
      try {
        mk.addEventListener(ev, () => tick());
      } catch (e) {
        // Older MusicKit builds without that event; the timer still runs.
      }
    }
  }

  function readApple() {
    hookApple();
    const mk = musicKit();
    if (!mk) return { note: 'Player not loaded yet' };
    const item = mk.nowPlayingItem;
    if (!item) return { note: 'Nothing playing' };

    const a = item.attributes || {};
    const playing = mk.isPlaying === true;
    if (item.isLiveRadioStation || a.isLive || /station/i.test(text(item.type))) {
      // The item is the station itself, not the song on air.
      return { playing, note: 'Live radio is not scrobbled' };
    }
    // Prefer the catalogue length: for 30-second previews the playback
    // duration is the preview, and a preview should not earn a scrobble.
    const seconds = (a.durationInMillis || item.playbackDuration || 0) / 1000;
    return {
      title: text(item.title) || text(a.name),
      artist: text(item.artistName) || text(a.artistName),
      album: text(item.albumName) || text(a.albumName),
      duration: seconds || mk.currentPlaybackDuration || 0,
      position: mk.currentPlaybackTime,
      playing,
      source: 'MusicKit',
    };
  }

  // ---- SiriusXM: player bar first, Media Session as fallback ---------------

  const BAR = "[class*='playbackControls']";
  const SEPARATORS = [' -- ', ' ~ ', ' - ', ' – ', ' — ', ' // ', ' • '];

  function splitArtistTrack(s) {
    for (const sep of SEPARATORS) {
      const i = s.indexOf(sep);
      if (i > 0) return [s.slice(0, i).trim(), s.slice(i + sep.length).trim()];
    }
    return null;
  }

  // Text of an element without aria-hidden copies (scrolling marquees clone
  // their text), collapsed to single spaces.
  function visibleText(el) {
    let out = '';
    const walk = (n) => {
      if (n.nodeType === Node.TEXT_NODE) {
        out += n.nodeValue;
      } else if (n.nodeType === Node.ELEMENT_NODE && n.getAttribute('aria-hidden') !== 'true') {
        for (const c of n.childNodes) walk(c);
      }
    };
    walk(el);
    return out.replace(/\s+/g, ' ').trim();
  }

  // "ROSÉ/Bruno Mars - APT.ROSÉ/Bruno Mars - APT." -> "ROSÉ/Bruno Mars - APT."
  function undouble(s) {
    const m = /^(.+?)\s*(?:[•·|]\s*)?\1$/.exec(s);
    return m ? m[1] : s;
  }

  // The player may use an <audio> element that is never attached to the
  // document, so remember every element that play() is called on.
  const seen = new WeakSet();
  const refs = [];
  function remember(el) {
    if (el instanceof HTMLMediaElement && !seen.has(el)) {
      seen.add(el);
      refs.push(new WeakRef(el));
      // Media events are not throttled in background tabs; use them as a clock.
      for (const ev of ['timeupdate', 'play', 'pause', 'ended']) el.addEventListener(ev, () => tick());
    }
  }
  // The SiriusXM player stops refreshing its now-playing display while the
  // tab is hidden, so track changes went unnoticed until the tab was focused
  // again. Make the page believe it is always visible: report it as such,
  // keep visibilitychange from reaching the page, and run animation-frame
  // callbacks on a timer while the tab is really hidden (browsers never run
  // them in hidden tabs).
  function keepPageAwake() {
    const realState = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    const reallyHidden = () => Boolean(realState && realState.get.call(document) === 'hidden');
    try {
      Object.defineProperty(document, 'hidden', { get: () => false, configurable: true });
      Object.defineProperty(document, 'visibilityState', { get: () => 'visible', configurable: true });
      document.hasFocus = () => true;
    } catch (e) {
      // Leave the page's own view of visibility alone if it cannot be shadowed.
    }

    // Every animation frame gets a timer as a backstop: whichever fires first
    // runs the callback and cancels the other. Frames requested while the tab
    // is visible normally win the race; once the tab is hidden (or the
    // browser stops painting it for any other reason) the timer takes over.
    const realRaf = window.requestAnimationFrame.bind(window);
    const realCancel = window.cancelAnimationFrame.bind(window);
    const frames = new Map(); // our id -> { real, timer }
    let nextId = 1 << 30;
    window.requestAnimationFrame = (cb) => {
      const id = nextId++;
      const fire = () => {
        const f = frames.get(id);
        if (!f) return;
        frames.delete(id);
        if (f.real !== null) realCancel(f.real);
        clearTimeout(f.timer);
        cb(performance.now());
      };
      const hidden = reallyHidden();
      const f = { real: hidden ? null : realRaf(fire), timer: setTimeout(fire, hidden ? 100 : 300) };
      frames.set(id, f);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      const f = frames.get(id);
      if (!f) return;
      frames.delete(id);
      if (f.real !== null) realCancel(f.real);
      clearTimeout(f.timer);
    };

    // Registered at document_start, so these run before any page listener.
    const swallow = (e) => e.stopImmediatePropagation();
    window.addEventListener('visibilitychange', swallow, true);
    document.addEventListener('visibilitychange', swallow, true);
  }
  if (site === 'siriusxm') keepPageAwake();

  let observing = false;
  function observeSirius() {
    if (observing || !document.body) return;
    observing = true;
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      remember(this);
      return origPlay.apply(this, args);
    };
    // Track changes and play/pause flips show up as DOM changes in the bar.
    new MutationObserver(() => tick()).observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['aria-label'],
    });
  }

  function mediaPlaying() {
    document.querySelectorAll('audio, video').forEach(remember);
    let playing = false;
    for (let i = refs.length - 1; i >= 0; i--) {
      const el = refs[i].deref();
      if (!el) {
        refs.splice(i, 1);
      } else if (!el.paused && !el.ended && !el.muted && el.readyState > 2) {
        playing = true;
      }
    }
    return playing;
  }

  function readSirius() {
    observeSirius();
    const ms = mediaSessionInfo();
    const bar = document.querySelector(BAR);
    const titleEl = bar && bar.querySelector("[class*='title']");
    const domText = titleEl ? undouble(visibleText(titleEl)) : '';

    let playing;
    if (bar && bar.querySelector("button[aria-label='Pause'], button[aria-label='Pausar']")) {
      playing = true;
    } else if (bar && bar.querySelector("button[aria-label='Play'], button[aria-label='Reproducir']")) {
      playing = false;
    } else {
      playing = ms.state === 'playing' || (ms.state !== 'paused' && mediaPlaying());
    }

    const raw = { playerBar: domText, mediaSession: ms };
    const pair = domText ? splitArtistTrack(domText) : null;
    if (pair) return { artist: pair[0], title: pair[1], playing, source: 'player bar', raw };
    if (ms.title && ms.artist) {
      return { artist: ms.artist, title: ms.title, playing, source: 'media session', raw };
    }
    return { playing, note: domText ? 'Not a song: ' + domText : 'Nothing detected', raw };
  }

  // Called by the timer and by player events; never more than once a second.
  let lastTickAt = 0;
  function tick() {
    const now = Date.now();
    if (now - lastTickAt < 900) return;
    lastTickAt = now;
    let snap;
    try {
      snap = site === 'apple' ? readApple() : readSirius();
    } catch (e) {
      snap = { note: 'Read error: ' + e.message };
    }
    snap.site = site;
    snap.at = now;
    window.postMessage({ __tabScrobbler: true, snap }, location.origin);
  }

  setInterval(tick, 1000);
})();
