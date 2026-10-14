/**
 * Controlla se il dominio attuale (preso da main.json) ha cambiato indirizzo.
 * Usato da .github/workflows/check-domain.yml - NON modifica nessun file, segnala soltanto.
 *
 * Uso locale: node .github/scripts/check-domain.js
 *
 * Output (in GITHUB_OUTPUT se presente, altrimenti a schermo):
 *   alert=true|false   old_domain=...   new_domain=...   reason=...
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

function setOutput(values) {
  const lines = Object.entries(values).map(([k, v]) => `${k}=${String(v).replace(/\r?\n/g, " ")}`);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, lines.join("\n") + "\n");
  console.log(lines.join("\n"));
}

async function probe(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { redirect: "manual", headers: { "User-Agent": UA }, signal: controller.signal });
    return { status: res.status, location: res.headers.get("location") };
  } finally {
    clearTimeout(timer);
  }
}

(async () => {
  const main = JSON.parse(fs.readFileSync(path.join(ROOT, "main.json"), "utf8"));
  const oldDomain = new URL(main.baseUrl).hostname;
  const target = main.baseUrl;

  let result = null;
  let lastError = null;
  for (let attempt = 1; attempt <= 3 && !result; attempt++) {
    try {
      result = await probe(target);
    } catch (error) {
      lastError = error;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }

  // Sito irraggiungibile (dominio chiuso, DNS, nessuna risposta)
  if (!result) {
    setOutput({
      alert: true,
      old_domain: oldDomain,
      new_domain: "",
      reason: `Il dominio ${oldDomain} non risponde (${lastError && (lastError.cause?.code || lastError.message)}). Potrebbe essere stato chiuso senza redirect: trova il nuovo indirizzo a mano.`,
    });
    return;
  }

  // Redirect verso un altro dominio = cambio indirizzo
  if (result.status >= 300 && result.status < 400 && result.location) {
    const newDomain = new URL(result.location, target).hostname;
    if (newDomain !== oldDomain) {
      setOutput({
        alert: true,
        old_domain: oldDomain,
        new_domain: newDomain,
        reason: `Il dominio ${oldDomain} reindirizza (HTTP ${result.status}) a ${newDomain}.`,
      });
      return;
    }
  }

  // 200, 403/503 di Cloudflare, redirect interni: il sito è vivo, nessun avviso
  setOutput({ alert: false, old_domain: oldDomain, new_domain: "", reason: `HTTP ${result.status}, nessun cambio rilevato.` });
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
