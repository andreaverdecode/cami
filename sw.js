/*
 * sw.js — service worker: fa funzionare l'app anche senza connessione
 * (per esempio quando la apri dall'icona sulla schermata Home).
 *
 * - I file dell'app vengono salvati alla prima visita.
 * - Pagine e file dell'app: si mostra subito la copia salvata e intanto si scarica
 *   quella nuova, che verrà usata alla prossima apertura ("stale-while-revalidate").
 * - Font e icone dalle CDN: si scaricano una volta sola e poi si usa la copia salvata.
 *
 * QUANDO PUBBLICHI MODIFICHE ALL'APP aumenta VERSIONE: così le vecchie copie vengono
 * eliminate e tutti ricevono subito i file nuovi.
 *
 * I dati (clienti, ore) NON passano da qui: stanno in localStorage e non vengono mai toccati.
 */
const VERSIONE = "v2";
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
            .then((cache) => cache.addAll(FILE_APP))
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
        evento.respondWith(staleWhileRevalidate(richiesta, evento));
    } else if (HOST_ESTERNI.includes(url.hostname)) {
        evento.respondWith(primaLaCache(richiesta));
    }
});

async function staleWhileRevalidate(richiesta, evento) {
    const cache = await caches.open(CACHE_APP);
    // ignoreSearch: "index.html?x" usa comunque la copia di "index.html"
    const salvata = await cache.match(richiesta, { ignoreSearch: true });
    const dallaRete = fetch(richiesta)
        .then((risposta) => {
            if (risposta.ok) cache.put(richiesta, risposta.clone());
            return risposta;
        })
        .catch(() => null);

    if (salvata) {
        evento.waitUntil(dallaRete);
        return salvata;
    }
    const risposta = await dallaRete;
    if (risposta) return risposta;
    // Offline e pagina mai vista: mostriamo la pagina principale.
    if (richiesta.mode === "navigate") {
        const principale = await cache.match("./index.html");
        if (principale) return principale;
    }
    return Response.error();
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
