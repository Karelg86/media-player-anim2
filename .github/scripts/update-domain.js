/**
 * Sostituisce il dominio attuale con quello nuovo e incrementa la versione.
 * Usato da .github/workflows/update-domain.yml (avvio manuale, anche da cellulare).
 *
 * Uso locale: node .github/scripts/update-domain.js streamingcommunityz.nuovo
 *
 * File toccati: main.json, extractor.js, Quick-Resume.md
 * - ogni occorrenza del vecchio dominio (incluso cdn.<dominio>) diventa il nuovo
 * - version in main.json +1 sull'ultima cifra (1.0.6 -> 1.0.7), riportata anche negli altri due file
 */

const fs = require("fs");
const path = require("path");

const ROOT = process.cwd();
const FILES = ["main.json", "extractor.js", "Quick-Resume.md"];

function fail(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}

// Accetta "dominio.tld", "https://dominio.tld", "https://dominio.tld/it/"
let input = (process.argv[2] || "").trim().toLowerCase();
input = input.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(input)) fail(`Dominio non valido: "${process.argv[2] || ""}"`);
const newDomain = input;

const mainPath = path.join(ROOT, "main.json");
const main = JSON.parse(fs.readFileSync(mainPath, "utf8"));
const oldDomain = new URL(main.baseUrl).hostname;
if (oldDomain === newDomain) fail(`Il dominio è già ${newDomain}, niente da fare.`);

const oldVersion = main.version;
const parts = oldVersion.split(".").map(Number);
if (parts.some(Number.isNaN)) fail(`Versione non valida in main.json: ${oldVersion}`);
parts[parts.length - 1]++;
const newVersion = parts.join(".");

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const domainRegex = new RegExp(escapeRegex(oldDomain), "g");

for (const file of FILES) {
  const filePath = path.join(ROOT, file);
  if (!fs.existsSync(filePath)) continue;
  let text = fs.readFileSync(filePath, "utf8");
  const count = (text.match(domainRegex) || []).length;
  text = text.replace(domainRegex, newDomain);

  if (file === "main.json") {
    text = text.replace(/("version"\s*:\s*")[^"]+(")/, `$1${newVersion}$2`);
  } else if (file === "extractor.js") {
    text = text.replace(/(\* Versione:\s*)[\d.]+/, `$1${newVersion}`);
  } else if (file === "Quick-Resume.md") {
    text = text.replace(/(\*\*Versione modulo:\*\*\s*)[\d.]+/, `$1${newVersion}`);
  }

  fs.writeFileSync(filePath, text);
  console.log(`✏️  ${file}: ${count} occorrenze del dominio sostituite`);
}

// Verifica che main.json sia ancora JSON valido
JSON.parse(fs.readFileSync(mainPath, "utf8"));

console.log(`✅ ${oldDomain} -> ${newDomain}, versione ${oldVersion} -> ${newVersion}`);
if (process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(
    process.env.GITHUB_OUTPUT,
    `old_domain=${oldDomain}\nnew_domain=${newDomain}\nold_version=${oldVersion}\nnew_version=${newVersion}\n`
  );
}
