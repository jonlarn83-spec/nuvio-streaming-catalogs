# Streaming & Genre Catalogs (Nuvio / Stremio addon)

Adds home-screen rows for the major streaming services (Netflix, Prime Video, Disney+, Apple TV+, HBO Max, Paramount+, NOW, Sky Go, BBC iPlayer, ITVX, Channel 4, Crunchyroll, MUBI and more), plus a row for every genre and Trending rows. Only services available in your region are shown.

- Every service row has a **genre filter** (e.g. Netflix → Horror).
- Every genre row has **Popular / New / Top Rated** sorting.
- Items use IMDb IDs, so your existing stream and metadata addons work with them.
- No dependencies. Needs Node 18 or newer.

## 1. Get a TMDB key (free)
Sign up at themoviedb.org, then go to Settings → API and copy the **API Key** (or the Read Access Token).

## 2. Host it (Nuvio needs a public HTTPS URL)
**Render (free):** push this folder to a GitHub repo, then in Render choose New → Web Service → your repo. Set the build command to `npm install` and the start command to `npm start`.
**Any Docker host:** `docker build -t catalogs . && docker run -p 7000:7000 catalogs`
**Local test:** `node server.js`, then open http://localhost:7000/configure

## 3. Install in Nuvio
1. Open `https://YOUR-HOST/configure`
2. Enter your TMDB key, choose your region (GB by default) and the services you want, then generate the link.
3. In Nuvio, go to Settings → Addons → Add Addon, paste the link and install.

Your key is stored only inside your install link, so keep the link private.

### Optional environment variables
`TMDB_API_KEY` (then a plain `/manifest.json` works without configuring), `REGION` (default GB), `LANGUAGE` (default en-GB), `PORT` (default 7000).

## Adding more services
Add an entry to `SERVICES` in `server.js`. The `match` value must be the provider's name as TMDB lists it.
