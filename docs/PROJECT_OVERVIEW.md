# LIFEFORGE — Descrizione completa del progetto

> Documento autosufficiente: chi lo legge (persona o intelligenza artificiale) deve poter capire cosa fa LifeForge,
> come funziona, perché è fatto così e dove si trova ogni cosa, senza aver mai aperto il codice.
> Stato descritto: settembre 2026, branch `claude/laughing-johnson-l8tucl`.

---

## Indice

1. [In una frase](#1-in-una-frase)
2. [Per chi è e su cosa gira](#2-per-chi-è-e-su-cosa-gira)
3. [Principi di prodotto (le regole che non si violano)](#3-principi-di-prodotto)
4. [Il ciclo di gioco](#4-il-ciclo-di-gioco)
5. [Risorse del giocatore](#5-risorse-del-giocatore)
6. [Quest: tipi, azioni, generazione, carico giornaliero](#6-quest)
7. [Punteggio del giorno, streak, HP, energia, penalità](#7-punteggio-streak-hp-energia)
8. [Livelli, ricompense ed economia](#8-livelli-ricompense-economia)
9. [Mondo Tycoon, negozio, cosmetici, premi reali](#9-mondo-tycoon)
10. [Achievement, classi, recap e review](#10-achievement-classi-review)
11. [Allenamento: piano, logger, progressione, cardio](#11-allenamento)
12. [Nutrizione: dashboard, Add Food, Scan Food con AI](#12-nutrizione)
13. [Daily Context: momento della giornata, sveglia, lavoro](#13-daily-context)
14. [Il Coach (chat) e l'agente AI Gemini](#14-coach-e-agente-ai)
15. [Router dei modelli Gemini e monitor di utilizzo](#15-router-gemini)
16. [Schermate e navigazione (mappa completa)](#16-schermate)
17. [Impostazioni e pannello Admin](#17-impostazioni-e-admin)
18. [Notifiche e promemoria](#18-notifiche)
19. [Voce e microfono](#19-voce)
20. [Primo giorno, onboarding, tutorial, utente che ritorna](#20-primo-giorno)
21. [Dati, persistenza, backup, reset](#21-dati-e-reset)
22. [Architettura tecnica](#22-architettura)
23. [Backend serverless e sicurezza](#23-backend-e-sicurezza)
24. [PWA, iPhone, responsive, accessibilità](#24-pwa-iphone)
25. [Qualità: test e QA](#25-qualità)
26. [Deploy e variabili d'ambiente](#26-deploy)
27. [Mappa dei file](#27-mappa-dei-file)
28. [Limiti noti e cose non verificate](#28-limiti)
29. [Glossario](#29-glossario)

---

## 1. In una frase

**LifeForge è un gioco di ruolo / gestionale ("life tycoon") in cui le azioni utili della vita reale diventano quest:**
bere acqua, allenarsi, mangiare, lavarsi i denti, leggere, stare sotto un budget di tempo sui social, ecc.
Completarle dà XP, monete e statistiche; con le monete si costruisce una casa virtuale stanza per stanza; un Coach
con intelligenza artificiale (Google Gemini) permette di configurare e registrare tutto parlando in linguaggio naturale.
Tutti i dati restano sul telefono.

## 2. Per chi è e su cosa gira

- **Utente**: una persona sola (uso personale), italiana, che usa l'app ogni giorno su **iPhone 15 Pro**
  (viewport 393 × 852). L'interfaccia è in **inglese**; il Coach capisce **italiano e inglese**.
- **Forma**: **Progressive Web App (PWA)** installabile sulla schermata Home di iPhone ("Aggiungi a Home"), funziona
  offline. Non è un'app nativa.
- **Hosting**: **Vercel** (frontend statico + 4 funzioni serverless per l'AI).
- **Dove vivono i dati**: **IndexedDB del browser** (tramite la libreria Dexie). Non c'è un database server, non c'è
  login, non ci sono account. L'unica cosa che esce dal telefono sono le richieste all'AI che l'utente fa esplicitamente.
- **Costi**: zero. L'AI usa solo modelli del **Free Tier di Gemini** (Google AI Studio); il sistema è progettato per non
  poter mai generare costi per sbaglio (vedi §15).

## 3. Principi di prodotto

Queste regole guidano ogni decisione e ogni riga di codice. Chi modifica il progetto deve rispettarle.

1. **La vita reale è il gioco.** Si premia solo ciò che fa bene.
2. **Gamification sana, mai tossica.** Nessuna vergogna, umiliazione, digiuno, pasti saltati, restrizione calorica
   estrema, esercizio punitivo, privazione di sonno, sfide pericolose. Le penalità sono **solo meccaniche di gioco**
   (HP, monete virtuali), con un tetto giornaliero e una "Recovery Mode" al posto del game over.
3. **Niente dati inventati.** Se un dato non c'è si scrive "No data yet". Niente percentuali di quota inventate, niente
   "13 giorni su 13 sotto budget" al primo giorno, niente "area più forte" quando tutto è a zero, niente successi
   assegnati nei giorni in cui l'app non è stata aperta.
4. **Nessuna precisione falsa.** Le stime AI del cibo si mostrano come intervalli ("~500–600 kcal"), non come "523 kcal".
5. **Nessuna supposizione sulla vita dell'utente.** Orari di lavoro, sveglia, giorni di allenamento possono essere
   "non impostato" o "non so ancora": l'app funziona lo stesso e chiede solo quando la risposta cambierebbe il piano.
6. **L'utente ha il controllo.** Nessuna modifica importante viene applicata senza anteprima e conferma. I suggerimenti
   adattivi sono carte SÌ/NO, mai applicati in silenzio. Quasi tutto ha **Undo**.
7. **Il database è la fonte di verità.** L'AI propone e interpreta; lo stato reale lo decide l'app. Se l'AI dice "hai
   completato il workout" ma il database dice di no, vale il database.
8. **Semplice nonostante la profondità.** Il primo giorno ha poche quest; la complessità cresce gradualmente.
9. **Privacy.** Niente GPS, niente tracciamento in background, niente analytics, dati solo sul dispositivo.
10. **Ogni azione deve sembrare progresso.** Feedback immediato (XP, monete, barre, animazioni brevi).

## 4. Il ciclo di gioco

```
vita reale ─► quest ─► XP · monete · statistiche ─► livello e sblocchi ─► costruisci il tuo mondo ─► nuove quest ─► review
    ▲                                                                                                              │
    └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Una giornata tipo:
1. Apertura al mattino → card "GOOD MORNING, <NOME>": "Ti sei appena svegliato?" (SÌ / NON ANCORA), energia, difficoltà
   del giorno, obiettivo principale, pulsante **START DAY**.
2. La Home mostra **RIGHT NOW** (cosa fare adesso, in ordine di priorità) e le quest del giorno.
3. Durante il giorno: tap per completare quest, registrare acqua/pasti/passi, avviare il timer del tempo di gioco,
   avviare un allenamento, premere **START WORK** quando si esce per andare al lavoro.
4. Durante il lavoro: **Work Mode** (schermata minimale, le quest sono "in attesa", non fallite).
5. **END WORK** → "WORK COMPLETE" → "YOUR EVENING" con ciò che conta ancora e il tempo rimasto prima di dormire.
6. Sera: recap giornaliero; a mezzanotte "di gioco" (**04:00**) la giornata si chiude: punteggio, streak, HP, reddito
   del mondo.
7. Con le monete si potenziano le stanze della casa; ogni lunedì c'è la review settimanale.

**Nota sul "giorno di gioco":** il giorno non finisce a mezzanotte ma alle **04:00** (configurabile, `dayStartHour`).
Un'attività fatta all'01:00 conta ancora per il giorno precedente. Tutte le date usano il fuso orario locale del
dispositivo (mai un fuso hardcoded).

## 5. Risorse del giocatore

| Risorsa | Cos'è | Da dove arriva |
| --- | --- | --- |
| **XP / Livello** | Progresso a lungo termine. I livelli sbloccano funzioni e danno bonus. | Quest, allenamenti, routine, achievement. |
| **Monete 🪙** | Valuta spendibile, solo virtuale (nessun denaro reale, mai). | Quest (≈30% dell'XP), level-up, traguardi di streak, reddito del mondo. |
| **HP ❤️ (0–100)** | Quanto ti stai prendendo cura di te *ultimamente*. | + quest core, giornate core perfette, riposo gestito bene; − quest core mancate (con tetto). |
| **Energia ⚡ (0–100+)** | La "batteria" di oggi. Le quest faticose costano energia; riposo e benessere mentale la ricaricano. | Parte dalle ore di sonno (85 se sconosciute). Il massimo cresce con il mondo. |
| **Statistiche** | Forza · Resistenza · Disciplina · Salute · Ordine · Cura · Costanza · Conoscenza. | Ogni attività dà punti statistica. Guidano il grafico radar e la classe. |
| **Oggetti** | Streak Freeze 🧊 · Streak Revive ❤️‍🔥 · Quest Reroll 🎲 · XP Booster 🚀 · Coin Magnet 🧲. | Bonus di livello, achievement, oppure acquistati con monete. |

## 6. Quest

### 6.1 Attività vs quest
- Un'**attività** è un modello (template) nella libreria: "Bere acqua, ogni giorno, core". Ce ne sono **123** precaricate,
  tutte modificabili in Admin.
- Una **quest** è l'istanza di un giorno specifico generata da un'attività ("Bere acqua — 28 settembre").
- Ricorrenze supportate: ogni giorno, giorni specifici della settimana, X volte a settimana, ogni N giorni, settimanale,
  mensile, "pool" (usate solo dal generatore di side quest). Esistono anche **quest una-tantum** ("solo venerdì"),
  che non diventano mai ricorrenti.

### 6.2 Tipi di quest

| Tipo | Scopo | Sblocco |
| --- | --- | --- |
| **Core** | I "non negoziabili" di una buona giornata (idratazione, pasti, denti, NoFap, budget tempo di gioco, passi, proteine, workout nei giorni di allenamento). Valgono il 45% del punteggio. | Giorno 1 |
| **Important** | Utili ma flessibili (cardio, pulizie, skincare, pianificazione…). | Giorno 1 |
| **Side** | Generate ogni giorno in base al tempo libero e all'energia. Possono solo aggiungere, mai rovinare la giornata. | Livello 2 |
| **Daily Challenge** | Una quest un po' più difficile e più ricompensata al giorno. | Livello 3 |
| **Hidden** | Quest segreta, rivelata solo quando la fai. | Livello 4 |
| **Weekly** | 3 obiettivi multi-giorno ("4 allenamenti questa settimana"). | Livello 5 |
| **Boss** | Un grande obiettivo settimanale con grande ricompensa. | Livello 8 |

**Rarità** (side/challenge): comune 68% · non comune 22% · rara 7% · epica 2,5% · leggendaria 0,5%. Più rara = più
ricompensa (×1,25 … ×3).

### 6.3 Azioni su una quest
Completa (con Undo), registra una metrica (si completa da sola al raggiungimento del target), avvia ora, rimanda
(**Later · After work · After dinner · Tomorrow · Weekend** — le opzioni compaiono solo se sensate), riprogramma,
salta (con motivo opzionale: stanco, niente tempo, malato, non serve), reroll (side quest), modifica, elimina.
Dopo 3 rinvii la card avvisa; oltre, un piccolo costo in monete a fine giornata (con tetto).

**Quest a metrica**: alcune quest seguono un valore registrato (acqua ml, passi, proteine g, minuti di gioco).
Modalità "almeno" (raggiungi il target) o "al massimo" (resta sotto un budget, es. tempo di gioco ≤ 90 min).

### 6.4 Generatore di side quest (senza AI)
Assegna un punteggio a ogni attività idonea: entra nel tempo libero prima del prossimo impegno? è adatta all'ora e al
giorno? l'energia basta? evita cose fatte negli ultimi 3 giorni, una sola quest per categoria, favorisce aree trascurate
o scelte come obiettivo. Attività scalabili si accorciano ("leggi 10 pagine" invece di 30). È **deterministico per
data**: riaprendo l'app la board non cambia.

### 6.5 Capacità giornaliera e bilanciamento del carico
Ogni mattina il gioco stima **quanti minuti di quest ci stanno davvero oggi**:
`tempo libero = sveglio − lavoro noto − impegni`, moltiplicato per la quota di tempo libero che l'utente usa
davvero per le quest (imparata, default 35%), corretto per energia, andamento recente, giorni "più/meno tempo" e
giorni di riposo; limiti 20–600 minuti. Se gli orari di lavoro non sono noti usa lo storico (default 120 min).

Poi **bilancia**:
1. Le **core restano sempre** (alleggerite solo se da sole superano la capacità del 20%, mai sotto 3, mai il workout,
   mai NoFap, mai quelle che l'utente ha "tenuto").
2. Le **important** riempiono lo spazio restante per priorità; quelle che non ci stanno diventano **"bonus di oggi"**
   (mai cancellate).
3. Le side quest prendono i minuti rimasti.

Indicatore di carico: **Low / Balanced / High** (+ "Overloaded"). Modalità scelte dall'utente: **Balance** (default),
**Keep all** (nessun taglio), **Push** (nessun taglio + più side quest). Su ogni quest alleggerita c'è "Keep this task".

### 6.6 Difficoltà adattiva
Ogni mattina lo stato è **too easy / balanced / overloaded / critical** (da completamento recente, carico, energia, HP).
"Too easy" aggiunge side quest e challenge più rare; "overloaded" ne lascia una breve; "critical" solo core.
Non alza mai automaticamente target reali (passi, calorie, pesi).

## 7. Punteggio, streak, HP, energia

### 7.1 Today Score (0–100)
Media pesata delle componenti che si applicano oggi (pesi modificabili in Admin):

| Componente | Peso | Calcolo |
| --- | --- | --- |
| Quest core | 45 | fatte / totali |
| Quest important | 12 | fatte / totali |
| Side quest | 6 | fatte / min(2, disponibili) — possono solo aiutare |
| Fisico | 12 | passi vs target, mescolato 50/50 col workout nei giorni di allenamento |
| Nutrizione | 7 | calorie entro ±10% del target + proteine (se il tracking è attivo) |
| Idratazione | 6 | acqua / target |
| Routine | 6 | passi delle routine fatti |
| Costanza | 6 | giornate riuscite negli ultimi 7 |

Le componenti non applicabili (es. fisico in un giorno di riposo) vengono **tolte e il loro peso ridistribuito**:
un giorno di riposo può fare 100. Achievement sbloccati oggi: +2 ciascuno (max +5).
Voti: **S** ≥ 95 · **A** ≥ 80 · **B** ≥ 65 · **C** ≥ 45 · **D** < 45.
Toccando la card del punteggio ("Why this score?") si vede il dettaglio di ogni componente.

### 7.2 Streak
- **Giornaliero**: un giorno conta se il punteggio supera la soglia della difficoltà (Casual 50 · Normal 60 ·
  **Hard 70 (default)** · Insane 80). Nei giorni di riposo bastano le poche core.
- **Settimanale**: 4 giorni riusciti a settimana (5 su Hard/Insane).
- **Streak Freeze** usato in automatico in un giorno fallito; **giorni di malattia** preservano lo streak gratis;
  **Streak Revive** ripristina uno streak rotto entro 3 giorni.
- Streak per singola attività (es. giorni NoFap di fila).
- Traguardi a 3 · 7 · 14 · 30 · 50 · 100 · 150 · 200 · 365 giorni (monete, HP, celebrazione). Ogni giorno di streak
  dà +1% XP (max +20%).
- Dopo una rottura l'app mostra "last run" e "best streak"; dopo 7+ giorni di assenza una card "WELCOME BACK" con
  livello, miglior streak, ultima serie e "a new run starts today".
- **I giorni in cui l'app non viene aperta toccano solo lo streak**: nessuna penalità HP/monete, e nessun successo
  inventato.

### 7.3 HP e Recovery Mode (mai una spirale negativa)
- +1 HP per quest core (max +10/giorno), +5 giornata core perfetta, +6 riposo gestito bene, +5 traguardo streak.
- A fine giornata: −3 per core mancata, −1 per important ignorata, −4 se la costanza a 7 giorni scende sotto il 40%.
  **Perdita massima 12 al giorno**, scalata per difficoltà (Casual ×0,4 … Insane ×1,4). Giorni di malattia: nessuna perdita.
- **HP 0 = knock-out, non game over.** Nulla viene cancellato. Sotto 25 HP si entra in **Recovery Mode**: perdite ×0,25,
  guadagni ×2, giornate solo essenziali, bonus comeback. Si esce a 60 HP.
- Monete: −5 per core mancata + costo rinvii, **massimo 25 al giorno**, mai sotto zero.
- "Sluggish": punteggio < 40 → XP ×0,9 il giorno dopo; una buona giornata lo toglie.

### 7.4 Energia
Energia iniziale = 20 + 10,5 × ore dormite (85 se sconosciuto), minimo 30, +10 nei giorni di riposo.
Costo per difficoltà 1–5: 3 · 5 · 10 · 20 · 30 (+1 ogni 10 minuti oltre i 20). Attività di riposo/sonno/benessere
mentale **ricaricano**. Energia bassa → suggerimenti più leggeri; sotto 20 la regola "Low battery" dice di fare solo le core.

## 8. Livelli, ricompense, economia

- **Curva livelli**: `xpToNext(L) = round(150 × L^1.35 / 10) × 10`. Livello 2 in 150 XP (arriva il primo giorno),
  livello 10 a ~12.600 XP totali, livello 30 a ~181.600. Massimo livello 200.
- **Bonus di livello**: `20 + 5 × livello` monete; ogni 3 livelli un Reroll, ogni 5 uno Streak Freeze, ogni 10 un Revive.
- **XP di una quest** (calcolata alla creazione): base per difficoltà (15 · 35 · 70 · 140 · 280) × fattore durata ×
  importanza × frequenza × sforzo × rarità × livello; minimo 5, arrotondata a 5. **Monete ≈ 30% dell'XP.**
  Esempio: "Lavarsi i denti" → 15 XP, 5 monete.
- **Moltiplicatori al completamento** (mostrati nel dettaglio quest): preset difficoltà, streak, bonus del mondo per
  categoria, XP Booster / Coin Magnet (+25% per 24h), effetti di stato.
- **Altre entrate**: prima quest del giorno +25 monete; traguardi streak `round(40 × √giorni)`; reddito del mondo
  `reddito × punteggio di ieri / 100` (zero sotto 30); achievement (bronzo 50 XP/20 monete … platino 1.000/400).
- **Uscite**: stanze (prezzi esponenziali), Freeze 250, Revive 600, Reroll 30, Booster 300, Magnet 350, decorazioni
  e cosmetici 30–3.000, premi reali (prezzo scelto dall'utente).
- **Idempotenza**: nessuna ricompensa può essere assegnata due volte (doppio tap, ripetere "ho fatto palestra",
  richieste AI ripetute). Ogni variazione di XP/monete/HP è registrata in un **ledger** (registro contabile);
  i test verificano che XP e monete del giocatore coincidano sempre con la somma del ledger.

Tutte le costanti stanno in `src/data/defaultRules.ts` e sono modificabili in Admin senza toccare codice.

## 9. Mondo Tycoon

- Si parte da una **Tiny Room** (camera da letto livello 1). **11 stanze**, ognuna legata a un'area della vita, 5 livelli
  ciascuna, prezzo `baseCost × growth^(livello−1)`:

| Stanza | Costo base | Crescita | Sblocco |
| --- | ---: | ---: | ---: |
| Bedroom | 100 | ×3 | L1 |
| Pet Corner | 120 | ×2,8 | L2 |
| Bathroom | 250 | ×2,8 | L3 |
| Kitchen | 400 | ×2,9 | L4 |
| Gym | 500 | ×3 | L5 |
| Garden | 650 | ×2,8 | L6 |
| Office | 800 | ×2,9 | L7 |
| Library | 1.000 | ×2,9 | L9 |
| Workshop | 1.400 | ×3 | L11 |
| Recreation Room | 1.800 | ×3 | L13 |
| Storage Vault | 2.200 | ×3 | L15 |

- Le stanze danno **bonus del mondo**: reddito giornaliero, energia massima, slot per side quest, +XP% nella categoria.
- Il "livello casa" (somma dei livelli delle stanze) sblocca titoli. Le stanze mostrano arredi visibili crescenti.
- Le prime monete vanno in un **micro-upgrade** (lampada per la camera) così il loop di costruzione si vede dal giorno 1.
- **Negozio**: oggetti (Freeze, Revive, Reroll, Booster, Magnet), **cosmetici** (pelle, capelli, colore, outfit, tinta,
  accessori, sfondo dell'avatar; temi colore) e **premi reali** definiti dall'utente (es. "serata cinema") con un prezzo in
  monete; quelli di esempio partono **non approvati** e non si possono riscattare finché l'utente non li approva.
  Le ricompense alimentari non sono mai presentate come "cheat day" o compenso per l'allenamento.

## 10. Achievement, classi, review

- **155 achievement** (16 nascosti) in categorie: primi passi, streak, fitness, record di forza, cardio, nutrizione,
  idratazione, casa, cura, conoscenza, costruzione del mondo, economia, NoFap, disciplina schermo. Sono **data-driven**
  (contatore + soglia): se ne aggiungono senza codice, anche dall'AI.
- **Classi emergenti** dagli ultimi 30 giorni: Athlete, Builder, Disciplined, Explorer, Guardian, Creator, Survivor,
  Balanced. Non si scelgono: descrivono come si gioca.
- **Recap giornaliero** (sera) e **review settimanale** (lunedì): punteggio, XP, monete, streak, aree più forti e deboli
  (solo se i dati le distinguono davvero), raccomandazioni solo dopo almeno 2 giornate complete, previsione di domani
  coerente con la rampa della prima settimana.

### 10.1 Progressione a lungo termine (tutto derivato da dati reali)
- **Maestria** in 10 tracce (Forza, Resistenza, Nutrizione, Idratazione, Cura di sé, Casa, Compagno, Mente, Recupero,
  Relazioni) che crescono con le quest completate. **Rendimenti decrescenti** per traccia e per giorno (1, 0,6, 0,35, 0,2,
  0,1…): conviene presentarsi più giorni che fare tutto in un pomeriggio. Livelli 0–20; a 5/10/15/20 si sblocca un
  **titolo** cosmetico equipaggiabile (Mastery screen, `/mastery`). Non cambia XP né monete.
- **Momentum**: quest completate a meno di 45 minuti l'una dall'altra formano una combo ("Combo ×2", "On fire ×3"),
  mostrata accanto a "Quests". Solo motivazionale: non toglie mai nulla, svanisce con una pausa.
- **Journey** (`/journey`): capitoli (The Awakening 1–7, Forging Habits 8–30, The Long Road 31–90, Seasons of Mastery
  91–180, The Legend Grows 181–365, poi "Year N") con giorni attivi, giorni riusciti, streak migliore, workout, punteggio
  medio; timeline di traguardi reali (livelli, streak 3/7/14/30…, primo workout e ogni 25, rientri dopo 3+ giorni di
  pausa, achievement, stanze costruite, record). Dopo un reset del gioco compare "New run started".
- **Percorsi di achievement** (stesso contatore con soglie crescenti, es. First Rep → Iron Veteran) e **vetrina** di 3
  achievement sbloccati sul Character.
- **Eventi del mondo**: la casa reagisce alla settimana reale (Lantern Festival con streak ≥ 7, palestra in fermento con 3
  workout, giardino in fiore con 5 giorni idratati, biblioteca, casa splendente, animale felice, mercato del weekend,
  "settimana tranquilla" solo dopo una settimana di storia), ognuno col suo "perché". **Collezioni** (tutte le stanze,
  tutte al massimo, badge di maestria, guardaroba, acconciature, decorazioni) che si completano solo con cose costruite o
  comprate con monete guadagnate: niente casualità, niente loot box.
- Il reset del gioco azzera maestria, titolo e vetrina (la cronologia resta).

## 11. Allenamento

- **Piano precaricato**: Lunedì Upper A · Mercoledì Lower + Core · Venerdì Upper B, 3 serie, recupero 60–120 s,
  pesi iniziali prudenti. Tutto modificabile (Plan editor).
- **37 esercizi** con illustrazioni SVG animate e **mappa muscolare** fronte/retro (muscoli primari e secondari con
  intensità HIGH/MEDIUM e legenda).
- **Workout logger**: per ogni esercizio serie × (peso · ripetizioni · fatto · RPE 😎 facile / 🙂 normale / 😰 duro /
  💀 quasi impossibile · nota). Timer, volume, "Finish" salva la sessione e l'XP. Sessione libera con stato vuoto guidato.
- **Progressione** (mai automatica: carta SÌ/NO alla sessione successiva):

| Situazione ultima sessione | Suggerimento |
| --- | --- |
| Tutte le serie fatte al top del range (o tutte ≥ metà range e molto facili), RPE medio ≤ 🙂 | **Aumenta** dell'incremento (2,5 kg; 1 kg per isolamento; +2 rip a corpo libero), massimo +15% |
| Target raggiunto ma è stato duro | **Mantieni** |
| Serie fatte ma ripetizioni sotto target | **Aggiungi ripetizioni** |
| 1 sessione fallita | **Mantieni** (un giorno storto non è un trend) |
| 2 sessioni fallite | Mantieni o torna all'ultimo peso completato bene |
| 3 sessioni fallite | **Deload −10%** |

  Esempio: chest press 20 kg, range 8–12, 10/10/10 tutte facili → "Prova 22,5 kg".
  Una sessione fallita è un dato, non una punizione.
- **Record**: peso massimo, ripetizioni, volume, 1RM stimato (Epley).
- **Cardio walk → run**: 9 stadi (camminata 30′/35′/40′ → intervalli I/II/III → corsa 20′/24′/28′), 3 sessioni a
  settimana; avanza se ≥ 80% sessioni fatte e fatica media bassa (max +20% di durata), torna indietro dopo due settimane
  sotto il 50%.
- Nei giorni di riposo la quest workout non viene creata (quindi nessun "workout mancato").

## 12. Nutrizione

Scheda principale nella barra in basso (**Nutrition**).

### 12.1 Dashboard
- Anello calorie: attuale / obiettivo / **%**; testo "X kcal left today" o "X kcal over target" (senza giudizi).
- Proteine, carboidrati, grassi: attuale / obiettivo / % / grammi rimanenti, barre colorate.
- Acqua: litri attuali / obiettivo / % / rimanenti.
- Tre azioni rapide: **Add Food · Scan Food · Add Water** (+250 ml, configurabile); link "Ask the Coach about today".
- **Pasti di oggi raggruppati per pasto** (Breakfast · Morning Snack · Lunch · Afternoon Snack · Dinner · Night Snack) con
  subtotale; tap su un pasto → **Edit meal** (nome, pasto, ora, calorie, macro, elimina). La modifica aggiorna i totali
  in place senza doppie ricompense.
- Grafici degli ultimi 7 giorni (calorie e proteine) con vista tabella.
- Obiettivi di partenza (modificabili, non consigli medici): 74 kg, 170 cm, 1.800 kcal, 150 g proteine, 55 g grassi,
  ~175 g carboidrati, 2,3 L acqua.

### 12.2 Add Food (inserimento manuale)
Un solo modulo, nessuna categoria:
1. **What did you eat?** (campo testo con microfono)
2. **Recent** (cibi recenti: un tap ricompila nome e valori) e **Quick fill** (16 preset tipo "Greek yogurt", "Pizza
   margherita": riempiono solo i campi)
3. **Meal**: 6 pasti, **preselezionato dall'ora del telefono** (04:00–10:30 Breakfast · 10:30–12:00 Morning Snack ·
   12:00–15:00 Lunch · 15:00–18:30 Afternoon Snack · 18:30–22:30 Dinner · 22:30–04:00 Night Snack; finestre modificabili
   in `src/config/meals.ts`), sempre cambiabile
4. **Time** (default: adesso)
5. **Calories · Protein · Carbs · Fat** (campi numerici che accettano la virgola italiana: "1,5")
6. **ADD FOOD · N kcal**

### 12.3 Scan Food (foto → AI)
Flusso: **TAKE PHOTO / CHOOSE PHOTO** → la foto viene compressa sul telefono (≤ 1280 px, ≤ ~0,9 MB JPEG) → inviata alla
funzione serverless `/api/food` → Gemini (modello con input immagine + output strutturato) → **stima strutturata**:
alimenti, quantità approssimate, metodo di cottura, calorie/macro per alimento, confidenza per alimento e complessiva,
cosa è stato usato per giudicare la porzione, assunzioni, cose non visibili (olio, salse), fino a 3 domande con risposte rapide.

Schermata **Review meal**:
- badge **AI ESTIMATE** e **confidenza** (high / medium / low);
- totali come **intervalli** ("~390–580 kcal", "~40–60 g" di proteine), più larghi quando la confidenza è bassa; il valore
  centrale è quello che viene registrato;
- se la confidenza è bassa, un avviso chiede più dettagli;
- domande rapide ("Did you use oil?" → None / 1 tsp / 1 tbsp);
- elenco alimenti con porzione a intervallo ("~120–180 g · grilled · medium");
- **mini-chat di correzione** "Tell the AI what to change…": "non è pollo, è tacchino", "il riso era 250 g", "ho aggiunto
  un cucchiaio d'olio", "ho mangiato solo metà" → l'AI **aggiorna** la stima precedente (non ricomincia da zero) e risponde
  con una frase ("Swapped chicken for turkey (−38 kcal)"); un riquadro UPDATED mostra prima → dopo;
- "Why so many calories?" (spiegazione breve);
- scelta **pasto e ora**;
- **EDIT** (modifica ogni valore a mano), **Use my own values instead** (modulo manuale precompilato con la stima),
  **ADD TO TODAY**, **CANCEL**.

Casi di errore: se non è cibo → "This doesn't look like food" (nessuna invenzione); se Gemini non risponde → messaggio
comprensibile + **Try again / Add manually**, la foto non si perde; se il limite di quota è raggiunto → "GEMINI LIMIT
REACHED" + link all'utilizzo ufficiale.
**Privacy**: la foto non viene salvata sul server; sul telefono viene salvata una miniatura solo se "Save Food Photos" è
ON (default **OFF**).

## 13. Daily Context

Il motore che sa **in che momento della giornata sei**, solo da tap espliciti (niente GPS, niente tracciamento).

- **Stati**: SLEEP, WAKE_UP, MORNING, AFTERNOON, WEEKEND, WORK, POST_WORK, TRAINING, EVENING, WIND_DOWN. Calcolati al volo
  (non salvati) da: ora, sveglia registrata, sessione di lavoro aperta, allenamento in corso, orario di letto.
  Una "chip" sotto il titolo della Home mostra lo stato e il tempo rimasto prima di dormire ("🏠 Post-work · 6h 20m left").
- **Sveglia**: alla prima apertura del mattino "Did you just wake up?" SÌ/NON ANCORA; se l'orario tipico è stato imparato,
  chiede di confermarlo; si può inserire a mano.
- **Lavoro**: **START WORK** = esco di casa (il tragitto conta), **END WORK** = sono tornato. Il timer sopravvive alla
  chiusura dell'app; una sessione appartiene al giorno in cui è iniziata; tetto di sicurezza 16 h se ci si dimentica.
  Sessioni modificabili in Settings → Daily Routine; statistiche di lavoro come contesto, non come gara.
- **Priorità**: ogni quest riceve **CRITICAL / IMPORTANT / NORMAL / OPTIONAL** da streak a rischio, orario previsto,
  pressione della scadenza (minuti rimasti vs durata), energia, affinità con l'ora. Con energia < 30% le quest pesanti
  propongono una versione ridotta (sessione 20 min / camminata di recupero).
- **RIGHT NOW (Focus card)**: le poche cose che ci stanno nel tempo rimasto, in ordine, con "Do it"/"Start workout".
- **Apprendimento**: dopo almeno 3 osservazioni impara sveglia feriale/weekend, giorni lavorativi, orari di pasti e
  allenamento; propone modifiche con carte SÌ/NO, mai in silenzio. "Adaptive schedule" attivo di default,
  "Reset learned schedule" dimentica solo i pattern.
- **Promemoria silenziati** durante lavoro, allenamento e tempo di gioco.
- **Card di apertura** adattiva: mattina/pomeriggio/sera, "You've started late today" se si apre tardi, "Welcome back".

## 14. Coach e agente AI

### 14.0 Comandi sul dispositivo e memoria
Risposte immediate dai dati reali, senza richieste AI (anche con Gemini attivo): **"What should I do right now?" /
"cosa faccio adesso?"**, **"How much time do I actually have today?"**, **"Plan my evening"** (dalle 18:00, lasciando 30
minuti per rilassarsi), **"Prepare tomorrow"**, **"Show me what I have postponed"**, **"Help me recover from a bad day"**
(le due cose più piccole, rassicurazione sullo streak, pulsante "Make today lighter").
**Memoria del Coach**: "Remember that…" / "Ricorda che…", "Forget…", "What do you remember?". Note solo sul dispositivo
(max 30 × 200 caratteri), visibili e modificabili in **Settings → Coach memory**, incluse nei backup, inviate a Gemini solo
dentro una chat avviata dall'utente come dati (`playerNotes`), mai come istruzioni. Il Coach non salva nulla da solo. Le
quest private sono mascherate in tutto ciò che va a Gemini.

### 14.1 Cos'è
Una chat a schermo intero (`/coach`), raggiungibile anche dal pulsante **🎙️ Ask LifeForge** in alto nella Home.
Accetta **linguaggio naturale** in italiano e inglese. Ha due "cervelli":
1. **Coach di base (sul dispositivo, senza AI)**: parser deterministico (IT/EN) per configurazioni comuni: orari di lavoro
   ("da lunedì lavoro 9–18", anche parziali: "probabilmente dalle 9"), giorni singoli, niente palestra questa settimana,
   più/meno tempo libero, obiettivi, sveglia/letto, peso, passi, target nutrizionali e d'acqua, attività una-tantum o
   ricorrenti, **registrazione acqua** ("ho bevuto 500 ml"), completamento quest ("ho fatto la palestra"), reset (sempre con
   domanda di chiarimento). Funziona offline e quando Gemini non è disponibile.
2. **Agente Gemini**: per tutto il resto (domande, stime di cibo, pianificazione, sfide, analisi). Usa **strumenti** (tool
   calling) per leggere e modificare davvero i dati.

Alcuni comandi semplici e certi vengono sempre gestiti sul dispositivo anche con Gemini connesso (risparmio di quota), con
la nota "⚡ Handled on-device — no AI request used".
**Negazioni, domande, futuro e condizionali non completano mai nulla**: "non ho fatto palestra", "domani farò palestra",
"ho fatto palestra?", "se ho tempo…" vanno all'AI e non registrano niente (c'è un test di regressione dopo che un bug
completava il workout su "non ho fatto il workout").

### 14.2 Strumenti dell'agente (~70)
Definiti una volta sola in `src/ai/shared/tools.ts` (condivisi da server e app), con schema di validazione zod:
- **Lettura** (automatici, nessuna modifica): profilo, oggi, quest, attività, obiettivi, piano allenamento, esercizi,
  storico allenamenti, nutrizione oggi/storico, passi, calendario, routine, streak, achievement e contatori, mondo tycoon,
  energia, statistiche, orari, punteggio, riepilogo settimanale, regole di gioco, **daily context**, storico modifiche.
- **Scrittura**: quest una-tantum, quest, challenge, modifica/elimina/sposta quest, completa/salta quest, attività
  ricorrenti (crea/modifica/elimina), routine, obiettivi, achievement, target nutrizionali/peso/passi/acqua, modifiche
  all'allenamento (esercizi, serie, pesi), orari di lavoro (settimanali, giorno singolo, "non so"), eccezioni di
  disponibilità, modalità di carico, ritmo giornaliero, regole di gioco, costi degli edifici, **logFood**, **logWater**.
- **Distruttivi**: resetToday, resetWeek, resetWorkoutHistory, resetNutritionHistory, resetGameProgress, resetAllData.

### 14.3 Livelli di conferma
| Permesso | Comportamento |
| --- | --- |
| read | eseguito subito |
| low (completa/salta quest) | applicato subito con pulsante **Undo** |
| write | **card di anteprima** "PREVIEW" con righe prima → dopo, avvisi, **APPLY / Cancel**; poi **Undo** |
| destructive | conferma forte; il reset totale richiede di scrivere `RESET EVERYTHING` |

Ogni argomento dell'AI viene **validato** (tipo, intervallo, data non nel passato, ID esistente) prima di preparare
l'anteprima; nulla viene scritto finché l'utente non conferma. Più modifiche insieme → "APPLY ALL".
**Undo**: le modifiche vengono registrate in un change log; l'annullamento ripristina lo snapshot dei record toccati,
oppure (per completamenti, cibo e acqua) passa per i servizi normali, così totali, quest e ricompense restano coerenti.
**Idempotenza**: ogni chiamata di tool ha una chiave (richiesta + indice): un retry o un doppio tap non la eseguono due volte.

### 14.4 Contesto e comportamento
A ogni messaggio l'app invia a Gemini: gli ultimi scambi della conversazione e un **contesto compatto del gioco** (data,
profilo, board di oggi, carico, energia, obiettivi, daily context con "unknown" per ciò che non è registrato).
Il prompt di sistema impone: usare solo strumenti per leggere/modificare, non indovinare ID, dire che qualcosa è fatto
**solo se il risultato del tool ha success: true**, non inventare fatti (chiedere invece), distinguere una-tantum da
ricorrente, non pianificare oltre i minuti disponibili, dare le stime di cibo come intervalli, sicurezza alimentare/fisica,
risposte concise nella lingua dell'utente. Personalità: Gentle, Balanced, **Direct (default)**, Hard.
Dopo ogni azione la UI si aggiorna subito (Home, calendario, nutrizione) senza ricaricare.

### 14.5 Errori
Messaggi comprensibili, mai stack trace: offline ("Could not reach the AI service"), chiave non valida, limite raggiunto
(card **GEMINI LIMIT REACHED** con "Basic coach" e "View usage"), nessun modello disponibile (card con "Try again" /
"Basic coach"), risposta malformata o vuota ("Gemini returned an empty answer…"), richiesta rifiutata da Google (mostra la
ragione di Google, con eventuali chiavi oscurate). Si può sempre passare al coach di base.

## 15. Router Gemini

Il server sceglie **quale modello Gemini** usare per ogni richiesta, senza mai generare costi.

- **Scoperta**: all'avvio (cache 10 min) chiede a Google l'elenco dei modelli disponibili per la chiave; esclude modelli
  deprecati, senza `generateContent`, o speciali (generazione immagini, TTS, embedding, live audio).
- **Registro capacità**: per ogni modello sa se supporta testo, input immagine/audio/video, function calling, output
  strutturato, istruzioni di sistema.
- **Tipi di richiesta** e requisiti: TEXT_CHAT, SIMPLE_COMMAND, TOOL_EXECUTION, PLANNING, DATA_ANALYSIS, IMAGE_ANALYSIS,
  FOOD_IMAGE (testo+immagine+output strutturato+system), FOOD_REVISE, FOOD_EXPLAIN, VOICE, STATUS. Il testo del Coach viene
  classificato (IT/EN) per scegliere il tipo. **Non si usa il modello più potente se non serve** (preferenze per tipo:
  flash/lite prima, pro solo per pianificazione complessa, e solo se Free Tier).
- **FREE TIER ONLY (default ON)**: usa solo modelli documentati come gratuiti (Gemini 2.5 Flash / Flash-Lite, Flash latest,
  Gemini 3 Flash preview, 3.1 Flash-Lite preview, Gemma 3…); lista estendibile con `GEMINI_FREE_MODELS`. Un modello a
  pagamento può essere usato solo se l'utente disattiva FREE TIER ONLY **e** sul server c'è `GEMINI_ALLOW_PAID=true`.
  Se Google risponde che un modello ha quota 0 sul progetto, viene segnato come non-free per 24 h.
- **Disponibilità**: cooldown per modello dopo un 429 (usa il `retryDelay` di Google; limite giornaliero → fino alla
  mezzanotte del Pacifico), limiti RPM/TPM/RPD imparati dagli errori di Google o inseriti dall'utente. "Sconosciuto" non
  significa "illimitato".
- **Esecuzione e fallback**: catena ordinata di modelli **compatibili** (mai un fallback verso un modello privo della
  capacità richiesta, es. immagini o tool). Errori transitori (5xx, timeout, rete): al massimo 2 retry con backoff
  (400/800 ms) sullo stesso modello; rate limit/quota: passa al modello successivo; chiave non valida o richiesta malformata:
  stop immediato. Timeout 20 s per tentativo, 26 s totali (la funzione Vercel ha 30 s). **Nessun retry infinito.**
  Se tutti falliscono → errore chiaro all'utente.
- **Robustezza output strutturato**: allo schema del cibo vengono tolti i vincoli di lunghezza/range che il decoder di
  Google può rifiutare; se Google rifiuta comunque, un secondo tentativo sullo stesso modello mette lo schema nel prompt;
  la risposta viene normalizzata e validata con zod. Budget di output ampio perché i modelli "thinking" non tronchino il JSON.
- **Monitor di utilizzo** (Settings → AI): richieste, token stimati, errori, 429, fallback, per modello e per periodo
  (minuto / oggi fino a mezzanotte PT / 7 / 30 giorni). Etichette oneste: **APP ESTIMATE** (conteggio dell'app) vs
  **GOOGLE AUTHORITATIVE** (solo limiti riportati da Google negli errori). Se la quota residua non è nota l'app lo dice,
  non inventa percentuali. Indicatore nell'header del Coach: 🟢 AI Ready · 🟡 Usage high · 🟠 Approaching limit ·
  🔴 Limit reached. Link al pannello ufficiale di Google AI Studio.
- La connessione AI viene controllata **solo quando serve** (Coach, Scan, Impostazioni), non all'avvio dell'app.

## 16. Schermate

**Barra in basso**: Home · Quests · Train · Nutrition · World. Il Coach si apre dall'header (🎙️) o dai link interni.
L'header di gioco (HUD) mostra avatar, livello, barra XP, HP, energia, streak, monete, pulsante Ask LifeForge e statistiche.

| Route | Schermata | Contenuto |
| --- | --- | --- |
| `/` | **Home (Today)** | Data, titolo (Day N nella prima settimana), chip del contesto, riga "N core quests remaining", card di apertura (sveglia, START DAY), Work Mode, card Working today?, suggerimenti SÌ/NO, **Score card** (con "Why this score?"), **RIGHT NOW**, quest per sezioni comprimibili (core, routine, important, optional) con vista List/Timeline, card Play time, riepilogo nutrizione e statistiche. |
| `/quests` | Quests | Today / Weekly / Library; daily challenge, hidden, side (+ Custom), scheduled; crea quest personalizzata. |
| `/quests/routines` | Routines | Morning, Night, Recovery, Workout routine: passi, bonus, "Start routine now". |
| `/train` | Train | Prossimo workout con mappa muscolare, esercizi, "Start it today anyway", settimana, programma cardio, sessioni recenti. |
| `/train/workout` | Workout logger | Registrazione serie/rip/peso/RPE, timer, Finish. |
| `/train/exercises`, `/train/exercise/:id` | Libreria esercizi / dettaglio | Illustrazioni animate, filtri, how-to, muscoli, i tuoi numeri, regole di progressione. |
| `/train/plan` | Plan editor | Giorni, esercizi, serie, range, recupero, riordino. |
| `/train/cardio` | Cardio | Stadio attuale, registra sessione (durata, distanza, fatica), 9 stadi. |
| `/nutrition` | Nutrition | Vedi §12. |
| `/nutrition/scan` | Scan food | Vedi §12.3. |
| `/coach` | Coach | Vedi §14. |
| `/world` | World | Casa illustrata stanza per stanza, bonus del mondo, elenco stanze con prezzi. |
| `/world/shop` | Shop | Items / Cosmetics / Rewards. |
| `/world/avatar` | Avatar | Anteprima e parti: Skin, Hair, Colour, Outfit, Tint, Extra, Backdrop. |
| `/stats` + `/stats/calendar`, `/stats/advanced`, `/stats/records` | Statistiche | Settimana (media punteggio, XP, streak, passi), insight del coach, grafici 14 giorni, calendario mese/settimana/giorno con dettaglio del giorno, statistiche avanzate 14/30/90 giorni, record personali. |
| `/review/day`, `/review/week` | Recap / Review | Riepilogo di oggi e di domani; review settimanale. |
| `/profile`, `/achievements` | Personaggio / Achievement | Classe, radar statistiche, inventario; achievement per categoria con progresso. |
| `/play` | Play time | Timer (Games, TikTok, YouTube, Social, Other), minuti manuali, ultimi 14 giorni. |
| `/search` | Ricerca | Attività, esercizi, achievement, stanze. |
| `/settings`, `/settings/:section` | Impostazioni | Vedi §17. |
| `/admin/...` | Admin | Vedi §17. |
| `/dev` | Strumenti nascosti | Utilità di sviluppo (viaggio nel tempo per test, ecc.). |

Ogni schermata ha stati di caricamento (skeleton), vuoto (spiegazione + azione), errore (messaggio + riprova).

## 17. Impostazioni e Admin

**Settings**: Profile (nome, altezza, peso, obiettivi, obiettivi futuri, animale domestico "Sky") · Appearance (tema
System/Light/Dark, accento, riduzione animazioni, vibrazione) · Game (difficoltà Casual/Normal/Hard/Insane, tono del coach,
ora di inizio giornata) · **Daily Routine** (sveglia/letto pianificati, sveglia di oggi, orari tipici imparati, lavoro,
sessioni recenti modificabili, abitudini imparate, Adaptive schedule, reset pattern) · **Schedule** (orari di lavoro per
giorno con pause, parziali, versioni future "da lunedì", giorni singoli, impegni ricorrenti, modalità carico) ·
Configure with the Coach · **Targets** (nutrizione, corpo, passi min/ideale/stretch, acqua, budget tempo di gioco,
tracciamenti) · **Safety bounds** (limiti di ogni cambiamento adattivo) · Notifications · **Data** (esporta/importa JSON,
**Reset**: oggi, settimana, allenamenti, nutrizione, progressi di gioco, cancella tutto — ciascuno mostra cosa cancella e
cosa tiene; progressi di gioco e cancella tutto richiedono una frase scritta) · **AI** (stato Gemini, test connessione,
AI SYSTEM, funzioni AI, Save Food Photos, Cost Control / FREE TIER ONLY, personalità, voce, utilizzo, modelli,
impostazioni avanzate) · Help (rivedi il tour) · Admin.

**Admin** ("il gioco è dati"): Activities (CRUD delle 123 attività: nome, icona, descrizione, categoria, tipo
core/important/optional, difficoltà, importanza, ricorrenza, orario, disponibilità, durata/quantità/unità, auto-tracking
da metrica, ricompense opzionali, statistiche) · **Create with AI** (copia un prompt per ChatGPT/Claude/qualsiasi AI →
incolla il JSON → validazione di schema → anteprima → importa; nessuna API usata) · Routines · Workout plan ·
Progression rules · **Game rules** (formula del punteggio, XP, monete, curva livelli, energia, HP, penalità, generatore,
difficoltà adattiva, streak, preset) e **smart rules** (regole SE → ALLORA, es. "Momentum bonus", "Deload guard") ·
**Tycoon economy** (costi, crescita, livello di sblocco per stanza) · Real rewards · Safety bounds · Targets.

## 18. Notifiche

Promemoria locali (workout, idratazione, quest, rinvii scaduti, recap giornaliero, level up, avviso streak, daily
challenge, budget tempo di gioco), con un **governatore di frequenza** (massimo al giorno, distanza minima, fascia di
silenzio) e silenziamento durante lavoro/allenamento/gioco **e durante il sonno** (dalle 04:00 alla sveglia e dall'ora di
letto a fine giornata); le quest già completate non generano promemoria. Orari appresi ("Learn my times") solo se l'utente lo attiva.
NoFap usa testi neutri ("Evening check-in"). Su iPhone le notifiche di sistema richiedono l'app installata sulla Home;
**le push con app chiusa richiederebbero un backend push (non configurato)**: oggi i promemoria funzionano mentre l'app è
aperta.

## 19. Voce

- Microfono dentro i campi di testo e nel Coach: **tap → ascolto → trascrizione aggiunta al testo già scritto →
  modificabile → invio**. Si avvia solo da un tap, un solo microfono alla volta, si ferma da solo (niente audio in 6 s,
  massimo 20 s, silenza dopo una pausa).
- Nell'**app installata sulla Home di iPhone** il riconoscimento vocale del browser può bloccare la pagina, quindi lì
  l'app non lo usa: toccando il microfono il cursore va nel campo e si usa il tasto **🎙️ della tastiera iOS** (dettatura
  nativa). Nessun microfono finto.
- Tastiera: il campo non perde mai il focus mentre si scrive; nel Coach il tasto Invio va a capo su iPhone e la tastiera
  resta aperta dopo l'invio.

## 20. Primo giorno

- **Onboarding** in 8 passi brevi (nome, altezza, peso, obiettivi principali, disponibilità per l'allenamento, abitudini,
  orari di lavoro con "Non lo so ancora / Lo aggiungo dopo"); tutto tranne il nome si può saltare.
- **Rampa della prima settimana**: giorno 1 = prima quest ("Bevi un bicchiere d'acqua") + massimo 4 core, niente important,
  niente challenge, ≤ 2 side; giorni 2–3 = 6 core, 2 important; giorni 4–7 = 8 core, 4 important; dalla seconda settimana
  board completa. Sopra si applicano gli sblocchi per livello.
- **Tutorial** interattivo a riflettore sulle schermate reali (rivedibile da Settings → Help) e spiegazioni ⓘ su Energia,
  HP, punteggio, ecc.
- **Utente che ritorna**: dopo 1–6 giorni una nota "Welcome back"; dopo 7+ la card con livello, miglior streak, ultima serie.
  Nulla viene segnato come fallito per i giorni di assenza.

## 21. Dati e reset

- **IndexedDB** (Dexie), database `lifeforge`, schema versione **4**. Tabelle principali: `settings`, `player`,
  `activities`, `quests`, `routines`, `plans` (piani allenamento), `exercises`, `exerciseStates` (pesi di lavoro), `sessions`
  (allenamenti), `metrics` (acqua, passi, sonno, peso, calorie/macro, minuti di gioco…), `meals` (con `mealType`,
  eventuale miniatura, stima AI), `dayLogs` (un record per giorno: punteggio, totali, esito), `dayPlans` (override del
  giorno), `dayContexts` (sveglia, sessioni di lavoro, prima apertura), `achievements`, `counters`, `records`, `buildings`,
  `cosmetics`, `rewards`, `redemptions`, `suggestions` (carte SÌ/NO), `notifications`, `ledger`, `aiUsage` (una riga per
  richiesta AI, senza contenuti), `aiChanges` (change log del Coach per Undo), `meta` (chiave/valore: timer, chat, visite…).
- **Migrazioni**: versioni Dexie + `settings.schemaVersion`; le impostazioni mancanti vengono riempite dai default.
- **Seed**: al primo avvio crea impostazioni, giocatore e contenuti (123 attività, 155 achievement, 37 esercizi, 79
  cosmetici, 11 stanze, 16 cibi rapidi, 9 stadi cardio, routine, 8 smart rules). Aggiornamenti di contenuto aggiungono solo
  ID mancanti, non sovrascrivono mai le modifiche dell'utente.
- **Backup**: esporta tutto in un file JSON; importa con validazione e anteprima dei conteggi (sostituisce i dati attuali).
  Test: export → import → stesso stato.
- **Reset** (Settings → Data o Coach): oggi, settimana, storico allenamenti, storico nutrizione, progressi di gioco
  (livello/XP/monete/streak/achievement/tycoon; tiene lo storico), cancella tutto (l'app riparte dall'onboarding come una
  nuova installazione, anche le preferenze locali). Ogni reset ricalcola i totali in modo coerente.

## 22. Architettura

**Stack**: React 19 + TypeScript (strict), Vite, Tailwind CSS 4, Zustand (stato UI), Dexie (IndexedDB), React Router 7,
Motion (animazioni), Recharts (grafici), date-fns, zod (validazione), vite-plugin-pwa/Workbox (service worker),
`@google/genai` (SDK Gemini, solo lato server). Test: Vitest, fake-indexeddb, Testing Library, jsdom; QA con Playwright.

**Livelli** (dal più puro al più concreto):

```
src/domain/        logica di gioco pura (nessun I/O): punteggio, streak, HP, energia, livelli, ricompense, generatore di quest,
                   capacità e carico, ricorrenze, progressione allenamento, cardio, target adattivi, daily context,
                   parser del Coach (nlu, ruleIntents, coachAssistant), router AI lato client…
src/repositories/  unico punto di accesso a IndexedDB (Dexie)
src/services/      casi d'uso: dayService (costruzione/chiusura del giorno), questService, metricsService (metriche e pasti),
                   workoutService, tycoonService, contextService, resetService, exportService, notifiche,
                   services/ai/* (client Gemini, orchestratore del Coach, tool registry, change log, monitor utilizzo)
src/store/         Zustand: gameStore (stato del gioco, act() che applica un risultato e mostra feedback), aiStore
src/features/      schermate React, una cartella per area
src/components/    design system (primitive, form, bottom sheet, dialog, grafici, icone, HUD, FX delle ricompense)
src/ai/shared/     codice condiviso app ↔ server: catalogo tool, schemi cibo, tipi del router, classificatore
src/config/        costanti (es. finestre dei pasti)
src/data/          contenuti e regole di default
server/ai/         logica delle funzioni serverless (handler, router modelli, registro, esecuzione, prompt, errori)
api/               4 funzioni Vercel sottili che chiamano server/ai
```

**Principi tecnici**:
- Tutta la logica di gioco è in funzioni pure testabili; i servizi le applicano dentro transazioni (`GameTx`) che
  aggiornano giocatore, log del giorno, ledger ed eventi in modo atomico.
- Ogni azione restituisce eventi (XP, monete, level up, achievement, record) che `gameStore.act()` trasforma in feedback
  visivo (FxLayer: popup, animazioni brevi, overlay per level up/achievement, rispetto di prefers-reduced-motion).
- L'AI non tocca mai il database direttamente: ogni tool produce un **Plan** (titolo, righe prima → dopo, avvisi, tipo di
  undo, funzione `apply`) che passa dai servizi normali.
- Orologio centralizzato (`services/clock`) con offset per test e "viaggio nel tempo" di sviluppo.

## 23. Backend e sicurezza

- **Funzioni serverless** (`api/`, Node ESM, import relativi con estensione `.js` — verificato da un test):
  `POST /api/ai` (un passo della conversazione del Coach; il loop dei tool gira nell'app), `POST /api/food` (analyze /
  revise / explain), `GET /api/status` (stato; con `?test=1` fa una richiesta minima), `GET /api/models` (modelli scoperti,
  capacità, stato Free Tier, salute).
- **La chiave `GEMINI_API_KEY` esiste solo come variabile d'ambiente su Vercel.** Mai nel client, nel bundle, in
  localStorage/IndexedDB o in git (all'avvio l'app cancella eventuali vecchie copie locali).
- Validazione di ogni input (dimensione massima del corpo della richiesta, schemi zod), validazione dell'output AI,
  validazione degli argomenti dei tool contro i dati reali, conferme per operazioni distruttive, nessuna esecuzione di codice
  arbitrario. Log del server solo con metadati (modello, tipo, stato, latenza, token), mai contenuti, immagini o chiavi.
  Cache per `requestId` così un retry del client non costa due volte.
- Header di sicurezza su Vercel (`nosniff`, `Referrer-Policy`, `Permissions-Policy: camera=(self), microphone=(self),
  geolocation=()` — la geolocalizzazione è bloccata per scelta).

## 24. PWA, iPhone

- Manifest, service worker con precache (funziona offline; "New version available — tap to update"), icone **sfondo
  bianco con simbolo grigio** (incudine con barre di crescita e stella) in favicon, 192, 512, maskable, Apple touch icon.
- iPhone 15 Pro: safe area (Dynamic Island in alto, indicatore Home in basso), bottom sheet che seguono la tastiera, Coach
  dimensionato sull'area visibile quando la tastiera è aperta, barra in basso nascosta con tastiera aperta.
- Responsive verificato automaticamente a 375 / 390 / 393 / 430 px (anche 768 / 1440 e landscape), temi chiaro e scuro:
  zero overflow orizzontale, controlli non tagliati, **touch target ≥ 44 px**.
- Offline: quest, tracciamenti, allenamenti, acqua, nutrizione manuale, tycoon funzionano; l'AI mostra chiaramente che non
  è disponibile.
- Accessibilità: etichette ARIA, ruoli (dialog, radiogroup, tablist), focus gestito nei pannelli, contrasto, animazioni
  ridotte (impostazione di sistema o forzata).

## 25. Qualità

- `npm run check` = typecheck + lint + test + build di produzione. Stato attuale: **tutto verde, 326 test**.
- Test di: logica di dominio (punteggio, streak, HP, energia, ricorrenze, capacità, progressione, target, daily context,
  parser IT/EN inclusi negazioni e futuro), servizi su IndexedDB (loop di gioco, rollover dei giorni, **simulazioni di 7, 30 e
  60 giorni** (365 con `SIM_YEAR=1`) con invarianti di ledger/idempotenza/confine delle 04:00, reset, backup, pasti, metriche, contesto), tool AI (validazione, anteprime,
  apply, undo, idempotenza), orchestratore del Coach, handler serverless con client Gemini simulato (routing, fallback, 429,
  cost guard, schema fallback, errori), regressione del focus della tastiera, import ESM delle funzioni.
- QA automatica con Playwright (`scripts/qa/audit.cjs`): visita ogni route e segnala overflow, elementi tagliati, target
  piccoli, errori di pagina, in chiaro e scuro, a varie larghezze.

## 26. Deploy

- Vercel: build `npm run build`, output `dist`, rewrite SPA, funzioni `api/*.ts` con timeout 30 s.
- Variabili d'ambiente (server): **`GEMINI_API_KEY`** (obbligatoria per l'AI, da Google AI Studio; deve essere impostata
  per gli ambienti Production e Preview, poi redeploy), `GEMINI_MODEL` (opzionale, default `gemini-flash-latest`),
  `GEMINI_FREE_MODELS` / `GEMINI_PAID_MODELS` (estensioni della lista), `GEMINI_ALLOW_PAID` (default no).
  Client opzionali: `VITE_PUSH_PUBLIC_KEY`, `VITE_PUSH_ENDPOINT` (solo per un eventuale backend push).
- Sviluppo locale: `npm run dev` (Vite serve anche le route `/api`).

## 27. Mappa dei file

| Cosa | Dove |
| --- | --- |
| Avvio app, route, shell | `src/main.tsx`, `src/app/App.tsx` |
| Regole di default / impostazioni di default | `src/data/defaultRules.ts`, `src/data/defaultSettings.ts` |
| Contenuti (attività, achievement, esercizi, stanze, cosmetici, cibi) | `src/data/*` |
| Formule di gioco | `src/domain/score.ts`, `streak.ts`, `hp.ts`, `energy.ts`, `level.ts`, `rewards.ts`, `tycoon.ts`, `dayClose.ts` |
| Generatore quest, ricorrenze, carico | `src/domain/questGenerator.ts`, `recurrence.ts`, `capacity.ts`, `workload.ts` |
| Allenamento | `src/domain/progression.ts`, `cardio.ts`, `src/services/workoutService.ts`, `src/features/train/*` |
| Nutrizione | `src/config/meals.ts`, `src/features/nutrition/*`, `src/services/metricsService.ts`, `src/services/foodService.ts`, `src/ai/shared/food.ts` |
| Daily Context | `src/domain/dailyContext.ts`, `src/services/contextService.ts`, `src/features/today/context/*` |
| Coach (on-device) | `src/domain/nlu.ts`, `ruleIntents.ts`, `coachAssistant.ts`, `src/services/coachService.ts` |
| Coach (Gemini) | `src/services/ai/orchestrator.ts`, `src/services/ai/tools/*`, `src/services/ai/changeLog.ts`, `src/features/coach/CoachScreen.tsx` |
| Catalogo tool | `src/ai/shared/tools.ts` |
| Server AI e router | `server/ai/*`, `api/*` |
| Database | `src/repositories/db.ts` e repository |
| Reset / backup | `src/services/resetService.ts`, `src/services/exportService.ts` |
| Design system | `src/components/ui/*`, `src/styles/index.css` |
| Documentazione tecnica | `README.md`, `docs/architecture.md`, `docs/database.md`, `docs/game-design.md`, `docs/progression.md` |

## 28. Limiti

- **Gemini reale non testato end-to-end** (manca una chiave nell'ambiente di sviluppo): verificato che le richieste
  costruite dal server superano la validazione di formato di Google e che gli errori vengono gestiti; qualità delle risposte,
  riconoscimento reale delle foto e veri limiti 429 sono coperti solo da test con risposte simulate.
- Test su **iPhone reale e app installata** non eseguiti dallo sviluppatore AI: tutto provato con Chromium che emula
  l'iPhone 15 Pro.
- **Push con app chiusa**: richiedono un backend push non presente.
- Voce nell'app installata: si usa la dettatura della tastiera iOS.
- L'annullamento dei reset non esiste (per questo chiedono conferma e suggeriscono un backup).
- La quota residua esatta di Gemini non è esposta da Google: l'app mostra stime e i limiti che Google comunica.

## 29. Glossario

- **Game day**: giornata di gioco, dalle 04:00 alle 04:00.
- **Core / Important / Optional (Side)**: livelli di priorità delle quest.
- **Board**: l'insieme delle quest di oggi.
- **Capacity**: minuti di quest realisticamente disponibili oggi.
- **Load**: carico del giorno (Low / Balanced / High).
- **Ramp**: limiti della prima settimana.
- **Metric quest**: quest che si completa da una metrica registrata (acqua, passi…); "atMost" = budget da non superare.
- **Ledger**: registro di ogni variazione di XP, monete, HP, energia.
- **Suggestion**: proposta adattiva mostrata come carta SÌ/NO.
- **Plan (AI)**: anteprima di una modifica proposta dall'AI, con funzione di applicazione e tipo di Undo.
- **Free Tier**: modelli Gemini gratuiti; **FREE TIER ONLY** impedisce di usare modelli a pagamento.
- **Daily Context**: stato della giornata (sveglia, lavoro, momento) usato per priorità e suggerimenti.
- **Work Mode**: schermata minimale mentre una sessione di lavoro è aperta.
- **Recovery Mode**: modalità protettiva quando gli HP scendono sotto 25.
