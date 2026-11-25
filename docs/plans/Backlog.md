# Backlog

Was noch offen ist – das Neueste oben. Erledigtes wird gestrichen oder mit Datum abgehakt.

## Offen

### 1. Alle Accounts einmal neu laden (Spielformat 6) – *ich*

Seit 25.11.2026 speichert die App pro Spiel mehr aus der Timeline (Spielformat 6): XP, Jungle-CS und Positionen pro
Minute, die Orte der Kills, bei Drachen/Baron/Herald/Atakhan den Killer und wie viele Gegner draufgehauen haben.
Gespeicherte Spiele in älteren Formaten liest **Load** neu ein.

- [ ] Mit jedem Account einmal einloggen und **Load** drücken (dauert einmalig länger).
- [ ] Danach Bescheid geben – dann geht es mit Punkt 2 weiter.

### 2. Tag-Schwellen nachkalibrieren (nach Punkt 1) – *Claude*

Diese Tags haben vorläufige Schwellen aus den Rollenaufgaben, weil es noch keine Ranked-Spiele mit den neuen Daten gab:

| Tag | Kennzahl |
|---|---|
| XP-Vorsprung / XP-Rückstand | `xpDiff15` |
| Roamer | `roam` |
| Wird erwischt | `caught` |
| Objective-Dieb | `steals` |
| Invader / Wird invadet | `invade`, `invaded` |
| Objective-Jäger / Verpasst Objectives | `objPart` |

- [ ] `node tools/tag-thresholds.js` laufen lassen (nur lesend) und die Werte pro Position in `ui/tag-rules.js`
  übernehmen – nach demselben Schema wie die anderen: weak = schwächste 25 %, terrible = schwächste 10 %,
  great = bestes Drittel, master = bestes Sechstel.
- [ ] Die Kommentare „PROVISIONAL“ in `ui/tag-rules.js` entfernen.
- [ ] Prüfen, ob die Karten-Zonen (`Stats.zone`: Lanes, River, Jungle je Seite) zu echten Positionen passen – z. B.
  Stichproben von Kill-Orten gegen die Lane der Spieler.
- [ ] Prüfen, ob „Objective-Dieb“ (letzter Schlag, mehr Gegner als Mitspieler dran) in echten Spielen sinnvoll trifft.
- [ ] Prüfen, ob „Wird erwischt“ (Tod nach 15 Min., kein Mitspieler im Umkreis von 2.500, mindestens zwei Gegner)
  zu oft oder zu selten anschlägt.

### 3. Schwellen gelegentlich auffrischen – *Claude, bei Bedarf*

Alle Schwellen stammen aus den gespeicherten Ranked-Spielen der anderen Spieler (Stand 25.11.2026: 186 Spiele,
1.666 Spieler-Spiele, die eigenen Accounts herausgerechnet). Mit mehr Spielen werden sie genauer.

- [ ] Gelegentlich `node tools/tag-thresholds.js` laufen lassen und große Abweichungen übernehmen.
