"use strict";

const formCliente = document.getElementById("new-client");
const listaClienti = document.getElementById("lista-clienti");
const nessunCliente = document.getElementById("nessun-cliente");
const modelloCliente = document.getElementById("modello-cliente");

const mostraClienti = UI.protetto(() => {
    const { clienti, attivita } = Dati.leggi();

    // Somma minuti e importi delle attività di ogni cliente.
    const totali = new Map();
    for (const a of attivita) {
        const totale = totali.get(a.clienteId) ?? { minuti: 0, centesimi: 0 };
        totale.minuti += a.minuti;
        totale.centesimi += Dati.importo(a);
        totali.set(a.clienteId, totale);
    }

    const card = clienti.map((cliente) => {
        const totale = totali.get(cliente.id) ?? { minuti: 0, centesimi: 0 };
        return UI.daModello(modelloCliente, {
            nome: cliente.nome,
            tariffa: `${UI.euro(cliente.tariffaCentesimi)}/h`,
            ore: UI.durata(totale.minuti),
            totale: UI.euro(totale.centesimi),
        });
    });

    listaClienti.replaceChildren(...card);
    nessunCliente.hidden = clienti.length > 0;
});

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

Dati.allaModifica(mostraClienti);
mostraClienti();
