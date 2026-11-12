# Privacy policy — Tab Scrobbler

Tab Scrobbler has no server of its own and no analytics. It talks to exactly one service, Last.fm, and only
when you have connected a Last.fm account.

## What it reads

On the SiriusXM web player and the Apple Music web player, the extension reads the name of the track currently
playing: artist, title, album (where shown), track length (Apple Music only) and whether playback is running.
It reads nothing else from those pages and runs on no other sites.

## What it sends, and to whom

When a track has played long enough to count as a listen, the extension sends that track's artist, title,
album, length and the time you started playing it to Last.fm (`ws.audioscrobbler.com`), using the account you
connected. While a track is playing it also sends the same details as a Last.fm "now playing" update. Nothing
is sent anywhere else, and nothing is sent at all until you connect an account or while scrobbling is switched
off in the toolbar popup.

## What it stores

In the browser's extension storage, on your device only:

- the Last.fm session key and username obtained when you connected, so you do not have to approve access
  again;
- tracks waiting to be sent while Last.fm is unreachable (kept for at most two weeks), and the last twenty
  sent;
- your settings.

Disconnecting on the settings page deletes the session key. Removing the extension deletes everything. The
extension never sees your Last.fm password; you approve access on Last.fm's own site, and you can revoke it
at any time under Last.fm → Settings → Applications.

## Third parties

Last.fm's handling of the data it receives is governed by Last.fm's own privacy policy. SiriusXM and Apple
receive nothing from this extension.

## Contact

Questions and issues: <https://github.com/NeilN1/TabScrobbler/issues>.
