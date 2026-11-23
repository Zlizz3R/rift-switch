// What changed in each version – the one source for the "What's new" box in the app and for the
// GitHub release text (tools/release-notes.js). English and German; other languages show English.
(function (root) {
  const CHANGELOG = [
    {
      v: '1.2.2',
      en: [
        'Logging in runs by itself: a Riot Client that is not open or not ready yet is brought up and the login typed again; Play is pressed until the client takes it; an update is shown and waited for.',
        'The Riot Client and League on different accounts: Rift Switch notices it, says so and restarts League for the right account (never during champion select or a game).',
        'Live: right after a game the whole match at a glance – both teams with K/D/A, items, runes, ranks, bans and objectives, damage dealt and taken and gold as bars (best player = 100 %), and a placement of all ten with MVP and ACE – including a lane factor for how much better or worse than the lane opponent (×0.60 to ×1.40).',
        'Match history: a game\'s details show the same table; "Show more" under per account, played with and most played shows five more each.',
      ],
      de: [
        'Einloggen läuft von selbst: Ein Riot Client, der noch nicht offen oder bereit ist, wird geöffnet und der Login neu eingegeben; Play wird gedrückt, bis der Client es annimmt; ein Update wird angezeigt und abgewartet.',
        'Riot Client und League auf verschiedenen Accounts: Rift Switch merkt es, sagt es und startet League für den richtigen Account neu (nie in Championauswahl oder Spiel).',
        'Live: Direkt nach einem Spiel das ganze Match auf einen Blick – beide Teams mit K/D/A, Items, Runen, Rängen, Bans und Objectives, ausgeteiltem und erlittenem Schaden und Gold als Balken (bester Spieler = 100 %) und eine Platzierung aller zehn mit MVP und ACE – inklusive Lane-Faktor, wie viel besser oder schlechter als der Lane-Gegner (×0,60 bis ×1,40).',
        'Spielverlauf: Die Details eines Spiels zeigen dieselbe Tabelle; "Mehr anzeigen" bei Pro Account, Gespielt mit und Meistgespielt zeigt jeweils fünf mehr.',
      ],
    },
    {
      v: '1.2.1',
      en: [
        'The pages are now a bar at the top with their names.',
        'Overview: key figures across all accounts (games, win rate, LP, best climb, most played champion, busiest account) and the season peak of every account.',
        'Match history: your five most played champions, games and play time per account, the teammates you played with most – each with its win rate.',
        'Clash games are named and have their own filter; ARAM variants count as ARAM.',
        'Collection: an inventory the client had not loaded yet no longer empties it; "Read now" and when each account was read.',
        'Optional Windows notification when a match is found; start minimized with Windows; the update check can be switched off.',
        'The first start asks once whether Rift Switch should start with Windows.',
        'A login interrupted by another window says so clearly, with a "Log in again" button.',
        'Where you type a password, a short note says what happens to it: stored only on this PC, encrypted, never sent anywhere.',
        'Safer data: daily backups of your accounts (last 5 days), and re-encrypting the logins is all or nothing.',
        'Releases are built with read-only rights and carry a signed build provenance.',
      ],
      de: [
        'Die Seiten sind jetzt eine Leiste oben mit ihren Namen.',
        'Übersicht: Kennzahlen über alle Accounts (Spiele, Winrate, LP, bester Aufstieg, meistgespielter Champion, aktivster Account) und der Saison-Peak jedes Accounts.',
        'Spielverlauf: deine fünf meistgespielten Champions, Spiele und Spielzeit pro Account, die Mitspieler, mit denen du am meisten gespielt hast – jeweils mit Winrate.',
        'Clash-Spiele heißen so und haben einen eigenen Filter; ARAM-Varianten zählen als ARAM.',
        'Sammlung: Ein noch nicht geladenes Inventar leert sie nicht mehr; „Jetzt lesen“ und wann jeder Account gelesen wurde.',
        'Auf Wunsch eine Windows-Benachrichtigung bei gefundenem Match; mit Windows minimiert starten; Update-Suche abschaltbar.',
        'Beim ersten Start fragt Rift Switch einmal, ob es mit Windows starten soll.',
        'Ein Login, den ein anderes Fenster unterbrochen hat, sagt das jetzt klar – mit „Nochmal einloggen“.',
        'Wo du ein Passwort eingibst, sagt ein kurzer Hinweis, was damit passiert: nur auf diesem PC, verschlüsselt, nie gesendet.',
        'Sicherere Daten: tägliche Backups deiner Accounts (letzte 5 Tage), und das Neuverschlüsseln der Logins geschieht ganz oder gar nicht.',
        'Releases werden mit reinen Leserechten gebaut und tragen einen signierten Herkunftsnachweis.',
      ],
    },
    {
      v: '1.2.0',
      en: [
        'Overview page: the LP history of all accounts in one chart – Solo/Duo, Flex, Ranked 5v5 and Classic 5v5 in any combination –, games, win rate and LP per account and in total, a rank goal per account and queue.',
        'Collection page: owned champions, skins and loot shards of every account, with one search across all of them.',
        'Match history: any combination of queues, Ranked 5v5 and Classic 5v5 included.',
        'The Live page opens at once instead of waiting for the champion list and Clash.',
        'Add many accounts at once: paste a list (user:password, user--Name#TAG--password, blocks of "Username: …") – with a preview of what was understood.',
        'Three layouts for the accounts: tiles, small tiles or a list.',
        'Keyboard shortcuts for pages, search, adding and moving through the accounts – press ? for the list.',
        'A locked account (leaver lock, low priority, dodge) asks before logging in; after logging in the app checks that the right account is signed in.',
        'A code or captcha while signing in: clear steps and a button that opens the Riot Client – the app goes on by itself afterwards.',
        'Diagnostics file for bug reports (Tools), with names, ids and your user folder removed.',
        'Export with clear choices: without logins, or with logins protected by a password of their own.',
        '"Switch" is now called "Log in"; the MMR estimate and the in-game overlay were removed again.',
      ],
      de: [
        'Übersicht: die LP-Historie aller Accounts in einem Graphen – Solo/Duo, Flex, Ranked 5v5 und Classic 5v5 beliebig kombiniert –, Spiele, Winrate und LP pro Account und insgesamt, ein Rangziel pro Account und Modus.',
        'Sammlung: Champions, Skins und Shards aller Accounts, mit einer Suche über alle.',
        'Spielverlauf: Modi beliebig kombinierbar, auch Ranked 5v5 und Classic 5v5.',
        'Der Live-Tab öffnet sofort, statt auf die Champion-Liste und Clash zu warten.',
        'Mehrere Accounts auf einmal hinzufügen: Liste einfügen (user:passwort, user--Name#TAG--passwort, Blöcke mit „Username: …“) – mit Vorschau, was erkannt wurde.',
        'Drei Ansichten für die Accounts: Kacheln, kleine Kacheln oder Liste.',
        'Tastenkürzel für Seiten, Suche, Hinzufügen und die Auswahl der Accounts – ? zeigt die Liste.',
        'Ein gesperrter Account (Leaver-Sperre, Low Priority, Dodge) fragt vor dem Einloggen nach; nach dem Login prüft die App, ob der richtige Account angemeldet ist.',
        'Code oder Captcha beim Anmelden: klare Schritte und ein Knopf, der den Riot Client öffnet – danach macht die App von selbst weiter.',
        'Diagnose-Datei für Fehlerberichte (Tools), ohne Namen, IDs und Benutzerordner.',
        'Export mit klaren Optionen: ohne Logins oder mit Logins, geschützt durch ein eigenes Passwort.',
        '„Wechseln“ heißt jetzt „Einloggen“; die MMR-Schätzung und das Ingame-Overlay sind wieder entfernt.',
      ],
    },
    {
      v: '1.1.0',
      en: ['Rewritten with Tauri and Rust: about 8 MB in the tray instead of well over 100 MB, a 2 MB installer.',
        'Match history without a limit, with filters, details, gold graphs and a player comparison.'],
      de: ['Neu geschrieben mit Tauri und Rust: etwa 8 MB im Tray statt weit über 100 MB, ein 2-MB-Installer.',
        'Spielverlauf ohne Grenze, mit Filtern, Details, Goldgraphen und Spielervergleich.'],
    },
  ];
  const api = { CHANGELOG };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Changelog = api;
})(typeof window !== 'undefined' ? window : globalThis);
