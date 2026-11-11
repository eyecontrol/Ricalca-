# Ricalca

Web app per ricalcare: apri la fotocamera posteriore, carica un'immagine, sovrapponila alla realtà e regolane la trasparenza per disegnarla su carta.

**Apri l'app:** https://eyecontrol.github.io/Ricalca-/

## Funzioni
- Fotocamera posteriore a schermo intero (HTTPS richiesto)
- Immagine sovrapposta: sposta con un dito, ingrandisci e ruota con due dita (rotella del mouse sul computer)
- Cursore della trasparenza
- Blocco dell'immagine mentre disegni
- Mostra / nascondi, specchia, centra
- Filtri: Originale, Linee (contorni estratti automaticamente), Bianco e nero, Inverti
- Zoom della fotocamera (ottico dove supportato, altrimenti digitale), torcia, griglia
- Tocca lo schermo per nascondere i comandi
- Installabile come app (PWA) e funziona anche offline; lo schermo resta acceso

## Come si usa
1. Appoggia il telefono sopra il foglio (ad esempio su un bicchiere o un supporto).
2. Scegli un'immagine e posizionala con le dita.
3. Premi **Blocca**, regola la trasparenza e ricalca.

Le immagini restano sul dispositivo: nulla viene caricato online.

## Sviluppo
Sito statico senza dipendenze: `python3 -m http.server` e apri `http://localhost:8000`.
