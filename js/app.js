// Contexto compartido entre módulos. main.js lo completa al arrancar
// (engine, library, player, auth, playlists, stats, artist, render, go, toast…).
export const app = {
  ui: { view: 'home', param: null, back: [], query: '', panel: null, lists: [], chunks: [], npOpen: false },
  actions: {},
  forms: {},
  user: null,
  profile: null,
  prefs: {},
};

export const registerActions = (map) => Object.assign(app.actions, map);
