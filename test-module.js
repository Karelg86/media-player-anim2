/**
 * Test runner locale per extractor.js - AnimeUnity (Node.js 18+)
 *
 * Uso:
 *   node test-module.js "frieren"      -> test LIVE sul sito vero (search, details, episodes, stream)
 *   node test-module.js "one piece"    -> anime lungo (1000+ episodi, blocchi da 120)
 *   node test-module.js --mock         -> test OFFLINE con pagine finte (non tocca internet)
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
async function runLive(keyword) {
  const ex = loadExtractor(fetch);
  console.log(`\n🔎 Test LIVE con "${keyword}"\n`);

  const results = JSON.parse(await ex.searchResults(keyword));
  check("search", results.length > 0, `${results.length} risultati`);
  if (results.length === 0) return;
  check("search: nessuna entità HTML nei titoli", results.every((r) => !/&#|&[a-z]+;/i.test(r.title)));

  // Preferisce il risultato con slug identico alla ricerca (es. "one piece" -> /anime/12-one-piece)
  const slug = keyword.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
  const first = results.find((r) => r.href.endsWith(`-${slug}`)) || results[0];
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
const BASE = "https://www.animeunity.so";
const MOCK_TOTAL_EPISODES = 250; // -> 3 blocchi: 1-120, 121-240, 241-250

function laravelAttr(obj) {
  // Come Blade {{ }}: &quot; per le virgolette, &#039; per gli apostrofi
  return JSON.stringify(obj).replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function makeMockFetch(stats) {
  return async (url) => {
    stats.requests.push(url);
    stats.inFlight++;
    stats.maxInFlight = Math.max(stats.maxInFlight, stats.inFlight);
    await new Promise((r) => setTimeout(r, 30));
    stats.inFlight--;

    let body = "";
    const range = url.match(/\/info_api\/42\/1\?start_range=(\d+)&end_range=(\d+)/);
    if (url.startsWith(`${BASE}/archivio?title=`)) {
      body = `<archivio records="${laravelAttr([
        { id: 42, slug: "frieren", title: "Sousou no Frieren", title_eng: "Frieren: Beyond Journey's End", imageurl: "https://img.example/f.jpg" },
        { id: 43, slug: "senza-immagine", title: "Senza immagine", imageurl: "" },
      ])}" genre="false"></archivio>`;
    } else if (url === `${BASE}/anime/42-frieren`) {
      body = `<video-player anime="${laravelAttr({ id: 42, title: "Sousou no Frieren", plot: "L'elfa Frieren parte.", date: 2023 })}" episodes_count="${MOCK_TOTAL_EPISODES}"></video-player>`;
    } else if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (end - start + 1 > 120) {
        body = JSON.stringify({ error: "You can't fetch for a range bigger than 120" });
      } else {
        const episodes = [];
        for (let n = start; n <= Math.min(end, MOCK_TOTAL_EPISODES); n++) {
          episodes.push({ id: 1000 + n, number: n === 13 ? "12.5" : String(n) });
        }
        body = JSON.stringify({ episodes_count: MOCK_TOTAL_EPISODES, episodes });
      }
    } else if (url === `${BASE}/embed-url/1001`) {
      body = "https://vixcloud.co/embed/999?token=abc&expires=1&canPlayFHD=1";
    } else if (url.startsWith("https://vixcloud.co/embed/999")) {
      body = `<script>var tracker = { url: 'https://pubblicita.example/track' };</script>
<script>
  window.masterPlaylist = {
    params: {
      'token': 'TOKEN123',
      'expires': '1999999999',
      'asn': '',
    },
    url: 'https://vixcloud.co/playlist/999?b=1',
  }
  window.canPlayFHD = true
</script>
<script>var other = { 'token': 'SBAGLIATO', url: 'https://pubblicita.example/after' };</script>`;
    }
    return { status: 200, text: async () => body };
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
  check("search: titolo inglese con apostrofo", results[0] && results[0].title === "Frieren: Beyond Journey's End", results[0] && results[0].title);
  check("search: scarta risultati senza immagine", results.length === 1, `${results.length}`);
  check("search: href", results[0] && results[0].href === `${BASE}/anime/42-frieren`);

  const details = JSON.parse(await ex.extractDetails(`${BASE}/anime/42-frieren`));
  check("details: trama con apostrofo", details[0] && details[0].description === "L'elfa Frieren parte.", details[0] && details[0].description);
  check("details: titolo originale e anno", details[0] && details[0].aliases === "Sousou no Frieren" && details[0].airdate === "2023");

  stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  ex = loadExtractor(makeMockFetch(stats));
  const episodes = JSON.parse(await ex.extractEpisodes(`${BASE}/anime/42-frieren`));
  check("episodes: tutti i blocchi da 120", episodes.length === MOCK_TOTAL_EPISODES, `${episodes.length}/${MOCK_TOTAL_EPISODES}`);
  check("episodes: ordine naturale", episodes.every((e, i) => i === 0 || e.number > episodes[i - 1].number));
  check("episodes: numero decimale (12.5)", episodes[12] && episodes[12].number === 12.5, episodes[12] && String(episodes[12].number));
  check("episodes: href con id episodio", episodes[0] && episodes[0].href === `${BASE}/anime/42-frieren/1001`);
  check("episodes: nessun range > 120 richiesto", stats.requests.every((u) => {
    const m = u.match(/start_range=(\d+)&end_range=(\d+)/);
    return !m || Number(m[2]) - Number(m[1]) + 1 <= 120;
  }));
  check("episodes: max richieste in parallelo <= 3", stats.maxInFlight <= 3, `${stats.maxInFlight}`);

  stats = { requests: [], inFlight: 0, maxInFlight: 0 };
  ex = loadExtractor(makeMockFetch(stats));
  const stream = await ex.extractStreamUrl(`${BASE}/anime/42-frieren/1001`);
  check("stream: URL dal blocco masterPlaylist (non dagli script esterni)",
    stream === "https://vixcloud.co/playlist/999?b=1&token=TOKEN123&expires=1999999999&h=1", stream || "null");
  check("stream: URL senza id episodio -> null", (await ex.extractStreamUrl(`${BASE}/anime/42-frieren`)) === null);
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
  console.log(failures === 0 ? "\n🎉 Tutti i test superati\n" : `\n⚠️  ${failures} test falliti\n`);
  process.exit(failures === 0 ? 0 : 1);
})();
