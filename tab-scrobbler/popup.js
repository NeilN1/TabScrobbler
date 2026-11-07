'use strict';

(() => {
  const api = globalThis.browser ?? globalThis.chrome;
  const $ = (id) => document.getElementById(id);

  const PLAYER_URLS = [
    'https://music.apple.com/*',
    'https://beta.music.apple.com/*',
    'https://classical.music.apple.com/*',
    'https://*.siriusxm.com/*',
    'https://*.siriusxm.ca/*',
  ];
  const SITE_NAMES = { apple: 'Apple Music', siriusxm: 'SiriusXM' };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function clock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  async function playerStates() {
    let tabs = [];
    try {
      tabs = await api.tabs.query({ url: PLAYER_URLS });
    } catch (e) {
      return [];
    }
    const replies = await Promise.all(
      tabs.map(async (tab) => {
        try {
          return await api.tabs.sendMessage(tab.id, { type: 'getState' });
        } catch (e) {
          return null; // tab opened before the extension was loaded
        }
      })
    );
    return replies.filter((r) => r && r.site);
  }

  function renderPlayers(states) {
    const box = $('players');
    box.replaceChildren();
    if (!states.length) {
      box.append(el('div', 'small muted', 'No player found. Open SiriusXM or Apple Music in a tab (reload it if it was already open).'));
      return;
    }
    for (const s of states) {
      const card = el('div', 'card');
      const st = s.state;
      card.append(el('div', 'small muted', SITE_NAMES[s.site] || s.site));
      const raw = s.raw || {};
      if (st && st.track) {
        card.append(el('div', 'title', st.track.title));
        card.append(el('div', 'small', st.track.album ? st.track.artist + ' · ' + st.track.album : st.track.artist));
        let line;
        if (st.scrobbled) line = el('div', 'small ok', 'Scrobbled ✓');
        else if (st.thresholdSeconds === null) line = el('div', 'small muted', 'Too short to scrobble');
        else {
          line = el(
            'div',
            'small muted',
            (st.playing ? 'Playing' : 'Paused') + ' — ' + clock(st.playedSeconds) + ' of ' + clock(st.thresholdSeconds) + ' needed to scrobble'
          );
        }
        card.append(line);
        if (s.staleSeconds > 5) {
          card.append(el('div', 'small bad', 'The page stopped reporting ' + s.staleSeconds + 's ago'));
        }
      } else {
        const shown = [raw.artist, raw.title].filter(Boolean).join(' — ');
        card.append(el('div', 'small', raw.note || (shown ? 'Not treated as a song: ' + shown : 'Nothing playing')));
      }
      box.append(card);
    }
  }

  function renderRecent(recent, queue) {
    const list = $('recent');
    list.replaceChildren();
    for (const q of queue.slice().reverse()) {
      const li = el('li');
      li.append(el('span', '', q.track.artist + ' — ' + q.track.title), el('span', 'muted', '  waiting to send'));
      list.append(li);
    }
    for (const r of recent) {
      const li = el('li');
      li.append(el('span', '', r.track.artist + ' — ' + r.track.title));
      const when = new Date(r.timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      if (r.status === 'scrobbled') li.append(el('span', 'muted', '  ' + when));
      else li.append(el('span', 'bad', '  ' + r.status + (r.note ? ': ' + r.note : '')));
      list.append(li);
    }
    if (!list.children.length) list.append(el('li', 'muted', 'Nothing yet.'));
  }

  async function render() {
    const s = await api.storage.local.get(['apiKey', 'sessionKey', 'username', 'enabled', 'queue', 'recent', 'lastError']);
    $('enabled').checked = s.enabled !== false;

    const account = $('account');
    account.replaceChildren();
    if (s.sessionKey) {
      account.append('Connected to Last.fm as ' + (s.username || 'unknown') + ' · ');
    } else {
      account.append(el('span', 'bad', 'Not connected to Last.fm'), ' · ');
    }
    const link = el('a', '', 'Settings');
    link.href = '#';
    link.addEventListener('click', (e) => {
      e.preventDefault();
      api.runtime.openOptionsPage();
    });
    account.append(link);

    $('error').textContent = s.lastError ? 'Last.fm: ' + s.lastError : '';

    const states = await playerStates();
    renderPlayers(states);
    renderRecent(s.recent || [], s.queue || []);
    $('raw').textContent = states.length ? JSON.stringify(states.map((x) => x.raw), null, 2) : '(no player tab)';
  }

  $('enabled').addEventListener('change', (e) => api.storage.local.set({ enabled: e.target.checked }));

  render();
  setInterval(render, 1000);
})();
