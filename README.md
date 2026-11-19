# Kass-Istentin

Eine Assistentin für organisatorische Aufgaben rund um Kalender und Mail. Sie wird mit Google Calendar und Gmail eines Google-Workspace-Kontos verbunden und übernimmt Terminkoordination: freie Slots suchen, Blocker für Terminumfragen eintragen und wieder aufräumen, Antworten auf Terminanfragen entwerfen.

**Stand:** Planung abgeschlossen, noch kein Code. Die Abläufe wurden mit den Claude-Konnektoren für Google Calendar und Gmail an echten Fällen ausprobiert. Die Ergebnisse stehen in [docs/regeln.md](docs/regeln.md).

## Rahmen

| Punkt | Entscheid |
|---|---|
| Konto | Google Workspace, die App läuft als interne App ohne Google-Prüfung |
| Bedienung | Web-Chat, später zusätzlich Weiterleiten per Mail |
| Nutzerkreis | zuerst eine Person, später mehrere; Regeln und Zugriffe sind pro Person getrennt |
| Betrieb | Google Cloud |
| Schreibrechte | Kalendereinträge erst nach OK der Person, Mails nur als Entwurf, nie selbst senden |

## Was die App mehr können muss als ein Chat mit Konnektoren

- **Regeln pro Person:** Wann gilt eine Zeit als besetzt, was ist verschiebbar, wie wird Reisezeit gerechnet, in welchem Ton schreibt sie. Die Regeln sind gespeichert und anpassbar.
- **Vorgänge:** Jede Abstimmung ist ein Vorgang mit seinen Blockern, zum Beispiel eine Terminumfrage. So weiss die Assistentin, welche Blocker sie nach einer Zusage löscht und woran sie erinnern muss.
- **Bekannte Orte:** Eine Liste mit Büro, Zuhause und Standorten von Kunden und Partnern. Sie wächst mit jeder Antwort auf eine Rückfrage.

## Etappen

| Etappe | Inhalt |
|---|---|
| 1. Kalender | Freie Slots suchen, Blocker aus Umfragen eintragen und aufräumen, Reisezeit berücksichtigen |
| 2. Mail | Terminanfragen in Gmail lesen, Antworten mit Vorschlägen als Entwurf ablegen, offene Zusagen erkennen |
| 3. Proaktiv | Neue Mails mit Terminbezug selbst erkennen, Weiterleiten an eine eigene Adresse, an offene Vorgänge erinnern |

### Reihenfolge in Etappe 1

1. **Gerüst:** Login, Chat-Oberfläche, Bereitstellung auf Cloud Run.
2. **Kalender lesen:** Slot-Suche nach den Regeln der Person.
3. **Umfragen:** Slots aus Screenshot oder Text lesen, Blocker nach OK eintragen, Vorgang anlegen und später aufräumen.
4. **Reisezeit:** Orte erkennen, Reise einrechnen und als Kalendereintrag vorschlagen.

## Technik (Vorschlag, noch nicht bestätigt)

| Baustein | Vorschlag |
|---|---|
| App | eine Web-App in TypeScript (Next.js) auf Cloud Run, Region Zürich (`europe-west6`) |
| Anmeldung | Google-Login (OAuth), als interne Workspace-App |
| Daten | Firestore für Regeln, Vorgänge und Orte; Google-Zugriffe (Refresh-Tokens) verschlüsselt im Secret Manager |
| Sprachmodell | Claude über die API, mit Kalender und Mail als Werkzeugen |
| Reisezeit | Google Maps Routes API mit ÖV |
| Neue Mails (Etappe 3) | Gmail-Benachrichtigungen über Pub/Sub |

Die Slot-Suche rechnet normaler Code nach den Regeln, nicht das Sprachmodell. Das Modell versteht die Anfrage, liest Screenshots und formuliert. So bleiben die Ergebnisse nachvollziehbar und testbar.

Blocker, die die Assistentin anlegt, markiert sie im Kalendereintrag mit der Kennung des Vorgangs (erweiterte Eigenschaften des Eintrags), damit sie sie sicher wiederfindet.

## Offen

- Bestätigung des Technik-Vorschlags.
- GCP-Projekt in der Cloud-Organisation, darin die Anmeldung als interne App einrichten.
- Schlüssel für die Claude-API und für Google Maps.
- Startwerte für die Liste bekannter Orte. Sie gehören in die Datenbank, nicht in dieses Repository.
