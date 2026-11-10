# Procedura di moderazione di app.disbigle.com

Gestore del servizio: Serafino Christian Varazze (persona fisica), contatto unico per utenti e
autorità: disbin@disbigle.com (italiano, inglese, spagnolo).

Riferimenti: Regolamento (UE) 2022/2065 sui servizi digitali (DSA), Regolamento (UE) 2021/784
sui contenuti terroristici online (TCO), D.Lgs. 70/2003, GDPR. Condizioni d'uso:
https://disbigle.com/it/termini — Regole: https://disbigle.com/it/regole.

## Da dove arrivano le segnalazioni

| Fonte | Dove la vedi | Note |
|---|---|---|
| Pulsante **Segnala** (web, iOS, Android) | Amministrazione → Segnalazioni | `source: user` |
| **Modulo pubblico** https://app.disbigle.com/report-content | Amministrazione → Segnalazioni ("Modulo pubblico") | anche senza account; chi segnala riceve conferma e esito se lascia l'email |
| **Altri server** (ActivityPub `Flag`, es. Mastodon) | Amministrazione → Segnalazioni ("altro server") | arrivano dall'attore del server remoto |
| Email a disbin@disbigle.com | casella email | inserire a mano l'esito nel registro (vedi sotto) |
| Ordini delle autorità (art. 9-10 DSA, TCO) | email/PEC/posta | **priorità massima**, vedi sotto |

Dal momento in cui ricevi una segnalazione circostanziata sei "a conoscenza": da lì decorre la
responsabilità se non agisci rapidamente.

## Tempi

- Contenuti terroristici con **ordine di rimozione** di un'autorità: **entro 1 ora** (TCO, art. 3).
- Abusi su minori, minacce concrete alla vita o alla sicurezza: **subito**, appena letti.
- Tutto il resto: **entro 24-48 ore** (è quanto dichiarato nelle condizioni d'uso e ad Apple).

## Come si decide

1. Apri la segnalazione, guarda i post allegati e il profilo.
2. Scegli il motivo: **contenuto illegale** oppure **contrario alle regole**.
3. Azioni possibili, dalla più leggera:
   - **Nessuna violazione**: "Segna come risolta" → *Nessuna violazione*, con una riga di spiegazione.
   - **Rimuovi il post**: pulsante sotto il post segnalato; scrivi la spiegazione. La segnalazione
     si chiude da sola come *Contenuto rimosso*.
   - **Sospendi l'account**: per violazioni gravi o ripetute; scegli il motivo e scrivi la spiegazione.
   - **Blocca il server** (Federazione → Server bloccati) se il problema è un intero server.
4. La piattaforma manda in automatico:
   - all'autore (se ha l'account qui) la **motivazione** via email: cosa, perché, motivo, come
     contestare (art. 17 DSA);
   - a chi ha segnalato (account locale o email del modulo) l'**esito** (art. 16.5 DSA).
5. Scrivi spiegazioni brevi e concrete: le legge la persona interessata e restano nel registro.
   Mai inserire dati personali di chi ha segnalato.

## Contestazioni (reclami)

Chi è stato moderato può rispondere all'email o scrivere a disbin@disbigle.com entro 6 mesi.
Rivedi la decisione (se possibile la rivede una persona diversa da chi l'ha presa), rispondi
motivando e, se sbagliata, annullala (ripristino della sospensione da Amministrazione → Account).

## Casi gravi

### Abusi sessuali su minori (CSAM)
1. **Non scaricare, non inoltrare, non fare screenshot** del materiale.
2. Annota solo l'indirizzo (URL), l'account, data e ora.
3. Sospendi subito l'account (motivo: contenuto illegale) e rimuovi i contenuti.
4. Segnala alla Polizia Postale: https://www.commissariatodips.it (sezione segnalazioni) indicando
   URL, account e orari. Se il contenuto arriva da un altro server, blocca il server se necessario
   e avvisa il suo amministratore.
5. Conserva i dati tecnici dell'account (non il materiale) finché le autorità non li chiedono:
   non cancellare l'account dal database finché non sei sicuro che non servano.

### Terrorismo
- Ordine di rimozione di un'autorità (TCO): rimuovi o disabilita **entro 1 ora**, poi rispondi
  all'autorità confermando. Conserva il contenuto rimosso e i dati collegati per **6 mesi**
  (art. 6 TCO), solo per eventuali procedimenti.
- Contenuto trovato senza ordine: rimuovi e valuta la segnalazione alle autorità.

### Minaccia alla vita o alla sicurezza (art. 18 DSA)
Se un contenuto fa sospettare un reato che minaccia la vita o la sicurezza di qualcuno
(es. annuncio di violenza, istigazione al suicidio rivolta a una persona): avvisa subito le forze
dell'ordine (112, oppure Polizia Postale online) con tutte le informazioni disponibili.

### Ordini e richieste di informazioni delle autorità (art. 9-10 DSA)
Verifica che l'ordine sia autentico (mittente istituzionale, riferimenti del procedimento),
eseguilo senza ritardo e rispondi all'autorità indicando cosa hai fatto e quando.
Per richieste di dati degli utenti: fornisci solo ciò che è richiesto e disponibile.

## Registro

- Ogni decisione presa dalla piattaforma finisce nel **registro di moderazione**
  (`admin_action_logs`: chi, cosa, quando, motivo) e nella segnalazione (decisione e spiegazione).
- Le segnalazioni ricevute per **email** vanno trattate allo stesso modo: rispondi con l'esito e
  annota decisione e data (in una cartella dedicata della posta).
- Conservazione: 2 anni, come indicato nell'informativa privacy.

## Dati che il server conserva

- Sessioni: indirizzo IP e browser finché la sessione è attiva (sicurezza).
- Segnalazioni e decisioni: 2 anni.
- Backup: 14 giorni.
