# Backlog

Was noch offen ist – das Neueste oben. Erledigtes wird gestrichen oder mit Datum abgehakt.

## Offen

### D. Konflikte mit den Riot-Policies – vor der Registrierung beheben (26.11.2026)

Der Nutzer will Rift Switch im Riot Developer Portal registrieren und muss dabei den
[General Policies](https://developer.riotgames.com/policies/general) zustimmen. Drei Punkte widersprechen ihnen nach
Stichproben in Code und Screenshots (Stellen vor dem Ändern selbst nachsuchen, die Liste ist nicht vollständig). Die
Lösungen sind Vorschläge; das Registrieren und Zustimmen macht der Nutzer selbst.

- [x] ✔ 26.11.2026 **D1 – Keine Spieler bloßstellen.** Umgesetzt mit `Tags.forOthers` (Live-Karten, Spieler-Seite,
  „Auf einen Blick“, Traits-Tab ohne „Baustellen“ und ohne „Alle möglichen Traits“; Pechsträhne in der Form-Karte nur
  bei eigenen Accounts). Neutral bleiben nur `readyToRumble` und `aggroJungler`. Policy: „Shame players based on any metric including their recent
  performance“ ist verboten, ebenso Annahmen, die zu einem schlechten Bild von einem Spieler führen.
  - Betroffen: Live-Karten (`ui/scout-view.js`, z. B. „Losing streak“, „Weak farmer“, „Smurf?“) und die Spieler-Seite
    (`ui/player-view.js`, teilt in `strong` / `weak` / Rest).
  - Vorschlag: Schwächen und „Smurf?“ nur bei den eigenen Accounts zeigen, bei Fremden nur Positives und Neutrales.
  - Achtung: `Tags.isWeakness` (`ui/tags.js`) reicht als Filter nicht – es lässt die Form-Tags (`lossStreak`) aus,
    und `smurf` hat die Farbe `warn`. Auch die übrigen `bad`- / `warn`-Tags und die Live-Tags einzeln durchgehen.
- [x] ✔ 26.11.2026 **D2 – Keine Verbindung zum League-Chat.** Funktion entfernt; wer sie an hatte, wird beim ersten
  League-Start nach dem Update einmal online gesetzt (`undo_offline`), danach ist der Schlüssel weg. Policy: keine Wege zu anderen League-Systemen wie dem Chat, die nicht
  zu den Third-Party-Tools gehören.
  - Betroffen: „Offline erscheinen“ – `chat_status` / `set_chat_status` über `/lol-chat/v1/me`
    (`src-tauri/src/riot.rs`), Aufrufe in `src-tauri/src/main.rs` (um Zeile 2695 und 3681), Standardwert
    `appearOffline` in `src-tauri/src/settings.rs`, Schalter in `ui/index.html`, Test in `test/extras-ui.test.js`,
    Texte in `ui/i18n.js` + `ui/lang/*.js`, Erwähnung in `ui/changelog.js`.
  - Vorschlag: Funktion ganz entfernen. Wer sie eingeschaltet hat, soll danach nicht offline hängen bleiben.
- [x] ✔ 26.11.2026 **D3 – Kein Scraping fremder Quellen.** Abruf entfernt (`live.rs`, Befehl `counters`, Cache
  `counters.json` wird beim Start gelöscht). Winrates aus den gespeicherten Spielen (`lanes.rs` zählt die Lane-Matchups
  jedes Spiels mit allen zehn Spielern) plus eigene Bilanz; counterstats.net nur noch als Link.
- [x] ✔ 26.11.2026 **D4 – Versteckte Spieler.** Policy: „Products cannot identify or analyze players who are deliberately
  hidden by the game.“ Zellen mit `nameVisibilityType: HIDDEN` oder ohne ID werden nie nachgeschlagen (`live.rs has_id`).
- [ ] **D5 – Noch offen, Nutzer entscheidet:** Auto-Accept und Premade-Erkennung bei Gegnern werden in den Policies
  nicht genannt; „Products should not remove game decisions“ bzw. „no game-session-specific information that would be
  previously unknown to the player“ könnten beim Audit gefragt werden. Beim Registrieren die genutzten LCU-Endpunkte
  angeben (Policy: „We need to know which endpoints you're using and how you're using them“). Policy: keine Daten von Quellen außerhalb der Riot-API und der
  dokumentierten Third-Party-Tools. Laut `docs/plans/Pruefbericht.md` §3 verstößt der Abruf außerdem sehr
  wahrscheinlich gegen das User Agreement von counterstats.net.
  - Betroffen: Champ-Select-Helper – Abruf in `src-tauri/src/live.rs`, Anzeige in `ui/views.js`, Test in
    `test/ui-clicks.test.js`, README (Champ select helper, „Outside connections“) und die Liste *Data sources* in
    der App.
  - Vorschlag: Winrates aus den eigenen gespeicherten Spielen berechnen (mit Anzahl der Spiele) oder nur noch auf
    counterstats.net verlinken. Ersetzt die Entscheidung vom 24.11., den Helper so zu lassen.

### A. Version 1.3 – ✔ 25.11.2026 fertig (1.2.2 wurde nie veröffentlicht und steckt in 1.3.0)

Ziel: alles unten umsetzen, dann als **1.3** veröffentlichen (Version in `src-tauri/tauri.conf.json`, Notizen in `ui/changelog.js`, Tag `v1.3.0` pushen – der Nutzer hat das Pushen dafür freigegeben).

- [x] **Live: 200er-Liste + Details für 50 Ranked-Spiele** – ✔ 25.11.2026. Lite-Spiele (Format 0) aus der Liste, 365 Tage; volle Details für die neuesten 50 Ranked-Spiele, 30 Tage. Das Fenster hält die Spiele (`scv.games`) über Spiele hinweg und schickt ihre Schlüssel (`k`) mit – Premades werden nicht neu übertragen; ein Lite-Spiel, zu dem ein weiterer Spieler dazukam, kommt neu.
- [x] ✔ 25.11.2026 **Sprache beim ersten Start aus Windows übernehmen** (eine der 11 Sprachen, sonst Englisch).
- [x] ✔ 25.11.2026 **Lane im Champ Select Helper** standardmäßig aus der Hauptrolle der Match History (`Tags.mainRole`; Lane `adc` = Rolle `bot`).
- [x] ✔ 25.11.2026 **Knopf umbenennen:** "Aus der Match History" → "Aus der Match History hinzufügen" / "Add from match history" (`live.poolFromMh`, 11 Sprachen).
- [x] ✔ 25.11.2026 **Tags: „Alle Rollen“** – jede Rolle mit 5+ Spielen mit ihren eigenen Schwellen; jeder Rollen-Tag zeigt Rolle und Anteil der Spiele.
- [x] ✔ 25.11.2026 **Einstellungen als eigene Seite** – wie ein Buch: Kapitel links (Sprung, Markierung beim Scrollen), alles in einer Liste.
- [ ] Sortierung bleibt "nach Level" (Nutzer-Entscheidung).
- [x] Match-Benachrichtigung: kam nicht, weil Windows-Benachrichtigungen beim Nutzer ganz aus sind (`PushNotificationsToastEnabled = 0`). Die Einstellungen weisen jetzt darauf hin.


### B. Nach 1.3.1 (25.11.2026)

- [x] Spieler-Seite für jeden Spieler (Klick auf einen Namen in Match History, Live, nach dem Spiel): Rang, Kennzahlen, Rollen, Champions, Traits, letzte Spiele, mit dir; alle 200 Spiele mit Details; Open with.
- [x] Vor/Zurück-Pfeile in der Titelleiste (auch Alt+←/→, Maus-Seitentasten).
- [x] „Tags“ heißen jetzt „Traits“ (DE auch „Traits“).
- [x] Live: Traits in drei Stufen (Wichtig / Mehr / Alle), Rest einer Karte hinter „+n“.
- [x] Live lädt viel schneller: alle Match-Listen auf einmal, dann 12 Spiele gleichzeitig ohne Pause zwischen den Runden, Spiel + Timeline parallel; im Spiel 6 gleichzeitig statt 1 alle 4 s; kurze Pause, wenn der Client ablehnt. Die Spieler-Seite lädt ebenso 12 gleichzeitig.
- [x] Spielersuche in der Titelleiste (Strg+K): Vorschläge aus allen Spielern deiner Spiele, sonst Riot ID über den Client (ohne Tag: der eigene Server).
- [x] ✔ 26.11.2026 Als 1.3.2 veröffentlicht (Release-Lauf grün), danach 1.3.3.
- [ ] **GitHub-Seite neu machen** (Nutzer, 26.11.2026 – noch nicht anfangen): Seit 1.3.2/1.3.3 sieht vieles anders
  aus (Übersicht mit Kopfbild und Showcase, „Auf einen Blick“, ein Performance-Tab, Live nach dem Spiel, Augments).
  Vor allem das **Video `docs/screens/demo.gif`** ist hinfällig; dazu die README-Bilder. Neu aufnehmen mit
  `tools/screens` (demo.js = erfundene Accounts, capture.py = headless Edge + ffmpeg), README-Texte dabei mit prüfen.
- [ ] **Karte: standardmäßig „Beides“** (Nutzer, 26.11.2026 – noch nicht anfangen): Performance → Karte startet auf
  „Beides“ statt „Tode“, und „Beides“ steht in der Auswahl vorne (Beides / Tode / Kills). `ui/map-view.js`
  (`mv.kind`, die Reihenfolge in `kinds`); auch die Karten-Kachel auf „Auf einen Blick“ (`sumMap`, zeigt nur Tode) und
  den Test in `test/perf-ui.test.js` („deaths only at first“) anpassen.
- [ ] **Trend-Zeile in Performance entfernen** (Nutzer, 26.11.2026 – „nichtssagend“; noch nicht anfangen): die Zeile
  „Letzte 20 Spiele gegen die davor: Winrate 65 % → 30 % · KDA 2.01 → 2.54“ unter den Kennzahlen. `perfTrendHtml`
  in `ui/perf.js` (Aufruf in `perfAllHtml`, die Auswahl `trendN` / `trendKey`, `perf.trendN` / `perf.trendKey`) und
  die Tests dazu. `PerfMath.trend` bleibt – die Trendpfeile der Kennzahlen auf „Auf einen Blick“ nutzen es.
- [ ] **Live während des Spiels zu langsam** (Nutzer, 27.11.2026 – noch nicht anfangen): Die App liest pro Mitspieler
  bis zu 50 Ranked-Spiele samt Timeline (`OTHERS_DETAILS`, `scout_loop` in `main.rs`, `PAR_IN_GAME` / `IN_GAME_GAP`),
  im Spiel bewusst gedrosselt. Offen: bremst das den Client, oder lehnt er Anfragen ab? Das sieht man nur in einem
  echten Spiel – dafür Log-Ausgaben der Scout-Runden (Zeit, Anzahl abgelehnt) sammeln und auswerten.
- [ ] **Übersicht-Reiter neu ordnen, Performance als Startseite?** (Nutzer, 26.11.2026 – erst besprechen, nicht
  einfach bauen): Der Nutzer findet Performance inzwischen schöner und nützlicher als „Auf einen Blick“ – nur die
  Kennzahlen-Zeile von „Auf einen Blick“ (`sumFigs`: Ring für die Winrate, Trendpfeile) gefällt ihm besser als die
  `perf-bar` von Performance. Ideen zum Vorschlagen: Performance wird der Start-Tab (`dashTabNow` in `ui/mastery.js`)
  mit der Kennzahlen-Zeile von „Auf einen Blick“; „Auf einen Blick“ geht in Performance auf oder wird ein späterer
  Tab; die Reihenfolge der Reiter (`#dashTabs` in `ui/index.html`, `PL_TABS` der Spieler-Seite) neu denken.

### C. Ideen-Runde (25.11.2026)

- [x] Live: eigene Premades ohne „Letztes Spiel: Team (…)“, Premades einer Party ohne „schon einmal getroffen“; „Deine Bilanz gegen ihre Champions“ zeigt die Zahlen auf dem Chip.
- [x] Replays in der Match History (herunterladen mit Fortschritt, ansehen) über `/lol-replays`.
- [x] Übersicht → Tode: Karte, wo man stirbt, nach Phase, von der blauen Seite aus; Stellen ab 5 Toden und 30 %.
- [x] Riot ID umbenannt: Kachel übernimmt sie, Toast (nicht im Streamer-Modus), alte Namen im Panel und in der Suche.
- [x] Panic-Hook schreibt Ort und Meldung in `error.log`, bevor `panic = "abort"` beendet.
- [x] `tools/release.js` (`npm run release X.Y.Z [--push]`): alle Prüfungen des Release-Workflows vorab.
- [ ] Code-Signing: SignPath Foundation (kostenlos für Open Source) oder Azure Trusted Signing (~10 $/Monat) – braucht eine Bewerbung/Identitätsprüfung durch den Nutzer.
- [x] Aus dem Vergleich (25.11.2026): zufälliger Skin mit Chroma (Champ Select), Offline erscheinen (Einstellungen),
  Sprache von League (Tools), Login-Name / Passwort kopieren im Panel (Passwort nach Windows Hello, nicht im
  Zwischenablage-Verlauf, nach 30 s gelöscht). Noch nicht mit dem echten Client ausprobiert.
- [ ] Noch offen (Nutzer entscheidet): winget-Manifest, Export als CSV.

## Nicht gewollt – passt nicht zur Vision (25.11.2026)

Nicht wieder vorschlagen. Die Gründe des Nutzers:

- **Runen und Item-Sets aus den eigenen besten Spielen in den Client übernehmen** – dafür gibt es Seiten, die
  Server-Daten auswerten; Rift Switch bleibt lokal. Alte Runen helfen bei einem neuen Champion auch nicht.
- **Hilfe beim Dodge** (Niederlagen-Serien, Autofill, Kosten eines Dodges) – Dodgen ist nie gut.
- **Taskleiste blinken / Ton bei „Match gefunden“** – der League-Client springt ohnehin in den Vordergrund.
- **Live Client Data API im Spiel** (Items, Level, Gold live, zweiter Bildschirm) – kein Ingame-Overlay und keine
  Live-Updates im Spiel; dafür gibt es Blitz als bessere Alternative.
- **Vorschlag „Jetzt spielen: Account X“** – unpassend. Smurfen ist eine Grauzone und soll nirgends erwähnt werden.
- **Decay-Kalender mit Warnung** – der Decay auf der Kachel reicht.
- **Beute über alle Accounts** (Truhen, Schlüssel, Splitter zum Zerlegen) – die Kollektion gibt es schon;
  Splitter sind uninteressant.
- **Session-Anzeige** (heute gespielt, LP heute) – geht schon mit dem Filter „Heute“ in der Match History.
- **Tilt-Anzeige** (Hinweis nach Niederlagen in Folge) – wann der Tilt kommt, weiß man selbst am besten.
- **Desktop-Verknüpfung pro Account** – müllt den Desktop zu.
- **TFT** und **Valorant** – Rift Switch bleibt eine reine LoL-App.
- **Discord-Status** (Rich Presence) – Apps sollen Discord nicht übernehmen.
- **Ränge oder alte Saisons über OP.GG** – Rift Switch fragt keine fremden Server nach Account-Daten.

### 0. Aus dem Code-Review (25.11.2026) noch offen

- [ ] **P5 – Spiele im Fenster-Speicher:** `mh.cache` (matches-view.js) hält jedes geladene Spiel ganz im WebView; die
  Übersicht lädt dafür die ganze Historie. Besser: kompakte Zeilen für Kennzahlen, Details per LRU-Cache.
- [ ] **`panic = "abort"`:** Jeder Panic beendet die App samt Tray. Bewusst so gelassen (kleinere Datei); die
  bekannten Panic-Stellen (z. B. `redact` mit Sonderzeichen) sind behoben. Seit 25.11.2026 steht jeder Panic
  vorher mit Ort und Meldung in `error.log` (und damit in der Diagnose-Datei).
- **S2 – signierte Updates:** nicht umgesetzt (Code-Signing kostet mehrere hundert Euro im Jahr). Der Installer wird
  gegen die SHA-256 aus dem Release geprüft – beim Download und noch einmal direkt vor dem Start.

### 1. Schwellen auf echte Spieler-Durchschnitte umstellen – *Claude, sobald genug Daten da sind*

Die Schwellen kommen bisher aus einem **Modell**: Fast alle fremden Spieler stecken nur in 1–2 gespeicherten Spielen,
also wird geschätzt, wie Saison-Durchschnitte streuen (Mitte aus Einzelspielen und Mittelwerten von 10 gezogenen
Spielen). Ein Tag bewertet einen Spieler dagegen immer mit **allen** seinen Spielen.

`tools/tag-thresholds.js` rechnet seit 25.11.2026 auch **echt**: alle Spiele jedes fremden Spielers mit 10+ Ranked-Spielen
auf einer Rolle – auch aus dem Speicher, den Live mit den letzten 20 Spielen jedes Mitspielers füllt
(`matches-others`). Ab 30 solchen Spielern pro Rolle ersetzt das das Modell (Ausgabe: „real“ statt „model“).
Stand 25.11.2026: 1–3 Spieler pro Rolle, `matches-others` noch leer.

- [ ] Nach einigen Live-Spielen `node tools/tag-thresholds.js` laufen lassen; wo „real“ steht, die Werte übernehmen.
- [ ] Bei „Roamer“ (nur Top, Mid, Support) und „Invader“ (nur Jungle) nachsehen, ob die anderen Rollen dazukommen können.

### 2. „Wird erwischt“ wieder einschalten – *nur mit genaueren Positionen*

Aus (`off: true`): Die Timeline hat Positionen nur einmal pro Minute. Selbst Killer und Assister, die nachweislich
dabei waren, liegen dann in 37 % der Kills mehr als 2.500 Einheiten weg – „kein Mitspieler in der Nähe“ ist so nicht
messbar. Erst wieder an, wenn es eine Quelle mit genauen Positionen gibt.

### 3. „Ranked-Grinder“ – geändert 25.11.2026

War 50 Spiele in 30 Tagen; Live kennt nur die letzten 20 Spiele eines Spielers, damit nie erreichbar. Jetzt 10
Ranked-Spiele in 7 Tagen (≈ 43 im Monat). Beobachten, ob das zu oft anschlägt.

## Erledigt

### ~~Tags für Live, Beschreibungen, Kollektion~~ – ✔ 25.11.2026

- [x] „Alle möglichen Tags“: Live-Tags ganz entfernt; jeder Tag erklärt beim Hovern und Klicken, was er misst und
  was der eigene Wert bedeutet, dazu die Schwellen der Rolle und woher sie kommen (11 Sprachen).
- [x] Kein Tag braucht mehr als 10 Spiele (vorher 15 bei OTP, Pool, Rollen; Comeback/Throws jetzt 60 % von
  mindestens 5 statt 40 % von 8; Late/Early Game 5 statt 8 pro Seite).
- [x] Roams geprüft: nutzen die genauen Kill-Orte, 2.003 von 2.003 stimmen mit den Rohdaten überein.
- [x] Kollektion „Nach Rarität“: erst die Arten (Skins, Chromas, Ward-Skins, Icons) mit allen Accounts zusammen,
  ein Klick klappt die Accounts einer Art auf.

### ~~Alle Accounts einmal neu laden (Spielformat 6)~~ – ✔ 25.11.2026

Alle 186 gespeicherten Ranked-Spiele liegen im Spielformat 6 vor (XP, Jungle-CS, Positionen, Kill-Orte,
Objectives mit Killer und Gegnern).

### ~~Tag-Schwellen nachkalibrieren~~ – ✔ 25.11.2026

- [x] `tools/tag-thresholds.js` korrigiert: Es überschrieb die Objectives aus Format 6 mit den älteren aus dem
  Rohdaten-Archiv (ohne Killer und Gegner) – dadurch kam für „Objective-Dieb“ nichts heraus; für `objPart` rechnete es
  keine Stufen. Kleine Zählwerte (Roams, Erwischt) kommen jetzt wie First Blood und Steals nur aus den 10-Spiele-Mischungen.
- [x] Werte pro Position in `ui/tag-rules.js` übernommen, „PROVISIONAL“ entfernt:
  XP-Vorsprung/-Rückstand, Roamer, Wird erwischt, Objective-Dieb, Invader / Wird invadet, Objective-Jäger.
  Sonderfälle: Jungler sind bei 96 % der Objectives dabei – dort gibt es nur „verpasst Objectives“, keine gute Stufe.
  Botlaner (Roamer) und Laner (Invader) fallen heraus: Bei ihnen wäre schon ein einziges Mal in zehn Spielen das
  „beste Drittel“.
- [x] Karten-Zonen geprüft: In Minute 3–8 stehen Toplaner zu 82 % in der Top-Zone, Midlaner zu 73 % in Mid, Botlaner
  zu 85 % und Supports zu 73 % in Bot (der Rest meist Basis); Tode vor 10 Min. liegen genauso (Bot 90 %, Top 84 %,
  Mid 66 % + 11 % River). Passt.
- [x] „Objective-Dieb“ geprüft: 36 Treffer in 186 Spielen, 34 davon Jungler (Smite), Rest Top/Bot – sinnvoll.
- [x] „Wird erwischt“ geprüft: 18 % der Tode nach 15 Min. zählen (1.325 von 7.206), im Schnitt 0,5–1,1 pro Spiel je
  nach Rolle. Die Schwellen (schwächste 25 % / 10 %) liegen jetzt bei 0,5–1,3 statt 1,6–2,5 – vorher hätte der Tag
  fast nie angeschlagen.
