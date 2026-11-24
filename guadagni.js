"use strict";

/*
 * Dashboard dei guadagni.
 * Il periodo scelto (mese, anno o sempre) filtra tutto quello che c'è nella pagina,
 * così i numeri del totale, dei clienti e del grafico sono sempre coerenti tra loro.
 */

const el = (id) => document.getElementById(id);

const formatoMese = new Intl.DateTimeFormat("it-IT", { month: "long" });
const formatoMeseBreve = new Intl.DateTimeFormat("it-IT", { month: "short" });
const formatoEuroTondo = new Intl.NumberFormat("it-IT", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
    useGrouping: "always",
});

const maiuscola = (testo) => testo.charAt(0).toUpperCase() + testo.slice(1);
const due = (n) => String(n).padStart(2, "0");
const nomeMese = (mese, formato = formatoMese) => formato.format(new Date(2000, mese - 1, 1)).replace(".", "");

// ---------- periodo ----------

const [annoOggi, meseOggi] = Dati.oggi().split("-").map(Number);
let periodo = { tipo: "mese", anno: annoOggi, mese: meseOggi };

/** Le date sono "AAAA-MM-GG": un periodo corrisponde a un prefisso ("2026-11", "2026", ""). */
function prefisso(p) {
    if (p.tipo === "mese") return `${p.anno}-${due(p.mese)}`;
    if (p.tipo === "anno") return String(p.anno);
    return "";
}

function etichetta(p) {
    if (p.tipo === "mese") return maiuscola(`${nomeMese(p.mese)} ${p.anno}`);
    if (p.tipo === "anno") return String(p.anno);
    return "Da sempre";
}

function sposta(p, passi) {
    if (p.tipo === "mese") {
        const totale = p.anno * 12 + (p.mese - 1) + passi;
        return { ...p, anno: Math.floor(totale / 12), mese: (totale % 12) + 1 };
    }
    if (p.tipo === "anno") return { ...p, anno: p.anno + passi };
    return p;
}

// ---------- calcoli ----------

function riepilogo(attivita) {
    let centesimi = 0;
    let minuti = 0;
    let daIncassare = 0;
    for (const a of attivita) {
        const importo = Dati.importo(a);
        centesimi += importo;
        minuti += a.minuti;
        if (!a.saldato) daIncassare += importo;
    }
    return { centesimi, minuti, daIncassare, incassato: centesimi - daIncassare, numero: attivita.length };
}

function nelPeriodo(attivita, p) {
    const inizio = prefisso(p);
    return attivita.filter((a) => a.data.startsWith(inizio));
}

/** Suddivide le attività del periodo in colonne: giorni del mese, mesi dell'anno o anni. */
function colonne(attivita, p, tutte) {
    let chiavi;
    if (p.tipo === "mese") {
        const giorni = new Date(p.anno, p.mese, 0).getDate();
        chiavi = Array.from({ length: giorni }, (_, i) => {
            const giorno = i + 1;
            const data = `${p.anno}-${due(p.mese)}-${due(giorno)}`;
            return {
                chiave: data,
                asse: giorno === 1 || giorno % 5 === 0 ? String(giorno) : "",
                nome: UI.data(data),
            };
        });
    } else if (p.tipo === "anno") {
        chiavi = Array.from({ length: 12 }, (_, i) => ({
            chiave: `${p.anno}-${due(i + 1)}`,
            asse: i % 2 === 0 ? nomeMese(i + 1, formatoMeseBreve) : "", // uno sì e uno no, altrimenti si toccano
            nome: maiuscola(`${nomeMese(i + 1)} ${p.anno}`),
        }));
    } else {
        const anni = tutte.map((a) => Number(a.data.slice(0, 4)));
        const primo = Math.min(...anni);
        const ultimo = Math.max(...anni, annoOggi);
        chiavi = Array.from({ length: ultimo - primo + 1 }, (_, i) => ({
            chiave: String(primo + i),
            asse: String(primo + i),
            nome: String(primo + i),
        }));
    }
    return chiavi.map((c) => ({ ...c, ...riepilogo(attivita.filter((a) => a.data.startsWith(c.chiave))) }));
}

/** Scala "pulita" per l'asse: tetto e passo tondi (1, 2, 2,5 o 5 per una potenza di 10), in euro. */
function scala(massimoCentesimi) {
    const massimo = Math.max(massimoCentesimi / 100, 1);
    const grezzo = massimo / 4;
    const potenza = 10 ** Math.floor(Math.log10(grezzo));
    const passo = Math.max(1, [1, 2, 2.5, 5, 10].map((m) => m * potenza).find((v) => v >= grezzo));
    return { passo, tetto: Math.ceil(massimo / passo) * passo };
}

// ---------- disegno ----------

function mostraTotali(attivita, tutte) {
    const corrente = riepilogo(nelPeriodo(attivita, periodo));
    el("totale").textContent = UI.euro(corrente.centesimi);
    el("ore").textContent = UI.durata(corrente.minuti);
    el("media").textContent = corrente.minuti > 0
        ? `${UI.euro(Math.round((corrente.centesimi * 60) / corrente.minuti))}/h`
        : "—";

    // Incassato / da incassare: barra piena = quota già pagata.
    el("incasso").hidden = corrente.centesimi === 0;
    if (corrente.centesimi > 0) {
        const quota = corrente.incassato / corrente.centesimi;
        el("meter-riempimento").style.width = `${quota * 100}%`;
        el("meter-incasso").setAttribute("aria-label",
            `Incassato il ${Math.round(quota * 100)}%: ${UI.euro(corrente.incassato)} su ${UI.euro(corrente.centesimi)}`);
        el("incassato").textContent = UI.euro(corrente.incassato);
        el("da-incassare").textContent = UI.euro(corrente.daIncassare);
    }

    // Confronto con il periodo precedente (non ha senso per "sempre").
    const confronto = el("confronto");
    confronto.replaceChildren();
    if (periodo.tipo === "sempre") {
        confronto.textContent = corrente.numero === 1 ? "1 attività registrata" : `${corrente.numero} attività registrate`;
        return;
    }
    const precedente = sposta(periodo, -1);
    const prima = riepilogo(nelPeriodo(tutte, precedente)).centesimi;
    // "a ottobre 2026" / "al 2025", "in ottobre 2026" / "nel 2025"
    const nome = etichetta(precedente).toLocaleLowerCase("it");
    const [rispettoA, inPeriodo] = periodo.tipo === "mese" ? [`a ${nome}`, `a ${nome}`] : [`al ${nome}`, `nel ${nome}`];
    if (prima === 0) {
        confronto.textContent = `Nessun guadagno ${inPeriodo}`;
        return;
    }
    const variazione = Math.round(((corrente.centesimi - prima) / prima) * 100);
    const icona = document.createElement("i");
    icona.className = `fa-solid ${variazione > 0 ? "fa-arrow-trend-up" : variazione < 0 ? "fa-arrow-trend-down" : "fa-equals"}`;
    icona.setAttribute("aria-hidden", "true");
    const segno = variazione > 0 ? "+" : "";
    confronto.append(icona, ` ${segno}${variazione}% rispetto ${rispettoA} (${UI.euro(prima)})`);
}

function mostraClienti(attivita, clienti) {
    const nomi = new Map(clienti.map((c) => [c.id, c.nome]));
    const perCliente = new Map();
    for (const a of attivita) {
        const lista = perCliente.get(a.clienteId) ?? [];
        lista.push(a);
        perCliente.set(a.clienteId, lista);
    }
    const righe = [...perCliente]
        .map(([id, lista]) => ({ nome: nomi.get(id) ?? "Cliente sconosciuto", ...riepilogo(lista) }))
        .sort((a, b) => b.centesimi - a.centesimi || a.nome.localeCompare(b.nome, "it"));

    const totale = righe.reduce((somma, r) => somma + r.centesimi, 0);
    const massimo = righe[0]?.centesimi ?? 0;

    el("per-cliente").replaceChildren(...righe.map((r) => {
        const quota = totale > 0 ? Math.round((r.centesimi / totale) * 100) : 0;
        const riga = UI.daModello(el("modello-riga-cliente"), {
            nome: r.nome,
            importo: UI.euro(r.centesimi),
            dettaglio: `${UI.durata(r.minuti)} · ${quota}% del totale`
                + (r.daIncassare > 0 ? ` · da incassare ${UI.euro(r.daIncassare)}` : " · tutto incassato"),
        });
        riga.querySelector(".classifica-riempimento").style.width = massimo > 0 ? `${(r.centesimi / massimo) * 100}%` : "0";
        return riga;
    }));
    el("per-cliente-vuoto").hidden = righe.length > 0;
}

let colonneCorrenti = [];
let colonnaAttiva = -1;

function mostraAndamento(attivita, tutte) {
    const titoli = { mese: "Andamento giornaliero", anno: "Andamento mensile", sempre: "Andamento annuale" };
    el("titolo-andamento").textContent = titoli[periodo.tipo];

    colonneCorrenti = colonne(attivita, periodo, tutte);
    const vuoto = attivita.length === 0;
    // Un grafico con una sola colonna non dice niente: per "sempre" serve almeno qualche anno.
    el("sezione-andamento").hidden = periodo.tipo === "sempre" && colonneCorrenti.length < 2;
    el("andamento-vuoto").hidden = !vuoto;
    el("grafico").hidden = vuoto;
    el("vista-tabella").hidden = vuoto;
    nascondiTooltip();
    if (vuoto) return;

    const { passo, tetto } = scala(Math.max(...colonneCorrenti.map((c) => c.centesimi)));
    const n = colonneCorrenti.length;

    // Asse y e griglia: una linea per ogni passo.
    const tacche = [];
    for (let v = 0; v <= tetto + 1e-9; v += passo) tacche.push(v);
    el("asse-y").replaceChildren(...tacche.map((v) => {
        const tacca = document.createElement("span");
        tacca.textContent = formatoEuroTondo.format(v);
        tacca.style.bottom = `${(v / tetto) * 100}%`;
        return tacca;
    }));
    el("griglia").replaceChildren(...tacche.map((v) => {
        const linea = document.createElement("span");
        linea.style.bottom = `${(v / tetto) * 100}%`;
        return linea;
    }));

    // Colonne.
    el("colonne").style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    el("colonne").replaceChildren(...colonneCorrenti.map((c) => {
        const banda = document.createElement("div");
        banda.className = "grafico-banda";
        const colonna = document.createElement("div");
        colonna.className = "grafico-colonna";
        colonna.style.height = `${(c.centesimi / 100 / tetto) * 100}%`;
        colonna.classList.toggle("vuota", c.centesimi === 0);
        banda.append(colonna);
        return banda;
    }));

    // Asse x.
    el("asse-x").style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    el("asse-x").replaceChildren(...colonneCorrenti.map((c) => {
        const etichettaAsse = document.createElement("span");
        etichettaAsse.textContent = c.asse;
        return etichettaAsse;
    }));

    // Vista tabella: stessi dati, leggibili senza grafico (solo i periodi con attività).
    el("tabella").replaceChildren(...colonneCorrenti.filter((c) => c.numero > 0).map((c) => {
        const riga = document.createElement("tr");
        for (const testo of [c.nome, UI.durata(c.minuti), UI.euro(c.centesimi)]) {
            const cella = document.createElement("td");
            cella.textContent = testo;
            riga.append(cella);
        }
        return riga;
    }));
}

// ---------- tooltip del grafico ----------

function mostraTooltip(indice) {
    const colonna = colonneCorrenti[indice];
    if (!colonna) return;
    colonnaAttiva = indice;
    const bande = el("colonne").children;
    for (let i = 0; i < bande.length; i++) bande[i].classList.toggle("attiva", i === indice);

    el("tooltip-valore").textContent = UI.euro(colonna.centesimi);
    el("tooltip-etichetta").textContent = colonna.minuti > 0
        ? `${colonna.nome} · ${UI.durata(colonna.minuti)}`
        : colonna.nome;
    const tooltip = el("tooltip");
    tooltip.hidden = false;

    // Centrato sulla colonna, ma senza uscire dai bordi del grafico.
    const larghezzaPiano = el("piano").clientWidth;
    const centro = ((indice + 0.5) / colonneCorrenti.length) * larghezzaPiano;
    const meta = tooltip.offsetWidth / 2;
    tooltip.style.left = `${Math.min(Math.max(centro, meta), larghezzaPiano - meta)}px`;
}

function nascondiTooltip() {
    colonnaAttiva = -1;
    el("tooltip").hidden = true;
    for (const banda of el("colonne").children) banda.classList.remove("attiva");
}

function indiceDaPuntatore(evento) {
    const rettangolo = el("colonne").getBoundingClientRect();
    const indice = Math.floor(((evento.clientX - rettangolo.left) / rettangolo.width) * colonneCorrenti.length);
    return Math.min(Math.max(indice, 0), colonneCorrenti.length - 1);
}

// L'area sensibile è l'intera fascia della colonna, non solo la barra disegnata.
el("piano").addEventListener("pointermove", (e) => mostraTooltip(indiceDaPuntatore(e)));
el("piano").addEventListener("pointerdown", (e) => mostraTooltip(indiceDaPuntatore(e)));
el("piano").addEventListener("pointerleave", (e) => {
    // Su touch il tooltip resta finché non si tocca altrove.
    if (e.pointerType === "mouse" && document.activeElement !== el("piano")) nascondiTooltip();
});
document.addEventListener("pointerdown", (e) => {
    if (!el("piano").contains(e.target)) nascondiTooltip();
});

// Da tastiera: frecce per spostarsi tra le colonne, Home/Fine per la prima/ultima.
el("piano").addEventListener("keydown", (e) => {
    const ultimo = colonneCorrenti.length - 1;
    const tasti = {
        ArrowRight: Math.min(colonnaAttiva + 1, ultimo),
        ArrowLeft: Math.max(colonnaAttiva - 1, 0),
        Home: 0,
        End: ultimo,
    };
    if (!(e.key in tasti)) return;
    e.preventDefault();
    mostraTooltip(colonnaAttiva < 0 && e.key.startsWith("Arrow") ? 0 : tasti[e.key]);
});
el("piano").addEventListener("blur", nascondiTooltip);

// ---------- filtri ----------

/** Limiti della navigazione: dal periodo della prima attività fino a oggi (o all'ultima attività, se futura). */
function limiti(tutte) {
    const date = tutte.map((a) => a.data).sort();
    const oggi = Dati.oggi();
    return {
        primo: date[0] ?? oggi,
        ultimo: date.length && date[date.length - 1] > oggi ? date[date.length - 1] : oggi,
    };
}

function aggiornaFiltri(tutte) {
    const { primo, ultimo } = limiti(tutte);
    const corrente = prefisso(periodo);
    const lunghezza = corrente.length;
    el("navigatore").hidden = periodo.tipo === "sempre";
    el("etichetta-periodo").textContent = etichetta(periodo);
    el("precedente").disabled = corrente <= primo.slice(0, lunghezza);
    el("successivo").disabled = corrente >= ultimo.slice(0, lunghezza);
}

const disegna = UI.protetto(() => {
    const { clienti, attivita: tutte } = Dati.leggi();
    el("nessun-dato").hidden = tutte.length > 0;
    el("contenuto").hidden = tutte.length === 0;
    aggiornaFiltri(tutte);
    if (tutte.length === 0) return;

    const attivita = nelPeriodo(tutte, periodo);
    mostraTotali(attivita, tutte);
    mostraClienti(attivita, clienti);
    mostraAndamento(attivita, tutte);
});

for (const radio of document.querySelectorAll('input[name="tipo"]')) {
    radio.addEventListener("change", () => {
        // Cambiando tipo si riparte dal periodo che contiene oggi.
        periodo = { tipo: radio.value, anno: annoOggi, mese: meseOggi };
        disegna();
    });
}
el("precedente").addEventListener("click", () => {
    periodo = sposta(periodo, -1);
    disegna();
});
el("successivo").addEventListener("click", () => {
    periodo = sposta(periodo, 1);
    disegna();
});

Dati.allaModifica(disegna);
disegna();
