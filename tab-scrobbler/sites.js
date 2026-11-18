// The supported players, keyed by the site id used in messages and storage,
// in the order the settings page lists them. Scrobbling can be switched off
// per site; the ids of the sites that are off live in storage as
// `disabledSites`, so a site added later starts switched on.
globalThis.TabScrobblerSites = {
  siriusxm: 'SiriusXM',
  apple: 'Apple Music',
  accuradio: 'AccuRadio',
  ytmusic: 'YouTube Music',
  spotify: 'Spotify',
};

// The addresses each site's player lives at. These must stay identical to the
// match patterns in manifest.json.
globalThis.TabScrobblerSiteOrigins = {
  siriusxm: [
    'https://*.siriusxm.com/player/*',
    'https://*.siriusxm.ca/player/*',
    'https://player.siriusxm.com/*',
    'https://player.siriusxm.ca/*',
  ],
  apple: ['https://music.apple.com/*', 'https://beta.music.apple.com/*', 'https://classical.music.apple.com/*'],
  accuradio: ['https://*.accuradio.com/*'],
  ytmusic: ['https://music.youtube.com/*'],
  spotify: ['https://open.spotify.com/*'],
};

// The browser decides whether the extension may run on a site. Firefox does
// not grant access to sites added in an update, and the user can switch a
// site off under the add-on's Permissions; without access the extension's
// scripts never start there. These helpers find and fix that.
globalThis.TabScrobblerAccess = {
  // Ids of the sites the browser has not given access to. `skip` lists sites
  // the user has switched off, which need no access.
  async missing(api, skip) {
    const out = [];
    if (!api.permissions) return out;
    for (const [id, origins] of Object.entries(globalThis.TabScrobblerSiteOrigins)) {
      if (skip && skip.includes(id)) continue;
      try {
        if (!(await api.permissions.contains({ origins }))) out.push(id);
      } catch (e) {
        // A browser that cannot answer is treated as having access.
      }
    }
    return out;
  },

  // Asks the user to allow the given sites. Must be called straight from a
  // click handler: browsers refuse a permission prompt without a user action.
  request(api, ids) {
    const origins = ids.flatMap((id) => globalThis.TabScrobblerSiteOrigins[id] || []);
    return api.permissions.request({ origins });
  },

  names(ids) {
    const list = ids.map((id) => globalThis.TabScrobblerSites[id] || id);
    return list.length > 1 ? list.slice(0, -1).join(', ') + ' and ' + list[list.length - 1] : list[0] || '';
  },
};
