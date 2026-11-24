const form = document.getElementById('new-client');
const inputCliente = document.getElementById('cliente');
const inputPaga = document.getElementById('paga');
const lista = document.getElementById('lista');
const CHIAVE = "clienti";

function leggiClienti(){
    try{
        return JSON.parse(localStorage.getItem(CHIAVE)) ?? [];
    } catch{
        return [];
    }
}

function salvaClienti(clienti){
    localStorage.setItem(CHIAVE, JSON.stringify(clienti));
}

function mostraClienti(){
    const clienti = leggiClienti();
    lista.innerHTML = "";

    clienti.forEach((el) => {
        const li = document.createElement("li");
        li.textContent = `${el.cliente}: ${el.paga}`;
        lista.appendChild(li);
    });
}

form.addEventListener("submit", function(event){
    event.preventDefault();

    const nuovoCliente = {
        cliente: inputCliente.value,
        paga: inputPaga.value
    };

    const clienti = leggiClienti();
    clienti.push(nuovoCliente);
    salvaClienti(clienti);

    form.reset();
    mostraClienti();
});

mostraClienti();