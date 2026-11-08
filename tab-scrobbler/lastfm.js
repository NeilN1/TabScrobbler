// Minimal Last.fm API client: desktop auth flow, now-playing and scrobble.
// Every call takes cfg = { apiKey, apiSecret, sessionKey }.
(function (root) {
  'use strict';

  const API_URL = 'https://ws.audioscrobbler.com/2.0/';
  const AUTH_URL = 'https://www.last.fm/api/auth/';

  // Temporary failures: keep the scrobble queued and try again later.
  const RETRYABLE = [-1, 8, 11, 16, 29];
  // Credential problems: keep the queue, stop until the user fixes settings.
  const BLOCKING = [4, 9, 10, 13, 14, 15, 26];

  class LastFmError extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'LastFmError';
      this.code = code;
      this.retryable = RETRYABLE.includes(code);
      this.blocking = BLOCKING.includes(code);
    }
  }

  function sign(params, secret) {
    const base = Object.keys(params)
      .sort()
      .map((k) => k + params[k])
      .join('');
    return root.md5(base + secret);
  }

  async function call(cfg, method, params, opts) {
    const post = Boolean(opts && opts.post);
    const p = { method, api_key: cfg.apiKey };
    for (const [k, v] of Object.entries(params || {})) {
      if (v !== undefined && v !== null && v !== '') p[k] = String(v);
    }
    p.api_sig = sign(p, cfg.apiSecret);
    p.format = 'json';

    const body = new URLSearchParams(p);
    let resp;
    try {
      resp = post
        ? await fetch(API_URL, { method: 'POST', body })
        : await fetch(API_URL + '?' + body.toString());
    } catch (e) {
      throw new LastFmError('Network error: ' + e.message, -1);
    }
    let data = null;
    try {
      data = await resp.json();
    } catch (e) {
      // Non-JSON body; handled below through the HTTP status.
    }
    if (data && data.error) {
      throw new LastFmError(data.message || 'Last.fm error ' + data.error, Number(data.error));
    }
    if (!resp.ok || !data) {
      // Non-JSON (captive portal, proxy page), 429 and 5xx are transient.
      const transient = !data || resp.status === 429 || resp.status >= 500;
      throw new LastFmError('Last.fm returned HTTP ' + resp.status, transient ? -1 : -2);
    }
    return data;
  }

  async function getToken(cfg) {
    const data = await call(cfg, 'auth.getToken');
    return data.token;
  }

  function authUrl(cfg, token) {
    return AUTH_URL + '?' + new URLSearchParams({ api_key: cfg.apiKey, token }).toString();
  }

  // Throws code 14 until the user has approved the token in the browser.
  async function getSession(cfg, token) {
    const data = await call(cfg, 'auth.getSession', { token });
    return { key: data.session.key, name: data.session.name };
  }

  function trackParams(cfg, track) {
    return {
      artist: track.artist,
      track: track.title,
      album: track.album,
      duration: track.duration > 0 ? Math.round(track.duration) : undefined,
      sk: cfg.sessionKey,
    };
  }

  function updateNowPlaying(cfg, track) {
    return call(cfg, 'track.updateNowPlaying', trackParams(cfg, track), { post: true });
  }

  async function scrobble(cfg, track, timestamp) {
    const params = trackParams(cfg, track);
    params.timestamp = timestamp;
    const data = await call(cfg, 'track.scrobble', params, { post: true });
    const s = (data && data.scrobbles) || {};
    const attr = s['@attr'] || {};
    const one = Array.isArray(s.scrobble) ? s.scrobble[0] : s.scrobble;
    const ignored = (one && one.ignoredMessage) || {};
    return {
      accepted: Number(attr.accepted) > 0,
      message: Number(attr.ignored) > 0 ? ignored['#text'] || 'Ignored by Last.fm (code ' + ignored.code + ')' : '',
    };
  }

  const LastFm = { LastFmError, sign, getToken, authUrl, getSession, updateNowPlaying, scrobble };
  root.LastFm = LastFm;
  if (typeof module !== 'undefined' && module.exports) module.exports = LastFm;
})(globalThis);
