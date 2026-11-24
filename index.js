"use strict";

const formAttivita = document.getElementById("new-activity");
const selectCliente = formAttivita.elements.cliente;
const inputData = formAttivita.elements.data;
const bottoneAggiungi = document.getElementById("aggiungi-ore");
const serveCliente = document.getElementById("serve-cliente");
const nessunClienteAttivo = document.getElementById("nessun-cliente-attivo");
const listaAttivita = document.getElementById("lista-attivita");
const nessunaAttivita = document.getElementById("nessuna-attivita");
const modelloAttivita = document.getElementById("modello-attivita");

/** Riempie la select con i clienti attivi, mantenendo la scelta corrente se possibile. */
function popolaSelect(clienti) {
    const scelto = selectCliente.value;
    const segnaposto = new Option("Scegli un cliente", "");
    selectCliente.replaceChildren(segnaposto, ...clienti.map((c) => new Option(c.nome, c.id)));

    if (clienti.some((c) => c.id === scelto)) selectCliente.value = scelto;
    else if (clienti.length === 1) selectCliente.value = clienti[0].id;
}

function mostraAttivita(clienti, attivita) {
    const nomi = new Map(clienti.map((c) => [c.id, c.nome]));
    const card = attivita.map((a) => {
        const elemento = UI.daModello(modelloAttivita, {
            cliente: nomi.get(a.clienteId) ?? "Cliente sconosciuto",
            data: UI.data(a.data),
            durata: UI.durata(a.minuti),
            importo: UI.euro(Dati.importo(a)),
        });
        elemento.querySelector("time").dateTime = a.data;
        return elemento;
    });
    listaAttivita.replaceChildren(...card);
    nessunaAttivita.hidden = attivita.length > 0 || clienti.length === 0;
}

const aggiorna = UI.protetto(() => {
    const { clienti, attivita } = Dati.leggi();
    const attivi = clienti.filter((c) => c.attivo !== false);
    popolaSelect(attivi);
    // Le attività dei clienti spenti restano visibili: per i nomi usiamo tutti i clienti.
    mostraAttivita(clienti, attivita);

    // Senza clienti attivi non si possono registrare ore: rimandiamo alla pagina Clienti.
    bottoneAggiungi.disabled = attivi.length === 0;
    serveCliente.hidden = clienti.length > 0;
    nessunClienteAttivo.hidden = clienti.length === 0 || attivi.length > 0;
    if (attivi.length === 0 && formAttivita.matches(":popover-open")) formAttivita.hidePopover();
});

// All'apertura del form proponiamo la data di oggi.
formAttivita.addEventListener("beforetoggle", (evento) => {
    if (evento.newState === "open" && !inputData.value) inputData.value = Dati.oggi();
});

formAttivita.addEventListener("submit", (evento) => {
    evento.preventDefault();
    try {
        Dati.aggiungiAttivita({
            clienteId: selectCliente.value,
            data: inputData.value,
            ore: formAttivita.elements.ore.value,
            minuti: formAttivita.elements.minuti.value,
        });
    } catch (errore) {
        UI.mostraErrore(formAttivita, errore);
        return;
    }
    formAttivita.reset();
    formAttivita.hidePopover();
    aggiorna();
});

Dati.allaModifica(aggiorna);
aggiorna();
