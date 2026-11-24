/*
 * ui.js — funzioni di interfaccia condivise da tutte le pagine:
 * formattazione di importi, durate e date, e visualizzazione degli errori.
 */
const UI = (() => {
    "use strict";

    const formatoEuro = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" });
    const formatoData = new Intl.DateTimeFormat("it-IT", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
    });

    /** 2550 -> "25,50 €" */
    function euro(centesimi) {
        return formatoEuro.format(centesimi / 100);
    }

    /** 90 -> "1 h 30 min" */
    function durata(minuti) {
        const ore = Math.floor(minuti / 60);
        const resto = minuti % 60;
        if (ore === 0) return `${resto} min`;
        if (resto === 0) return `${ore} h`;
        return `${ore} h ${resto} min`;
    }

    /** "2026-11-24" -> "mar 24 nov 2026" */
    function data(testo) {
        const [anno, mese, giorno] = testo.split("-").map(Number);
        return formatoData.format(new Date(anno, mese - 1, giorno));
    }

    /** Crea un elemento a partire da un <template>, con i campi [data-campo] da riempire. */
    function daModello(modello, valori) {
        const elemento = modello.content.firstElementChild.cloneNode(true);
        for (const [campo, valore] of Object.entries(valori)) {
            const destinazione = elemento.querySelector(`[data-campo="${campo}"]`);
            if (destinazione) destinazione.textContent = valore; // textContent: niente HTML iniettato
        }
        return elemento;
    }

    /**
     * Mostra un errore. Se è un errore di validazione legato a un campo del form,
     * appare come fumetto sul campo; altrimenti come avviso.
     */
    function mostraErrore(form, errore) {
        let campo = errore instanceof Dati.ErroreValidazione ? form?.elements[errore.campo] : null;
        if (campo instanceof RadioNodeList) campo = campo[0]; // gruppo di radio: segnaliamo sul primo
        if (!campo) {
            console.error(errore);
            alert(errore.message);
            return;
        }
        campo.setCustomValidity(errore.message);
        campo.reportValidity();
        // Appena l'utente modifica il form, l'errore sparisce e si può riprovare.
        form.addEventListener("input", () => {
            for (const elemento of form.elements) elemento.setCustomValidity?.("");
        }, { once: true });
    }

    /** Esegue `funzione` mostrando un avviso in caso di errore (per esempio memoria non disponibile). */
    function protetto(funzione) {
        return (...argomenti) => {
            try {
                return funzione(...argomenti);
            } catch (errore) {
                mostraErrore(null, errore);
            }
        };
    }

    return Object.freeze({ euro, durata, data, daModello, mostraErrore, protetto });
})();
