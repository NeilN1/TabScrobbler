// Last.fm application credentials, shared by every install of this build.
//
// Last.fm has no public-client auth flow: the shared secret is needed to sign
// the authorization handshake itself, so it ships with the extension, as it
// does in every open-source scrobbler. Users only approve access once.
// Register an application at https://www.last.fm/api/account/create and
// paste its values here before signing a build.
globalThis.TabScrobblerConfig = {
  apiKey: '2475d439cde7b4950bdb8834b3aec29d',
  apiSecret: '8ae77d28c4dda2d6c093c91c10bf4b88',
};
