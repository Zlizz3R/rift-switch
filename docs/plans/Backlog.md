# Backlog

Was noch offen ist – das Neueste oben. Erledigtes wird gelöscht (steht in der Git-Historie und in
`ui/changelog.js`), nicht abgehakt stehen gelassen. Aufgeräumt am 27.11.2026.

## Offen

### Im echten Spiel prüfen (27.11.2026)

- [ ] **Live-Laden im Spiel:** umgebaut nach dem `scout.log` des Spiels vom 27.11. (Match-Listen liefen nach 30 s ab
  und wurden nie wiederholt, 5 Spiele wurden nach zwei Timeouts aufgegeben). Gemessen: Der Client gibt Match-Listen nur
  **eine nach der anderen** heraus (20 Spiele ≈ 1,5 s, 50 ≈ 4 s, 200 ≈ 12 s), jede Spiel-Anfrage wartet so lange. Jetzt:
  eine Liste pro Runde, Gegner zuerst, im Spiel 50 statt 200 Spiele pro Liste, Listen werden wiederholt, ein Spiel
  zählt nur bei einem echten „Nein“ als fehlgeschlagen, erst Details, dann Timelines, im Spiel dasselbe Tempo, der
  Ladebildschirm weckt das Laden sofort. Im nächsten Spiel `scout.log` ansehen: Wie lange bis „all there“, kommt jede
  Liste, ruckelt das Spiel? Falls es ruckelt: `PAR_FAST` im Spiel senken (`main.rs`).
- [ ] **Streamer-Modus im Spiel** (Einstellungen → „Streamer-Modus – im Spiel“): setzt League's eigene Option
  „Spielernamen verbergen“ (`HUD.HidePlayerNames` über `/lol-game-settings/v1/game-settings`) für jeden eingeloggten
  Account. Im Spiel nachsehen, ob die Namen wirklich verschwinden.
- [ ] **Arena-Karte:** die sieben Arenen (`MapMath.ARENAS`) stammen aus 5.690 Kill-Orten von 44 Arena-Spielen anderer
  Spieler. Mit eigenen Arena-Spielen (nach „Laden“) prüfen, ob alle Orte in einer Arena landen.

### Entscheidungen des Nutzers

- [ ] **Dateien auf GitHub:** `KI-Export.cmd` (+ `tools/ai-export.js`) und `docs/plans/` sind nur für die Entwicklung
  da. Vorschlag: aus dem öffentlichen Repo nehmen (lokal bleiben sie, per `.gitignore`). Achtung: Eine andere
  Claude-Sitzung committet Backlog-Notizen – die müsste dann wissen, dass `docs/plans/` nicht mehr versioniert ist.
- [ ] **D5 – Auto-Accept und Premade-Erkennung bei Gegnern:** in den Riot-Policies nicht genannt; „Products should not
  remove game decisions“ bzw. „no game-session-specific information that would be previously unknown to the player“
  könnten beim Audit gefragt werden. Beim Registrieren die genutzten LCU-Endpunkte angeben
  (`docs/plans/LCU-Endpunkte.md`).
- [ ] **Code-Signing:** SignPath Foundation (kostenlos für Open Source) oder Azure Trusted Signing (~10 $/Monat) –
  braucht eine Bewerbung/Identitätsprüfung durch den Nutzer.
- [ ] winget-Manifest, Export als CSV.

### Daten sammeln, dann nachjustieren

- [ ] **Mastery-Punkte pro Spiel** (`ui/playtime-rules.js`: 500 vor Mai 2024, 1.200 danach): Riot nennt keine Zahlen.
  Eigene Daten nach dem Umbau (27.11.2026, nur 3 einzelne Ranked-Spiele zwischen zwei Mastery-Ständen): Sieg 1.396,
  Niederlagen 708 und 810 → bei 50 % Winrate eher ~1.050–1.100. Mit mehr Mastery-Ständen (jedes „Laden“ schreibt
  einen) nachrechnen (`mastery/<puuid>.jsonl` gegen die eigenen Spiele dazwischen) und `pointsAfter` anpassen; der
  Wert vor 2024 lässt sich so nicht prüfen.
- [ ] **Trait-Schwellen auf echte Spieler-Durchschnitte:** `node tools/tag-thresholds.js` laufen lassen; wo „real“ statt
  „model“ steht (ab 30 Spielern mit 10+ Ranked-Spielen pro Rolle), die Werte in `ui/tag-rules.js` übernehmen. Bei
  „Roamer“ (nur Top, Mid, Support) und „Invader“ (nur Jungle) nachsehen, ob die anderen Rollen dazukommen können.
- [ ] **„Ranked-Grinder“** (10 Ranked-Spiele in 7 Tagen) beobachten, ob er zu oft anschlägt.
- [ ] **„Wird erwischt“** bleibt aus (`off: true`): Die Timeline hat Positionen nur einmal pro Minute – „kein Mitspieler
  in der Nähe“ ist so nicht messbar. Erst mit einer Quelle genauer Positionen wieder an.

### Technik

- [ ] **P5 – Spiele im Fenster-Speicher:** `mh.cache` (matches-view.js) hält jedes geladene Spiel ganz im WebView; die
  Übersicht lädt dafür die ganze Historie. Besser: kompakte Zeilen für Kennzahlen, Details per LRU-Cache.
- **`panic = "abort"`:** bewusst so (kleinere Datei); jeder Panic steht vorher mit Ort und Meldung in `error.log`.
- **S2 – signierte Updates:** nicht umgesetzt (Code-Signing kostet). Der Installer wird gegen die SHA-256 aus dem
  Release geprüft – beim Download und direkt vor dem Start.

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
- **MMR-/Elo-Schätzung** – Riots Policies verbieten MMR-Rechner.
- **Chat-Funktionen** („Offline erscheinen“) und **counterstats.net abrufen** – Riots Policies.

Festgelegt: Die Account-Sortierung bleibt standardmäßig „nach Level“.
