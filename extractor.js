/**
 * Shirox / Sora / Luna Module Extractor - AnimeUnity IT
 * Versione: 1.0.1
 *
 * Basato sull'architettura del modulo StreamingCommunity v1.0.6 (stesso player Vixcloud):
 * - Ricerca da /archivio (JSON nell'attributo records del componente <archivio>)
 * - Dettagli dal componente <video-player anime="...">
 * - Episodi da /info_api/{id}/1 a blocchi da 120 (limite del sito), max EPISODE_CONCURRENCY in parallelo
 * - Stream: /embed-url/{episodeId} -> embed Vixcloud -> Master Playlist HLS (ABR nativo di AVPlayer)
 */

const CONFIG = {
  BASE: "https://www.animeunity.so",
};

// Il sito restituisce al massimo 120 episodi per richiesta
const EPISODE_PAGE_SIZE = 120;
// Quanti blocchi da 120 episodi scaricare contemporaneamente (One Piece = 10 blocchi)
const EPISODE_CONCURRENCY = 3;

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

// Legge un attributo HTML contenente JSON (Laravel lo codifica con &quot;).
// Solo &quot; prima del parse: decodeEntities va applicato DOPO, sui singoli campi.
function parseJsonAttribute(html, tagName, attrName) {
  const regex = new RegExp(`<${tagName}[^>]*\\s${attrName}="([^"]*)"`);
  const match = regex.exec(html);
  if (!match || !match[1]) return null;
  return JSON.parse(match[1].replace(/&quot;/g, '"'));
}

// "https://www.animeunity.so/anime/4851-frieren/76205" -> { animeId: "4851", slug: "frieren", episodeId: "76205" }
function parseAnimeUrl(url) {
  const match = /\/anime\/(\d+)-([^/?#]+)(?:\/(\d+))?/.exec(url || "");
  if (!match) return null;
  return { animeId: match[1], slug: match[2], episodeId: match[3] || null };
}

// --- FETCH ENGINE COMPATIBILE SHIROX / SORA / LUNA ---
async function soraFetch(url, options = { headers: {}, method: "GET", body: null }) {
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

// ==========================================
// 1. RICERCA
// ==========================================
async function searchResults(keyword) {
  try {
    const response = await soraFetch(`${CONFIG.BASE}/archivio?title=${encodeURIComponent(keyword)}`);
    if (!response) return JSON.stringify([]);
    const html = await response.text();

    const records = parseJsonAttribute(html, "archivio", "records") || [];

    const results = records
      .map((item) => ({
        title: decodeEntities(item.title_eng || item.title_it || item.title || ""),
        image: item.imageurl || "",
        href: `${CONFIG.BASE}/anime/${item.id}-${item.slug}`,
      }))
      .filter((item) => item.title && item.image);

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
    const html = await response.text();

    const anime = parseJsonAttribute(html, "video-player", "anime");
    if (!anime) return JSON.stringify([]);

    return JSON.stringify([{
      description: decodeEntities(anime.plot || "N/A"),
      aliases: decodeEntities(anime.title || anime.title_eng || "N/A"),
      airdate: anime.date ? String(anime.date) : "N/A",
    }]);
  } catch (error) {
    return JSON.stringify([]);
  }
}

// ==========================================
// 3. EPISODI
// ==========================================
async function fetchEpisodeRange(animeId, start, end) {
  const response = await soraFetch(
    `${CONFIG.BASE}/info_api/${animeId}/1?start_range=${start}&end_range=${end}`,
    { headers: { "Accept": "application/json", "X-Requested-With": "XMLHttpRequest" }, method: "GET", body: null }
  );
  if (!response) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function extractEpisodes(url) {
  try {
    const info = parseAnimeUrl(url);
    if (!info) return JSON.stringify([]);
    const animeHref = `${CONFIG.BASE}/anime/${info.animeId}-${info.slug}`;

    // Primo blocco: contiene anche episodes_count
    const first = await fetchEpisodeRange(info.animeId, 1, EPISODE_PAGE_SIZE);
    if (!first || !Array.isArray(first.episodes)) return JSON.stringify([]);

    const total = Number(first.episodes_count) || first.episodes.length;
    const ranges = [];
    for (let start = EPISODE_PAGE_SIZE + 1; start <= total; start += EPISODE_PAGE_SIZE) {
      ranges.push([start, Math.min(start + EPISODE_PAGE_SIZE - 1, total)]);
    }

    // Blocchi successivi a gruppi, risultati nell'ordine dei range
    const rest = await mapWithConcurrency(ranges, EPISODE_CONCURRENCY, ([start, end]) =>
      fetchEpisodeRange(info.animeId, start, end)
    );

    const allEpisodes = [first, ...rest]
      .filter((block) => block && Array.isArray(block.episodes))
      .flatMap((block) => block.episodes);

    const episodes = allEpisodes.map((episode, index) => {
      const number = parseFloat(episode.number);
      return {
        href: `${animeHref}/${episode.id}`,
        number: Number.isNaN(number) ? index + 1 : number,
      };
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
    if (!info || !info.episodeId) return null;
    const pageUrl = `${CONFIG.BASE}/anime/${info.animeId}-${info.slug}/${info.episodeId}`;

    // /embed-url/{id} restituisce come testo l'URL dell'embed Vixcloud (con token, expires, canPlayFHD)
    const response1 = await soraFetch(`${CONFIG.BASE}/embed-url/${info.episodeId}`, {
      headers: { "Referer": pageUrl, "X-Requested-With": "XMLHttpRequest" },
      method: "GET",
      body: null,
    });
    if (!response1) return null;
    const embedUrl = decodeEntities((await response1.text()).trim());
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
