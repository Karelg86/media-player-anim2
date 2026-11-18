/**
 * Shirox / Sora / Luna Module Extractor - AnimeUnity IT
 * Versione: 1.1.0
 *
 * Novità v1.1.0 (18/11/2026): il sito si è spostato su animeunity.cx ed è stato rifatto.
 * - Ricerca da /api/search?q= (JSON). Un anime ha ora una sola scheda con le varianti di lingua:
 *   se esistono sia "ita" (doppiato) sia "jpn" (sottotitolato) si mostrano due risultati,
 *   "Titolo (ITA)" e "Titolo", come prima.
 * - Dettagli dalla pagina /anime/{id}-{slug} (JSON nell'attributo data-page, props.anime)
 * - Episodi da /api/anime/{id}/episodes?start=N a blocchi da 120, max EPISODE_CONCURRENCY in parallelo
 * - Stream: pagina /anime/{id}-{slug}/{videoId} -> props.embedUrl (embed Vixcloud) -> Master Playlist HLS
 *
 * v1.0.3: soraFetch ritenta fino a 3 volte (pausa 1 s, 2 s) se la rete fallisce o il server
 * risponde 5xx/429/408, entro ~50 s (Shirox concede 120 s a ogni funzione del modulo)
 */

const CONFIG = {
  BASE: "https://animeunity.cx",
};

// Il sito restituisce 120 episodi per richiesta (tab_size)
const EPISODE_PAGE_SIZE = 120;
// Quanti blocchi da 120 episodi scaricare contemporaneamente (One Piece = 10 blocchi)
const EPISODE_CONCURRENCY = 3;
// Lingue delle varianti, nell'ordine in cui compaiono i risultati
const LANGUAGES = ["ita", "jpn"];

// --- UTILITY ---
function decodeEntities(str = "") {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function withParams(url, params) {
  if (!url) return "";
  const [main, hash = ""] = url.split("#");
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  if (!qs) return url;
  const sep = main.includes("?") ? (main.endsWith("?") || main.endsWith("&") ? "" : "&") : "?";
  return main + sep + qs + (hash ? "#" + hash : "");
}

// Esegue fn su ogni elemento con al massimo `limit` operazioni in parallelo.
// I risultati restano nello stesso ordine degli elementi.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length).fill(null);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (error) {
        results[i] = null;
      }
    }
  }
  const workers = [];
  for (let w = 0; w < Math.min(Math.max(limit, 1), items.length); w++) {
    workers.push(worker());
  }
  await Promise.all(workers);
  return results;
}

// Props della pagina (Inertia): JSON nell'attributo data-page, codificato da Laravel
// (&quot; &#039; &lt; &gt; &amp;). Qui si decodifica tutto PRIMA del parse: le virgolette dentro
// le stringhe JSON arrivano già come \&quot; e diventano \" (JSON valido). &amp; per ultimo,
// altrimenti "&amp;lt;" diventerebbe "<".
function parsePageProps(html) {
  const match = /\sdata-page="([^"]*)"/.exec(html || "");
  if (!match || !match[1]) return null;
  const json = match[1]
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&#x0*27;|&apos;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
  const page = JSON.parse(json);
  return page && page.props ? page.props : null;
}

// "https://animeunity.cx/anime/4851-frieren/74644" -> { animeId: "4851", slug: "frieren", videoId: "74644", lang: null }
// "https://animeunity.cx/anime/4851-frieren?lang=ita" -> { animeId: "4851", slug: "frieren", videoId: null, lang: "ita" }
function parseAnimeUrl(url) {
  const match = /\/anime\/(\d+)-([^/?#]+)(?:\/(\d+))?/.exec(url || "");
  if (!match) return null;
  const langMatch = /[?&]lang=(ita|jpn)\b/.exec(url);
  return { animeId: match[1], slug: match[2], videoId: match[3] || null, lang: langMatch ? langMatch[1] : null };
}

// Video di un episodio nella lingua chiesta; senza lingua il primo disponibile.
function pickVideo(episode, lang) {
  const videos = (episode && Array.isArray(episode.videos) ? episode.videos : []).filter((v) => v && !v.is_hidden);
  if (lang) return videos.find((v) => v.language === lang) || null;
  return videos[0] || null;
}

// --- FETCH ENGINE COMPATIBILE SHIROX / SORA / LUNA ---
// Rete debole o sito sovraccarico: una richiesta fallita o con errore del server viene ritentata,
// invece di arrivare a Shirox come stream/lista vuota al primo errore.
// Il limite di tempo resta sotto i 120 s che Shirox concede a ogni funzione del modulo.
const FETCH_ATTEMPTS = 3;
const FETCH_TIME_BUDGET_MS = 50000;

async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
  const started = Date.now();
  let res = null;
  for (let attempt = 1; attempt <= FETCH_ATTEMPTS; attempt++) {
    res = await soraFetchOnce(url, options);
    if (res && !(res.status >= 500 || res.status === 429 || res.status === 408)) return res;
    if (attempt === FETCH_ATTEMPTS || Date.now() - started > FETCH_TIME_BUDGET_MS) break;
    console.log(`[soraFetch] tentativo ${attempt} fallito (${res ? res.status : "rete"}), riprovo: ${url}`);
    await sleep(1000 * attempt);
  }
  return res;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function soraFetchOnce(url, options) {
  try {
    const response = await fetchv2(url, options.headers ?? {}, options.method ?? "GET", options.body ?? null);
    // Luna: fetchv2 risolve sempre, anche in errore ({error} senza status). Shirox: rigetta.
    if (response && response.status !== undefined) return response;
    throw new Error("fetchv2 error response");
  } catch (e) {
    try {
      return await fetch(url, options);
    } catch (error) {
      return null;
    }
  }
}

const JSON_HEADERS = { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" };

// ==========================================
// 1. RICERCA
// ==========================================
async function searchResults(keyword) {
  try {
    const response = await soraFetch(`${CONFIG.BASE}/api/search?q=${encodeURIComponent(keyword)}`, {
      headers: JSON_HEADERS,
      method: "GET",
      body: null,
    });
    if (!response) return JSON.stringify([]);
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    const records = data && Array.isArray(data.data) ? data.data : [];

    const results = [];
    for (const item of records) {
      const title = decodeEntities(item.title_it || item.title || item.title_ja || "");
      const images = item.images || {};
      const image = images.poster || images.cover || "";
      if (!title || !image || !item.id || !item.slug) continue;
      const href = `${CONFIG.BASE}/anime/${item.id}-${item.slug}`;
      const languages = (Array.isArray(item.variants) ? item.variants : [])
        .map((v) => v && v.language)
        .filter((lang) => LANGUAGES.includes(lang));
      if (languages.length === 0) {
        results.push({ title, image, href });
        continue;
      }
      for (const lang of LANGUAGES) {
        if (!languages.includes(lang)) continue;
        results.push({ title: lang === "ita" ? `${title} (ITA)` : title, image, href: `${href}?lang=${lang}` });
      }
    }
    return JSON.stringify(results);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 2. DETTAGLI
// ==========================================
async function extractDetails(url) {
  try {
    const info = parseAnimeUrl(url);
    if (!info) return JSON.stringify([]);

    const response = await soraFetch(`${CONFIG.BASE}/anime/${info.animeId}-${info.slug}`);
    if (!response) return JSON.stringify([]);
    const props = parsePageProps(await response.text());
    const anime = props && props.anime;
    if (!anime) return JSON.stringify([]);

    return JSON.stringify([{
      description: anime.plot || "N/A",
      aliases: anime.title_ja || anime.title || "N/A",
      airdate: anime.year ? String(anime.year) : "N/A",
    }]);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 3. EPISODI
// ==========================================
async function fetchEpisodeBlock(animeId, start) {
  const response = await soraFetch(`${CONFIG.BASE}/api/anime/${animeId}/episodes?start=${start}`, {
    headers: JSON_HEADERS,
    method: "GET",
    body: null,
  });
  if (!response) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function extractEpisodes(url) {
  try {
    const info = parseAnimeUrl(url);
    if (!info) return JSON.stringify([]);
    const animeHref = `${CONFIG.BASE}/anime/${info.animeId}-${info.slug}`;

    // Primo blocco: contiene anche total e tab_size
    const first = await fetchEpisodeBlock(info.animeId, 1);
    if (!first || !Array.isArray(first.episodes)) return JSON.stringify([]);

    const total = Number(first.total) || first.episodes.length;
    const size = Number(first.tab_size) || EPISODE_PAGE_SIZE;
    const starts = [];
    for (let start = size + 1; start <= total; start += size) starts.push(start);

    // Blocchi successivi a gruppi, risultati nell'ordine dei blocchi
    const rest = await mapWithConcurrency(starts, EPISODE_CONCURRENCY, (start) =>
      fetchEpisodeBlock(info.animeId, start)
    );

    const allEpisodes = [first, ...rest]
      .filter((block) => block && Array.isArray(block.episodes))
      .flatMap((block) => block.episodes);

    const episodes = [];
    allEpisodes.forEach((episode, index) => {
      const video = pickVideo(episode, info.lang);
      if (!video) return;
      const number = parseFloat(episode.number);
      episodes.push({
        href: `${animeHref}/${video.id}`,
        number: Number.isNaN(number) ? index + 1 : number,
      });
    });

    return JSON.stringify(episodes);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 4. ESTRAZIONE STREAM (URL DIRETTO PER SHIROX)
// ==========================================
async function extractStreamUrl(url) {
  try {
    const info = parseAnimeUrl(url);
    if (!info || !info.videoId) return null;
    const pageUrl = `${CONFIG.BASE}/anime/${info.animeId}-${info.slug}/${info.videoId}`;

    // La pagina dell'episodio contiene l'URL dell'embed Vixcloud (con token, expires, canPlayFHD)
    const response1 = await soraFetch(pageUrl);
    if (!response1) return null;
    const props = parsePageProps(await response1.text());
    const embedUrl = props && typeof props.embedUrl === "string" ? props.embedUrl.trim() : "";
    if (!/^https?:\/\//.test(embedUrl)) return null;

    const response2 = await soraFetch(embedUrl, {
      headers: {
        "Referer": `${CONFIG.BASE}/`,
        "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
      },
    });
    if (!response2) return null;
    const html2 = await response2.text();

    let finalUrl = null;

    // Estrazione Master Playlist Vixcloud (HLS ABR nativo)
    if (html2.includes("window.masterPlaylist")) {
      // Cerca url/token/expires solo da window.masterPlaylist fino alla fine del suo <script>
      // (Vixcloud non chiude il blocco con "};", quindi non si usa una regex sulle graffe)
      const blockStart = html2.indexOf("window.masterPlaylist");
      const blockEnd = html2.indexOf("</script>", blockStart);
      const targetSource = html2.slice(blockStart, blockEnd === -1 ? undefined : blockEnd);

      const urlMatch = targetSource.match(/url:\s*['"]([^'"]+)['"]/);
      const tokenMatch = targetSource.match(/['"]?token['"]?\s*:\s*['"]([^'"]+)['"]/);
      const expiresMatch = targetSource.match(/['"]?expires['"]?\s*:\s*['"]([^'"]+)['"]/);

      if (urlMatch && tokenMatch && expiresMatch) {
        const canPlayFHD = /window\.canPlayFHD\s*=\s*(true|1)/i.test(html2);
        const params = { token: tokenMatch[1], expires: expiresMatch[1] };
        if (canPlayFHD) params.h = 1;
        finalUrl = withParams(urlMatch[1], params);
      }
    }

    // Fallback: cerca URL m3u8 esplicito
    if (!finalUrl) {
      const m3u8Match = html2.match(/(https?:\/\/[^'"\s]+\.m3u8[^'"\s]*)/);
      if (m3u8Match) finalUrl = m3u8Match[1];
    }

    return finalUrl || null;
  } catch (error) {
    return null;
  }
}
