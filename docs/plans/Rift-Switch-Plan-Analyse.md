# Auftrag: Rift Switch – Mastery, Spieleranalyse, Tags und Live-Übersicht

**Worum es geht:** Rift Switch ist meine eigene Windows-App für League of Legends: ein Account-Switcher und
Multi-Account-Companion (Tauri: Rust-Backend in `src-tauri/`, Oberfläche in `ui/`, 11 Sprachen). Das Projekt liegt in
`C:\Users\bjarn\Documents\LoL-Switcher` (GitHub: `Zlizz3R/rift-switch`). **Lies zuerst die `README.md`.** Dort steht,
was die App kann, wie sie arbeitet und welche Verbindungen nach außen sie hat. Danach diesen Plan.

Rift Switch bleibt ein **lokaler Multi-Account-Companion**: schnell, privat, ohne eigene Server. Dieser Plan erweitert
die App um:

- **Mastery über alle Accounts** – das wichtigste Feature dieses Plans –, dazu eine **Spielzeit-Schätzung** aus der
  Mastery.
- Nachvollziehbare Statistiken.
- Spieler-Tags im Stil von Mobalytics.
- Eine **Live-Übersicht im Stil von Porofessor**: eine Karte pro Spieler mit Kennzahlen und Tags.
- Ein Spielstilprofil im Vergleich zum Lane-Gegner.

**Leitsatz für alle Daten: so viel wie möglich.** Je mehr Spiele, desto besser die Grundlage. Wo der Client mehr
liefert, wird mehr geladen und dauerhaft gecacht. Es gibt keine künstlichen Obergrenzen, nur Ladereihenfolge und
Parallelität begrenzen.

## Auftrag

> **Arbeite den Plan Phase für Phase der Reihe nach ab**, in der Reihenfolge der Fortschrittsliste (Abschnitt 7).
> Schau zuerst dort nach, was schon erledigt ist, und mach mit dem ersten offenen Punkt weiter. Nach jeder Phase:
> Tests, Commit, Häkchen, kurzer Bericht – dann direkt die nächste, außer eine Phase verlangt ausdrücklich meine
> Entscheidung (Prüfauftrag, Speicher-Messung, OP.GG-MCP).

## 0. Arbeitsweise

- **Fortschritt:** Dieser Plan liegt im Projektordner (`docs/plan/`). Führe am Ende die Liste „Fortschritt“ (Abschnitt 7) und hake
  erledigte Phasen ab, mit Datum und einem Satz zum Stand. Wird der Chat zu lang, mache ich einen neuen auf, der
  genau dort weitermacht.
- **Fang direkt mit Phase 1 an.** Keine separate Bestandsaufnahme als Dokument. Lies zu Beginn jeder Phase nur den
  Code, den sie betrifft, und prüfe dabei die Liste in Abschnitt 2 (sie stammt aus einem älteren Stand).
- Phasen der Reihe nach. Nach jeder Phase: `npm test` grün, Commit, kurzer Bericht (was gebaut, was offen).
- Frag nur nach, wenn eine Entscheidung schwer rückgängig zu machen ist (z. B. Format der gespeicherten Daten).
  Alles andere: sinnvoll entscheiden und im Bericht nennen.
- Neue Texte in **allen 11 Sprachen** (`ui/i18n.js` + `ui/lang/*.js`; der Test prüft das).
- Neue Seitenteile auch in der Demo (`tools/screens/demo.js`) mit erfundenen Daten. Am Ende neue Screenshots über
  `tools/screens/capture.py`.
- Bestehende Funktionen, vor allem der **Accountwechsel**, dürfen sich nicht ändern. Ein Fehler in einem Analyse-Teil
  darf nie die Account-Seite oder das Einloggen stören.
- **Screenshots im Anhang:** Ich schicke dir mit diesem Plan Screenshots als Inspiration mit: die Live-Karten von
  Porofessor (Aufbau, Ränge, Kreise, Tag-Chips) und Tag-Beispiele von Mobalytics (Name + genauer Text mit Zahlen).
  Sie zeigen Aufbau und Stil. Nicht 1:1 kopieren (keine fremden Namen, Logos oder Texte), sondern im Stil von Rift
  Switch umsetzen. Lege sie zu Beginn unter `docs/plan/` ab, damit sie auch in späteren Chats da sind.

### Prüfauftrag vor Phase 5: Ist der Champ-Select-Helper (und die Live-Ansicht) erlaubt?
Kurz prüfen und im Bericht festhalten, mit Quellen:
- **Riot-Richtlinien für Drittanbieter-Tools** (developer.riotgames.com, Policies; League-Regeln zu Champ Select und
  Live-Infos): Was darf ein Tool im Champ Select und im laufenden Spiel anzeigen? Braucht eine App, die nur die lokale
  Client-API nutzt, eine Registrierung? Gilt etwas Besonderes für Auto-Accept, Gegner-Lane-Vermutung und
  Counter-Empfehlungen?
- **counterstats.net:** Nutzungsbedingungen und `robots.txt` prüfen. Ist automatisches Abrufen erlaubt? Falls nicht:
  Vorschläge für eine erlaubte Quelle oder eine Lösung ohne externe Daten (z. B. eigene Winrates aus gespeicherten
  Spielen gegen diesen Champion).
- Nichts abschalten oder umbauen, bevor ich das Ergebnis gesehen habe. Nur berichten.

## 1. Grundregeln für alle Zahlen und Tags

**Design zuerst:** Die App soll aussehen wie von einem professionellen Studio gemacht – clean, ruhig, übersichtlich
und trotzdem lean und schnell.
- **Nicht vollpflastern:** Jede Ansicht zeigt zuerst das Wichtigste, wenige große Zahlen. Details gibt es erst per
  Klick, Aufklappen oder Tooltip. Lieber eine Kennzahl weglassen als eine Ansicht überladen.
- **Unterkategorien:** Haupttabs, die zu voll werden, bekommen Unterreiter (z. B. Overview → *LP-Verlauf · Champions
  & Rollen · Mastery · Spielstil · Seasons*). Die Navigation bleibt flach und vorhersehbar. Der zuletzt gewählte
  Unterreiter wird gemerkt.
- **Einheitlich:** gleiche Abstände, Schriftgrößen, Farben und Bausteine wie im bestehenden Design (`ui/style.css`).
  Neue Elemente sehen aus, als wären sie schon immer da gewesen. Farben haben eine Bedeutung (grün/orange/rot wie bei
  den Tags) und werden nicht zur Deko verwendet.
- **Lean:** keine schweren Bibliotheken, keine Dauer-Animationen, nichts lädt, was gerade nicht sichtbar ist.

1. **Eine Quelle:** Jede Kennzahl (KDA, Kill-Beteiligung, CS/min, Schaden/min, Vision/min, Winrate) wird genau
   einmal berechnet. Match history, Overview, Live, Tags und das Profil nutzen dieselben Funktionen.
2. **Ehrliche Mengen:** „420 analysierte Spiele“, nie „420 Spiele insgesamt“, wenn die Historie unvollständig ist.
   Jede Zahl zeigt, worauf sie sich bezieht (Accounts, Queue, Zeitraum, Anzahl).
3. **Fehlend ≠ 0:** Fehlende Werte werden weggelassen und gekennzeichnet, nie als 0 gerechnet. Ein fehlendes Tag heißt
   „nicht belegt“, nicht „trifft nicht zu“.
4. **Tags mit Zahlen:** Tags dürfen griffige, auch wertende Namen haben („Lane-Tyrann“, „Wackelig“). **Jeder Tag
   zeigt im Tooltip die Zahlen dahinter**, wie bei Mobalytics: „Ø +28,8 CS-Differenz bei 15 Min. in 9 Spielen“.
   Ohne Daten kein Tag. Kein Gesamtscore.
5. **Feste Schwellen:** Absolute Werte, einmal fundiert festgelegt, an **einer** Stelle (`ui/tag-rules.js`), wo nötig
   pro Rolle. Keine Vergleiche mit „allen Spielern“, dafür gibt es keine Daten.
6. **Gewichtet rechnen:** Summen über Spiele, nie Mittelwerte von Winrates. Rollenwerte kommen aus den Spielen, nicht
   aus den Champion-Zeilen.
7. **Remakes** (vorzeitiges Ende, Spiel kürzer als 5 Min.) zählen nirgends mit.
8. **Ein Spiel, zwei eigene Accounts:** Beim Zählen von Spielen zählt es einmal. Bei der Leistung zählt jede
   Teilnahme. Wo es einen Unterschied macht, steht dabei, welche Zählweise gilt.
9. **KDA:** „Ø K / D / A“ (drei Mittelwerte) und „KDA“ = (K+A) / max(1, D) über die Summen. Diese Definition gilt
   überall.

## 2. Was es schon gibt (nicht neu bauen, erweitern)

Stand vom 23.11., bitte im Code bestätigen:

- **Lokale Match-Speicherung** ohne Limit, *Ältere Spiele laden*, Speicherplatz und Löschen (`mh-storage`,
  `mh-clear`).
- **Filter in der Match history** (`ui/matchfilter.js`): Account, Queues, Zeitraum/eigene Daten, Sieg/Niederlage,
  Champion, Sortierung, Kills/Deaths/KDA/Multikills.
- **Zusammenfassung über der Liste** (`summaryHtml` in `ui/matches-view.js`): Winrate, KDA, CS/min, Schaden, Serien,
  **Rekorde** mit Sprung zum Spiel.
- **Spieldetails:** Stats, Items, Runen, Ränge aller Spieler, Teamgold-Verlauf (Timeline wird also schon geladen),
  Vergleich zweier Spieler.
- **Overview:** LP-Verlauf aller Accounts, 7/30/90 Tage, Ranked-Spiele, Siege/Niederlagen, Ziele.
- **Live:** Lobby, Champ Select, im Spiel, Ränge aller sichtbaren Spieler, Multi-op.gg, Clash, Champ-Select-Helper.
- **Profil:** Top-Mastery des eingeloggten Accounts.
- **Sammlung** pro Account, gelesen beim Einloggen, mit „Jetzt lesen“-Knopf. Die Mini-Kacheln mit grün/gelb/grau bei
  der Suche gibt es schon.

**Datenquellen:** der lokale League/Riot Client (`127.0.0.1`) für alle Spieler- und Spieldaten. Die App hat keinen
Riot-API-Schlüssel und baut auch keinen ein. **Kein Scraping von op.gg**: Dessen Nutzungsbedingungen verbieten
Scraping und automatische Skripte ausdrücklich. Der Link *Öffnen mit op.gg* bleibt.

## 3. Architektur (schlank)

- **`ui/stats.js`** – reine Funktionen, keine DOM-Zugriffe: Kennzahlen pro Spiel, Aggregation über eine Spielliste
  (gewichtet, Remakes raus, Teilnahmen vs. eindeutige Spiele), Gruppierung nach Rolle/Champion/Account,
  Lane-Gegner-Vergleich. Mit Tests.
- **`ui/tag-rules.js`** – der Tag-Katalog (Abschnitt 5) als Daten: **Kurzname** („Stark mit {champ}“), **genauer Text**
  mit Platzhaltern für die Werte („{wr} % Winrate mit {champ} in den letzten {n} Spielen“),
  Farbe (grün/blau = positiv, orange = Hinweis, rot = Warnung), Datenstufe, Mindestanzahl, Schwelle.
- **`ui/tags.js`** – wertet die Regeln aus. Ergebnis je Tag: `erfüllt | nicht erfüllt | zu wenig Daten`, dazu Wert,
  Schwelle, Anzahl, Zeitraum. Eine getrennte Funktion wählt aus, was angezeigt wird (Konflikte, Priorität, Anzahl).
- **Spieldaten-Speicher im Backend** – ein Spiel (vollständige Daten + Timeline) wird einmal geladen und **dauerhaft**
  gespeichert, egal ob eigenes oder fremdes Spiel. Ein Spiel ändert sich nie, und dieselben Spiele tauchen bei
  mehreren Spielern auf. Bestehende Speicher- und Cache-Muster weiterverwenden. Fremde Spiele bekommen eine eigene
  Größenanzeige und einen eigenen Löschknopf.
- **Wiederverwendbare UI-Bausteine:** Spielzeile kompakt/ausführlich, Kennzahlenleiste, Tag-Chip mit Tooltip,
  „Laden“-Knopf mit Fortschrittsbalken.
- Ob Berechnungen besser in Rust liegen, entscheidest du nach dem Code. Wichtig ist nur: eine Stelle pro Formel.

## 4. Phasen

### Phase 1 – Mastery über alle Accounts, Spielzeit-Schätzung, „Laden“-Knöpfe
**Das Herzstück:** die Mastery-Punkte eines Champions über alle Accounts zusammen. Beispiel: Illaoi hat auf dem Main
1,8 Mio., die App zeigt **Illaoi 2,2 Mio.** über alle Accounts, mit der Aufteilung.

- **Lesen:** Mastery beim Einloggen eines Accounts lesen und mit Zeitstempel speichern, wie bei der Sammlung. Prüfe
  das Endpoint im Client (`lol-champion-mastery`, local-player). **Prüfe gleich am Anfang, ob es Mastery für fremde PUUIDs gibt**
  – davon hängen „Neu auf {Champ}“ und die Mastery-Tags in Live ab. Ergebnis im Bericht.
- **Neue Ansicht „Mastery“** (in der Overview oder als eigener Reiter – entscheide nach Platz):
  - Oben die **Top-Champions nach Gesamtpunkten**, groß, mit Champion-Bild: „Illaoi · 2.214.330 · 3 Accounts“.
  - Tabelle Champion × Account mit Punkten, Spalte **„Gesamt (alle Accounts)“**, sortierbar, Suche. Der höchste
    Account ist hervorgehoben. Level je Account (Level werden **nicht** addiert).
  - „Stand: <Datum>“ je Account. Nie gelesene Accounts sind sichtbar markiert.
- **Meilensteine:** 100k / 500k / 1 Mio. / 2 Mio. je Account **und** über alle Accounts, mit den beitragenden
  Accounts im Tooltip.
- Mastery und „meistgespielt“ (aus Spielen) bleiben getrennte Spalten oder Ansichten.
- **Spielzeit-Schätzung** aus den Mastery-Punkten, je Champion und Account und als Summe über alle Accounts:
  „Illaoi · 2,2 Mio. Punkte · ca. X–Y Std.“ (Zahlen ergeben sich aus der Rechnung)
  - Rechnung: Punkte ÷ Ø Punkte pro Spiel = geschätzte Spiele. Geschätzte Spiele × (Ø Spieldauer + 5–10 Min. für
    Suche, Champ Select, Ladebildschirm und Post-Game) = Spielzeit. Ausgabe immer als **Spanne** mit „ca.“, nie als
    exakte Zahl.
  - **Ø Punkte pro Spiel:** Annahme 50 % Winrate, also Mittel aus Punkten pro Sieg und pro Niederlage. Riot hat das
    Mastery-System 2024 umgebaut, davor gab es andere Punkte pro Spiel. Recherchiere die Werte je Zeitraum (offizielle
    Patch Notes, Wiki) und trage sie mit Quelle in `ui/playtime-rules.js` ein. Nichts schätzen, was nicht belegt ist;
    fehlt ein Wert, bleibt die Spanne breiter.
  - **Ø Spieldauer je Season** (Summoner's Rift), ebenfalls mit Quelle in `ui/playtime-rules.js`. Da sich die Punkte
    nicht auf Seasons aufteilen lassen, rechnet die Spanne mit der kürzesten und der längsten Season-Dauer.
  - **Eichung mit echten Daten:** Bei jedem Mastery-Lesen merkt sich die App die Punkte je Champion. Zusammen mit den
    dazwischen gespeicherten Spielen ergibt das die tatsächlichen Punkte pro Spiel und die echte Spieldauer dieses
    Accounts. Gibt es davon genug (≥ 10 Spiele), wird damit gerechnet: für die Punkte seit dem Umbau, und für
    die Dauer zur Kontrolle. Im Tooltip steht, womit gerechnet wurde.
  - ARAM gibt auch Mastery, hat aber kürzere Spiele. Wo die gespeicherten Spiele einen ARAM-Anteil zeigen, fließt er
    ein, sonst nicht.
- **„Laden“-Knöpfe:** an mehreren Stellen (Sammlung, Mastery, Account-Panel, Overview), aber **immer dieselbe
  Aktion: alles auf einmal laden**, was der Client für den eingeloggten Account liefert (Sammlung, Mastery, Ränge,
  neue Spiele). Den bestehenden „Jetzt lesen“-Knopf der Sammlung dafür umbauen, nicht doppeln.
  - Dauert es länger als ~1 Sekunde, erscheint ein **Fortschrittsbalken** mit Schritt: „Mastery … 2/4“.
  - Am Ende kurz „✓ Geladen – 162 Champions, 87 Skins, 12 neue Spiele“, und die Daten erscheinen sofort.
  - Ist der Account nicht eingeloggt, heißt der Knopf „Beim nächsten Login laden“.
  - Läuft schon ein Ladevorgang, zeigen alle Knöpfe denselben Fortschritt, statt einen zweiten zu starten.

### Phase 2 – Kennzahlen an einer Stelle + „Letztes Spiel“
- `ui/stats.js` anlegen und alle bestehenden Berechnungen dorthin ziehen (Zusammenfassung der Match history,
  Overview, Spieldetails). Danach gibt es keine doppelten Formeln mehr.
- Komponente **Letztes Spiel** (kompakt): auf der Live-Seite, wenn kein Spiel läuft, und im Account-Panel. Sie nutzt
  dieselbe Spielzeile wie die Match history. Ein Klick öffnet das Spiel in der Match history.
- Tests: kein Spiel, 0 Tode, fehlende Team-Kills, Remake, dasselbe Spiel auf zwei Accounts.
- **Fertig, wenn:** alle bisherigen Zahlen gleich bleiben (Test vor/nach), keine Formel mehr doppelt existiert und das
  letzte Spiel an beiden Stellen identisch aussieht.

### Phase 3 – Overview: Kennzahlenleiste + Rollen-/Champion-Tabelle
- Die Overview bekommt denselben Filterkontext wie die Match history (Accounts, Queue, Zeitraum, Rolle). Am besten
  denselben Filter-Code verwenden. Darüber steht ein Satz wie „420 Solo/Duo-Spiele · Top · 3 Accounts“.
- **Kennzahlenleiste:** analysierte Spiele, Winrate, Ø K/D/A, KDA, CS/min, Schaden/min, Vision/min, Kill-Beteiligung.
- **Tabelle:** Rollen aufklappbar, darunter Champions. Spalten: Spiele, Winrate, Ø K/D/A, optional CS/min,
  Schaden/min, KP, Vision/min, Accounts. Sortierbar. Ein Klick auf einen Champion öffnet die gefilterte Match history.
  „Unbekannte Rolle“ (ARAM, Arena …) bekommt eine eigene Zeile. Winrate erst ab 5 Spielen, darunter grau.
- **Champion-Übersicht im Stil von op.gg** (eigener Unterreiter „Champions“; Screenshot im Anhang): eine schlichte
  Liste, eine Zeile pro Champion.
  - Oben ein Auswahlfeld für die Queue: **Ranked (Solo + Flex)** als Standard, dazu Solo/Duo, Flex, Normal, ARAM,
    Alle. Daneben Season (aktuelle Season als Standard) und Account(s).
  - **Erste Zeile „Alle“** mit den Werten über alle Champions, darunter die Champions nach Anzahl Spiele sortiert.
  - **Pro Zeile:** Champion-Bild und Name, darunter **Ø CS (CS/min)**. In der Mitte **KDA als „2,23 : 1 KDA“** und
    darunter **Ø K / D / A**. Rechts die **Winrate** und darunter die **Anzahl Spiele**.
  - Dezente Farbe nur, wo sie etwas sagt (z. B. Winrate ≥ 60 % grün, KDA ≥ Stark-Schwelle aus den Tags). Keine Farbe
    unter 5 Spielen.
  - Zuerst die Top 8, dann **„Mehr anzeigen + frühere Seasons“**: öffnet die volle Liste mit Season-Auswahl (Seasons
    aus den gespeicherten Spielen, siehe Phase 8). Sortierbar nach Spielen, Winrate, KDA, CS.
  - Ein Klick auf eine Zeile öffnet die Match history, gefiltert auf diesen Champion.
  - Dieselben Zahlen wie in der Rollen-Tabelle (aus `ui/stats.js`), nur anders dargestellt.
- **Fertig, wenn:** die Zeilen und die Leiste dieselben Summen ergeben und die Rollenwerte aus den Spielen kommen.

### Phase 4 – Tag-Engine + Tags für eigene Accounts
- `ui/tags.js` + `ui/tag-rules.js` bauen, mit **allen** Tags aus Abschnitt 5. Grundlage ist die gesamte lokale
  Historie, für Stufe C alle gespeicherten Timelines. Fehlende Spieldaten und Timelines eigener Spiele im Hintergrund
  nachladen, wenn League läuft (langsam, max. 2 parallel, abbrechbar).
- Aktivitäts-Tags (Serien, „Wieder da“, „Dauerzocker“) schauen auf die letzten Tage. Spielstil-Tags nutzen alle
  Ranked-Spiele der aktuellen Season, damit uralte Spiele nicht als „aktuell“ gelten.
- **Alle Tags auch in der Overview** (eigener Unterreiter „Tags“): je Account und zusammen über alle Accounts, damit
  man sofort sieht, wo man heraussticht. Oben **„Deine Stärken“** (Meister/Stark) und **„Baustellen“**
  (Schwach/Sehr schwach) als Chips, darunter alle Tags nach Gruppen. Ein Klick auf einen Chip zeigt die Begründung:
  Wert, Schwelle, Anzahl Spiele, Zeitraum, Stand.
- **Konflikte und Reihenfolge:** siehe Abschnitt 5.4. **Ausprägungen** (Meister/Stark/Schwach/Sehr schwach) siehe 5.1.
- **Hysterese:** Ein Tag verschwindet erst, wenn der Wert 5 % unter die Schwelle fällt. Sonst flackert er.
- **Fertig, wenn:** jeder Tag seine Zahlen zeigt, „zu wenig Daten“ nie als „nicht erfüllt“ erscheint und eine
  Schwelle sich an genau einer Stelle ändern lässt.

### Phase 5 – Live-Übersicht im Porofessor-Stil
**Daten:** über den lokalen Client. Die App lädt heute schon Match-Listen und Ränge für beliebige PUUIDs
(`match_list`, `player-ranks`). Der Client hat pro Spieler die Match-Liste, die vollständigen Spieldaten und die
Timeline eines Spiels. Im Code zu klären:
- **Wie weit die Match-Liste zurückreicht** (`begIndex`/`endIndex` hochzählen, bis nichts mehr kommt). Geladen wird
  **so weit, wie der Client liefert**, ohne Spiel-Limit. Neueste zuerst, damit die Karte schnell etwas zeigt.
- In der Match-Liste stehen nur die Werte des Spielers selbst. Kill-Beteiligung und Schadensanteil brauchen die
  vollständigen Spieldaten (Stufe B), Lane-Werte die Timeline (Stufe C). **Alle Stufen für alle Spiele**, nach
  Priorität geladen: erst A für alle 10 Spieler, dann B, dann C, jeweils neueste Spiele zuerst. Die Karten füllen
  sich laufend. Unter jedem Tag steht, auf wie vielen Spielen er beruht.
- **Wer sichtbar ist:** wie die Live-Seite heute. Im Champ Select nur, wen der Client zeigt; ab Ladebildschirm und im
  Spiel alle 10. Verborgene Namen werden nie aufgedeckt.
- **Ladeplan (feste Regel: im laufenden Spiel keine Abfragen):**
  - **Champ Select:** Verbündete laden, sobald sie bekannt sind.
  - **Ladebildschirm:** **volle Kraft**, alles, was geht, ohne es zu übertreiben (z. B. 4–6 Anfragen gleichzeitig,
    Pause bei Fehlern/Rate-Limit). Reihenfolge: erst Stufe A für alle 10, dann B, dann C, jeweils neueste Spiele
    zuerst.
  - **Sobald das Spiel wirklich läuft: sofort stoppen**, keine einzige Abfrage mehr. Prüfe, wie sich „Ladebildschirm
    vorbei“ zuverlässig erkennen lässt (z. B. Spielzeit > 0 aus der lokalen Live Client Data API, oder die
    Erkennung, die die App schon hat). Die Karten zeigen bis dahin, was geladen ist, und sagen, auf wie vielen
    Spielen ein Wert beruht.
  - **Nach dem Spiel:** den Rest für diese 10 Spieler nachladen (für das nächste Treffen und die Statistiken).
  - Spieldaten und Timelines landen im dauerhaften Spieldaten-Speicher (siehe Speicher-Messung), Listen werden
    30 Min. gecacht. Ein zweites Spiel mit denselben Spielern lädt fast nur aus dem Speicher.
- **Speicher-Messung vor der Entscheidung:** Bevor fremde Spiele dauerhaft gespeichert werden, miss an echten Daten,
  wie groß pro Spiel sind: Eintrag der Match-Liste, vollständige Spieldaten, Timeline, jeweils roh und komprimiert.
  Rechne hoch auf 1.000 / 10.000 / 100.000 Spiele und leg mir das im Bericht vor, mit den Optionen „roh speichern“,
  „komprimiert speichern“ und „nur berechnete Kennzahlen pro Spiel speichern“. **Ich entscheide danach.** Bau die
  Kennzahlen-Berechnung pro Spiel deshalb von Anfang an getrennt vom Rohdaten-Speicher, damit jede Option geht.
- **Speicherlimit (Einstellungen → Daten):** Standard **unbegrenzt**. Der Speicherverbrauch steht in den
  Einstellungen (eigene und fremde Spiele getrennt).
  - Überschreitet der Speicher **zum ersten Mal 1 GB**, kommt eine Meldung (einmalig, nicht nervig) mit den Optionen:
    **Komprimieren** · **Ältere fremde Spiele löschen** · **Eigenes Limit festlegen** (z. B. 2 GB) · **Unbegrenzt
    lassen**.
  - Ist ein Limit gesetzt, löscht die App laufend die **ältesten fremden Spiele**, sobald es überschritten ist.
    **Eigene Spiele werden nie automatisch gelöscht**, nur über den bestehenden Löschknopf.
  - Berechnete Kennzahlen und Tags von gelöschten Spielen bleiben erhalten, wenn die Option „nur Kennzahlen“
    gewählt ist. Sonst fallen sie mit weg, und die Karte zeigt die kleinere Anzahl Spiele.

**Anordnung:** zwei Reihen (eigenes Team, Gegnerteam), in jeder Reihe von links nach rechts **Top, Jungle, Mid, ADC,
Support**, so dass sich die Lane-Gegner genau gegenüberstehen. Position aus den Spieldaten des Clients. Fehlt sie
(z. B. in Normals), wird sie geschätzt: Smite → Jungle, dann Champion-Rolle und Hauptrolle des Spielers. Eine
geschätzte Position ist am Rollen-Symbol erkennbar (blasser, Tooltip „geschätzt“). ARAM/Arena: Reihenfolge wie im
Client.

**Karte pro Spieler** (Teamfarbe oben wie bei Porofessor):
- Kopf: Icon, Riot-ID, Level.
- Links: gespielter Champion dieses Spiels mit Ø K/D/A und Mastery-Punkten (falls lesbar).
- Rechts: **Solo/Duo- und Flex-Rang** mit Emblem, LP und Season-Siege/Niederlagen aus den Rangdaten. Keine
  Ladder-Platzierung, die gibt es lokal nicht.
- **Hintergrund der Karte in der Farbe des Solo/Duo-Rangs** (Eisen bis Challenger), damit man die Ränge beider Teams
  auf einen Blick erfasst. **Als Tönung nach innen**, z. B. ein Verlauf von den Rändern zur Mitte oder ein innerer
  Schein (`box-shadow: inset …`), dezent statt vollflächig knallig. **Keine Umrandung:** Der Rand der Karte ist für
  die Premade-Anzeige reserviert, beides muss gleichzeitig klar erkennbar sein. Text bleibt gut lesbar
  (Kontrast prüfen, hell und dunkel). Ungewertet/unbekannt: neutraler Hintergrund. Die Rang-Farben einmal zentral
  festlegen und überall wiederverwenden (auch Overview/LP-Bänder, falls dort schon Farben existieren).
- Zwei Kreise:
  - **Winrate mit diesem Champion** im erfassten Zeitraum, mit Spielen und Siegen, z. B. „62 % · 34 Spiele · 30 Tage“.
    Das ist die **einzige** Winrate auf der Karte.
  - **Hauptrolle** (häufigste Position) mit Rollen-Symbol und Anteil.
- Darunter die Tags (Farben wie im Katalog). Bei mehr als 5 Tags: „+n“.
- **Schalter oben im Live-Tab: „Tags: kurz / genau“** (wird gemerkt).
  - **Kurz:** „Stark mit Yorick“. Fährt man mit der Maus darüber, zeigt der Tooltip den genauen Text.
  - **Genau:** der ausführliche Text mit Zahlen direkt im Chip: „68 % Winrate mit Yorick in den letzten 60 Spielen“.
    Die Kartengröße ändert sich dadurch nicht.
- **Alle 10 Karten sind immer ganz zu sehen**, ohne die Seite zu scrollen. Die Karten passen sich der Fenstergröße
  an. Oben in der Karte bleibt fest: Icon, Name, Champion, Ränge, Kreise. Nur der **Tag-Bereich darunter scrollt
  innerhalb der Karte**, wenn der Platz nicht reicht. Dezente Scrollleiste, erst beim Hover sichtbar, und ein leichter
  Ausblend-Verlauf unten zeigt, dass mehr kommt. „+n“ entfällt dann. Wichtigste Tags oben (Priorität aus der
  Tag-Auswahl).
- Ladezustände: Platzhalter, nichts springt. Fehler zeigen „keine Daten“, die Karte bleibt.
- **Fortschrittsbalken** oben in der Live-Ansicht: Stufe und Menge, z. B. „Spieldetails · 84 / 312 Spiele“. Dazu
  pro Karte ein dünner Balken, wie weit dieser Spieler geladen ist. Wenn alles da ist, wird er ausgeblendet.

**Fertig, wenn:** im Ladebildschirm/Spiel 10 Karten erscheinen, Stufe A in wenigen Sekunden steht und B/C nachkommen,
ein zweites Spiel mit denselben Spielern fast nur aus dem Speicher lädt und die Live-Seite ohne Spiel unverändert ist.

### Phase 5b – Mehr Live-Infos (Ziel: der Live-Tab als feste Infoquelle auf dem zweiten Bildschirm)

**Ansicht wechselt automatisch mit der Spielphase:** Lobby → Champ Select → Ladebildschirm/Spiel → Nach dem Spiel,
ohne Klick. Das gilt nur innerhalb des Live-Tabs, ein anderer offener Tab wird nicht gewechselt. Die bestehende
**Nach-dem-Spiel-Übersicht bleibt stehen, bis der nächste Champ Select beginnt**: Lobby und Warteschlange lassen sie
stehen.

**Was hat sich geändert (in der Nach-dem-Spiel-Übersicht):** Die Tags des eigenen Accounts vor und nach diesem
Spiel im Vergleich, als kleine Zeile mit Chips:
- Tag mit Chevron: **▲ grün**, wenn besser geworden (neu erreicht, höhere Ausprägung oder Wert in die gute Richtung),
  **▼ rot**, wenn schlechter (verloren, niedrigere Ausprägung, Wert in die schlechte Richtung).
- Tooltip mit der Änderung: „CS/min 7,8 → 8,1“, „Neu: Heißer Lauf“, „Weg: Starke KDA (3,0 → 2,9)“.
- Nur Tags, die sich wirklich geändert haben, höchstens eine Zeile. Hat sich nichts geändert, entfällt die Zeile.

**Champ-Select-Helper passt sich der Phase an:**
- **Kein Spiel / Lobby / Warteschlange:** als einklappbarer Bereich „Champion-Pool“ zum Einrichten des Pools (Zustand
  wird gemerkt). Neben einer stehenden Nach-dem-Spiel-Übersicht nimmt er wenig Platz ein.
- **Champ Select:** voll aufgeklappt mit Gegner-Picks und Empfehlungen.
- **Ladebildschirm und Spiel:** ausgeblendet, dort gehört der Platz den 10 Spielerkarten.
- Das Vorladen der Matchups während der Warteschlange bleibt im Hintergrund erhalten.

**Schadensverteilung der Teams (wichtigste Info dieser Phase):** Pro Team ein Balken AD / AP / True, z. B.
„Gegner: 72 % AD · 24 % AP · 4 % True“. Steht vor allem das Gegnerteam deutlich im Blick.
- Ab Champ Select, sobald Champions gewählt sind (Champions sind dort sichtbar, Namen nicht nötig).
- **Quelle:** Wenn für den Spieler genug Spiele auf diesem Champion geladen sind, sein echter Schaden aus diesen
  Spielen (physisch/magisch/true an Champions). Sonst ein Durchschnitt für den Champion aus allen gespeicherten Spielen.
  Sonst die Schadensart aus den Champion-Daten (CommunityDragon). Im Tooltip steht, woher der Wert kommt.
- Bei deutlichem Übergewicht (≥ 65 %) ein kurzer Hinweis wie „Viel AD – Rüstung lohnt sich“. Neutral formuliert,
  keine Build-Empfehlung.

**Premade-Erkennung (ab Ladebildschirm, erst dort sind alle Namen sichtbar):**
- Aus den schon geladenen Match-Listen: Zwei Spieler im selben Team gelten als **Premade**, wenn sie im geladenen
  Zeitraum **mindestens 2 frühere Spiele im selben Team** hatten (gleiche Spiel-ID, gleiches Team in beiden Listen).
  Zusammen mit dem aktuellen Spiel sind das 3. Ein gemeinsames Spiel allein reicht nicht.
- **Darunter (genau 1 früheres gemeinsames Spiel)** gilt es als Zufall: keine Umrandung, sondern ein Hinweis-Tag wie
  bei „Kenne ich den?“, **ohne Namen** (der steht schon auf der Karte). Der andere Spieler wird über seinen
  Champion **in diesem Spiel** genannt, und der Tag steht auf beiden Karten: z. B. auf der Karte von Ahri „Mit Darius:
  letztes Spiel im Team“, auf der Karte von Darius „Mit Ahri: letztes Spiel im Team“. Bei einem früheren Gegner
  entsprechend „… als Gegner“. Das gilt für
  **alle Paare in der Lobby**: Teammates, die zufällig wieder zusammen sind, ebenso wie Spieler, die sich vorher
  als Gegner hatten. Tooltip mit Datum, Champions und Ergebnis.
- **Darstellung: farbige Umrandung um die Karten**, sodass man auf einen Blick sieht, wer zusammen spielt. Jede Party
  bekommt eine eigene Farbe (max. 2 Parties pro Team möglich, z. B. Violett und Türkis). Die Farben dürfen nicht mit
  Teamfarbe oder Tag-Farben (grün/orange/rot) verwechselbar sein.
  - **Nebeneinander** liegende Party-Karten (z. B. ADC + Support) bekommen **eine gemeinsame Umrandung** um beide.
  - **Nicht nebeneinander** liegende (z. B. Top + Support, Jungle + ADC) bekommen jeweils eine Umrandung in derselben
    Party-Farbe, dazu oben ein kleines Kettensymbol mit Nummer („⛓ 1“). Fährt man mit der Maus über eine Karte, werden
    die Partner hervorgehoben.
  - Tooltip: „Party mit Name#TAG · zusammen in 5 der letzten 20 Spiele, zuletzt vor 2 Std.“.
  - Die Umrandung darf das Layout nicht verschieben (z. B. `outline` oder Schatten statt `border`).
- Braucht nur Stufe A, ist also früh fertig.

**„Kenne ich den?“ (ab Ladebildschirm):**
- Jeder der 10 Spieler wird mit **allen gespeicherten Spielen aller eigenen Accounts** abgeglichen.
- **Als eigener Tag** auf der Karte (neutrale Farbe, z. B. Blau), kurz und klar, bezogen auf das **letzte gemeinsame
  Spiel**: „Letztes Spiel: Gegner (Kennen)“ bzw. „Letztes Spiel: Team (Kennen)“. Liegt es weiter zurück:
  „Gestern: Gegner (Kennen)“, „Vor 3 Tagen: Team (Ahri)“.
- **Ausführlicher Tooltip:** „Letztes Spiel gegen dich: Kennen Top · 1/1/0 · Sieg für dich · gestern 21:14 · auf
  Account Main#EUW“. Darunter, falls mehr: „Insgesamt 3× getroffen: 2× Gegner (1 S / 1 N), 1× Team (1 S)“ mit Liste
  (Datum, dein Account, beide Champions, KDA, Ergebnis).
- Ein Klick auf den Tag öffnet das Spiel in der Match history.
- Läuft rein lokal und sofort, ohne zusätzliche Abfragen.

**Deine Bilanz gegen den Gegner-Champion (auf der eigenen Karte, ab Ladebildschirm):**
- Aus allen gespeicherten Spielen aller eigenen Accounts: Bilanz gegen den Champion des Lane-Gegners, z. B.
  „Gegen Darius: 7–3 · 70 %“, wenn möglich auf deinem aktuellen Champion, sonst über alle deine Champions (dann so
  beschriftet).
- Ist der Lane-Gegner nicht eindeutig, steht die Bilanz gegen alle 5 Gegner-Champions im Tooltip.

### Phase 6 – Spielstilprofil gegen den Lane-Gegner (Radar)
- **Vergleichsbasis:** der direkte Lane-Gegner in jedem Spiel, aus den gespeicherten Spieldaten. Lane-Gegner = gleiche
  Position im anderen Team. Ohne eindeutige Position (ARAM, Arena, unklar) zählt das Spiel nicht mit.
- **Achsen (5–6):** Farm (CS/min), Schaden (Champion-Schaden/min), Kill-Beteiligung, Vision (Vision/min),
  Überleben (Tode), Lane-Phase (CS- oder Gold-Differenz bei 15 Min., Stufe C), optional Turmschaden.
- **Wert je Achse:** eigener Wert ÷ Wert des Gegners, gemittelt über die Spiele. 100 % ist die Mitte und heißt
  „gleich gut wie der Gegner“. Bei Toden umgekehrt (weniger ist besser). Im Tooltip stehen beide Rohwerte und die
  Anzahl Spiele: „Farm 112 % · Ø 7,8 vs. 7,0 CS/min · 186 Spiele“.
- Filter wie die Overview (Account(s), Rolle, Champion, Queue). Rollen werden nicht gemischt. Ohne Rollenfilter wird
  die Hauptrolle genommen.
- Achsen mit zu wenig Spielen (< 10) sind gestrichelt und ohne Wert, nicht 0. Aus der Fläche wird kein Gesamtwert
  gebildet. Daneben dieselben Werte als Balkenliste.
- Zu sehen in der Overview und im Profil eines Spielers in Live (wenn genug Spiele geladen sind).

### Phase 7 – Trends und Bestwerte
- **Trends:** Winrate und eine wählbare Kennzahl über die letzten 10/20/50/100 Spiele, jeweils gegen den gleich langen
  Zeitraum davor.
- **Bestwerte:** Die vorhandenen Rekorde bekommen einen Geltungsbereich: „Bestwert in 1.240 gespeicherten
  Ranked-Spielen“, nie „Allzeitrekord“. Modi werden getrennt (ARAM ≠ Summoner's Rift).

### Phase 8 – Frühere Ranked-Seasons (prüfen, dann bauen)
Ziel: frühere Seasons der eigenen Accounts sehen, also Rang und, wo möglich, Spiele/Siege/Niederlagen.
- Prüfe, was der Client zu früheren Seasons liefert: Rangdaten (`lol-ranked`, z. B. Rang am Ende der letzten Season,
  höchster Rang), Profil- und Banner-Daten. Zeige alles, was verlässlich ist, als Season-Leiste je Account
  („S2024-1 Gold · S2024-2 Platin …“).
- Aus der lokalen Match-Speicherung je Season: analysierte Ranked-Spiele, Siege, Winrate. Klar gekennzeichnet als
  „aus gespeicherten Spielen“.
- **Eigene Eingabe:** Pro Account lassen sich frühere Seasons von Hand eintragen oder als Text einfügen
  (Season, Queue, Rang, Siege, Niederlagen), mit Vorschau wie beim Bulk-Add. Diese Einträge werden getrennt
  gespeichert und als „selbst eingetragen“ markiert. Sie werden nie mit gespeicherten Spielen zusammengezählt.
- **OP.GG MCP-Server (nur prüfen, nicht einbauen):** OP.GG betreibt einen offiziellen MCP-Server
  (`https://mcp-api.op.gg/mcp`, u. a. `lol_get_summoner_profile`). Prüfe, ob er frühere Seasons liefert und unter
  welchen Bedingungen eine App ihn nutzen darf. Ergebnis im Bericht. Eingebaut wird er nur, wenn die Nutzung
  ausdrücklich erlaubt ist und ich zugestimmt habe.
- Kein Scraping von op.gg (siehe Abschnitt 2).

## 5. Tag-Katalog (Startwerte in `ui/tag-rules.js`)

Startwerte, die später angepasst und ergänzt werden. Die Engine muss neue Tags **nur über Einträge in
`tag-rules.js`** aufnehmen können. Jeder Eintrag hat einen **Kurznamen** und einen **genauen Text** mit
Platzhaltern (für den Schalter „kurz / genau“). Kurznamen sind eigene, keine 1:1-Kopien von Porofessor/Mobalytics,
und werden übersetzt; in der Tabelle steht deutsch / englisch.

**Grundlage:** **nur Ranked-Spiele** (Solo/Duo und Flex) zählen für Tags. Normals, ARAM, Arena usw. werden für
Tags ignoriert (auch wenn das aktuelle Live-Spiel ein Normal oder ARAM ist). Ausnahmen: Mastery-Tags und „Smurf?“,
die nicht auf Spielen beruhen. Eigene Accounts = gesamte lokale Ranked-Historie; Live = alle Ranked-Spiele, die der
Client liefert. „Ø“ = Mittel über die Spiele, ohne Remakes.

**Rollen:** Kennzahlen-Tags werden **pro Rolle** berechnet, aus den Spielen auf dieser Rolle (Position im jeweiligen
Spiel). Jeder Eintrag in `tag-rules.js` hat ein Feld `roles` (für welche Rollen er gilt) und kann Schwellen pro Rolle
haben. Was für eine Rolle normal ist (z. B. wenig Schaden oder Farm beim Support), wird für diese Rolle **nicht**
bewertet. Angezeigt werden die Tags der Rolle, die der Spieler gerade spielt (Live) bzw. seiner Hauptrolle
(Overview). **Stufe:** A = Match-Liste, B = vollständige Spieldaten, C = Timeline, M = Mastery,
L = Live-Daten des aktuellen Spiels/Champ Selects.

### 5.1 Ausprägungen (Stufen eines Tags)

Viele Tags messen eine Kennzahl, die gut oder schlecht ausfallen kann. Solche Tags haben **Ausprägungen** statt
getrennter Einzel-Tags. Pro Kennzahl wird höchstens eine Ausprägung angezeigt.

| Ausprägung | Bedeutung | Farbe | Beispiel (Farm) |
|---|---|---|---|
| Meister / Master | sehr stark | kräftiges Grün + ★ | „Farm-Meister“ |
| Stark / Great | stark | grün | „Guter Farmer“ |
| Schwach / Weak | schwach | orange | „Schwacher Farmer“ |
| Sehr schwach / Terrible | sehr schwach | rot | „Farm-Problem“ |

- In `tag-rules.js` als Liste von Schwellen pro Kennzahl, z. B. `farm: { great: 8, master: 9.5, weak: 5.5,
  terrible: 4.5 }`. Nicht jede Kennzahl braucht alle vier.
- Die Werte unten in **Klammern mit „V“** sind Vorschläge von mir, die ich zuhause noch festlege. Lege sie so an,
  übernimm sie unverändert und markiere sie im Code mit `// TODO Schwelle prüfen`.

### 5.2 Begriffe (zentral in `ui/stats.js` definiert)

- **Solo-Kill:** Kill an einem Champion, bei dem es **keine Assists** gab (Timeline-Event ohne
  `assistingParticipantIds`), der Killer ist ein Champion.
- **Solo-Tod:** umgekehrt, man stirbt einem einzelnen Gegner ohne Assists. **Gank-Tod:** Tod mit mindestens einem
  Assist der Gegner.
- **Duell:** Solo-Kill oder Solo-Tod. **Duell-Quote** = Solo-Kills ÷ (Solo-Kills + Solo-Tode).
- **Farm-Anteil (Zeitraum):** eigene CS (Minions + Monster) im Zeitraum ÷ CS des eigenen Teams im Zeitraum.
- **Hauptrolle:** Position mit ≥ 60 % der Spiele (mind. 10 Spiele), sonst keine.
- **„Tag“ für „Aufgewacht“:** Tagesgrenze 0:00 Uhr Ortszeit des Nutzers.
- **Erfolgreicher Gank (Jungle):** Kill vor 14:00, an dem der Jungler als Killer oder mit Assist beteiligt ist und
  dessen Opfer ein gegnerischer **Laner** ist (nicht der gegnerische Jungler).

### 5.3 Katalog

**Champion & Pool**

| Tag (de / en) | Farbe | Bedingung | Min. | Stufe | Genauer Text (Beispiel) |
|---|---|---|---|---|---|
| OTP {Champ} / {Champ} OTP | grün | ≥ 80 % der Spiele mit einem Champion | 15 | A | „40 von 48 Spielen mit Urgot“ |
| {Champ}-Main / {Champ} Main | grün | > 10 Spiele mit dem Champion in den letzten 60 Tagen (mehrere möglich; nicht wenn OTP auf demselben) | – | A | „14 Spiele mit Urgot in 60 Tagen“ |
| Stark mit {Champ} / Great with {Champ} | grün | ≥ 6 Spiele, Winrate ≥ 60 % | 6 | A | „68 % Winrate mit Yorick in 60 Spielen“ |
| Neu auf {Champ} / New to {Champ} | orange | nur Live, **beides** muss zutreffen: ≤ 2 Ranked-Spiele mit dem gespielten Champion in 30 Tagen **und** Mastery < 20k. Ist die Mastery nicht lesbar, kein Tag | – | A+M+L | „1 Spiel mit Kennen in 30 Tagen, 8.420 Mastery-Punkte“ |
| Flexibler Pool / Flexible pool | blau | ≥ 5 verschiedene Champions **und** keiner > 50 % der Spiele | 15 | A | „9 Champions, häufigster Ahri mit 28 %“ |
| Generalist / Generalist | blau | keine Rolle > 66 % der Spiele | 15 | A | „Top 34 %, Mid 30 %, Jungle 22 % …“ |
| Main geklaut / Main taken | orange | Champ Select/Spiel: Main oder OTP-Champion dieses Spielers wurde **vom Gegner gepickt** | – | A+L | „Spielt sonst Urgot (14 Spiele) – Gegner hat ihn gepickt“ |
| Main gebannt / Main banned | orange | Main oder OTP-Champion dieses Spielers wurde **gebannt** | – | A+L | „Spielt sonst Urgot (14 Spiele) – gebannt“ |
| Autofill? / Autofilled? | orange | Live-Position ≠ Hauptrolle (nur wenn die Position vom Client kommt, nicht geschätzt) | 10 | A+L | „Spielt sonst Top (78 %), jetzt Support“ |

**Aktivität & Form**

| Tag (de / en) | Farbe | Bedingung | Min. | Stufe | Genauer Text (Beispiel) |
|---|---|---|---|---|---|
| Heißer Lauf / Hot streak | grün | ≥ 3 Siege in Folge (lückenlos) | 3 | A | „5 Siege in Folge“ |
| Pechsträhne / Losing streak | rot | ≥ 3 Niederlagen in Folge (lückenlos) | 3 | A | „4 Niederlagen in Folge“ |
| Wieder da / Back again | orange | letzte Pause ≥ 14 Tage, endete in den letzten 3 Tagen | 1 | A | „21 Tage Pause bis gestern“ |
| Aufgewacht / Just woke up | orange | aktuelles Spiel ist das erste des Tages | – | A+L | „Erstes Spiel heute“ |
| Ranked-Grinder / Ranked grinder | blau | ≥ 50 Ranked-Spiele in 30 Tagen | – | A | „63 Ranked-Spiele in 30 Tagen“ |
| Smurf? / Smurf? | orange | Beschwörer-Level < 100 | – | A | „Erst Level 43“ |

**Kennzahlen mit Ausprägungen** (Stark-Schwelle vom Nutzer, die anderen Ausprägungen sind Vorschläge V)

| Kennzahl → Tag (de / en) | Bedingung | Ausprägungen | Min. | Stufe | Genauer Text (Beispiel) |
|---|---|---|---|---|---|
| Farm → Farmer | Ø CS/min, nicht Support/ARAM | Stark ≥ 8,0 · Meister (≥ 9,5 V) · Schwach (≤ 5,5 V) | 10 | A | „Ø 8,6 CS/min in 22 Spielen“ |
| Früh-Farm → Early Farmer | Ø CS bei 15 Min., nicht Support | Stark > 120 · Meister (> 140 V) · Schwach (< 85 V) | 6 | C | „Ø 131 CS bei 15 Min.“ |
| Schaden → Damage Dealer | Ø Champion-Schaden/min, nicht Support | Stark > 800 · Meister (> 1.100 V) · Schwach (< 450 V) | 10 | A | „Ø 912 Schaden/min“ |
| KDA → Starke KDA / Great KDA | KDA über die Summen | Stark ≥ 3,0 (Support ≥ 4,0) · Meister ≥ 4,0 (Support ≥ 5,0) · Schwach < 1,6 (Support < 2,5) | 10 | A | „KDA 3,4 in 31 Spielen“ |
| Tode → Überlebenskünstler / Wackelig | Ø Tode | Stark ≤ 3,0 · Sehr schwach (rot) ≥ 7,0 | 10 | A | „Ø 2,4 Tode“ / „Ø 7,8 Tode“ |
| Sicht → Gute Sicht / Good vision | Ø Vision/min | Stark ≥ 1,0 (Support ≥ 2,0) · Meister (≥ 1,5 / Support ≥ 2,8 V) · Schwach (< 0,5 / Support < 1,3 V) | 10 | B | „Ø 2,6 Vision/min“ |
| Lane-CS → Lane-Tyrann / Verwundbar | Ø CS-Differenz bei 15 Min. gegen den Lane-Gegner, nicht Support | Stark ≥ +15 · Meister (≥ +25 V) · Sehr schwach ≤ −15 | 6 | C | „Ø +28,8 CS bei 15 Min. in 8 Spielen“ |
| Lane-Gold → Früher Vorsprung / Early lead | Ø Gold-Differenz bei 15 Min. gegen den Lane-Gegner | Stark ≥ +500 · Meister (≥ +1.000 V) · Schwach (≤ −500 V) | 6 | C | „Ø +640 Gold bei 15 Min.“ |
| Early-Farm-Anteil → Early Game | Farm-Anteil 0–15 Min., nicht Support | Stark (> 27,5 % V) · Meister (> 32 % V) · Schwach (< 15 % V) | 6 | C | „Ø 29 % des Team-Farms bis Min. 15“ |
| Mid-Farm-Anteil → Mid Game | Farm-Anteil 15–30 Min. (nur Spiele ≥ 25 Min.), nicht Support | Stark > 27,5 % · Meister (> 32 % V) · Schwach (< 15 % V) | 6 | C | „Ø 30 % des Team-Farms von Min. 15–30“ |

**Kampf & Spielweise**

| Tag (de / en) | Farbe | Bedingung | Min. | Stufe | Genauer Text (Beispiel) |
|---|---|---|---|---|---|
| Überall dabei / Team player | grün | Ø Kill-Beteiligung ≥ 65 % (Support ≥ 70 % V; Meister ab 75 %, Support 80 % V) | 10 | B | „Ø 71 % Kill-Beteiligung in 14 Spielen“ |
| Carry / Carry | grün | Ø Schadensanteil ≥ 28 % **und** Ø KP ≥ 50 % (nicht Support) | 10 | B | „Ø 31 % des Team-Schadens, 62 % KP“ |
| Turmbrecher / Tower breaker | orange | Ø Turmschaden ≥ 10.000 | 10 | B | „Ø 16.800 Turmschaden“ |
| Solo-Kämpfer / Solo fighter | grün | Ø Solo-Kills > 2,5 pro Spiel | 6 | C | „Ø 3,1 Solo-Kills pro Spiel“ |
| Tödlicher Duellant / Deadly duelist | grün | Duell-Quote > 66 % (mind. 10 Duelle) | 6 | C | „Gewinnt 72 % seiner Duelle (18 von 25)“ |
| Unkillbar auf der Lane / Unkillable laner | grün | Ø Tode vor 10:00 < 1 | 6 | C | „Ø 0,4 Tode vor Minute 10“ |
| Gank-Opfer / Dies to ganks | rot | Ø Gank-Tode vor 15:00 > 2 | 6 | C | „Ø 2,3 Tode durch Ganks vor Minute 15“ |
| Bereit zum Kampf / Ready to rumble | orange | erster **Kill** vor 5:00 in ≥ 66 % der Spiele | 6 | C | „Erster Kill vor 5:00 in 8 von 10 Spielen“ |
| Früher Warder / Early warder | grün | ≥ 1 Ward vor 3:00 in ≥ 90 % der Spiele | 6 | C | „Ward vor Minute 3 in 19 von 20 Spielen“ |
| Keine Pinks / No pinks | rot | Ø gekaufte Kontroll-Wards < 1 pro Spiel (V), oder vor Minute 15 in ≥ 70 % der Spiele keine (V) | 10 | B/C | „Ø 0,4 Kontroll-Wards pro Spiel“ |
| Drachentöter / Dragon slayer | grün | eigenes Team holt den ersten Drachen in ≥ 66 % der Spiele | 10 | B | „Erster Drache in 14 von 20 Spielen“ |
| Erfolgreicher Ganker / Successful ganker | grün | nur Jungle: mind. 1 erfolgreicher Gank in ≥ 66,6 % der Spiele | 6 | C | „Erfolgreicher Gank in 15 von 20 Spielen“ |
| Aggressiver Jungler / Aggressive jungler | orange | nur Jungle: Ø Kills + Assists vor 15:00 > 4 | 6 | C | „Ø 5,2 Kills+Assists vor Minute 15“ |
| Passiver Jungler / Passive jungler | orange | nur Jungle: Ø Kills + Assists vor 15:00 < 2 | 6 | C | „Ø 1,4 Kills+Assists vor Minute 15“ |

**Mastery**

| Tag (de / en) | Farbe | Bedingung | Stufe | Genauer Text (Beispiel) |
|---|---|---|---|---|
| Millionär: {Champ} / Millionaire | blau | Mastery ≥ 1 Mio. | M | „1.204.331 Punkte auf Illaoi“ |
| Veteran: {Champ} / Veteran | blau | Mastery ≥ 500k | M | „612.040 Punkte“ |
| Experte: {Champ} / Expert | blau | Mastery ≥ 100k | M | „184.200 Punkte“ |

Mastery-Tags gelten in Live für den **gespielten Champion** (und den mit der höchsten Mastery). Bei den eigenen
Accounts gilt die Summe über alle Accounts, z. B. „Millionär: Illaoi (2,2 Mio. über 3 Accounts)“. Von den
Mastery-Stufen wird nur die höchste angezeigt.

### 5.4 Konflikte und Reihenfolge
- OTP schlägt Main beim selben Champion. Heißer Lauf und Pechsträhne, Unkillbar und Gank-Opfer, Aggressiver und
  Passiver Jungler schließen sich aus. Pro Kennzahl nur eine Ausprägung.
- Flexibler Pool schließt OTP aus, Generalist schließt Autofill? aus.
- „Main geklaut“, „Main gebannt“, „Autofill?“, „Neu auf {Champ}“ und „Smurf?“ stehen in Live **oben**, weil sie das
  aktuelle Spiel betreffen.
- Danach Tags zur aktuellen Rolle und zum aktuellen Champion, dann der Rest. Negative Tags werden nicht nach vorn
  gezogen.

## 6. Tests, die immer gelten

Keine Spiele · teilweise geladene Spiele · unbekannte Rolle · 0 Tode · fehlende Team-Kills · Remake ·
unvollständige Folge (keine Serie) · Spiel ohne Timeline · kein Lane-Gegner · dasselbe Spiel auf zwei Accounts ·
verschiedene Spielzahlen pro Account · Mastery nie gelesen · Spielzeit ohne Eichdaten ·
zwei Laden-Knöpfe gleichzeitig gedrückt · Spieler ohne gemeinsame Spiele (kein Premade, kein Treffer) · genau 1 gemeinsames Spiel (kein Premade, nur Hinweis) ·
Champion ohne Schadensdaten · Spiel ohne Assists-Daten in der Timeline (keine Solo-Kills zählbar) · Netzwerk- oder Client-Fehler · Account gelöscht (seine
Daten verschwinden aus allen Auswertungen) · Accountwechsel funktioniert unverändert.

## 7. Fortschritt

- [x] Prüfauftrag Champ-Select-Helper / Live (Richtlinien, counterstats.net, Mastery fremder Spieler) – 24.11.2026:
  Bericht in `docs/plans/Pruefbericht.md`. Mastery fremder PUUIDs geht; counterstats-Abruf verstößt
  wahrscheinlich gegen deren User Agreement (Vorschläge im Bericht); Registrierung im Developer Portal empfohlen.
  Nichts umgebaut, Entscheidung offen.
- [x] Phase 1 – Mastery über alle Accounts, Spielzeit-Schätzung, „Laden“-Knöpfe – 24.11.2026: Mastery jedes
  Champions wird beim Einloggen gelesen (Account-Feld `mast`, Verlauf je Account in `mastery/<puuid>.jsonl`, nur
  Änderungen). Übersicht → Unterreiter „Mastery“ (Top 5, Tabelle Champion × Account, Gesamt, Suche, Sortierung,
  Meilensteine, Spielzeit als Spanne mit Quellen in `ui/playtime-rules.js`, Eichung ab 10 Spielen zwischen zwei
  Lesungen). Ein „Laden“ für alles (Sammlung, Übersicht, Account-Panel), ein gemeinsamer Fortschritt.
  Nachtrag 24.11.: Spielzeit auf Wunsch als ein Wert statt Spanne – Punkte ÷ 850 (Mitte aus ~500 vor und ~1.200
  nach dem Umbau) × (Spiellänge + 7 Min. für Suche, Champ Select, Laden, Spielende); eigene Spiellänge ab 10
  gespeicherten Spielen. Oben Gesamt-Mastery und Gesamtspielzeit. Eichung entfernt. Alle „Laden“-Knöpfe gleich.
  Sammlung zählt statt Shards: Chromas, Wardskins, Profilbilder, Emotes, Finisher, Runenseiten.
  Offen: „meistgespielt“ bleibt in der Match history (nicht doppelt in der Mastery-Ansicht).
- [x] Phase 2 – Kennzahlen an einer Stelle + „Letztes Spiel“ – 24.11.2026: `ui/stats.js` (KDA, KP, CS/min,
  Schaden/min, Vision/min, Schadensanteil, Winrate, Remakes, Zählweise je Spiel / je Teilnahme, Gruppierung).
  Match history (Zusammenfassung, Zeilen, Vergleich), Nach-dem-Spiel-Tabelle, Overview und Kacheln rechnen damit;
  Vorher/Nachher-Test (`test/fixtures/summary-before.json`) bleibt gleich. Einzige sichtbare Änderung: KP ohne
  Team-Kills zeigt „–“ statt „0 %“. „Letztes Spiel“ kompakt auf Live (ohne Spiel/Nach-dem-Spiel) und im
  Account-Panel, Klick öffnet es in der Match history. Hinweis: Die bisherige Zusammenfassung zählt ein Spiel
  zweier eigener Accounts einmal (erster Account) – so gelassen, damit die Zahlen gleich bleiben; für Leistung je
  Teilnahme gibt es `byParticipation` (ab Phase 3 genutzt).
- [x] Phase 3 – Overview: Kennzahlenleiste + Rollen-/Champion-Tabelle – 24.11.2026: Übersicht → Unterreiter
  „Leistung“ (Filter Account/Queue/Zeitraum/Rolle, Satz darüber, Leiste mit 8 Kennzahlen, Rollen-Tabelle zum
  Aufklappen, sortierbar) und „Champions“ (op.gg-Stil: „Alle“, Top 8, dann alle mit Sortierung). Rechnen in
  `ui/perfmath.js`, Positionen jetzt `Stats.roles`, Zeitfilter `MatchFilter.rangeBounds`. Ein Klick öffnet die
  Match history mit Account, Queue, Zeitraum und Champion (die Rolle hat die Match history nicht). Season =
  Kalenderjahr, bis Phase 8 die echten Season-Grenzen bringt. Zählt jede Teilnahme eigener Accounts.
- [x] Phase 4 – Tag-Engine + Tags für eigene Accounts – Teil 1 am 24.11.2026: `ui/tag-rules.js` (alle Schwellen,
  V-Werte mit `// TODO Schwelle prüfen`), `ui/tags.js` (erfüllt / nicht erfüllt / zu wenig Daten, Ausprägungen,
  Hysterese 5 %, Konflikte, Hauptrolle ≥ 60 % ab 10 Spielen), Übersicht → Unterreiter „Tags“ (Stärken, Baustellen,
  alle Tags nach Gruppen, Klick zeigt Wert/Schwelle/Spiele/Zeitraum; je Account oder alle). Drin: alle Tags der Stufen
  A, B und M, dazu „Früher Vorsprung“ (aus dem gespeicherten Goldverlauf). Meister = Stark-Name + ★. Live-Tags
  (Neu auf, Main geklaut/gebannt, Autofill?, Aufgewacht) sind als Regeln angelegt und kommen mit Phase 5.
  Teil 2 am 24.11.2026: Spielformat 4 speichert aus der Timeline CS pro Minute, alle Kills mit Assists, die erste
  Ward je Spieler und das Team des ersten Drachen (~2 KB mehr pro Spiel, geschätzt; ältere Spiele lädt die App wie
  bisher nach, 4 pro Durchgang bei offenem Fenster; ersetzte Zeilen räumt sie beim Start weg). Begriffe aus 5.2 in
  `ui/stats.js`; alle Stufe-C-Tags und „Drachentöter“ drin. Am echten Client geprüft: Kill- und Drachen-Ereignisse
  passen; **Ward-Ereignisse liefert die Client-Timeline nicht** – „Früher Warder“ ist deshalb aus (`off` in
  `tag-rules.js`), bis eine Quelle sie hat.
- [x] Speicher-Messung (vor dem dauerhaften Speichern fremder Spiele) – gemessen 24.11.2026, Bericht in
  `docs/plans/Speichermessung.md` (App-Format 4: ~10 KB pro Spiel, gzip ~4 KB; Match-Liste des Clients nur ~20 Spiele
  pro Spieler) – Entscheidung 24.11.: „weitermachen“ → Empfehlung übernommen: App-Format 4 in eigenem Ordner.
- [x] Speicherlimit in den Einstellungen – 24.11.2026: System & Daten zeigt eigene und fremde Spiele getrennt (Größe,
  Anzahl, Löschen für fremde); Limit unbegrenzt/500 MB/1/2/5 GB, darüber gehen die ältesten fremden Spiele; einmalige
  Frage ab 1 GB (Limit 2 GB setzen oder unbegrenzt lassen). „Komprimieren“ gibt es nicht (App-Format 4 ist schon klein).
- [x] Phase 5 – Live-Übersicht im Porofessor-Stil – 24.11.2026: Backend-Ladeplan (`scout_loop` in main.rs, Speicher
  `matches-others`): Champ Select Verbündete (2 parallel), Ladebildschirm alle 10 (4 parallel), sobald die Live Client
  Data API eine Spielzeit > 0 meldet keine Abfrage mehr, danach der Rest; Match-Listen 30 Min. gemerkt; Spiele, die
  schon im eigenen Speicher sind, werden kopiert statt geladen. Karten in `ui/scout-view.js` (zwei Reihen nach
  Position, geschätzte Position blass, Rang-Tönung nach innen, Kreise Winrate-auf-Champion und Hauptrolle, Tags mit
  kurz/genau, Tag-Bereich scrollt, Ladebalken gesamt und je Karte). Live-Tags in `Tags.liveTags`. Am echten Spiel
  noch nicht gesehen (Ladebildschirm → Spielstart, Tempo von Stufe A).
- [x] Phase 5b – Mehr Live-Infos – 24.11.2026: Nach-dem-Spiel-Übersicht bleibt bis zum nächsten Champ Select (höchstens
  12 Std.) und zeigt die eigenen Tags vorher/nachher (▲/▼, Tooltip mit Werten, eine Zeile). Helper je Phase: ohne Spiel
  eingeklappter „Champion-Pool“ (gemerkt), Champ Select voll, im Spiel weg. Schadensverteilung AD/AP/True je Team (Champ
  Select und Spiel; Quelle Spieler → Champion-Schnitt → Schadensart von CommunityDragon, `champ-damage`; Hinweis ab
  65 %). Premades: ≥ 2 frühere Spiele im selben Team (aus den gespeicherten Spielen, Stufe B statt A – die Match-Liste
  hat keine Teams), Rahmen je Party (Violett/Magenta, nebeneinander verbunden, sonst ⛓ + Nummer, Hover hebt Partner
  hervor); genau 1 gemeinsames Spiel = Hinweis-Tag auf beiden Karten. „Kenne ich den?“ gegen alle eigenen Spiele
  (Klick öffnet das Spiel). Eigene Bilanz gegen den Champion des Lane-Gegners. Rechnen in `ui/insights.js`.
- [ ] Phase 6 – Spielstilprofil gegen den Lane-Gegner
- [ ] Phase 7 – Trends und Bestwerte
- [ ] Phase 8 – Frühere Ranked-Seasons
