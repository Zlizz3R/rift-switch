# Speicher-Messung (vor dem Speichern fremder Spiele)

Gemessen am 24.11.2026 am laufenden League-Client (nur lesende Abfragen, kein Spiel lief), an einem echten
Ranked-Spiel (~32 Min.) und der Match-Liste eines eigenen Accounts. „gzip“ und „brotli“ = dieselben Daten
komprimiert (höchste Stufe).

## Pro Spiel

| Was | roh | gzip | brotli |
|---|---:|---:|---:|
| A – ein Eintrag der Match-Liste (einzeln) | 4,3 KB | 1,6 KB | 1,4 KB |
| A – pro Spiel, wenn 21 Einträge zusammen liegen | 4,1 KB | 0,4 KB | 0,3 KB |
| B – vollständige Spieldaten | 31,8 KB | 4,6 KB | 3,3 KB |
| C – Timeline | 97,0 KB | 11,0 KB | 7,7 KB |
| **App-Format 4** (was die App heute für eigene Spiele speichert: B + die nötigen Teile von C, verdichtet) | **9,9 KB** | **3,9 KB** | 3,2 KB |
| nur berechnete Kennzahlen (alle 10 Spieler, geschätzt ~25 Werte je Spieler) | ~1,5 KB | – | – |

## Hochgerechnet

| Option | 1.000 Spiele | 10.000 Spiele | 100.000 Spiele |
|---|---:|---:|---:|
| roh speichern (A + B + C) | 127 MB | 1,27 GB | 12,7 GB |
| komprimiert speichern (A + B + C, gzip) | 16 MB | 164 MB | 1,6 GB |
| App-Format 4 (wie eigene Spiele) | 9,4 MB | 94 MB | 941 MB |
| App-Format 4, gzip | 3,7 MB | 37 MB | 375 MB |
| nur Kennzahlen | ~1,4 MB | ~14 MB | ~143 MB |

## Wie viele fremde Spiele kommen zusammen?

Die Match-Liste des Clients liefert pro Spieler **nur die letzten ~20 Spiele** (21 in der Messung). Größere
`begIndex`/`endIndex` geben immer dieselben Spiele zurück, weiter zurück geht es über den Client nicht. Pro Live-Spiel
sind das höchstens 10 × 20 = 200 Spiele, wegen Überschneidungen meist weniger. Im App-Format 4 sind das **bis zu
~2 MB pro Live-Spiel**. Nach 100 Live-Spielen mit lauter neuen Leuten wären es höchstens ~200 MB.

## Optionen

1. **Roh speichern:** alles, was der Client liefert. Am größten (~127 KB pro Spiel) und enthält vieles, was keine
   Ansicht braucht.
2. **Komprimiert speichern:** dieselben Rohdaten, gzip. Etwa ein Achtel davon, aber zum Lesen muss jedes Spiel
   entpackt werden.
3. **Nur berechnete Kennzahlen:** am kleinsten. Eine neue Kennzahl oder ein neuer Tag geht aber nicht rückwirkend,
   und Spieldetails (Items, Goldverlauf, Vergleich) für fremde Spiele gibt es dann nicht.
4. **Meine Empfehlung: App-Format 4, wie bei den eigenen Spielen** (~10 KB, gzip ~4 KB). Es hat alles, was die Tags
   und Kennzahlen brauchen, und die Detailansicht geht auch für fremde Spiele. Fremde Spiele kommen in eine eigene
   Datei mit eigener Größenanzeige und eigenem Löschknopf, wie im Plan. gzip lässt sich später bei der 1-GB-Meldung
   einschalten.

**Entscheidung:** ___
