# QUICK-RESUME: Modulo Shirox — AnimeUnity IT

> **Versione modulo:** 1.1.0  
> **Ultimo aggiornamento:** 18 Novembre 2026  
> **Dominio attuale:** `animeunity.cx` (senza www)  
> **App principale:** iOS **Shirox** (compatibile anche con Sora / Luna / Mojuru)  
> **Repository GitHub:** [Karelg86/media-player-anim2](https://github.com/Karelg86/media-player-anim2)  
> **URL modulo:** `https://raw.githubusercontent.com/Karelg86/media-player-anim2/main/main.json`  
> **Modulo "fratello":** [media-player-config](https://github.com/Karelg86/media-player-config) (StreamingCommunity): stesso player Vixcloud, stessa logica di estrazione dello stream.

---

## 1. COME FUNZIONA ANIMEUNITY

Sito Laravel + Inertia (rifatto a novembre 2026). Ricerca ed episodi rispondono in JSON; le pagine hanno i dati nell'attributo `data-page` (JSON codificato con &quot; &#039; &lt; &gt; &amp;).

| Passo | Indirizzo | Cosa restituisce |
|---|---|---|
| Ricerca | `/api/search?q=...` | JSON `{data: [{id, slug, title, title_ja, title_it, images: {poster, cover}, variants: [{language: "ita"/"jpn"}]}], count, hasMore}` |
| Dettagli | `/anime/{id}-{slug}` | Pagina con il JSON nell'attributo `data-page` → `props.anime` (`plot`, `title_ja`, `year`) |
| Episodi | `/api/anime/{id}/episodes?start=N` | JSON `{episodes: [{id, number, videos: [{id, language, is_hidden}]}], start, tab_size: 120, total}` |
| Stream 1 | `/anime/{id}-{slug}/{videoId}` | `data-page` → `props.embedUrl` (embed Vixcloud con token) |
| Stream 2 | embed Vixcloud | `window.masterPlaylist` → Master Playlist HLS (come prima) |

### Note
- Dal 18/11/2026 `www.animeunity.co` fa redirect 301 a `animeunity.cx` (senza www). `www.animeunity.cx` non risponde.
- Icona del modulo: `/icon/apple-touch-icon.png` (la vecchia `/apple-touch-icon.png` dà 404).
- Ogni stagione è un anime separato (es. "Frieren: Beyond Journey's End" e "… 2"). Doppiato e sottotitolato sono nella stessa scheda (`variants`, e in ogni episodio un video per lingua): il modulo mostra due risultati, "Titolo (ITA)" con `?lang=ita` e "Titolo" con `?lang=jpn`. Gli episodi senza video nella lingua scelta non compaiono.
- Il numero episodio può essere decimale (es. "12.5"): Shirox lo accetta (`EpisodeLink.number` è `Double`).
- Titolo mostrato in ricerca: `title_it` (fallback `title`, poi `title_ja`). In `aliases` va `title_ja`.

---

## 2. SCELTE TECNICHE (da non toccare)

1. Prima di `JSON.parse` sugli attributi si sostituisce **solo** `&quot;`. `decodeEntities()` va applicato **dopo**, sui singoli campi (stesso motivo del modulo StreamingCommunity). Per l'attributo `data-page` (`parsePageProps`) invece si decodifica tutto prima del parse, con `&amp;` per ultimo: le virgolette dentro le stringhe arrivano come `\&quot;` e diventano `\"`.
2. Episodi a blocchi da 120 con `?start=1, 121, 241…` (`EPISODE_PAGE_SIZE`), massimo 3 blocchi in parallelo (`EPISODE_CONCURRENCY`), risultati sempre nell'ordine dei blocchi. One Piece (1180 episodi = 10 blocchi): ~0,8 s (test 14/10/2026).
   - ⚙️ Se Shirox dà problemi sugli anime lunghi: `EPISODE_CONCURRENCY = 2` oppure `1`.
3. Stream: `url`, `token`, `expires` cercati **solo** da `window.masterPlaylist` fino alla fine del suo `<script>`. Vixcloud **non** chiude il blocco con `};` → niente regex sulle graffe.
4. `extractStreamUrl` restituisce la **Master Playlist** HLS (non una risoluzione fissa): AVPlayer gestisce da solo la qualità (ABR) ed evita gli stalli di buffering. `h=1` aggiunto solo se `window.canPlayFHD = true`.
5. `soraFetch` gestisce sia Shirox (`fetchv2` rigetta in caso di errore) sia Luna (`fetchv2` risolve con `{error}` senza `status`).
6. **Retry (dalla 1.0.3, 10/11/2026):** `soraFetch` ritenta fino a **3 volte** (pausa 1 s, poi 2 s) se la rete fallisce o il server risponde `5xx`, `429` o `408`, entro ~50 s (Shirox concede 120 s a ogni funzione). `403` e `404` non vengono ritentati. Stesso schema di StreamingCommunity, VixSrc e dei moduli manga. Test live del 10/11/2026 da PC: "frieren" ok. Backup pre-modifica: `backup/v1.0.2/` (solo sul PC).

### Limite noto: "Continua a guardare"
Lo stream salvato da Shirox contiene un token Vixcloud a scadenza. Nelle build recenti di Shirox (`Views/ContinueWatchingCard.swift` → `onStreamExpired`) quando il link è scaduto l'app richiama `extractEpisodes`, ritrova l'episodio tramite `href` (o numero) e chiede un nuovo stream: il problema dovrebbe risolversi da solo (da verificare sull'iPhone). Per questo gli `href` degli episodi devono restare **stabili** tra le versioni del modulo. Con la v1.1.0 gli href sono cambiati (dominio nuovo e id del video al posto dell'id episodio): gli episodi in "Continua a guardare" salvati con la v1.0.x non si riprendono, vanno riaperti dalla ricerca.

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
    │   ├── check-domain.yml        # Robot: controlla il dominio e AVVISA (issue). Solo avvio manuale dal 20/10/2026
    │   ├── update-domain.yml       # Robot: cambio dominio su richiesta (anche da cellulare)
    │   └── health-check.yml        # Robot: test completo ogni giorno, AVVISA se il modulo non funziona
    └── scripts/
        ├── check-domain.js
        └── update-domain.js
```

---

## 4. CAMBIO DOMINIO

### 🤖 Avviso automatico
- **Controllo dominio** è disattivato dal 20/10/2026 (il dominio non cambia): parte solo a mano da *Actions → Controllo dominio → Run workflow*. Non modifica nulla.
- Se il dominio reindirizza altrove **o non risponde più**, apre una **issue** con etichetta `dominio` assegnata a te → notifica su app GitHub / email.
- ⚠️ GitHub sospende i workflow programmati (qui: **Salute modulo**) dopo **60 giorni senza attività** nel repo (manda una email prima). Riattivazione: *Actions → Salute modulo → Enable workflow*.

### 🩺 Salute del modulo (robot giornaliero)
- Ogni giorno GitHub esegue **Salute modulo**: test offline + test completo sul sito vero (ricerca → episodi → stream).
- Se fallisce **2 volte di fila** apre una issue con etichetta `salute` (notifica su app GitHub / email): il sito ha probabilmente cambiato la struttura delle pagine e il modulo va aggiornato.
- Un solo errore isolato non genera avvisi.
- **AnimeUnity blocca i server di GitHub** (Cloudflare risponde `403` agli IP dei datacenter; verificato 2026-10-16): da lì la ricerca dà 0 risultati anche se il modulo funziona. `test-module.js` lo riconosce ed esce con codice **2** ("non verificabile"): il run resta verde con un avviso giallo e non apre né chiude issue. Per una verifica vera lanciare il test dal PC (rete italiana).
- Codici di uscita di `test-module.js`: `0` ok, `1` test falliti, `2` sito non raggiungibile da questa rete.
- Quando il test torna a funzionare la issue si chiude da sola. Lancio manuale: *Actions → Salute modulo → Run workflow*.

### 📱 Da cellulare
1. Apri il link nella issue, oppure `https://github.com/Karelg86/media-player-anim2/actions/workflows/update-domain.yml`
2. **Run workflow** → scrivi il nuovo dominio **senza** `https://`, con o senza `www.` come lo usa il sito (oggi `animeunity.cx`, senza www) → conferma.
3. Il robot sostituisce il dominio in `main.json`, `extractor.js`, `Quick-Resume.md`, `test-module.js`, incrementa la versione, lancia i test, fa commit + push e chiude la issue.
4. Su Shirox: Moduli → aggiorna.

> Test del robot falliti ≠ errore per forza: AnimeUnity (Cloudflare) blocca i server di GitHub con `403`. Prova su Shirox o lancia il test dal PC.

### 💻 Da PC
```bash
node .github/scripts/update-domain.js animeunity.nuovo
node test-module.js "frieren"
node test-module.js "one piece"
git add main.json extractor.js Quick-Resume.md test-module.js
git commit -m "Update domain to animeunity.nuovo - vX.Y.Z"
git push origin main
```

> ⚠️ Shirox salva lo script in cache: incrementare `version` in `main.json` è **obbligatorio** per far scaricare la nuova versione. `update-domain.js` lo fa da solo.
> Shirox controlla gli aggiornamenti all'avvio a freddo dell'app o col pulsante refresh nella schermata Modules: rilegge il `main.json` dal link installato e reinstalla se `version` cambia. Non serve reinserire il link (salta l'aggiornamento solo se lo script è stato modificato dentro l'app). Verificato sul sorgente Shirox il 22/10/2026.

---

## 5. TEST

```bash
node test-module.js --mock         # offline: apostrofi, due risultati ita/jpn, blocchi da 120 con start, episodi per lingua, data-page, stream, retry
node test-module.js "frieren"      # live
node test-module.js "one piece"    # live, anime lungo
```

### Su Shirox
1. Aggiungi il modulo dal link raw: `https://raw.githubusercontent.com/Karelg86/media-player-anim2/main/main.json`
2. Cerca "Frieren" o "One Piece", apri la scheda, avvia un episodio.
3. Verifica: titoli puliti, lista episodi completa, video fluido, scelta audio/sottotitoli.
