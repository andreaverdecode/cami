/*
 * dati.js — archivio dei dati dell'app, condiviso da tutte le pagine.
 *
 * Tutti i dati stanno in UNA sola chiave di localStorage ("planner"):
 *
 *   {
 *     versione: 1,
 *     clienti:  [{ id, nome, tariffaCentesimi, creatoIl }],
 *     attivita: [{ id, clienteId, data, minuti, tariffaCentesimi, creatoIl }]
 *   }
 *
 * Regole sul formato:
 * - gli importi sono in centesimi interi (25,50 €/h -> 2550), così i conti
 *   non accumulano errori di arrotondamento dei numeri decimali;
 * - le durate sono in minuti interi (1 h 30 min -> 90);
 * - le date sono stringhe "AAAA-MM-GG" del giorno locale (niente fusi orari);
 * - ogni attività copia la tariffa del cliente al momento della registrazione,
 *   così se in futuro cambi la tariffa i conteggi passati restano corretti;
 * - i clienti hanno un id univoco: le attività si collegano all'id, non al nome.
 *
 * Ogni modifica rilegge l'archivio dal disco subito prima di scrivere, così
 * due schede aperte contemporaneamente non si sovrascrivono a vicenda.
 */
const Dati = (() => {
    "use strict";

    const CHIAVE = "planner";
    const CHIAVE_VECCHIA = "clienti"; // formato del primo commit: [{ cliente, paga }]
    const VERSIONE = 1;

    class ErroreValidazione extends Error {
        /** @param {string} campo  il name del campo del form a cui si riferisce l'errore */
        constructor(messaggio, campo) {
            super(messaggio);
            this.name = "ErroreValidazione";
            this.campo = campo;
        }
    }

    // ---------- lettura e scrittura ----------

    function archivioVuoto() {
        return { versione: VERSIONE, clienti: [], attivita: [] };
    }

    function eValido(archivio) {
        return archivio !== null
            && typeof archivio === "object"
            && Number.isInteger(archivio.versione)
            && Array.isArray(archivio.clienti)
            && Array.isArray(archivio.attivita);
    }

    function leggiChiave(chiave) {
        try {
            return localStorage.getItem(chiave);
        } catch (errore) {
            throw new Error("Il browser non permette di salvare dati (forse sei in navigazione privata o i cookie sono bloccati).", { cause: errore });
        }
    }

    function scrivi(archivio) {
        try {
            localStorage.setItem(CHIAVE, JSON.stringify(archivio));
        } catch (errore) {
            throw new Error("Impossibile salvare i dati: la memoria del browser è piena o non disponibile.", { cause: errore });
        }
        richiediPersistenza();
    }

    function carica() {
        const grezzo = leggiChiave(CHIAVE);
        if (grezzo === null) return migraVecchioFormato();

        try {
            const archivio = JSON.parse(grezzo);
            if (eValido(archivio)) return archivio;
        } catch {
            // gestito qui sotto
        }

        // Dati illeggibili: NON li buttiamo via, li spostiamo in una chiave di
        // backup e ripartiamo da un archivio vuoto.
        const chiaveBackup = `${CHIAVE}-backup-${Date.now()}`;
        localStorage.setItem(chiaveBackup, grezzo);
        const archivio = archivioVuoto();
        scrivi(archivio);
        alert(`I dati salvati erano danneggiati e non è stato possibile leggerli. Una copia è stata conservata nel browser con la chiave "${chiaveBackup}".`);
        return archivio;
    }

    /** Converte i clienti salvati dalla prima versione dell'app. La vecchia chiave resta come copia. */
    function migraVecchioFormato() {
        const archivio = archivioVuoto();
        const grezzo = leggiChiave(CHIAVE_VECCHIA);
        if (grezzo === null) return archivio;

        let vecchi;
        try {
            vecchi = JSON.parse(grezzo);
        } catch {
            return archivio;
        }
        if (!Array.isArray(vecchi)) return archivio;

        for (const vecchio of vecchi) {
            let nome = normalizzaNome(vecchio?.cliente);
            const tariffaCentesimi = euroInCentesimi(vecchio?.paga);
            if (!nome || tariffaCentesimi === null) continue;

            // Nella vecchia versione i nomi potevano ripetersi: li rendiamo distinguibili.
            const base = nome;
            for (let n = 2; trovaPerNome(archivio, nome); n++) nome = `${base} (${n})`;

            archivio.clienti.push(nuovoCliente(nome, tariffaCentesimi));
        }
        scrivi(archivio);
        return archivio;
    }

    let persistenzaRichiesta = false;

    /** Chiede al browser di non cancellare i dati quando libera spazio. */
    function richiediPersistenza() {
        if (persistenzaRichiesta || !navigator.storage?.persist) return;
        persistenzaRichiesta = true;
        navigator.storage.persisted()
            .then((giaPersistente) => giaPersistente || navigator.storage.persist())
            .catch(() => {});
    }

    // ---------- conversioni e controlli ----------

    function nuovoId() {
        if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
        // crypto.randomUUID esiste solo su https/localhost
        return Date.now().toString(36) + Math.random().toString(36).slice(2);
    }

    function normalizzaNome(valore) {
        return String(valore ?? "").trim().replace(/\s+/g, " ");
    }

    function trovaPerNome(archivio, nome) {
        const cercato = nome.toLocaleLowerCase("it");
        return archivio.clienti.find((c) => c.nome.toLocaleLowerCase("it") === cercato);
    }

    /** "25,5" / "25.50" / 25.5 -> 2550. Restituisce null se il valore non è valido. */
    function euroInCentesimi(valore) {
        if (typeof valore === "string") valore = valore.trim().replace(",", ".");
        if (valore === "" || valore === null || valore === undefined) return null;
        const numero = Number(valore);
        if (!Number.isFinite(numero) || numero < 0) return null;
        return Math.round(numero * 100);
    }

    /** "" -> 0, "3" -> 3. Restituisce null se non è un intero >= 0. */
    function interoNonNegativo(valore) {
        const numero = valore === "" || valore === undefined ? 0 : Number(valore);
        return Number.isInteger(numero) && numero >= 0 ? numero : null;
    }

    function eDataValida(testo) {
        if (typeof testo !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(testo)) return false;
        const [anno, mese, giorno] = testo.split("-").map(Number);
        const data = new Date(anno, mese - 1, giorno);
        return data.getFullYear() === anno && data.getMonth() === mese - 1 && data.getDate() === giorno;
    }

    /** La data di oggi nel fuso orario locale, in formato "AAAA-MM-GG". */
    function oggi() {
        const d = new Date();
        const due = (n) => String(n).padStart(2, "0");
        return `${d.getFullYear()}-${due(d.getMonth() + 1)}-${due(d.getDate())}`;
    }

    function nuovoCliente(nome, tariffaCentesimi) {
        return { id: nuovoId(), nome, tariffaCentesimi, creatoIl: new Date().toISOString() };
    }

    // ---------- API pubblica ----------

    /** Restituisce { clienti, attivita }: clienti in ordine alfabetico, attività dalla più recente. */
    function leggi() {
        const { clienti, attivita } = carica();
        clienti.sort((a, b) => a.nome.localeCompare(b.nome, "it", { sensitivity: "base" }));
        attivita.sort((a, b) => b.data.localeCompare(a.data) || b.creatoIl.localeCompare(a.creatoIl));
        return { clienti, attivita };
    }

    /** @param {{ nome: string, tariffa: string|number }} campi  tariffa in euro */
    function aggiungiCliente({ nome, tariffa }) {
        const nomePulito = normalizzaNome(nome);
        if (!nomePulito) {
            throw new ErroreValidazione("Inserisci il nome del cliente.", "nome");
        }
        const tariffaCentesimi = euroInCentesimi(tariffa);
        if (tariffaCentesimi === null) {
            throw new ErroreValidazione("Inserisci una paga oraria valida, per esempio 25 o 25,50.", "tariffa");
        }

        const archivio = carica();
        if (trovaPerNome(archivio, nomePulito)) {
            throw new ErroreValidazione(`Esiste già un cliente di nome "${nomePulito}".`, "nome");
        }

        const cliente = nuovoCliente(nomePulito, tariffaCentesimi);
        archivio.clienti.push(cliente);
        scrivi(archivio);
        return cliente;
    }

    /** @param {{ clienteId: string, data: string, ore: string|number, minuti: string|number }} campi */
    function aggiungiAttivita({ clienteId, data, ore, minuti }) {
        const archivio = carica();

        const cliente = archivio.clienti.find((c) => c.id === clienteId);
        if (!cliente) {
            throw new ErroreValidazione("Scegli un cliente.", "cliente");
        }
        if (!eDataValida(data)) {
            throw new ErroreValidazione("Inserisci una data valida.", "data");
        }
        const oreNum = interoNonNegativo(ore);
        if (oreNum === null || oreNum > 23) {
            throw new ErroreValidazione("Le ore devono essere un numero intero da 0 a 23.", "ore");
        }
        const minutiNum = interoNonNegativo(minuti);
        if (minutiNum === null || minutiNum > 59) {
            throw new ErroreValidazione("I minuti devono essere un numero intero da 0 a 59.", "minuti");
        }
        const totaleMinuti = oreNum * 60 + minutiNum;
        if (totaleMinuti === 0) {
            throw new ErroreValidazione("Inserisci una durata maggiore di zero.", "ore");
        }

        const attivita = {
            id: nuovoId(),
            clienteId,
            data,
            minuti: totaleMinuti,
            tariffaCentesimi: cliente.tariffaCentesimi,
            creatoIl: new Date().toISOString(),
        };
        archivio.attivita.push(attivita);
        scrivi(archivio);
        return attivita;
    }

    /** Importo in centesimi di un'attività. */
    function importo(attivita) {
        return Math.round((attivita.minuti * attivita.tariffaCentesimi) / 60);
    }

    /**
     * Chiama `callback` quando i dati potrebbero essere cambiati altrove:
     * in un'altra scheda, oppure tornando a questa pagina con il tasto "indietro"
     * (il browser la ripristina dalla cache così com'era).
     */
    function allaModifica(callback) {
        window.addEventListener("storage", (evento) => {
            if (evento.key === CHIAVE || evento.key === null) callback();
        });
        window.addEventListener("pageshow", (evento) => {
            if (evento.persisted) callback();
        });
    }

    return Object.freeze({
        ErroreValidazione,
        leggi,
        aggiungiCliente,
        aggiungiAttivita,
        importo,
        oggi,
        allaModifica,
    });
})();
