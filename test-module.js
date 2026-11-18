/**
 * Test runner locale per extractor.js - AnimeUnity (Node.js 18+)
 *
 * Uso:
 *   node test-module.js "frieren"      -> test LIVE sul sito vero (search, details, episodes, stream)
 *   node test-module.js "one piece"    -> anime lungo (1000+ episodi, blocchi da 120)
 *   node test-module.js --mock         -> test OFFLINE con pagine finte (non tocca internet)
 *
 * Codici di uscita: 0 = ok, 1 = test falliti, 2 = sito non raggiungibile da questa rete
 * (403/503/429 di Cloudflare, es. dai server di GitHub Actions): test non verificabile.
 *
 * extractor.js viene caricato in un contesto isolato, come fa Shirox con JavaScriptCore.
 * fetchv2 non esiste in Node: soraFetch usa automaticamente fetch come fallback.
 */

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const EXTRACTOR_PATH = process.env.EXTRACTOR || path.join(__dirname, "extractor.js");

function loadExtractor(fetchImpl) {
  const context = vm.createContext({
    fetch: fetchImpl,
    console,
    setTimeout,
    clearTimeout,
  });
  vm.runInContext(fs.readFileSync(EXTRACTOR_PATH, "utf8"), context, { filename: "extractor.js" });
  return context;
}

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "✅" : "❌"} ${label}${detail ? "  ->  " + detail : ""}`);
  if (!condition) failures++;
}

// ==========================================
// TEST LIVE
// ==========================================

// AnimeUnity (Cloudflare) risponde 403 agli IP dei datacenter, compresi i server di GitHub:
// da lì il modulo trova 0 risultati anche se funziona. Si registra il primo blocco visto
// per distinguere "sito che blocca questa rete" da "modulo rotto".
let blockedBy = null;
async function trackedFetch(url, options) {
  const res = await fetch(url, options);
  if (!blockedBy && [403, 429, 503].includes(res.status)) {
    blockedBy = `HTTP ${res.status} (server: ${res.headers.get("server") || "?"}) su ${url}`;
  }
  return res;
}

async function runLive(keyword) {
  const ex = loadExtractor(trackedFetch);
  console.log(`\n🔎 Test LIVE con "${keyword}"\n`);

  const results = JSON.parse(await ex.searchResults(keyword));
  check("search", results.length > 0, `${results.length} risultati`);
  if (results.length === 0) return;
  check("search: nessuna entità HTML nei titoli", results.every((r) => !/&#|&[a-z]+;/i.test(r.title)));

  // Preferisce il risultato con slug identico alla ricerca (es. "one piece" -> /anime/12-one-piece)
  const slug = keyword.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
  const first = results.find((r) => r.href.endsWith(`-${slug}`) || r.href.includes(`-${slug}?`)) || results[0];
  console.log(`   risultato testato: ${first.title}\n   ${first.href}`);

  const details = JSON.parse(await ex.extractDetails(first.href));
  check("details", details.length === 1 && details[0].description !== "N/A",
    details[0] ? details[0].description.slice(0, 80) + "..." : "vuoto");

  const t0 = Date.now();
  const episodes = JSON.parse(await ex.extractEpisodes(first.href));
  check("episodes", episodes.length > 0, `${episodes.length} episodi in ${Date.now() - t0} ms`);
  if (episodes.length === 0) return;
  check("episodes: numeri crescenti (una sola stagione per Shirox)",
    episodes.every((e, i) => i === 0 || e.number > episodes[i - 1].number));

  const stream = await ex.extractStreamUrl(episodes[0].href);
  check("stream", typeof stream === "string" && stream.startsWith("http"), stream || "null");
  if (stream) {
    check("stream contiene token ed expires", /token=/.test(stream) && /expires=/.test(stream));
    check("nessun doppio '?' nell'URL", (stream.match(/\?/g) || []).length <= 1);
  }
}

// ==========================================
// TEST OFFLINE (MOCK)
// ==========================================
const BASE = "https://animeunity.cx";
const MOCK_TOTAL_EPISODES = 250; // -> 3 blocchi: start=1, 121, 241

function laravelAttr(obj) {
  // Come Blade {{ }}: & -> &amp; per primo, poi &quot; per le virgolette, &#039; per gli apostrofi
  return JSON.stringify(obj).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function inertiaPage(props) {
  return `<!DOCTYPE html><html><body><div id="app" data-page="${laravelAttr({ component: "Anime", props })}"></div></body></html>`;
}

// Episodio n: video ita (id 2000+n) e jpn (id 1000+n); l'episodio 5 non ha il doppiaggio
function mockEpisode(n) {
  const videos = [{ id: 1000 + n, language: "jpn", is_hidden: false }];
  if (n !== 5) videos.unshift({ id: 2000 + n, language: "ita", is_hidden: false });
  return { id: 500 + n, number: n === 13 ? "12.5" : String(n), videos };
}

function makeMockFetch(stats) {
  return async (url) => {
    stats.requests.push(url);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, 30));
    stats.inFlight--;

    let body = "";
    let status = 200;
    const block = url.match(/\/api\/anime\/42\/episodes\?start=(\d+)$/);
    if (url.startsWith(`${BASE}/api/search?q=`)) {
      body = JSON.stringify({
        data: [
          { id: 42, slug: "frieren", title: "Frieren: Beyond Journey's End", title_ja: "Sousou no Frieren", title_it: null,
            images: { poster: "https://img.example/f.jpg" }, variants: [{ language: "jpn" }, { language: "ita" }] },
          { id: 43, slug: "senza-immagine", title: "Senza immagine", images: { poster: null, cover: null }, variants: [{ language: "jpn" }] },
          { id: 44, slug: "solo-sub", title: "Solo Sub", title_it: "Solo Sottotitoli", images: { cover: "https://img.example/s.jpg" }, variants: [{ language: "jpn" }] },
        ],
        count: 3,
        hasMore: false,
      });
    } else if (url === `${BASE}/anime/42-frieren`) {
      body = inertiaPage({ anime: { id: 42, title: "Frieren: Beyond Journey's End", title_ja: "Sousou no Frieren", plot: "L'elfa Frieren parte & torna.", year: 2023 } });
    } else if (block) {
      const start = Number(block[1]);
      const episodes = [];
      for (let n = start; n <= Math.min(start + 119, MOCK_TOTAL_EPISODES); n++) episodes.push(mockEpisode(n));
      body = JSON.stringify({ episodes, start, tab_size: 120, total: MOCK_TOTAL_EPISODES, offset: 1 });
    } else if (url === `${BASE}/anime/42-frieren/2001`) {
      body = inertiaPage({ embedUrl: "https://vixcloud.cc/embed/999?token=abc&expires=1&canPlayFHD=1&skin=animeunity2" });
    } else if (url === "https://vixcloud.cc/embed/999?token=abc&expires=1&canPlayFHD=1&skin=animeunity2") {
      body = `<script>var tracker = { url: 'https://pubblicita.example/track' };</script>
<script>
  window.masterPlaylist = {
    params: {
      'token': 'TOKEN123',
      'expires': '1999999999',
      'asn': '',
    },
    url: 'https://vixcloud.cc/playlist/999?b=1',
  }
  window.canPlayFHD = true
</script>
<script>var other = { 'token': 'SBAGLIATO', url: 'https://pubblicita.example/after' };</script>`;
    } else {
      status = 404;
    }
    return { status, text: async () => body };
  };
}

async function runMock() {
  console.log("\n🧪 Test OFFLINE (mock)\n");

  const ex0 = loadExtractor(async () => null);
  for (const raw of ["L&#39;a", "L&#039;a", "L&#x27;a", "L&apos;a"]) {
    check(`decodeEntities("${raw}")`, ex0.decodeEntities(raw) === "L'a");
  }

  let stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  let ex = loadExtractor(makeMockFetch(stats));

  const results = JSON.parse(await ex.searchResults("frieren"));
  check("search: scarta risultati senza immagine, due righe per ita+jpn", results.length === 3, `${results.length}`);
  check("search: prima la versione doppiata (ITA)", results[0] && results[0].title === "Frieren: Beyond Journey's End (ITA)"
    && results[0].href === `${BASE}/anime/42-frieren?lang=ita`, results[0] && results[0].title);
  check("search: poi la versione sottotitolata", results[1] && results[1].title === "Frieren: Beyond Journey's End"
    && results[1].href === `${BASE}/anime/42-frieren?lang=jpn`, results[1] && results[1].href);
  check("search: titolo italiano se c'è, immagine di riserva (cover)", results[2] && results[2].title === "Solo Sottotitoli"
    && results[2].image === "https://img.example/s.jpg", results[2] && results[2].title);

  const details = JSON.parse(await ex.extractDetails(`${BASE}/anime/42-frieren?lang=ita`));
  check("details: trama con apostrofo e &", details[0] && details[0].description === "L'elfa Frieren parte & torna.", details[0] && details[0].description);
  check("details: titolo giapponese e anno", details[0] && details[0].aliases === "Sousou no Frieren" && details[0].airdate === "2023");

  stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  ex = loadExtractor(makeMockFetch(stats));
  const ita = JSON.parse(await ex.extractEpisodes(`${BASE}/anime/42-frieren?lang=ita`));
  check("episodes ita: tutti i blocchi, senza l'episodio non doppiato", ita.length === MOCK_TOTAL_EPISODES - 1, `${ita.length}/${MOCK_TOTAL_EPISODES - 1}`);
  check("episodes: ordine naturale", ita.every((e, i) => i === 0 || e.number > ita[i - 1].number));
  check("episodes: numero decimale (12.5)", ita.some((e) => e.number === 12.5));
  check("episodes ita: href con id del video ita", ita[0] && ita[0].href === `${BASE}/anime/42-frieren/2001`, ita[0] && ita[0].href);
  check("episodes: blocchi richiesti con start=1,121,241", ["1", "121", "241"].every((s) =>
    stats.requests.includes(`${BASE}/api/anime/42/episodes?start=${s}`)));
  check("episodes: max richieste in parallelo <= 3", stats.maxInFlight <= 3, `${stats.maxInFlight}`);

  ex = loadExtractor(makeMockFetch({ requests: [], inFlight: 0, maxInFlight: 0 }));
  const jpn = JSON.parse(await ex.extractEpisodes(`${BASE}/anime/42-frieren?lang=jpn`));
  check("episodes jpn: tutti gli episodi, href con id del video jpn", jpn.length === MOCK_TOTAL_EPISODES
    && jpn[4].href === `${BASE}/anime/42-frieren/1005`, `${jpn.length}`);

  stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  ex = loadExtractor(makeMockFetch(stats));
  const stream = await ex.extractStreamUrl(`${BASE}/anime/42-frieren/2001`);
  check("stream: URL dal blocco masterPlaylist (non dagli script esterni)",
    stream === "https://vixcloud.cc/playlist/999?b=1&token=TOKEN123&expires=1999999999&h=1", stream || "null");
  check("stream: URL senza id video -> null", (await ex.extractStreamUrl(`${BASE}/anime/42-frieren`)) === null);

  // Retry: errori temporanei del server/rete prima della risposta buona
  const flaky = (failures) => {
    const calls = {};
    const base = makeMockFetch({ requests: [], inFlight: 0, maxInFlight: 0 });
    const fetchImpl = async (url, options) => {
      calls[url] = (calls[url] || 0) + 1;
      const failure = failures[calls[url] - 1];
      if (failure === "rete") throw new Error("network down");
      if (failure) return { status: failure, text: async () => "" };
      return base(url, options);
    };
    return { calls, fetchImpl };
  };
  const streamUrl = `${BASE}/anime/42-frieren/2001`;
  const expected = "https://vixcloud.cc/playlist/999?b=1&token=TOKEN123&expires=1999999999&h=1";

  let f = flaky([503]);
  check("retry: 503 poi ok -> stream", (await loadExtractor(f.fetchImpl).extractStreamUrl(streamUrl)) === expected, `richieste pagina: ${f.calls[streamUrl]}`);

  f = flaky(["rete"]);
  check("retry: errore di rete poi ok -> stream", (await loadExtractor(f.fetchImpl).extractStreamUrl(streamUrl)) === expected);

  f = flaky([404]);
  await loadExtractor(f.fetchImpl).extractStreamUrl(streamUrl);
  check("retry: 404 non ritentato", f.calls[streamUrl] === 1, `${f.calls[streamUrl]} richieste`);

  f = flaky([503, 503, 503, 503]);
  const dead = await loadExtractor(f.fetchImpl).extractStreamUrl(streamUrl);
  check("retry: max 3 tentativi poi null", dead === null && f.calls[streamUrl] === 3, `${f.calls[streamUrl]} richieste`);
}

// ==========================================
(async () => {
  const arg = process.argv[2];
  try {
    if (!arg) {
      console.log('Uso: node test-module.js "titolo"   oppure   node test-module.js --mock');
      process.exit(1);
    }
    if (arg === "--mock") await runMock();
    else await runLive(arg);
  } catch (error) {
    console.error("💥 Errore imprevisto:", error);
    failures++;
  }
  if (failures > 0 && blockedBy) {
    console.log(`\n🚫 Sito non raggiungibile da questa rete: ${blockedBy}`);
    console.log("   Test non verificabile (non è un errore del modulo)\n");
    process.exit(2);
  }
  console.log(failures === 0 ? "\n🎉 Tutti i test superati\n" : `\n⚠️  ${failures} test falliti\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
