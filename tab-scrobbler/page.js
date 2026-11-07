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

  function readApple() {
    let mk = null;
    try {
      mk = window.MusicKit && window.MusicKit.getInstance && window.MusicKit.getInstance();
    } catch (e) {
      // MusicKit throws until the page has configured it.
    }
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

  // The player may use an <audio> element that is never attached to the
  // document, so remember every element that play() is called on.
  const seen = new WeakSet();
  const refs = [];
  function remember(el) {
    if (el instanceof HTMLMediaElement && !seen.has(el)) {
      seen.add(el);
      refs.push(new WeakRef(el));
    }
  }
  if (site === 'siriusxm') {
    const origPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function (...args) {
      remember(this);
      return origPlay.apply(this, args);
    };
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
    const ms = mediaSessionInfo();
    const bar = document.querySelector(BAR);
    const titleEl = bar && bar.querySelector("[class*='title']");
    const domText = titleEl ? titleEl.textContent.replace(/\s+/g, ' ').trim() : '';

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

  function tick() {
    let snap;
    try {
      snap = site === 'apple' ? readApple() : readSirius();
    } catch (e) {
      snap = { note: 'Read error: ' + e.message };
    }
    snap.site = site;
    window.postMessage({ __tabScrobbler: true, snap }, location.origin);
  }

  setInterval(tick, 1000);
})();
