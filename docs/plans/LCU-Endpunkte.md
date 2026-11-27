# Genutzte Client-Endpunkte (für die Registrierung im Riot Developer Portal)

Riot verlangt bei Produkten, die die League Client API nutzen: „We need to know which endpoints you're using and
how you're using them.“ Stand 27.11.2026 (Version 1.3.4). Alles läuft nur lokal über `127.0.0.1`; Rift Switch nutzt
keinen Riot-API-Key und keinen eigenen Server.

## League Client (LCU)

| Endpunkt | Wofür |
|---|---|
| `/lol-summoner/v1/current-summoner`, `/lol-summoner/v1/summoners/{id}`, `/lol-summoner/v2/summoners/puuid/{puuid}`, `/lol-summoner/v1/alias/lookup` | Eingeloggter Account; Riot ID, Icon, Level von Spielern; Spielersuche nach Riot ID |
| `/lol-ranked/v1/current-ranked-stats`, `/lol-ranked/v1/ranked-stats/{puuid}` | Ränge (eigene Accounts, Spieler in Lobby / Spiel / Spieler-Seite) |
| `/lol-match-history/v1/products/lol/{puuid}/matches`, `/lol-match-history/v1/games/{id}`, `/lol-match-history/v1/game-timelines/{id}` | Spielverlauf, Spieldetails und Timelines (Statistiken, Karte, Traits) |
| `/lol-champion-mastery/v1/local-player/champion-mastery(-score)`, `/lol-champion-mastery/v1/{puuid}/champion-mastery` | Meisterschaft |
| `/lol-champions/v1/inventories/{id}/champions`, `/lol-inventory/v1/inventory`, `/lol-inventory/v1/wallet`, `/lol-loot/v1/player-loot`, `/lol-perks/v1/inventory`, `/lol-honor-v2/v1/profile` | Sammlung (Champions, Skins, Chromas, Icons …), Blue Essence, Ehre |
| `/lol-game-data/assets/...` | Namen und Bilder von Champions, Skins, Icons, Ward-Skins |
| `/lol-gameflow/v1/gameflow-phase`, `/lol-gameflow/v1/session` | Spielphase; die zehn Spieler, sobald das Spiel läuft |
| `/lol-lobby/v2/lobby`, `/lol-lobby/v2/eligibility/party`, `/lol-lobby/v2/eligibility/self`, `/lol-lobby/v2/lobby/matchmaking/search`, `/lol-matchmaking/v1/search`, `/lol-leaver-buster/v1/notifications`, `/lol-summoner-profiles/v1/get-restriction-view` | Lobby-Mitglieder, Sperren und Wartezeiten (Leaver Buster, Low Priority) |
| `/lol-matchmaking/v1/ready-check`, `/lol-matchmaking/v1/ready-check/accept` | Auto-Accept (Einstellung, standardmäßig aus) |
| `/lol-champ-select/v1/session` | Champ Select: eigenes Team (versteckte Spieler werden nie nachgeschlagen), gegnerische Picks |
| `/lol-champ-select/v1/skin-carousel-skins`, `/lol-champ-select/v1/session/my-selection` | Zufälliger eigener Skin (auf Knopfdruck) |
| `/lol-clash/v1/tournament-summary`, `/lol-clash/v1/bracket/{id}`, `/lol-clash/v1/roster/{id}` | Clash-Gegner, sobald das Bracket steht |
| `/lol-end-of-game/v1/eog-stats-block` | Das gerade beendete Spiel |
| `/lol-replays/v1/configuration`, `/lol-replays/v1/metadata/{id}`, `/lol-replays/v2/metadata/{id}/create-gameversion`, `/lol-replays/v1/rofls/{id}/download`, `/lol-replays/v1/rofls/{id}/watch` | Replays herunterladen und ansehen (auf Knopfdruck) |
| `/lol-game-settings/v1/game-settings` (GET, PATCH `HUD.HidePlayerNames`) | Nur mit der Einstellung „Streamer-Modus – im Spiel“: League's eigene Option „Spielernamen verbergen“ ein- bzw. beim Ausschalten wieder aus (seit 1.3.4) |
| `/lol-chat/v1/me` | Nur noch einmalig: wer „Offline erscheinen“ (entfernt) an hatte, wird wieder online gesetzt |

## Riot Client (lokal)

| Endpunkt | Wofür |
|---|---|
| `/rso-auth/v1/authorization`, `/riot-client-auth/v1/userinfo` | Ist ein Account angemeldet, und welcher |
| `/product-launcher/v1/products/league_of_legends/patchlines/{live,pbe}` | „Play“ drücken nach dem Einloggen |
| `/riotclient/region-locale` | Server und Sprache |

## Nicht genutzt

Kein Riot-API-Key, keine Riot-Server direkt, kein Chat (außer dem einmaligen Online-Setzen oben), von der Ingame-API
(Live Client Data, Port 2999) nur `/liveclientdata/gamestats` – die Spielzeit, um zu merken, dass das Spiel läuft –, kein Overlay, keine Daten von Webseiten Dritter (counterstats.net nur als Link, den der Nutzer
selbst öffnet). Die Anmeldung beim Account-Wechsel tippt ein gespeichertes Passwort in das Login-Fenster des Riot
Clients (UI Automation), nur wenn der Nutzer es so eingerichtet hat.
