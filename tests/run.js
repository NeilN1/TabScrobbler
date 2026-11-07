// Node checks for the parts that can be tested without a browser:
//   node tests/run.js
'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');

const ext = path.join(__dirname, '..', 'tab-scrobbler');
const { md5 } = require(path.join(ext, 'md5.js'));
const LastFm = require(path.join(ext, 'lastfm.js'));
const { Tracker, cleanSnapshot } = require(path.join(ext, 'tracker.js'));

let passed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log('ok   ' + name);
    })
    .catch((err) => {
      process.exitCode = 1;
      console.log('FAIL ' + name + '\n     ' + String(err.message).split('\n').join('\n     '));
    });
}

const ref = (s) => crypto.createHash('md5').update(s, 'utf8').digest('hex');

// Drives a Tracker with one snapshot per second and records its callbacks.
function harness(unknownSeconds) {
  const events = [];
  const tracker = new Tracker({
    onNowPlaying: (t) => events.push({ type: 'nowPlaying', track: t }),
    onScrobble: (t, ts) => events.push({ type: 'scrobble', track: t, ts }),
    unknownSeconds: () => unknownSeconds || 60,
  });
  let now = 1_700_000_000_000;
  return {
    events,
    tracker,
    scrobbles: () => events.filter((e) => e.type === 'scrobble'),
    // Feed `seconds` ticks of the same raw snapshot; position advances if set.
    play(raw, seconds) {
      for (let i = 0; i < seconds; i++) {
        const snap = { ...raw };
        if (typeof raw.position === 'number') snap.position = raw.position + i;
        tracker.update(cleanSnapshot(snap), now);
        now += 1000;
      }
    },
    skip(ms) {
      now += ms;
    },
  };
}

const song = (over) => ({ site: 'apple', artist: 'Low', title: 'Lullaby', album: 'I Could Live in Hope', duration: 200, position: 0, playing: true, ...over });
const radio = (over) => ({ site: 'siriusxm', artist: 'Wilco', title: 'Jesus, Etc.', playing: true, ...over });

(async () => {
  await test('md5 matches Node crypto across lengths and unicode', () => {
    const samples = ['', 'a', 'abc', 'message digest', 'Björk — Jóga', '日本語のタイトル', '🎵'.repeat(40)];
    for (const n of [55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) samples.push('x'.repeat(n));
    for (const s of samples) assert.equal(md5(s), ref(s), 'input length ' + s.length);
  });

  await test('signature sorts parameters and appends the secret', () => {
    const params = { method: 'auth.getSession', token: 'tok', api_key: 'key' };
    assert.equal(LastFm.sign(params, 'secret'), ref('api_keykeymethodauth.getSessiontokentoksecret'));
  });

  await test('scrobble request is a signed form POST with the right fields', async () => {
    const calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, json: async () => ({ scrobbles: { '@attr': { accepted: 1, ignored: 0 }, scrobble: {} } }) };
    };
    const cfg = { apiKey: 'key', apiSecret: 'secret', sessionKey: 'sk1' };
    const res = await LastFm.scrobble(cfg, { artist: 'Sigur Rós', title: 'Hoppípolla', album: '', duration: 268.4 }, 1700000000);
    assert.equal(res.accepted, true);
    assert.equal(calls[0].url, 'https://ws.audioscrobbler.com/2.0/');
    assert.equal(calls[0].init.method, 'POST');
    const sent = Object.fromEntries(calls[0].init.body);
    assert.deepEqual(Object.keys(sent).sort(), ['api_key', 'api_sig', 'artist', 'duration', 'format', 'method', 'sk', 'timestamp', 'track']);
    assert.equal(sent.duration, '268');
    assert.equal(sent.track, 'Hoppípolla');
    const { api_sig, format, ...signed } = sent;
    assert.equal(api_sig, LastFm.sign(signed, 'secret'));
  });

  await test('Last.fm errors are classified for the retry queue', async () => {
    const respond = (body, status) => {
      globalThis.fetch = async () => ({ ok: status < 400, status, json: async () => body });
    };
    const cfg = { apiKey: 'k', apiSecret: 's', sessionKey: 'sk' };
    const attempt = () => LastFm.scrobble(cfg, { artist: 'a', title: 't' }, 1).then(() => null, (e) => e);

    respond({ error: 9, message: 'Invalid session key' }, 403);
    let err = await attempt();
    assert.equal(err.code, 9);
    assert.equal(err.blocking, true);
    assert.equal(err.retryable, false);

    respond({ error: 16, message: 'Temporarily unavailable' }, 200);
    err = await attempt();
    assert.equal(err.retryable, true);

    globalThis.fetch = async () => {
      throw new TypeError('offline');
    };
    err = await attempt();
    assert.equal(err.retryable, true);

    respond({ error: 6, message: 'Invalid parameters' }, 400);
    err = await attempt();
    assert.equal(err.retryable || err.blocking, false);
  });

  await test('known length: scrobbles once at half the track', () => {
    const h = harness();
    h.play(song(), 100);
    assert.equal(h.scrobbles().length, 0, 'not yet at 99s played');
    h.play(song({ position: 100 }), 100);
    assert.equal(h.scrobbles().length, 1);
    assert.equal(h.scrobbles()[0].track.album, 'I Could Live in Hope');
    assert.equal(h.events[0].type, 'nowPlaying');
  });

  await test('long tracks scrobble at four minutes', () => {
    const h = harness();
    h.play(song({ duration: 1200 }), 240);
    assert.equal(h.scrobbles().length, 0);
    h.play(song({ duration: 1200, position: 240 }), 2);
    assert.equal(h.scrobbles().length, 1);
  });

  await test('tracks under 30 seconds never scrobble', () => {
    const h = harness();
    h.play(song({ duration: 25 }), 60);
    assert.equal(h.scrobbles().length, 0);
  });

  await test('paused time does not count', () => {
    const h = harness();
    h.play(song(), 60);
    h.play(song({ playing: false, position: 60 }), 600);
    assert.equal(h.scrobbles().length, 0);
    h.play(song({ position: 60 }), 45);
    assert.equal(h.scrobbles().length, 1);
  });

  await test('scrobble timestamp is when the track started', () => {
    const h = harness();
    h.play(song(), 150);
    assert.equal(h.scrobbles()[0].ts, 1_700_000_000);
  });

  await test('a new track resets the count; skipping early does not scrobble', () => {
    const h = harness();
    h.play(song(), 50);
    h.play(song({ title: 'Words', duration: 300 }), 50);
    assert.equal(h.scrobbles().length, 0);
    h.play(song({ title: 'Words', duration: 300, position: 50 }), 110);
    assert.equal(h.scrobbles().length, 1);
    assert.equal(h.scrobbles()[0].track.title, 'Words');
  });

  await test('a track on repeat scrobbles each time round', () => {
    const h = harness();
    h.play(song(), 200);
    h.play(song(), 200);
    assert.equal(h.scrobbles().length, 2);
  });

  await test('radio: scrobbles after the configured listening time', () => {
    const h = harness(60);
    h.play(radio(), 60);
    assert.equal(h.scrobbles().length, 0);
    h.play(radio(), 2);
    assert.equal(h.scrobbles().length, 1);
    h.play(radio(), 300);
    assert.equal(h.scrobbles().length, 1, 'still one for the same song');
  });

  await test('radio: a short metadata blip does not double-scrobble', () => {
    const h = harness(60);
    h.play(radio(), 90);
    h.play(radio({ artist: '', title: '' }), 5);
    h.play(radio(), 90);
    assert.equal(h.scrobbles().length, 1);
  });

  await test('radio: the same song an hour later is a new play', () => {
    const h = harness(60);
    h.play(radio(), 90);
    h.play(radio({ artist: '@SiriusXM', title: 'Call us 1-877-33-SIRIUS' }), 30);
    h.skip(3_600_000);
    h.play(radio(), 90);
    assert.equal(h.scrobbles().length, 2);
  });

  await test('SiriusXM promos and handles are not songs; real titles survive', () => {
    const junk = [
      { artist: '@SXMHits1', title: 'Hits 1' },
      { artist: 'Alt Nation', title: 'siriusxm.com/altnation' },
      { artist: 'Call In', title: '1-877-33-SIRIUS' },
      { artist: 'The Pulse', title: '#PulseParty' },
    ];
    for (const j of junk) {
      const c = cleanSnapshot({ site: 'siriusxm', playing: true, ...j });
      assert.equal(c.artist + c.title, '', JSON.stringify(j));
    }
    assert.equal(cleanSnapshot(radio({ artist: 'Garbage', title: '#1 Crush' })).title, '#1 Crush');
    assert.equal(cleanSnapshot(radio({ artist: 'a-ha', title: 'Take On Me (85)' })).title, 'Take On Me');
    assert.equal(cleanSnapshot(song({ artist: 'will.i.am', title: '#thatPOWER' })).title, '#thatPOWER', 'Apple Music is not filtered');
  });

  await test('throttled ticks: the player clock fills in the gaps', () => {
    const h = harness();
    // Two looks 120 seconds apart, as a heavily throttled background tab
    // might allow. Wall-clock alone would credit at most about a minute.
    h.play(song({ position: 0 }), 1);
    h.skip(119_000);
    assert.equal(h.scrobbles().length, 0);
    h.play(song({ position: 120 }), 1);
    assert.equal(h.scrobbles().length, 1);
  });

  await test('a stalled player clock still counts wall-clock listening', () => {
    const h = harness();
    h.play(song({ position: 10 }), 10);
    for (let i = 0; i < 100; i++) h.play({ ...song(), position: 20 }, 1);
    assert.equal(h.scrobbles().length, 1);
  });

  await test('seeking forward does not count the skipped part', () => {
    const h = harness();
    h.play(song(), 20);
    h.play(song({ position: 150 }), 20);
    assert.equal(h.scrobbles().length, 0);
    assert.ok(h.tracker.state().playedSeconds < 50, 'got ' + h.tracker.state().playedSeconds);
  });

  await test('a sleep/wake gap counts for at most about a minute', () => {
    const h = harness();
    h.play(song({ duration: 400 }), 10);
    h.skip(8 * 3_600_000);
    h.play(song({ duration: 400, position: 10 }), 10);
    assert.equal(h.scrobbles().length, 0);
    assert.ok(h.tracker.state().playedSeconds < 90);
  });

  console.log('\n' + passed + ' passed' + (process.exitCode ? ', with failures' : ''));
})();
