# Rad Mobility

- Add 0.1 to `<meta name="version">` in `index.html` in every change to the app (index.html, videos.js, icons, manifest) that gets merged to `main` (2.0, 2.1 … 2.9, then 3.0). Changes that don't touch the app, like workflows or this file, don't bump it. It's shown at the bottom of the app and drives the "Version N is ready" update notice, so a change without a bump won't be announced.
- The app is served from two places, both built from `main`: GitHub Pages (michaelrad100.github.io/rad-mobility, republishes on its own) and michaelrad.me/mobility (copied in when the michaelrad.me site on Railway rebuilds, which `.github/workflows/rebuild-michaelrad-me.yml` triggers on every push to `main`).
