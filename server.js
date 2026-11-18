// Streaming Service & Genre Catalogs — a Stremio-format addon for Nuvio (and Stremio).
// Zero dependencies. Requires Node 18+ (uses built-in fetch).
//
// Data comes from TMDB's "Discover" API with JustWatch-powered watch-provider data.
// Items are returned with IMDb ids (tt...) so your existing metadata/stream addons work.

const http = require("http");

const PORT = process.env.PORT || 7000;
const ENV_KEY = process.env.TMDB_API_KEY || "";
const DEFAULTS = {
  region: process.env.REGION || "GB",
  lang: process.env.LANGUAGE || "en-GB",
  genres: true, // add standalone genre rows
};

// ---------------------------------------------------------------------------
// Streaming services. Names are matched against TMDB's provider list for your
// region, so only services that exist in your country appear. `fallback` ids
// are used if the lookup fails.
// ---------------------------------------------------------------------------
const SERVICES = [
  { id: "netflix", name: "Netflix", match: ["netflix"], fallback: "8" },
  { id: "prime", name: "Prime Video", match: ["amazon prime video"], fallback: "9|119" },
  { id: "disney", name: "Disney+", match: ["disney plus"], fallback: "337" },
  { id: "apple", name: "Apple TV+", match: ["apple tv plus", "apple tv+", "apple tv"], fallback: "350" },
  { id: "hbo", name: "HBO Max", match: ["hbo max", "max"], fallback: "1899|384" },
  { id: "hulu", name: "Hulu", match: ["hulu"], fallback: "15" },
  { id: "paramount", name: "Paramount+", match: ["paramount plus", "paramount+"], fallback: "531" },
  { id: "peacock", name: "Peacock", match: ["peacock", "peacock premium"], fallback: "386|387" },
  { id: "now", name: "NOW", match: ["now", "now tv"], fallback: "39" },
  { id: "skygo", name: "Sky Go", match: ["sky go"], fallback: "29" },
  { id: "iplayer", name: "BBC iPlayer", match: ["bbc iplayer"], fallback: "38" },
  { id: "itvx", name: "ITVX", match: ["itvx", "itv x"], fallback: "41" },
  { id: "channel4", name: "Channel 4", match: ["channel 4"], fallback: "103" },
  { id: "starz", name: "Starz", match: ["starz"], fallback: "43" },
  { id: "crunchyroll", name: "Crunchyroll", match: ["crunchyroll"], fallback: "283" },
  { id: "discovery", name: "Discovery+", match: ["discovery plus", "discovery+"], fallback: "524|584" },
  { id: "mubi", name: "MUBI", match: ["mubi"], fallback: "11" },
  { id: "shudder", name: "Shudder", match: ["shudder"], fallback: "99" },
  { id: "stan", name: "Stan", match: ["stan"], fallback: "21" },
  { id: "crave", name: "Crave", match: ["crave"], fallback: "230" },
];

const MOVIE_GENRES = {
  Action: 28, Adventure: 12, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99,
  Drama: 18, Family: 10751, Fantasy: 14, History: 36, Horror: 27, Music: 10402,
  Mystery: 9648, Romance: 10749, "Science Fiction": 878, Thriller: 53, War: 10752, Western: 37,
};
const TV_GENRES = {
  "Action & Adventure": 10759, Animation: 16, Comedy: 35, Crime: 80, Documentary: 99,
  Drama: 18, Family: 10751, Kids: 10762, Mystery: 9648, Reality: 10764,
  "Sci-Fi & Fantasy": 10765, Soap: 10766, "War & Politics": 10768, Western: 37,
};
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9+]/g, "");

// ---------------------------------------------------------------------------
// Tiny TTL cache
// ---------------------------------------------------------------------------
const cache = new Map();
async function cached(key, ttlMs, fn) {
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.val;
  const val = await fn();
  cache.set(key, { val, exp: Date.now() + ttlMs });
  if (cache.size > 20000) cache.delete(cache.keys().next().value);
  return val;
}

async function tmdb(path, params, key) {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== "") url.searchParams.set(k, v);
  const headers = { accept: "application/json" };
  // Support both v3 api keys and v4 read access tokens.
  if (key.length > 40) headers.authorization = `Bearer ${key}`;
  else url.searchParams.set("api_key", key);
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`TMDB ${res.status} on ${path}`);
  return res.json();
}

// Resolve which services exist in the region, and their TMDB provider ids.
async function resolveServices(cfg) {
  return cached(`providers:${cfg.region}`, 24 * 3600e3, async () => {
    try {
      const [m, t] = await Promise.all([
        tmdb("/watch/providers/movie", { watch_region: cfg.region }, cfg.key),
        tmdb("/watch/providers/tv", { watch_region: cfg.region }, cfg.key),
      ]);
      const all = new Map();
      for (const p of [...m.results, ...t.results]) all.set(p.provider_id, p.provider_name);
      const out = [];
      for (const svc of SERVICES) {
        const wanted = svc.match.map(norm);
        const ids = [...all].filter(([, name]) => wanted.includes(norm(name))).map(([id]) => id);
        if (ids.length) out.push({ ...svc, providers: ids.join("|") });
      }
      return out;
    } catch (e) {
      console.warn("Provider lookup failed, using fallbacks:", e.message);
      return SERVICES.map((s) => ({ ...s, providers: s.fallback }));
    }
  });
}

// ---------------------------------------------------------------------------
// Config: either env vars, or a base64url JSON segment in the URL:
//   https://host/<config>/manifest.json   where config = {"key":"...","region":"GB",...}
// ---------------------------------------------------------------------------
function parseConfig(seg) {
  let c = {};
  if (seg) {
    try { c = JSON.parse(Buffer.from(seg, "base64url").toString("utf8")); } catch { return null; }
  }
  const cfg = {
    key: c.key || ENV_KEY,
    region: (c.region || DEFAULTS.region).toUpperCase(),
    lang: c.lang || DEFAULTS.lang,
    genres: c.genres !== undefined ? !!c.genres : DEFAULTS.genres,
    services: Array.isArray(c.services) ? c.services : null, // null = all
  };
  return cfg.key ? cfg : null;
}

async function buildManifest(cfg) {
  const services = (await resolveServices(cfg)).filter((s) => !cfg.services || cfg.services.includes(s.id));
  const catalogs = [];
  const sortOpts = ["Popular", "New", "Top Rated"];

  for (const s of services) {
    catalogs.push(
      { type: "movie", id: `svc.${s.id}`, name: `${s.name} Movies`,
        extra: [{ name: "genre", options: Object.keys(MOVIE_GENRES) }, { name: "skip" }],
        genres: Object.keys(MOVIE_GENRES) },
      { type: "series", id: `svc.${s.id}`, name: `${s.name} Series`,
        extra: [{ name: "genre", options: Object.keys(TV_GENRES) }, { name: "skip" }],
        genres: Object.keys(TV_GENRES) },
    );
  }

  catalogs.push(
    { type: "movie", id: "trending", name: "Trending Movies", extra: [{ name: "skip" }] },
    { type: "series", id: "trending", name: "Trending Series", extra: [{ name: "skip" }] },
  );

  if (cfg.genres) {
    for (const g of Object.keys(MOVIE_GENRES))
      catalogs.push({ type: "movie", id: `genre.${slug(g)}`, name: `${g} Movies`,
        extra: [{ name: "genre", options: sortOpts }, { name: "skip" }], genres: sortOpts });
    for (const g of Object.keys(TV_GENRES))
      catalogs.push({ type: "series", id: `genre.${slug(g)}`, name: `${g} Series`,
        extra: [{ name: "genre", options: sortOpts }, { name: "skip" }], genres: sortOpts });
  }

  return {
    id: "community.streaming.genre.catalogs",
    version: "1.0.0",
    name: "Streaming & Genre Catalogs",
    description: `Catalogs for major streaming services (${cfg.region}) and every genre, powered by TMDB.`,
    logo: "https://www.themoviedb.org/assets/2/v4/logos/v2/blue_square_2-d537fb228cf3ded904ef09b136fe3fec72548ebc1fea3fbbd1ad9e36364db38b.svg",
    resources: ["catalog"],
    types: ["movie", "series"],
    idPrefixes: ["tt"],
    catalogs,
    behaviorHints: { configurable: true, configurationRequired: false },
  };
}

// ---------------------------------------------------------------------------
// Catalog handler
// ---------------------------------------------------------------------------
function parseExtra(str) {
  const out = {};
  if (!str) return out;
  for (const part of str.split("&")) {
    const [k, v] = part.split("=");
    if (k) out[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return out;
}

async function imdbId(kind, id, key) {
  return cached(`imdb:${kind}:${id}`, 30 * 24 * 3600e3, async () => {
    try { return (await tmdb(`/${kind}/${id}/external_ids`, {}, key)).imdb_id || null; }
    catch { return null; }
  });
}

async function toMetas(results, type, kind, cfg) {
  const ids = await Promise.all(results.map((r) => imdbId(kind, r.id, cfg.key)));
  return results
    .map((r, i) => {
      if (!ids[i] || !r.poster_path) return null;
      const date = r.release_date || r.first_air_date || "";
      return {
        id: ids[i],
        type,
        name: r.title || r.name,
        poster: `https://image.tmdb.org/t/p/w500${r.poster_path}`,
        background: r.backdrop_path ? `https://image.tmdb.org/t/p/w1280${r.backdrop_path}` : undefined,
        description: r.overview,
        releaseInfo: date.slice(0, 4),
        imdbRating: r.vote_average ? r.vote_average.toFixed(1) : undefined,
      };
    })
    .filter(Boolean);
}

async function getCatalog(cfg, type, catalogId, extra) {
  const kind = type === "movie" ? "movie" : "tv";
  const page = Math.floor((parseInt(extra.skip, 10) || 0) / 20) + 1;
  if (page > 500) return [];
  const today = new Date().toISOString().slice(0, 10);
  const dateField = kind === "movie" ? "primary_release_date.lte" : "first_air_date.lte";
  const base = { language: cfg.lang, page, include_adult: "false", [dateField]: today };

  let data;
  if (catalogId === "trending") {
    data = await tmdb(`/trending/${kind}/week`, { language: cfg.lang, page }, cfg.key);
  } else if (catalogId.startsWith("svc.")) {
    const svc = (await resolveServices(cfg)).find((s) => s.id === catalogId.slice(4));
    if (!svc) return [];
    const genres = kind === "movie" ? MOVIE_GENRES : TV_GENRES;
    data = await tmdb(`/discover/${kind}`, {
      ...base,
      watch_region: cfg.region,
      with_watch_providers: svc.providers,
      with_watch_monetization_types: "flatrate|free|ads",
      with_genres: extra.genre ? genres[extra.genre] : undefined,
      sort_by: "popularity.desc",
      "vote_count.gte": 10,
    }, cfg.key);
  } else if (catalogId.startsWith("genre.")) {
    const genres = kind === "movie" ? MOVIE_GENRES : TV_GENRES;
    const name = Object.keys(genres).find((g) => slug(g) === catalogId.slice(6));
    if (!name) return [];
    const sort = extra.genre || "Popular";
    const sortBy = sort === "Top Rated" ? "vote_average.desc"
      : sort === "New" ? (kind === "movie" ? "primary_release_date.desc" : "first_air_date.desc")
      : "popularity.desc";
    data = await tmdb(`/discover/${kind}`, {
      ...base,
      with_genres: genres[name],
      sort_by: sortBy,
      "vote_count.gte": sort === "Top Rated" ? 500 : sort === "New" ? 20 : 50,
    }, cfg.key);
  } else return [];

  return toMetas(data.results || [], type, kind, cfg);
}

// ---------------------------------------------------------------------------
// Configure page
// ---------------------------------------------------------------------------
function configurePage() {
  const svcBoxes = SERVICES.map((s) =>
    `<label class="chip"><input type="checkbox" name="svc" value="${s.id}" checked> ${s.name}</label>`).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Streaming & Genre Catalogs</title>
<style>
body{font-family:system-ui,sans-serif;background:#0f1115;color:#e8e8ea;max-width:560px;margin:0 auto;padding:24px}
h1{font-size:22px}label{display:block;margin:14px 0 6px;font-weight:600}
input[type=text],select{width:100%;padding:10px;border-radius:8px;border:1px solid #333;background:#1a1d24;color:#fff;box-sizing:border-box}
.chips{display:flex;flex-wrap:wrap;gap:8px}.chip{display:inline-flex;gap:6px;font-weight:400;margin:0;background:#1a1d24;padding:6px 10px;border-radius:20px}
button{margin-top:20px;width:100%;padding:12px;border:0;border-radius:8px;background:#6c5ce7;color:#fff;font-size:16px;font-weight:600}
#out{margin-top:18px;word-break:break-all;background:#1a1d24;padding:12px;border-radius:8px;display:none}
small{color:#999}
</style></head><body>
<h1>Streaming & Genre Catalogs</h1>
<p><small>Get a free TMDB API key at themoviedb.org → Settings → API.</small></p>
<label>TMDB API key (v3 key or v4 read token)</label><input type="text" id="key" placeholder="Your TMDB key">
<label>Region (country code)</label><input type="text" id="region" value="${DEFAULTS.region}" maxlength="2">
<label>Language</label><input type="text" id="lang" value="${DEFAULTS.lang}">
<label>Services</label><div class="chips">${svcBoxes}</div>
<label class="chip" style="margin-top:14px"><input type="checkbox" id="genres" checked> Include genre rows</label>
<button onclick="go()">Generate install link</button>
<div id="out"></div>
<script>
function go(){
  const key=document.getElementById('key').value.trim();
  if(!key){alert('Enter your TMDB key');return}
  const cfg={key,region:document.getElementById('region').value.trim().toUpperCase(),
    lang:document.getElementById('lang').value.trim(),genres:document.getElementById('genres').checked,
    services:[...document.querySelectorAll('input[name=svc]:checked')].map(e=>e.value)};
  const b64=btoa(unescape(encodeURIComponent(JSON.stringify(cfg)))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
  const url=location.origin+'/'+b64+'/manifest.json';
  const o=document.getElementById('out');o.style.display='block';
  o.innerHTML='<b>Paste this into Nuvio → Settings → Addons → Add Addon:</b><br><br>'+url+
    '<br><br><button onclick="navigator.clipboard.writeText(\\''+url+'\\')">Copy link</button>'+
    '<br><a style="color:#a29bfe" href="'+url.replace(/^https?:/,'stremio:')+'">Or install in Stremio</a>';
}
</script></body></html>`;
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------
function send(res, code, body, type = "application/json", maxAge = 0) {
  res.writeHead(code, {
    "Content-Type": type,
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    ...(maxAge ? { "Cache-Control": `public, max-age=${maxAge}` } : {}),
  });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");
    const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
    const parts = path.split("/").filter(Boolean);

    // Optional leading config segment
    let cfgSeg = null;
    if (parts.length && !["manifest.json", "catalog", "configure"].includes(parts[0])) cfgSeg = parts.shift();

    if (!parts.length || parts[0] === "configure") return send(res, 200, configurePage(), "text/html");

    const cfg = parseConfig(cfgSeg);
    if (!cfg) return send(res, 400, { error: "Missing or invalid TMDB key. Visit /configure." });

    if (parts[0] === "manifest.json") return send(res, 200, await buildManifest(cfg), "application/json", 3600);

    if (parts[0] === "catalog" && parts.length >= 3) {
      const type = parts[1];
      let id = parts[2], extraStr = "";
      if (parts.length >= 4) extraStr = parts[3];
      id = id.replace(/\.json$/, "");
      extraStr = extraStr.replace(/\.json$/, "");
      const extra = parseExtra(extraStr);
      const key = `cat:${cfg.region}:${cfg.lang}:${type}:${id}:${extraStr}`;
      const metas = await cached(key, 6 * 3600e3, () => getCatalog(cfg, type, id, extra));
      return send(res, 200, { metas }, "application/json", 6 * 3600);
    }

    send(res, 404, { error: "Not found" });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => console.log(`Addon running: http://localhost:${PORT}/configure`));
}
module.exports = { server, buildManifest, getCatalog, parseConfig };
