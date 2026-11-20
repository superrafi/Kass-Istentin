# Arbeitsanweisungen

## Einstieg

Lies zuerst [README.md](README.md) (Ziel, Etappen, Technik), [docs/regeln.md](docs/regeln.md) (Regeln und Testergebnisse) und [docs/einrichtung.md](docs/einrichtung.md) (lokaler Start und Bereitstellung). Die Schritte 1 (Gerüst) und 2 (Kalender lesen, Slot-Suche) von Etappe 1 sind gebaut. Die App läuft auf Cloud Run, noch ohne Schlüssel für die Claude-API. Der nächste Schritt ist Schritt 3: Umfragen.

Vor jedem Commit: `npm run typecheck`, `npm test` und `npm run build`.

## Sprache

- Mit der Nutzerin oder dem Nutzer Deutsch, Schweizer Schreibweise (kein ß), Du-Form.
- Dokumentation in diesem Repository auf Deutsch.
- Code, Bezeichner und Commit-Meldungen auf Englisch.

## Umgang mit Kalender und Mail

- Lesen ist jederzeit in Ordnung, wenn es der Aufgabe dient.
- Kalendereinträge anlegen, ändern oder löschen: erst nach ausdrücklichem OK für genau diese Einträge.
- Mails nie senden. Entwürfe nur nach OK ablegen, sonst den Text im Chat zeigen.
- Das gilt für Tests mit Konnektoren genauso wie für die App selbst.

## Datenschutz

- Keine echten Namen, Mailadressen, Kalenderinhalte oder Mailtexte ins Repository, auch nicht in Tests oder Beispiele. Nimm erfundene Daten.
- Schlüssel und Tokens gehören in den Secret Manager oder in lokale, nicht eingecheckte Dateien.

## Bauweise

- Die Slot-Suche und alle Regeln sind normaler, getesteter Code. Das Sprachmodell entscheidet nicht, ob eine Zeit frei ist.
- Jede Regel aus `docs/regeln.md` bekommt mindestens einen Test.
- Neue Regeln oder Erkenntnisse aus Gesprächen trägst du in `docs/regeln.md` nach.
