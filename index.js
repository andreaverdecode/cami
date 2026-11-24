"use strict";

const formAttivita = document.getElementById("new-activity");
const formModifica = document.getElementById("modifica-attivita");
const dialogElimina = document.getElementById("conferma-eliminazione");
const bottoneAggiungi = document.getElementById("aggiungi-ore");
const serveCliente = document.getElementById("serve-cliente");
const nessunClienteAttivo = document.getElementById("nessun-cliente-attivo");
const listaAttivita = document.getElementById("lista-attivita");
const nessunaAttivita = document.getElementById("nessuna-attivita");
const modelloAttivita = document.getElementById("modello-attivita");

/**
 * Riempie una select con i clienti indicati, mantenendo la scelta corrente se possibile.
 * I clienti spenti (che compaiono solo in modifica) sono segnalati come tali.
 */
function popolaSelect(select, clienti) {
    const scelto = select.value;
    const opzioni = clienti.map((c) => new Option(c.attivo === false ? `${c.nome} (spento)` : c.nome, c.id));
    select.replaceChildren(new Option("Scegli un cliente", ""), ...opzioni);

    if (clienti.some((c) => c.id === scelto)) select.value = scelto;
    else if (clienti.length === 1) select.value = clienti[0].id;
}

/** Divide una durata in minuti nei campi ore/minuti di un form. */
function impostaDurata(form, minuti) {
    form.elements.ore.value = Math.floor(minuti / 60) || "";
    form.elements.minuti.value = minuti % 60 || "";
}

// ---------- elenco ----------

function mostraAttivita(clienti, attivita) {
    const nomi = new Map(clienti.map((c) => [c.id, c.nome]));
    const card = attivita.map((a) => {
        const nome = nomi.get(a.clienteId) ?? "Cliente sconosciuto";
        const data = UI.data(a.data);
        const elemento = UI.daModello(modelloAttivita, {
            cliente: nome,
            data,
            durata: UI.durata(a.minuti),
            tariffa: `${UI.euro(a.tariffaCentesimi)}/h`,
            importo: UI.euro(Dati.importo(a)),
        });
        elemento.dataset.id = a.id;
        elemento.querySelector("time").dateTime = a.data;
        elemento.querySelector('[data-azione="modifica"]').setAttribute("aria-label", `Modifica attività di ${nome} del ${data}`);
        elemento.querySelector('[data-azione="elimina"]').setAttribute("aria-label", `Elimina attività di ${nome} del ${data}`);
        return elemento;
    });
    listaAttivita.replaceChildren(...card);
    nessunaAttivita.hidden = attivita.length > 0 || clienti.length === 0;
}

const aggiorna = UI.protetto(() => {
    const { clienti, attivita } = Dati.leggi();
    const attivi = clienti.filter((c) => c.attivo !== false);
    popolaSelect(formAttivita.elements.cliente, attivi);
    // Le attività dei clienti spenti restano visibili: per i nomi usiamo tutti i clienti.
    mostraAttivita(clienti, attivita);

    // Senza clienti attivi non si possono registrare ore: rimandiamo alla pagina Clienti.
    bottoneAggiungi.disabled = attivi.length === 0;
    serveCliente.hidden = clienti.length > 0;
    nessunClienteAttivo.hidden = clienti.length === 0 || attivi.length > 0;
    if (attivi.length === 0 && formAttivita.matches(":popover-open")) formAttivita.hidePopover();
});

// Un solo gestore per i bottoni di tutti i riquadri.
listaAttivita.addEventListener("click", UI.protetto((evento) => {
    const bottone = evento.target.closest("button[data-azione]");
    if (!bottone) return;
    const id = bottone.closest(".card").dataset.id;
    if (bottone.dataset.azione === "modifica") apriModifica(id);
    if (bottone.dataset.azione === "elimina") chiediEliminazione(id);
}));

/** Restituisce { attivita, clienti } o null se nel frattempo l'attività è stata eliminata. */
function datiAttivita(id) {
    const { clienti, attivita } = Dati.leggi();
    const trovata = attivita.find((a) => a.id === id);
    if (!trovata) {
        alert("Questa attività non esiste più: forse è stata eliminata in un'altra scheda.");
        aggiorna();
        return null;
    }
    return { attivita: trovata, clienti };
}

// ---------- nuove ore ----------

// All'apertura del form proponiamo la data di oggi.
formAttivita.addEventListener("beforetoggle", (evento) => {
    const inputData = formAttivita.elements.data;
    if (evento.newState === "open" && !inputData.value) inputData.value = Dati.oggi();
});

formAttivita.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const campi = formAttivita.elements;
    try {
        Dati.aggiungiAttivita({
            clienteId: campi.cliente.value,
            data: campi.data.value,
            ore: campi.ore.value,
            minuti: campi.minuti.value,
        });
    } catch (errore) {
        UI.mostraErrore(formAttivita, errore);
        return;
    }
    formAttivita.reset();
    formAttivita.hidePopover();
    aggiorna();
});

// ---------- modifica attività ----------

// Attività aperta nel form di modifica e paghe attuali dei clienti, per proporre la paga giusta.
let inModifica = null;

function apriModifica(id) {
    const dati = datiAttivita(id);
    if (!dati) return;
    const { attivita, clienti } = dati;
    const campi = formModifica.elements;

    // Clienti attivi + quello che l'attività ha già, anche se è spento.
    const selezionabili = clienti.filter((c) => c.attivo !== false || c.id === attivita.clienteId);
    formModifica.reset();
    campi.cliente.value = "";
    popolaSelect(campi.cliente, selezionabili);
    campi.cliente.value = attivita.clienteId;

    campi.attivitaId.value = attivita.id;
    campi.data.value = attivita.data;
    impostaDurata(formModifica, attivita.minuti);
    campi.tariffa.value = (attivita.tariffaCentesimi / 100).toFixed(2);

    inModifica = {
        attivita,
        tariffeClienti: new Map(clienti.map((c) => [c.id, c.tariffaCentesimi])),
    };

    formModifica.showPopover();
    campi.cliente.focus();
}

// Cambiando cliente proponiamo la sua paga attuale; tornando al cliente originale, la paga che aveva l'attività.
formModifica.elements.cliente.addEventListener("change", () => {
    const campi = formModifica.elements;
    const { attivita, tariffeClienti } = inModifica;
    const centesimi = campi.cliente.value === attivita.clienteId
        ? attivita.tariffaCentesimi
        : tariffeClienti.get(campi.cliente.value);
    if (centesimi !== undefined) campi.tariffa.value = (centesimi / 100).toFixed(2);
});

formModifica.addEventListener("submit", (evento) => {
    evento.preventDefault();
    const campi = formModifica.elements;
    try {
        Dati.modificaAttivita({
            id: campi.attivitaId.value,
            clienteId: campi.cliente.value,
            data: campi.data.value,
            ore: campi.ore.value,
            minuti: campi.minuti.value,
            tariffa: campi.tariffa.value,
        });
    } catch (errore) {
        UI.mostraErrore(formModifica, errore);
        return;
    }
    formModifica.hidePopover();
    aggiorna();
});

// ---------- eliminazione attività ----------

async function chiediEliminazione(id) {
    const dati = datiAttivita(id);
    if (!dati) return;
    const { attivita, clienti } = dati;
    const nome = clienti.find((c) => c.id === attivita.clienteId)?.nome ?? "Cliente sconosciuto";

    const confermato = await UI.conferma(dialogElimina, {
        titolo: "Eliminare questa attività?",
        testo: `${nome} · ${UI.data(attivita.data)} · ${UI.durata(attivita.minuti)} · `
            + `${UI.euro(Dati.importo(attivita))}. L'operazione non si può annullare.`,
    });
    if (!confermato) return;

    try {
        Dati.eliminaAttivita(id);
    } catch (errore) {
        UI.mostraErrore(null, errore);
    }
    aggiorna();
}

Dati.allaModifica(aggiorna);
aggiorna();
