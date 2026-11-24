/*
 * sw.js — service worker: fa funzionare l'app anche senza connessione
 * (per esempio quando la apri dall'icona sulla schermata Home).
 *
 * - Pagine e file dell'app: PRIMA LA RETE. Con la connessione si caricano sempre i file
 *   aggiornati (chiedendo al server se sono cambiati, senza fidarsi della memoria del
 *   browser); la copia salvata si usa solo offline o se la rete non risponde entro
 *   pochi secondi. Così una nuova pubblicazione si vede alla prima apertura.
 * - Font e icone dalle CDN: si scaricano una volta sola e poi si usa la copia salvata.
 *
 * Quando pubblichi modifiche aumenta VERSIONE: le app già aperte in background se ne
 * accorgono al ritorno in primo piano e si ricaricano da sole (vedi ui.js).
 *
 * I dati (clienti, ore) NON passano da qui: stanno in localStorage e non vengono mai toccati.
 */
const VERSIONE = "v3";
const CACHE_APP = `planner-app-${VERSIONE}`;
const CACHE_ESTERNI = "planner-esterni-v1";

const FILE_APP = [
    "./",
    "./index.html",
    "./clienti.html",
    "./guadagni.html",
    "./style.css",
    "./dati.js",
    "./ui.js",
    "./index.js",
    "./clienti.js",
    "./guadagni.js",
    "./manifest.webmanifest",
    "./icone/icona-192.png",
    "./icone/icona-512.png",
    "./icone/icona-maskable-512.png",
    "./icone/apple-touch-icon.png",
];

const HOST_ESTERNI = ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

self.addEventListener("install", (evento) => {
    evento.waitUntil(
        caches.open(CACHE_APP)
            // cache: "reload" = scarica dal server, non dalla memoria del browser
            // (GitHub Pages la tiene valida 10 minuti: si rischierebbe di salvare i file vecchi)
            .then((cache) => cache.addAll(FILE_APP.map((url) => new Request(url, { cache: "reload" }))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (evento) => {
    evento.waitUntil(
        caches.keys()
            .then((nomi) => Promise.all(
                nomi.filter((n) => n.startsWith("planner-app-") && n !== CACHE_APP).map((n) => caches.delete(n)),
            ))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (evento) => {
    const richiesta = evento.request;
    if (richiesta.method !== "GET") return;
    const url = new URL(richiesta.url);

    if (url.origin === self.location.origin) {
        evento.respondWith(primaLaRete(evento));
    } else if (HOST_ESTERNI.includes(url.hostname)) {
        evento.respondWith(primaLaCache(richiesta));
    }
});

// Oltre questo tempo senza risposta dalla rete si mostra la copia salvata (rete lenta).
const ATTESA_RETE_MS = 3000;

// Pagine aperte dalla copia salvata: anche i loro file (CSS, script) arrivano subito dalla
// copia salvata, senza aspettare di nuovo la rete. Così la pagina resta coerente (tutta
// vecchia o tutta nuova) e su rete lenta si apre in pochi secondi.
const clientiDallaCache = new Set();

async function primaLaRete(evento) {
    const richiesta = evento.request;
    const cache = await caches.open(CACHE_APP);

    // cache: "no-cache" = chiedi sempre al server se il file è cambiato (risposta 304 se no:
    // costa pochissimo), invece di usare la copia nella memoria del browser.
    const dallaRete = fetch(richiesta, { cache: "no-cache" }).then(async (risposta) => {
        if (risposta.ok) await cache.put(richiesta, risposta.clone());
        return risposta;
    });
    // Anche se intanto mostriamo la copia salvata, la risposta della rete aggiorna la cache.
    evento.waitUntil(dallaRete.catch(() => {}));

    const navigazione = richiesta.mode === "navigate";
    if (!navigazione && clientiDallaCache.has(evento.clientId)) {
        const salvata = await cache.match(richiesta, { ignoreSearch: true });
        if (salvata) return salvata;
    }

    const scaduto = new Promise((risolvi) => setTimeout(risolvi, ATTESA_RETE_MS, null));
    try {
        const risposta = await Promise.race([dallaRete, scaduto]);
        if (risposta) {
            if (navigazione) clientiDallaCache.delete(evento.resultingClientId);
            return risposta;
        }
    } catch {
        // offline: si usa la copia salvata
    }

    const salvata = await cache.match(richiesta, { ignoreSearch: true });
    if (salvata) {
        if (navigazione && evento.resultingClientId) clientiDallaCache.add(evento.resultingClientId);
        return salvata;
    }
    // Offline e pagina mai vista: mostriamo la pagina principale.
    if (richiesta.mode === "navigate") {
        const principale = await cache.match("./index.html");
        if (principale) return principale;
    }
    // Nessuna copia salvata: non resta che aspettare la rete.
    return dallaRete.catch(() => Response.error());
}

async function primaLaCache(richiesta) {
    const cache = await caches.open(CACHE_ESTERNI);
    const salvata = await cache.match(richiesta);
    if (salvata) return salvata;
    try {
        const risposta = await fetch(richiesta);
        // le risposte "opaque" (status 0) dei CSS da CDN vanno bene lo stesso
        if (risposta.ok || risposta.type === "opaque") cache.put(richiesta, risposta.clone());
        return risposta;
    } catch {
        return Response.error();
    }
}
