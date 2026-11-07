// Decides when a track counts as played. Fed one snapshot per second by
// content.js; calls back when "now playing" should be sent and when the track
// has earned a scrobble (Last.fm rule: longer than 30s, and played for half
// its length or 4 minutes, whichever comes first).
(function (root) {
  'use strict';

  const MIN_DURATION = 30;
  const MAX_THRESHOLD = 240;
  // Longest gap between two snapshots that still counts as listening time.
  // Covers timer throttling in background tabs without counting sleep/wake.
  const MAX_TICK_MS = 65000;
  // On radio, the same artist/title coming back after this long is a new play.
  const RADIO_GAP_MS = 180000;
  // SiriusXM fills the track line with promos, handles and phone numbers
  // between songs and on talk channels.
  const JUNK = /@|#(?!\d)|\.com\b|\.ca\b|facebook|twitter|instagram|siriusxm|1-8\d\d-/i;

  function tidy(s) {
    return typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '';
  }

  // Normalises a raw snapshot from page.js. Artist and title come back empty
  // when the page is showing something that is not a song.
  function cleanSnapshot(snap) {
    if (!snap) return null;
    let artist = tidy(snap.artist);
    let title = tidy(snap.title);
    if (snap.site === 'siriusxm') {
      // Decade channels append the release year, e.g. "Song (84)".
      title = tidy(title.replace(/\s*\(\d{2}\)$/, '').replace(/\bEXCLUSIVE\b/g, ''));
      if (JUNK.test(artist) || JUNK.test(title)) {
        artist = '';
        title = '';
      }
    }
    return {
      artist,
      title,
      album: tidy(snap.album),
      duration: Number.isFinite(snap.duration) && snap.duration > 0 ? snap.duration : 0,
      position: Number.isFinite(snap.position) ? snap.position : null,
      playing: snap.playing === true,
    };
  }

  class Tracker {
    // opts: onNowPlaying(track), onScrobble(track, startedAtUnixSeconds),
    // unknownSeconds() -> listening time required when the length is unknown.
    constructor(opts) {
      this.onNowPlaying = opts.onNowPlaying;
      this.onScrobble = opts.onScrobble;
      this.unknownSeconds = opts.unknownSeconds || (() => 60);
      this.cur = null;
    }

    threshold() {
      const c = this.cur;
      if (!c) return Infinity;
      const d = c.track.duration;
      if (d > 0) return d < MIN_DURATION ? Infinity : Math.min(d / 2, MAX_THRESHOLD);
      return Math.max(MIN_DURATION, Number(this.unknownSeconds()) || 60);
    }

    update(snap, now) {
      const key = snap && snap.artist && snap.title ? (snap.artist + '\n' + snap.title).toLowerCase() : null;
      let c = this.cur;
      if (!key) {
        // Metadata blips between songs must not reset a half-played track.
        if (c) c.wasPlaying = false;
        return;
      }

      const same = c && c.key === key;
      const radioReplay = same && !(c.track.duration > 0) && now - c.lastSeen > RADIO_GAP_MS;
      const restarted =
        same &&
        c.scrobbled &&
        snap.position !== null &&
        c.lastPosition !== null &&
        snap.position < 5 &&
        c.lastPosition - snap.position > 30;

      if (!same || radioReplay || restarted) {
        c = this.cur = {
          key,
          track: { artist: snap.artist, title: snap.title, album: '', duration: 0 },
          playedMs: 0,
          startedAt: 0,
          scrobbled: false,
          wasPlaying: false,
          lastTick: now,
          lastSeen: now,
          lastPosition: null,
          nowPlayingAt: 0,
        };
      }

      // Album and duration often arrive a moment after the title.
      if (snap.album) c.track.album = snap.album;
      if (snap.duration > 0) c.track.duration = snap.duration;

      if (snap.playing) {
        if (c.wasPlaying) c.playedMs += Math.min(Math.max(now - c.lastTick, 0), MAX_TICK_MS);
        if (!c.startedAt) c.startedAt = Math.floor(now / 1000);
        if (!c.nowPlayingAt || (!c.wasPlaying && now - c.nowPlayingAt > 60000)) {
          c.nowPlayingAt = now;
          this.onNowPlaying({ ...c.track });
        }
        if (!c.scrobbled && c.playedMs / 1000 >= this.threshold()) {
          c.scrobbled = true;
          this.onScrobble({ ...c.track }, c.startedAt);
        }
      }

      c.wasPlaying = snap.playing;
      c.lastTick = now;
      c.lastSeen = now;
      if (snap.position !== null) c.lastPosition = snap.position;
    }

    // Summary for the popup.
    state() {
      const c = this.cur;
      if (!c) return null;
      const threshold = this.threshold();
      return {
        track: { ...c.track },
        playing: c.wasPlaying,
        playedSeconds: Math.floor(c.playedMs / 1000),
        thresholdSeconds: Number.isFinite(threshold) ? Math.ceil(threshold) : null,
        scrobbled: c.scrobbled,
      };
    }
  }

  root.TabScrobbler = { Tracker, cleanSnapshot };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.TabScrobbler;
})(globalThis);
