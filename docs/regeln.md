# Regeln und Erkenntnisse aus den Tests

Diese Regeln stammen aus Tests an echten Fällen der ersten Nutzerin oder des ersten Nutzers. Sie sind die Startwerte für die Regeln pro Person. Namen, Kalenderinhalte und Mailtexte stehen bewusst nicht hier.

## Regeln

### Wann ist eine Zeit besetzt?

| Fall | Regel |
|---|---|
| Titel enthält «Evt.», «Blocker» oder «Reserve» | besetzt, auch wenn der Eintrag unsicher wirkt |
| Standup | verschiebbar; darf von einem Termin überlagert werden |
| Homeoffice-Einträge (Titel enthält «Homeoffice» oder «@Home») | Calls sind möglich, Termine vor Ort nicht |
| Vorläufig zugesagte, freiwillige Termine | nicht hart besetzt, aber im Befund erwähnen |
| Eigene Blocker für denselben Vorgang | nicht als Konflikt melden und keine Doppelten anlegen |

### Vor Ort oder online?

1. Hat ein Termin keinen Ort, aber einen Videocall-Link, ist er online.
2. Deuten Titel oder Mail auf ein Treffen hin (zum Beispiel «Lunch»), gilt er als vor Ort, auch mit Videolink. Outlook hängt Teams-Links oft automatisch an.
3. Ort als «Tbd» oder leer bei einem Treffen: nachfragen oder später nachfassen.

### Ort erkennen

1. Ortsfeld und Titel lesen.
2. Bei einem Kürzel oder unklaren Namen zuerst prüfen, ob es ein Café oder Restaurant in der Stadt des Büros ist.
3. Sonst vom Gastgeber auf dessen Standort schliessen (Maildomain, Signatur).
4. Bleibt der Ort unklar: nachfragen. Die Antwort kommt in die Liste bekannter Orte.

### Reisezeit

- Liegt ein Termin ausserhalb des Büros und fehlt die Hin- oder Rückreise im Kalender, rechnet die Assistentin sie ein und behandelt die Zeit als besetzt.
- Gerechnet wird mit ÖV.
- Ausgangspunkt ist das Büro, an Homeoffice-Tagen das Zuhause.
- Vorhandene Einträge wie «Anreise» oder «Rückreise» erkennen und nicht doppelt zählen.
- Fehlende Reisen schlägt sie gleich als Kalendereintrag vor.
- Bei mehreren möglichen Terminen (Umfrage) trägt sie Reisen erst ein, wenn der Termin feststeht.

### Schreiben

- Kalendereinträge erst nach OK anlegen oder löschen.
- Mails nur als Entwurf ablegen, nie selbst senden.
- Im Zweifel nachfragen statt raten.

### Ton der Mails

- Den Ton aus dem bisherigen Mailverlauf übernehmen.
- Startwerte: Du-Form, Anrede «Liebe alle» bei Gruppen, «Ihr» und «Euch» grossgeschrieben, kurzer Gruss mit dem Rufnamen.

## Geprüfte Abläufe

### 1. Terminumfrage

Eingabe: Screenshot einer Umfrage mit acht Slots.

1. Slots aus dem Bild lesen.
2. Jeden Slot gegen den Kalender prüfen, inklusive Umfeld (Termin davor ausser Haus?).
3. Befund pro Slot melden: frei, besetzt oder unsicher, mit Begründung.
4. Nach OK Blocker für die freien Slots eintragen.
5. Sobald der Termin bestätigt ist, die übrigen Blocker löschen.

Die Umfrage selbst kann die Assistentin nicht ausfüllen: Solche Umfragen liegen hinter einem Login.

### 2. Slot-Suche

Eingabe: «Drei freie Slots à 45 Minuten nächste Woche, nicht vor 9 Uhr, nicht über Mittag.»

Ergebnis: Vorschläge über mehrere Tage verteilt, jeweils mit dem Umfeld (was liegt davor und danach). Tage ohne freie Zeit werden kurz begründet.

### 3. Offene Terminmails finden

Eingabe: Suche nach Terminabstimmungen der letzten 14 Tage.

Erkenntnis: Die meisten Verläufe waren schon beantwortet. Nützlich war der Abgleich von Mail und Kalender. Die Assistentin soll pro Verlauf den Stand erkennen:

| Stand | Was sie tut |
|---|---|
| Abgestimmt, Bestätigung steht aus | warten, danach übrige Blocker löschen |
| Selbst etwas angekündigt, noch nicht erledigt | erinnern und Vorschlag vorbereiten |
| Termin steht, Ort offen | nachfassen, wenn bis eine Woche vorher kein Ort da ist |
| Verschoben ohne Datum | zum genannten Zeitpunkt erinnern |
| Erledigt | nichts |

Sie soll auch auf doppelte Einträge für denselben Termin und auf Überschneidungen von Reise und Terminen hinweisen.

### 4. Antwort entwerfen

Eingabe: Sitzung von drei Stunden vor Ort, mehrere Kandidaten im neuen Jahr.

Erkenntnis: Die Kandidaten standen schon als benannte Blocker im Kalender. Die Assistentin soll vorhandene Blocker eines Vorgangs erkennen und prüfen, statt neue Slots zu suchen. Danach entwirft sie die Mail im Ton des Verlaufs und setzt Platzhalter für das, was sie nicht kennt (Link zur Umfrage, Antwortfrist).

## Folgerungen für den Bau

- **Blocker gehören zu einem Vorgang.** Benannte Blocker («Blocker» plus Kürzel) müssen einem Vorgang zugeordnet werden, auch wenn die Person sie von Hand angelegt hat.
- **Erinnerungen:** Ein Vorgang kennt seinen nächsten Schritt und ein Datum dafür.
- **Grosse Antworten:** Kalender- und Mailabfragen liefern schnell sehr viel Text (HTML, Zitate, Signaturen). Vor der Übergabe ans Modell kürzen: nur Klartext, zitierte Verläufe abschneiden.
- **Suche in Gmail:** Ein Treffer in der Suche zeigt nicht die neueste Nachricht. Den Verlauf immer ganz laden, bevor der Stand beurteilt wird.
