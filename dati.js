/*
 * dati.js — archivio dei dati dell'app, condiviso da tutte le pagine.
 *
 * Tutti i dati stanno in UNA sola chiave di localStorage ("planner"):
 *
 *   {
 *     versione: 3,
 *     clienti:  [{ id, nome, tariffaCentesimi, attivo, creatoIl }],
 *     attivita: [{ id, clienteId, data, minuti, tariffaCentesimi, saldato, creatoIl }]
 *   }
 *
 * Regole sul formato:
 * - gli importi sono in centesimi interi (25,50 €/h -> 2550), così i conti
 *   non accumulano errori di arrotondamento dei numeri decimali;
 * - le durate sono in minuti interi (1 h 30 min -> 90);
 * - le date sono stringhe "AAAA-MM-GG" del giorno locale (niente fusi orari);
 * - ogni attività copia la tariffa del cliente al momento della registrazione,
 *   così se in futuro cambi la tariffa i conteggi passati restano corretti;
 * - i clienti hanno un id univoco: le attività si collegano all'id, non al nome;
 * - un cliente non attivo ("spento") non si può scegliere per nuove attività,
 *   ma le sue attività passate restano;
 * - un'attività "saldata" è già stata pagata: cambiare la paga del cliente
 *   non la ricalcola.
 *
 * Ogni modifica rilegge l'archivio dal disco subito prima di scrivere, così
 * due schede aperte contemporaneamente non si sovrascrivono a vicenda.
 */
const Dati = (() => {
    "use strict";

    const CHIAVE = "planner";
    const CHIAVE_VECCHIA = "clienti"; // formato del primo commit: [{ cliente, paga }]
    const VERSIONE = 3;

    /*
     * Migrazioni del formato: MIGRAZIONI[n] porta l'archivio dalla versione n
     * alla n + 1. Quando cambi il formato aumenta VERSIONE e aggiungi qui il
     * passaggio, così i dati già salvati vengono aggiornati invece che persi.
     */
    const MIGRAZIONI = {
        // 1 -> 2: i clienti possono essere spenti
        1(archivio) {
            for (const cliente of archivio.clienti) cliente.attivo ??= true;
        },
        // 2 -> 3: le attività possono essere segnate come saldate
        2(archivio) {
            for (const attivita of archivio.attivita) attivita.saldato ??= false;
        },
    };

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
            if (eValido(archivio)) return migra(archivio);
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

    function migra(archivio) {
        if (archivio.versione >= VERSIONE) return archivio;
        while (archivio.versione < VERSIONE) {
            MIGRAZIONI[archivio.versione](archivio);
            archivio.versione++;
        }
        scrivi(archivio);
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
        return { id: nuovoId(), nome, tariffaCentesimi, attivo: true, creatoIl: new Date().toISOString() };
    }

    function trovaCliente(archivio, id) {
        const cliente = archivio.clienti.find((c) => c.id === id);
        if (!cliente) throw new Error("Questo cliente non esiste più: forse è stato eliminato in un'altra scheda.");
        return cliente;
    }

    function validaNome(nome) {
        const nomePulito = normalizzaNome(nome);
        if (!nomePulito) throw new ErroreValidazione("Inserisci il nome del cliente.", "nome");
        return nomePulito;
    }

    function validaTariffa(tariffa) {
        const tariffaCentesimi = euroInCentesimi(tariffa);
        if (tariffaCentesimi === null) {
            throw new ErroreValidazione("Inserisci una paga oraria valida, per esempio 25 o 25,50.", "tariffa");
        }
        return tariffaCentesimi;
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
        const nomePulito = validaNome(nome);
        const tariffaCentesimi = validaTariffa(tariffa);

        const archivio = carica();
        if (trovaPerNome(archivio, nomePulito)) {
            throw new ErroreValidazione(`Esiste già un cliente di nome "${nomePulito}".`, "nome");
        }

        const cliente = nuovoCliente(nomePulito, tariffaCentesimi);
        archivio.clienti.push(cliente);
        scrivi(archivio);
        return cliente;
    }

    /**
     * Modifica nome e paga oraria di un cliente.
     * Se la paga cambia e il cliente ha attività salvate, `applica` dice a quali applicarla:
     * - "tutte":   a tutte le attività del cliente;
     * - "da-oggi": solo a quelle con data da oggi in poi (le precedenti restano com'erano).
     * Le attività già saldate non vengono mai ricalcolate: quell'importo è già stato pagato.
     * In ogni caso le attività registrate da qui in avanti useranno la nuova paga.
     * @param {{ id: string, nome: string, tariffa: string|number, applica?: "tutte"|"da-oggi" }} campi
     */
    function modificaCliente({ id, nome, tariffa, applica }) {
        const nomePulito = validaNome(nome);
        const tariffaCentesimi = validaTariffa(tariffa);

        const archivio = carica();
        const cliente = trovaCliente(archivio, id);
        const omonimo = trovaPerNome(archivio, nomePulito);
        if (omonimo && omonimo.id !== id) {
            throw new ErroreValidazione(`Esiste già un cliente di nome "${nomePulito}".`, "nome");
        }

        const nonSaldate = archivio.attivita.filter((a) => a.clienteId === id && !a.saldato);
        if (tariffaCentesimi !== cliente.tariffaCentesimi && nonSaldate.length > 0) {
            let daAggiornare;
            if (applica === "tutte") {
                daAggiornare = nonSaldate;
            } else if (applica === "da-oggi") {
                const dataOggi = oggi();
                daAggiornare = nonSaldate.filter((a) => a.data >= dataOggi);
            } else {
                throw new ErroreValidazione("Scegli a quali attività applicare la nuova paga.", "applica");
            }
            for (const a of daAggiornare) a.tariffaCentesimi = tariffaCentesimi;
        }

        cliente.nome = nomePulito;
        cliente.tariffaCentesimi = tariffaCentesimi;
        scrivi(archivio);
        return cliente;
    }

    /** Accende o spegne un cliente. Un cliente spento non compare tra quelli selezionabili per nuove attività. */
    function impostaAttivo(id, attivo) {
        const archivio = carica();
        trovaCliente(archivio, id).attivo = Boolean(attivo);
        scrivi(archivio);
    }

    /** Elimina un cliente e tutte le sue attività. Restituisce quante attività sono state eliminate. */
    function eliminaCliente(id) {
        const archivio = carica();
        trovaCliente(archivio, id);
        const prima = archivio.attivita.length;
        archivio.clienti = archivio.clienti.filter((c) => c.id !== id);
        archivio.attivita = archivio.attivita.filter((a) => a.clienteId !== id);
        scrivi(archivio); // una sola scrittura: cliente e attività spariscono insieme
        return prima - archivio.attivita.length;
    }

    /**
     * Controlla i campi di un'attività e restituisce { cliente, data, minuti }.
     * `clienteGiaAssegnato` è l'id del cliente che l'attività ha già (in modifica):
     * quello resta accettato anche se nel frattempo è stato spento.
     */
    function validaCampiAttivita(archivio, { clienteId, data, ore, minuti }, clienteGiaAssegnato = null) {
        const cliente = archivio.clienti.find((c) => c.id === clienteId);
        if (!cliente) {
            throw new ErroreValidazione("Scegli un cliente.", "cliente");
        }
        if (cliente.attivo === false && cliente.id !== clienteGiaAssegnato) {
            throw new ErroreValidazione("Questo cliente è spento: riaccendilo nella pagina Clienti per registrare nuove ore.", "cliente");
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
        return { cliente, data, minuti: totaleMinuti };
    }

    function trovaAttivita(archivio, id) {
        const attivita = archivio.attivita.find((a) => a.id === id);
        if (!attivita) throw new Error("Questa attività non esiste più: forse è stata eliminata in un'altra scheda.");
        return attivita;
    }

    /** @param {{ clienteId: string, data: string, ore: string|number, minuti: string|number }} campi */
    function aggiungiAttivita(campi) {
        const archivio = carica();
        const { cliente, data, minuti } = validaCampiAttivita(archivio, campi);

        const attivita = {
            id: nuovoId(),
            clienteId: cliente.id,
            data,
            minuti,
            tariffaCentesimi: cliente.tariffaCentesimi,
            saldato: false,
            creatoIl: new Date().toISOString(),
        };
        archivio.attivita.push(attivita);
        scrivi(archivio);
        return attivita;
    }

    /**
     * Modifica un'attività: cliente, data, durata e paga oraria applicata.
     * Si può lasciare il cliente che ha già anche se è spento, ma non spostarla su un altro cliente spento.
     * @param {{ id: string, clienteId: string, data: string, ore: string|number, minuti: string|number, tariffa: string|number }} campi
     *        tariffa in euro
     */
    function modificaAttivita(campi) {
        const archivio = carica();
        const attivita = trovaAttivita(archivio, campi.id);
        const { cliente, data, minuti } = validaCampiAttivita(archivio, campi, attivita.clienteId);
        const tariffaCentesimi = validaTariffa(campi.tariffa);

        attivita.clienteId = cliente.id;
        attivita.data = data;
        attivita.minuti = minuti;
        attivita.tariffaCentesimi = tariffaCentesimi;
        scrivi(archivio);
        return attivita;
    }

    /** Segna un'attività come saldata (pagata) o da saldare. */
    function impostaSaldato(id, saldato) {
        const archivio = carica();
        trovaAttivita(archivio, id).saldato = Boolean(saldato);
        scrivi(archivio);
    }

    function eliminaAttivita(id) {
        const archivio = carica();
        trovaAttivita(archivio, id);
        archivio.attivita = archivio.attivita.filter((a) => a.id !== id);
        scrivi(archivio);
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
        modificaCliente,
        impostaAttivo,
        eliminaCliente,
        aggiungiAttivita,
        modificaAttivita,
        eliminaAttivita,
        impostaSaldato,
        euroInCentesimi,
        importo,
        oggi,
        allaModifica,
    });
})();
