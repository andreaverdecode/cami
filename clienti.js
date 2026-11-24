"use strict";

const formCliente = document.getElementById("new-client");
const formModifica = document.getElementById("modifica-cliente");
const sceltaTariffa = document.getElementById("scelta-tariffa");
const notaTutte = document.getElementById("nota-tutte");
const notaDaOggi = document.getElementById("nota-da-oggi");
const notaSaldate = document.getElementById("nota-saldate");
const dialogElimina = document.getElementById("conferma-eliminazione");
const listaClienti = document.getElementById("lista-clienti");
const nessunCliente = document.getElementById("nessun-cliente");
const modelloCliente = document.getElementById("modello-cliente");

// ---------- elenco ----------

function aggiornaStatoCard(card, attivo) {
    card.classList.toggle("spento", !attivo);
    card.querySelector('[data-azione="attivo"]').checked = attivo;
    card.querySelector('[data-campo="stato"]').textContent = attivo ? "Attivo" : "Spento";
}

const mostraClienti = UI.protetto(() => {
    const { clienti, attivita } = Dati.leggi();

    // Somma minuti e importi delle attività di ogni cliente.
    const totali = new Map();
    for (const a of attivita) {
        const totale = totali.get(a.clienteId) ?? { minuti: 0, centesimi: 0, daIncassare: 0 };
        totale.minuti += a.minuti;
        totale.centesimi += Dati.importo(a);
        if (!a.saldato) totale.daIncassare += Dati.importo(a);
        totali.set(a.clienteId, totale);
    }

    const card = clienti.map((cliente) => {
        const totale = totali.get(cliente.id) ?? { minuti: 0, centesimi: 0, daIncassare: 0 };
        const elemento = UI.daModello(modelloCliente, {
            nome: cliente.nome,
            tariffa: `${UI.euro(cliente.tariffaCentesimi)}/h`,
            ore: UI.durata(totale.minuti),
            totale: UI.euro(totale.centesimi),
            daIncassare: UI.euro(totale.daIncassare),
        });
        elemento.dataset.id = cliente.id;
        // Etichette per i lettori di schermo: "Modifica Studio Rossi" invece di tanti "Modifica".
        elemento.querySelector('[data-azione="attivo"]').setAttribute("aria-label", `${cliente.nome} attivo`);
        elemento.querySelector('[data-azione="modifica"]').setAttribute("aria-label", `Modifica ${cliente.nome}`);
        elemento.querySelector('[data-azione="elimina"]').setAttribute("aria-label", `Elimina ${cliente.nome}`);
        aggiornaStatoCard(elemento, cliente.attivo !== false);
        return elemento;
    });

    listaClienti.replaceChildren(...card);
    nessunCliente.hidden = clienti.length > 0;
});

/** Restituisce il cliente e le sue attività, o null se nel frattempo è stato eliminato. */
function datiCliente(id) {
    const { clienti, attivita } = Dati.leggi();
    const cliente = clienti.find((c) => c.id === id);
    if (!cliente) {
        alert("Questo cliente non esiste più: forse è stato eliminato in un'altra scheda.");
        mostraClienti();
        return null;
    }
    return { cliente, attivita: attivita.filter((a) => a.clienteId === id) };
}

// Un solo gestore per tutti i bottoni dei riquadri (anche quelli creati dopo).
listaClienti.addEventListener("click", UI.protetto((evento) => {
    const bottone = evento.target.closest("button[data-azione]");
    if (!bottone) return;
    const id = bottone.closest(".card").dataset.id;
    if (bottone.dataset.azione === "modifica") apriModifica(id);
    if (bottone.dataset.azione === "elimina") chiediEliminazione(id);
}));

listaClienti.addEventListener("change", (evento) => {
    const interruttore = evento.target.closest('[data-azione="attivo"]');
    if (!interruttore) return;
    const card = interruttore.closest(".card");
    try {
        Dati.impostaAttivo(card.dataset.id, interruttore.checked);
    } catch (errore) {
        UI.mostraErrore(null, errore);
        mostraClienti();
        return;
    }
    // Aggiorniamo solo questo riquadro, così l'interruttore non perde il focus.
    aggiornaStatoCard(card, interruttore.checked);
});

// ---------- nuovo cliente ----------

formCliente.addEventListener("submit", (evento) => {
    evento.preventDefault();
    try {
        Dati.aggiungiCliente({
            nome: formCliente.elements.nome.value,
            tariffa: formCliente.elements.tariffa.value,
        });
    } catch (errore) {
        UI.mostraErrore(formCliente, errore);
        return;
    }
    formCliente.reset();
    formCliente.hidePopover();
    mostraClienti();
});

// ---------- modifica cliente ----------

function apriModifica(id) {
    const dati = datiCliente(id);
    if (!dati) return;
    const { cliente, attivita } = dati;
    const campi = formModifica.elements;

    formModifica.reset();
    campi.clienteId.value = cliente.id;
    campi.nome.value = cliente.nome;
    campi.tariffa.value = (cliente.tariffaCentesimi / 100).toFixed(2);
    formModifica.dataset.tariffaOriginale = cliente.tariffaCentesimi;
    // Le attività già saldate non vengono ricalcolate: contano solo le altre.
    const nonSaldate = attivita.filter((a) => !a.saldato);
    const saldate = attivita.length - nonSaldate.length;
    formModifica.dataset.numeroAttivita = nonSaldate.length;

    const dataOggi = Dati.oggi();
    const primaDiOggi = nonSaldate.filter((a) => a.data < dataOggi).length;
    const daOggi = nonSaldate.length - primaDiOggi;
    notaTutte.textContent = `Ricalcola ${contaAttivita(nonSaldate.length)} da saldare di questo cliente.`;
    notaSaldate.hidden = saldate === 0;
    notaSaldate.textContent = saldate === 1
        ? "L'attività già saldata non viene ricalcolata."
        : `Le ${saldate} attività già saldate non vengono ricalcolate.`;
    notaDaOggi.textContent = primaDiOggi === 0
        ? "Non ci sono attività prima di oggi: il risultato è lo stesso."
        : `${contaAttivita(primaDiOggi)} prima di oggi ${primaDiOggi === 1 ? "mantiene" : "mantengono"} la paga attuale`
            + (daOggi === 0 ? "."
                : `, ${contaAttivita(daOggi)} da oggi in poi ${daOggi === 1 ? "viene ricalcolata" : "vengono ricalcolate"}.`);

    aggiornaSceltaTariffa();
    formModifica.showPopover();
    // Il focus va sul form e non sul campo Nome: sul telefono la tastiera
    // si aprirebbe subito coprendo metà del form.
    formModifica.focus();
}

function contaAttivita(n) {
    return n === 1 ? "1 attività" : `${n} attività`;
}

/** Mostra la scelta "tutte / da oggi" solo se la paga cambia e ci sono attività da ricalcolare. */
function aggiornaSceltaTariffa() {
    const nuova = Dati.euroInCentesimi(formModifica.elements.tariffa.value);
    const cambiata = nuova !== null && nuova !== Number(formModifica.dataset.tariffaOriginale);
    const mostra = cambiata && Number(formModifica.dataset.numeroAttivita) > 0;
    sceltaTariffa.hidden = !mostra;
    sceltaTariffa.disabled = !mostra; // un fieldset disabilitato non blocca l'invio del form
}

formModifica.elements.tariffa.addEventListener("input", aggiornaSceltaTariffa);

formModifica.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const campi = formModifica.elements;
    try {
        Dati.modificaCliente({
            id: campi.clienteId.value,
            nome: campi.nome.value,
            tariffa: campi.tariffa.value,
            applica: campi.applica.value,
        });
    } catch (errore) {
        UI.mostraErrore(formModifica, errore);
        return;
    }
    formModifica.hidePopover();
    mostraClienti();
});

// ---------- eliminazione cliente ----------

async function chiediEliminazione(id) {
    const dati = datiCliente(id);
    if (!dati) return;
    const { cliente, attivita } = dati;
    const n = attivita.length;

    const confermato = await UI.conferma(dialogElimina, {
        titolo: `Eliminare ${cliente.nome}?`,
        testo: (n === 0 ? "Questo cliente non ha attività registrate."
            : n === 1 ? "Verrà eliminata anche la sua attività registrata."
            : `Verranno eliminate anche le sue ${n} attività registrate.`)
            + " L'operazione non si può annullare.",
    });
    if (!confermato) return;

    try {
        Dati.eliminaCliente(id);
    } catch (errore) {
        UI.mostraErrore(null, errore);
    }
    mostraClienti();
}

Dati.allaModifica(mostraClienti);
mostraClienti();
