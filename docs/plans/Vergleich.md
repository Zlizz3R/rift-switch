# Rift Switch im Vergleich (25.11.2026)

Womit sich Rift Switch messen lässt, was die anderen besser machen und was wir davon übernehmen könnten.
Quellen: Lost League Manager 1.13.1 (installiert, README und Dateiliste aus `app.asar` gelesen, nichts
ausgeführt), die READMEs von TcNo Account Switcher und LeagueAccounts auf GitHub, und was über Porofessor,
Blitz und Mobalytics allgemein bekannt ist.

## Die Account-Tools

| | **Rift Switch** | **Lost League Manager** | **LeagueAccounts** | **TcNo Acc Switcher** |
|---|---|---|---|---|
| Technik | Tauri 2 (Rust + WebView2) | Electron 37 + Overwolf | Tauri (Rust + WebView2, Vite/TS) | Go (Wails 3) |
| Größe | 2 MB Installer, ~8 MB im Tray | ~200 MB allein die .exe | klein (Tauri) | mittel |
| Login | gespeicherte *Angemeldet bleiben*-Sitzung tauschen, Passwort nur als Notlösung | tippt Name und Passwort in den Riot Client | meldet über den Riot Client an (Tippen) | tauscht Dateien/Registry, **keine** Passwörter |
| Passwörter | DPAPI, optional | verschlüsselt, Tresor-Passwort | Windows-Anmeldeinformationen | gar keine |
| Ränge anderer Server | nur über den Client (lokal) | Client, **OP.GG** oder Riot-API-Key | **OP.GG**, alle 30 Min. | – |
| Spiele | League | League **+ Valorant** | League **+ TFT** | 20+ Plattformen |
| Im Spiel | nichts (bewusst) | Overlay (Beta), Runen-Import, Dodge | – | – |
| Code signiert | nein | nein | nein | **ja, über die SignPath Foundation (kostenlos)** |
| Lizenz | MIT | ISC | MIT | GPL-3.0 |

### Wo Rift Switch vorne liegt

- **Leicht und lokal.** 2 MB statt einer Electron-App mit Overwolf. Keine Abfragen bei OP.GG oder der Riot-API –
  alles kommt aus dem eigenen Client. Lost League und LeagueAccounts schicken die Riot IDs aller Accounts an OP.GG.
- **Login ohne Passwort-Tippen** im Normalfall (Sitzung tauschen), und es prüft, ob das richtige Konto angemeldet ist.
- **Auswertung, die sonst nur Webseiten haben – aber aus den eigenen Spielen:** unbegrenzte Match History,
  Traits mit Schwellen pro Rolle, Spielstil-Radar gegen den Lane-Gegner, Karte der Tode, Mastery mit Spielzeit,
  Saisons. Lost League hat eine Saison-Rückschau und Champion-Tabelle, aber nichts in dieser Tiefe.
- **Live ohne Overlay:** die zehn Spieler mit Traits aus ihren 200 Spielen, Premades (aus der Lobby und aus
  gemeinsamen Spielen), Schaden-Mix, Spieler-Seite für jeden, Replays.
- **Sicherer Export** (Logins mit eigenem Passwort verschlüsselt); LeagueAccounts exportiert Passwörter im Klartext.
- **11 Sprachen** (LeagueAccounts 6; Lost League nennt keine), Streamer-Modus, App-Sperre mit Windows Hello.

### Was die anderen haben und wir nicht

| Idee | Wer | Passt zur Vision? |
|---|---|---|
| **Code-Signing über die SignPath Foundation** – TcNo zeigt, dass das für Open Source kostenlos klappt | TcNo | **ja** – nimmt die SmartScreen-Warnung weg; braucht deine Bewerbung |
| **Desktop-Verknüpfung pro Account** und Login per Befehl/Link | TcNo | **ja**, klein – die Sprungliste kann es schon, eine `.lnk` pro Account wäre wenig Arbeit |
| **TFT**: TFT-Rang auf der Kachel, wahlweise TFT statt LoL starten | LeagueAccounts | **ja**, mittel – derselbe Client |
| **Login-Daten kopieren** (erst Name, dann Passwort), Zwischenablage nach 30 s leeren, nicht im Verlauf | LeagueAccounts | ja, klein – für das Anmelden von Hand |
| **Client-Sprache umstellen** | Lost League | ja, klein (Tools) |
| **Zufälligen eigenen Skin** in der Championauswahl wählen | Lost League | ja, klein – reiner Spaß, über den Client |
| **Discord-Status** mit Rang und Champion (ohne Namen) | Lost League | vielleicht – läuft lokal über Discord, aber nicht jeder will das |
| **Offline erscheinen** im Chat | Lost League, LeagueAccounts (Deceive) | eher nicht – fühlt sich nach Graubereich an |
| **Valorant** (Login, Rang, Shop) | Lost League | groß – eigenes Spiel, eigene Entscheidung |
| Ehre beobachten, Champion-Werte pro Level, Goldwert von Items | Lost League | eher nicht – weit weg vom Kern |
| Ränge ohne laufenden Client über OP.GG | Lost League, LeagueAccounts | **nein** – Rift Switch fragt keine Server nach Account-Daten |
| Overlay, Runen-Import, Dodge, Pausen-Hinweis | Lost League | **nein** – siehe „Nicht gewollt“ im Backlog |
| Filter „mit welchem Account kann ich mit einem Freund Ranked spielen“ | LeagueAccounts | **nein** – Account-Wahl nach Rang |

Schon vorhanden, obwohl man es zuerst vermisst: OP.GG-/u.gg-Link beim Hinzufügen, Riot-ID-Umbenennung,
Decay, Sperren und Low Priority auf der Kachel, Ziel-Rang, Skin-Suche über alle Accounts, Massen-Import
(auch das LeagueAccounts-Format), Sprungliste, Auto-Accept, Riot-Prozesse schließen, Cache leeren.

## Die Webseiten-Tools: Porofessor, Blitz, Mobalytics

Grundlegend anders: Sie rechnen auf ihren Servern mit Millionen Spielen, brauchen meist ein Konto, zeigen
Werbung und laufen oft über Overwolf.

- **Sie haben**: Statistiken über alle Spieler (Tier-Listen, Builds, Runen, Matchup-Winrates), Overlays im
  Spiel, Apps fürs Handy, Sync über Geräte.
- **Wir haben**: mehrere Accounts in einem Fenster, alles lokal und ohne Konto, eine Match History ohne
  Grenze, die mit jedem Laden wächst, Traits aus *deinen* Spielen statt aus dem Durchschnitt, keine Werbung,
  kein Overwolf, 8 MB im Hintergrund.
- **Lernen kann man** vor allem bei der Darstellung: Porofessors kurze Etiketten auf den Spielerkarten
  (bei uns die Traits) und Mobalytics' eine Zahl pro Bereich. Diesen Weg sind wir mit den Traits schon gegangen,
  ohne Gesamtwertung. Matchup-Daten kommen bei uns aus counterstats.net – das bleibt die eine Stelle mit fremden
  Statistiken.

## Vorschlag für die Reihenfolge

1. Code-Signing über die SignPath Foundation beantragen (du), danach baue ich das Signieren in den Release ein.
2. Desktop-Verknüpfung pro Account.
3. TFT (Rang und Start).
4. Kleinigkeiten: Login-Daten kopieren, Client-Sprache, zufälliger Skin.
