# QUICK-RESUME: Modulo Shirox — AnimeUnity IT

> **Versione modulo:** 1.0.2  
> **Ultimo aggiornamento:** 22 Ottobre 2026  
> **Dominio attuale:** `www.animeunity.co`  
> **App principale:** iOS **Shirox** (compatibile anche con Sora / Luna / Mojuru)  
> **Repository GitHub:** [Karelg86/media-player-anim2](https://github.com/Karelg86/media-player-anim2)  
> **URL modulo:** `https://raw.githubusercontent.com/Karelg86/media-player-anim2/main/main.json`  
> **Modulo "fratello":** [media-player-config](https://github.com/Karelg86/media-player-config) (StreamingCommunity): stesso player Vixcloud, stessa logica di estrazione dello stream.

---

## 1. COME FUNZIONA ANIMEUNITY

Sito Laravel (come StreamingCommunity). I dati sono dentro attributi HTML in JSON, codificati con `&quot;`.

| Passo | Indirizzo | Cosa restituisce |
|---|---|---|
| Ricerca | `/archivio?title=...` | `<archivio records="[...]">`: lista anime (id, slug, title, title_eng, imageurl, plot, dub, ...) |
| Dettagli | `/anime/{id}-{slug}` | `<video-player anime="{...}">`: plot, title (giapponese), date (anno) |
| Episodi | `/info_api/{id}/1?start_range=A&end_range=B` | JSON `{episodes_count, episodes: [{id, number, ...}]}` — **max 120 per richiesta** (oltre: `"You can't fetch for a range bigger than 120"`) |
| Stream 1 | `/embed-url/{episodeId}` | Testo: URL embed Vixcloud (`https://vixcloud.co/embed/...?token=...&expires=...&canPlayFHD=1`) |
| Stream 2 | embed Vixcloud | `window.masterPlaylist = { params: {token, expires}, url }` → Master Playlist HLS |

### Note
- Il dominio senza `www` fa **redirect 302** alla versione con `www` (verificato 14/10/2026): nei file usare sempre l'indirizzo con `www`.
- Icona del modulo: `/apple-touch-icon.png`. `/favicon.ico` risponde 200 ma **vuoto (0 byte)** e Shirox logga `[Image] decode failed ... len=0` (verificato 16/10/2026, corretto nella 1.0.1).
- Ogni stagione è un anime separato (es. "Sousou no Frieren" e "Sousou no Frieren 2"), le versioni doppiate hanno una scheda propria con "(ITA)" nel titolo. Ogni scheda ha **una sola lista di episodi** → nessun problema con `detectSeasons` di Shirox.
- Il numero episodio può essere decimale (es. "12.5"): Shirox lo accetta (`EpisodeLink.number` è `Double`).
- Titolo mostrato in ricerca: `title_eng` (fallback `title_it`, poi `title`). Il titolo giapponese finisce in `aliases`.

---

## 2. SCELTE TECNICHE (da non toccare)

1. Prima di `JSON.parse` sugli attributi si sostituisce **solo** `&quot;`. `decodeEntities()` va applicato **dopo**, sui singoli campi (stesso motivo del modulo StreamingCommunity).
2. Episodi a blocchi da 120 (`EPISODE_PAGE_SIZE`), massimo 3 blocchi in parallelo (`EPISODE_CONCURRENCY`), risultati sempre nell'ordine dei blocchi. One Piece (1180 episodi = 10 blocchi): ~0,8 s (test 14/10/2026).
   - ⚙️ Se Shirox dà problemi sugli anime lunghi: `EPISODE_CONCURRENCY = 2` oppure `1`.
3. Stream: `url`, `token`, `expires` cercati **solo** da `window.masterPlaylist` fino alla fine del suo `<script>`. Vixcloud **non** chiude il blocco con `};` → niente regex sulle graffe.
4. `extractStreamUrl` restituisce la **Master Playlist** HLS (non una risoluzione fissa): AVPlayer gestisce da solo la qualità (ABR) ed evita gli stalli di buffering. `h=1` aggiunto solo se `window.canPlayFHD = true`.
5. `soraFetch` gestisce sia Shirox (`fetchv2` rigetta in caso di errore) sia Luna (`fetchv2` risolve con `{error}` senza `status`).

### Limite noto: "Continua a guardare"
Lo stream salvato da Shirox contiene un token Vixcloud a scadenza. Nelle build recenti di Shirox (`Views/ContinueWatchingCard.swift` → `onStreamExpired`) quando il link è scaduto l'app richiama `extractEpisodes`, ritrova l'episodio tramite `href` (o numero) e chiede un nuovo stream: il problema dovrebbe risolversi da solo (da verificare sull'iPhone). Per questo gli `href` degli episodi devono restare **stabili** tra le versioni del modulo.

---

## 3. STRUTTURA DEI FILE

```
media-player-anim2/
├── main.json                       # Metadati modulo, versione, URL GitHub raw
├── extractor.js                    # Script JS eseguito da Shirox
├── test-module.js                  # Test locale (Node.js 18+)
├── Quick-Resume.md                 # Questa guida
├── .gitignore                      # Esclude backup/ e file locali
└── .github/
    ├── workflows/
    │   ├── check-domain.yml        # Robot: controlla il dominio ogni 6 ore e AVVISA (issue)
    │   ├── update-domain.yml       # Robot: cambio dominio su richiesta (anche da cellulare)
    │   └── health-check.yml        # Robot: test completo ogni giorno, AVVISA se il modulo non funziona
    └── scripts/
        ├── check-domain.js
        └── update-domain.js
```

---

## 4. CAMBIO DOMINIO

### 🤖 Avviso automatico
- Ogni 6 ore GitHub esegue **Controllo dominio** (non modifica nulla).
- Se il dominio reindirizza altrove **o non risponde più**, apre una **issue** con etichetta `dominio` assegnata a te → notifica su app GitHub / email.
- Lancio manuale: *Actions → Controllo dominio → Run workflow*.
- ⚠️ GitHub sospende i workflow programmati dopo **60 giorni senza attività** nel repo (manda una email prima). Riattivazione: *Actions → Controllo dominio → Enable workflow*.

### 🩺 Salute del modulo (robot giornaliero)
- Ogni giorno GitHub esegue **Salute modulo**: test offline + test completo sul sito vero (ricerca → episodi → stream).
- Se fallisce **2 volte di fila** apre una issue con etichetta `salute` (notifica su app GitHub / email): il sito ha probabilmente cambiato la struttura delle pagine e il modulo va aggiornato.
- Un solo errore isolato non genera avvisi.
- **AnimeUnity blocca i server di GitHub** (Cloudflare risponde `403` agli IP dei datacenter; verificato 2026-10-16): da lì la ricerca dà 0 risultati anche se il modulo funziona. `test-module.js` lo riconosce ed esce con codice **2** ("non verificabile"): il run resta verde con un avviso giallo e non apre né chiude issue. Per una verifica vera lanciare il test dal PC (rete italiana).
- Codici di uscita di `test-module.js`: `0` ok, `1` test falliti, `2` sito non raggiungibile da questa rete.
- Quando il test torna a funzionare la issue si chiude da sola. Lancio manuale: *Actions → Salute modulo → Run workflow*.

### 📱 Da cellulare
1. Apri il link nella issue, oppure `https://github.com/Karelg86/media-player-anim2/actions/workflows/update-domain.yml`
2. **Run workflow** → scrivi il nuovo dominio **senza** `https://` e **con** `www.` (es. `www.animeunity.nuovo`) → conferma.
3. Il robot sostituisce il dominio in `main.json`, `extractor.js`, `Quick-Resume.md`, `test-module.js`, incrementa la versione, lancia i test, fa commit + push e chiude la issue.
4. Su Shirox: Moduli → aggiorna.

> Test del robot falliti ≠ errore per forza: AnimeUnity (Cloudflare) blocca i server di GitHub con `403`. Prova su Shirox o lancia il test dal PC.

### 💻 Da PC
```bash
node .github/scripts/update-domain.js www.animeunity.nuovo
node test-module.js "frieren"
node test-module.js "one piece"
git add main.json extractor.js Quick-Resume.md test-module.js
git commit -m "Update domain to www.animeunity.nuovo - vX.Y.Z"
git push origin main
```

> ⚠️ Shirox salva lo script in cache: incrementare `version` in `main.json` è **obbligatorio** per far scaricare la nuova versione. `update-domain.js` lo fa da solo.
> Shirox controlla gli aggiornamenti all'avvio a freddo dell'app o col pulsante refresh nella schermata Modules: rilegge il `main.json` dal link installato e reinstalla se `version` cambia. Non serve reinserire il link (salta l'aggiornamento solo se lo script è stato modificato dentro l'app). Verificato sul sorgente Shirox il 22/10/2026.

---

## 5. TEST

```bash
node test-module.js --mock         # offline: apostrofi, blocchi da 120, ordine, max 3 in parallelo, numeri decimali, stream
node test-module.js "frieren"      # live
node test-module.js "one piece"    # live, anime lungo
```

### Su Shirox
1. Aggiungi il modulo dal link raw: `https://raw.githubusercontent.com/Karelg86/media-player-anim2/main/main.json`
2. Cerca "Frieren" o "One Piece", apri la scheda, avvia un episodio.
3. Verifica: titoli puliti, lista episodi completa, video fluido, scelta audio/sottotitoli.
