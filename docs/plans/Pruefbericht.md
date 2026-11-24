# Prüfbericht vor Phase 5 (Stand 24.11.2026)

Nur Bericht – nichts wurde abgeschaltet oder umgebaut. Entscheidungen liegen bei dir.

## 1. Mastery fremder Spieler (für „Neu auf {Champ}“ und Mastery-Tags in Live)

**Geht.** Am laufenden Client geprüft (24.11., Phase „None“, also ohne Spiel):

- `GET /lol-champion-mastery/v1/{puuid}/champion-mastery` liefert für **jede PUUID** die vollständige Liste
  (getestet mit zwei Mitspielern aus dem letzten Spiel: 102 bzw. alle Champions, ~80 ms pro Abfrage).
- Felder: `championId`, `championLevel`, `championPoints`, `lastPlayTime`, `milestoneGrades` …
- Für den eingeloggten Account liefert dasselbe Endpoint dasselbe wie `local-player` (166 Champions, ~76 KB roh).
- Nicht geprüft: ob es auch im Champ Select / Ladebildschirm antwortet (sollte – es hängt nicht an der Phase).
  Wird in Phase 5 mitgeprüft.

## 2. Riot-Richtlinien

Quellen: [Riot Developer Policies – General](https://developer.riotgames.com/policies/general),
[League-Doku (Game Policy, League Client API)](https://developer.riotgames.com/docs/lol),
[Riot Support – Third-Party Applications](https://support.riotgames.com/en-us/riot/events/third-party-applications).

| Thema | Was die Richtlinien sagen | Einschätzung für Rift Switch |
|---|---|---|
| **Registrierung bei reiner LCU-Nutzung** | League-Doku: Wer die League Client API nutzt, soll im Developer Portal eine Anwendung anlegen oder bei einer bestehenden eine Notiz hinterlassen, „which endpoints you're using and how“. Die LCU ist „not officially supported“. | Rift Switch ist **nicht registriert**. Kein API-Schlüssel nötig, aber Riot erwartet eine Registrierung/Notiz. **Empfehlung:** Produkt im Developer Portal registrieren (kostenlos) und die genutzten Endpoints beschreiben. Deine Entscheidung. |
| **Spielinfos, die man sonst nicht hätte** | „Products may not provide any game-session-specific information that would be previously unknown to the player.“ Game Integrity: keine Infos „not present in the game client“, die einen Wettbewerbsvorteil geben. | Ränge, Match-Historie und Mastery sind im Client für jeden sichtbaren Spieler einsehbar → zulässig, solange nur **sichtbare** Spieler ausgewertet werden. Porofessor & Co. zeigen dasselbe. |
| **De-Anonymisierung** | „Products cannot identify or analyze players who are deliberately hidden by the game.“ | Im Champ Select sind die Gegnernamen verborgen → **Gegner erst ab Ladebildschirm**. Der Plan sieht genau das vor. Die heutige Live-Seite hält sich daran (nur sichtbare Spieler). |
| **Champ-Select-Empfehlungen** | Produkte dürfen „highlight decisions … and give multiple choices“, aber „should not remove game decisions“ / keine „Apps that dictate player decisions“. | Der Helper zeigt eine **sortierte Auswahl** aus dem eigenen Pool – das ist „multiple choices“ und zulässig. Er darf nie selbst picken/bannen (tut er nicht). |
| **Gegner-Lane-Vermutung** | Nicht ausdrücklich geregelt. | Beruht nur auf den sichtbaren Gegner-Champions (nicht auf Namen) → unbedenklich. |
| **Auto-Accept** | Nicht ausdrücklich geregelt. Support-Artikel nennt als Beispiel für Vorteile „Taking actions on your behalf (botting or scripting)“. | Grauzone. Auto-Accept verschafft keinen spielerischen Vorteil und ist in vielen Tools verbreitet, ist aber formal eine automatische Aktion. Der README-Hinweis („use at your own discretion“) bleibt sinnvoll. |
| **Im laufenden Spiel** | Keine Infos „during gameplay“, die Schlüsse für dich ziehen („Drawing conclusions for you during gameplay“). Erlaubt: „Game overlays that provide static data that is available prior to the game.“ | Der Plan (keine Abfragen im Spiel, Karten zeigen nur, was vorher geladen wurde) passt. Rift Switch hat kein Overlay. |
| **MMR/Elo** | „Prohibited alternatives include MMR or ELO calculators.“ | Bereits entfernt, bleibt draußen. Auch die Tags dürfen keinen Gesamtscore bilden (Plan: „Kein Gesamtscore“). |
| **Premade-Erkennung** | Nicht ausdrücklich geregelt. | Beruht auf öffentlich einsehbaren Match-Historien sichtbarer Spieler (ab Ladebildschirm) → gleiche Lage wie Porofessor. Grauzone, aber verbreitet. |

## 3. counterstats.net (Quelle des Champ-Select-Helpers)

- **robots.txt** ([www.counterstats.net/robots.txt](https://www.counterstats.net/robots.txt)): sperrt nur
  `/popup/`, `/cron/`, `/ajax/`, `/json/`, Admin-/Editor-Tools u. ä. – die Champion-Seiten sind **nicht** gesperrt.
- **User Agreement** ([/user-agreement](https://www.counterstats.net/user-agreement), Betreiber Critical Click
  Networks Inc., M.O.B.A. Network – derselbe Verbund wie Porofessor/League of Graphs):
  - „You may use this Web site only for your personal, noncommercial use.“
  - Ohne schriftliche Zustimmung darf man die Seite oder Teile davon nicht „modify, copy, distribute, disclose,
    retransmit, … publish“.
  - Die Daten gelten als „proprietary and confidential“ und dürfen nur wie vereinbart genutzt werden.
- **Einschätzung:** Ein automatischer Abruf durch eine öffentlich verteilte App, die die Winrates in ihrer eigenen
  Oberfläche zeigt, ist durch die robots.txt nicht verboten, **verstößt aber sehr wahrscheinlich gegen das User
  Agreement** (Weitergabe/Anzeige der Daten in einem anderen Produkt ohne Zustimmung).
- **Vorschläge:**
  1. **Eigene Daten statt fremder** (empfohlen): Winrate jedes Pool-Champions gegen den Gegner-Champion aus den
     gespeicherten Spielen (eigene + ab Phase 5 fremde Spiele aus dem Spieldaten-Speicher). Anfangs dünn, wächst aber
     mit jedem Spiel; mit „n Spiele“ dazu ehrlich.
  2. **Erlaubnis anfragen** bei counterstats (M.O.B.A. Network) – schriftliche Zustimmung würde die Nutzung decken.
  3. Als Übergang: Link „Auf counterstats.net öffnen“ statt eingebetteter Zahlen (wie bei op.gg).

## 4. Zahlen für die Spielzeit-Schätzung (Phase 1)

| Wert | Belegt | Quelle |
|---|---|---|
| Punkte pro Spiel **vor** dem Umbau (Patch 14.10, Mai 2024) | Sieg ~900–1.100, Niederlage ~100–300 → bei 50 % Winrate **~500–700** pro Spiel (Ranked Solo, Patch 13.7, ~1 Mio. Spiele, v. a. Gold) | [Jack J Gaming, 24.04.2023](https://jackjgaming.substack.com/p/mastery-a-statistical-summary-of) |
| Punkte pro Spiel **nach** dem Umbau | **Median 1.219** (146 Messungen: zwei Abfragen an verschiedenen Tagen, Punkte ÷ Spiele dazwischen) | [lolvalue.com, Stand Okt. 2026](https://lolvalue.com/lol-mastery-chart) |
| Riot selbst | Keine festen Werte veröffentlicht; Formel „(individuelle + Team-Leistung) × Premade-Bonus“ | [League Wiki – Champion mastery](https://wiki.leagueoflegends.com/en-us/Champion_mastery) |
| Ø Spieldauer Summoner's Rift | **ca. 25–32 Min.** (Tier-Durchschnitte, z. B. Gold 30:06, Diamant 27:44, Challenger 25:52) | [bo3.gg](https://bo3.gg/lol/news/this-rank-has-longest-game-time-lol), [thespike.gg](https://www.thespike.gg/league-of-legends/beginner-guides/how-long-is-a-league-of-legends-game) |
| Ø Spieldauer ARAM | **ca. 20 Min.** | [gameriv.com](https://gameriv.com/how-long-is-an-average-match-in-league-of-legends/) |

**Nicht gefunden:** belegte Ø-Spieldauern **je Season**. Die Schätzung rechnet deshalb mit der Spanne 25–32 Min. für
alle Seasons (breiter statt erfunden). Sobald die App eigene Mastery-Lesungen mit ≥ 10 Spielen dazwischen hat,
rechnet sie mit den echten Punkten pro Spiel des Accounts.

## 5. Nebenbefund für Phase 5

- Die Match-Liste (`/lol-match-history/v1/products/lol/{puuid}/matches?begIndex=…&endIndex=…`) lieferte bei
  begIndex 0/100/200/400 jeweils Antworten – wie weit sie wirklich zurückreicht, wird in Phase 5 genau gemessen.


## Nachtrag 24.11.2026 – Frühere Seasons und OP.GG-MCP-Server (Phase 8)

**Was der Client zu früheren Seasons liefert** (am laufenden Client geprüft, nur lesend,
`/lol-ranked/v1/current-ranked-stats`): pro Queue `previousSeasonEndTier/Division` (Ende der letzten Season),
`previousSeasonHighestTier/Division` (Höchststand der letzten Season) und `highestTier/Division` (Höchststand der
laufenden Season), dazu `highestPreviousSeasonEndTier` für den Account und unter `seasons` die Nummer der laufenden
Season (23) und ihr Ende. **Nichts davor**: ältere Seasons kennt der Client nicht. Die App zeigt deshalb drei getrennte
Quellen (Client, gespeicherte Spiele je Kalenderjahr, selbst eingetragen) und zählt sie nie zusammen.

**OP.GG-MCP-Server** (`https://mcp-api.op.gg/mcp`, Code: [github.com/opgginc/opgg-mcp](https://github.com/opgginc/opgg-mcp)):
- Werkzeuge für Spieler: `lol_get_summoner_profile` (Rang, Tier, LP, Winrate, Champion-Pool – die aktuelle Season),
  `lol_list_summoner_matches` (letzte Spiele), `lol_get_summoner_game_detail`. **Ein Werkzeug für frühere Seasons ist
  nicht beschrieben.**
- Der Code steht unter MIT-Lizenz – das betrifft den Code, nicht die Daten.
- Die Nutzungsbedingungen von OP.GG ([op.gg/lol/policies/agreement](https://www.op.gg/lol/policies/agreement), Stand
  14.09.2026) erlauben nur „personal, non-commercial use“ und verbieten u. a. „use automated scripts to collect
  information from or otherwise interact with the Services“ sowie Kopieren und Weitergeben von Inhalten. MCP-Server
  oder Apps werden dort nicht erwähnt, eine ausdrückliche Erlaubnis für Apps gibt es nicht.

**Ergebnis:** nicht eingebaut. Eine App, die den Server automatisch abfragt, fällt nach dem Wortlaut unter die
„automated scripts“, und die gesuchten früheren Seasons liefert er nach seiner Beschreibung ohnehin nicht. Einbauen
nur mit schriftlicher Erlaubnis von OP.GG und deiner Zustimmung (Entscheidung offen).
