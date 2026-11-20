# Einrichtung

Diese Anleitung führt von null bis zur laufenden App auf Cloud Run. Die Befehle brauchen die [gcloud CLI](https://cloud.google.com/sdk/docs/install). Ersetze die Werte in Grossbuchstaben durch Deine eigenen. Echte Werte gehören nicht ins Repository.

## Was Du brauchst

- Ein Google-Workspace-Konto mit dem Recht, in der Cloud-Organisation ein Projekt anzulegen.
- Ein Rechnungskonto in Google Cloud.
- Später einen Schlüssel für die Claude-API. Ohne Schlüssel antwortet der Chat mit einem festen Platzhalter.

## 1. Lokal starten

```bash
npm install
cp .env.example .env.local
npx auth secret
npm run dev
```

`npx auth secret` schreibt `AUTH_SECRET` in `.env.local`. Die übrigen Werte trägst Du nach Schritt 3 ein. Die App läuft dann auf `http://localhost:3000`.

Prüfen:

```bash
npm run typecheck
npm test
```

## 2. GCP-Projekt anlegen

```bash
gcloud projects create PROJEKT_ID --organization=ORGANISATIONS_ID
gcloud billing projects link PROJEKT_ID --billing-account=RECHNUNGSKONTO_ID
gcloud config set project PROJEKT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com
```

Das Projekt muss in der Organisation des Workspace-Kontos liegen. Nur dann lässt sich die Anmeldung als interne App einrichten.

## 3. Anmeldung als interne App

In der Cloud Console unter **Google Auth Platform**:

1. **Branding:** App-Name «Kass-Istentin», Support-Adresse wählen.
2. **Zielgruppe (Audience):** «Intern». So können sich nur Konten der eigenen Organisation anmelden, und Google verlangt keine Prüfung der App.
3. **Clients → Client erstellen:** Typ «Webanwendung». Bei «Autorisierte Weiterleitungs-URIs» zwei Einträge:
   - `http://localhost:3000/api/auth/callback/google`
   - `https://kass-istentin-PROJEKTNUMMER.europe-west6.run.app/api/auth/callback/google`

Die Projektnummer zeigt dieser Befehl:

```bash
gcloud projects describe PROJEKT_ID --format='value(projectNumber)'
```

Client-ID und Client-Secret trägst Du lokal in `.env.local` ein (`AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`), dazu die Domain in `ALLOWED_GOOGLE_DOMAIN`. Für den Anfang mit einer Person setzt Du zusätzlich `ALLOWED_EMAILS` auf Deine Adresse.

Rechte für Kalender und Mail kommen erst in Schritt 2 von Etappe 1 dazu. Bis dahin fragt die App nur Name und Mailadresse ab.

## 4. Secrets ablegen

Der Schlüssel für die Sitzung ist ein Zufallswert und geht direkt in den Secret Manager:

```bash
openssl rand -base64 33 | tr -d '\n' | gcloud secrets create auth-secret --data-file=-
```

Die beiden anderen Werte fügst Du ein. Der Befehl wartet ohne Anzeige auf die Eingabe: Wert einfügen, Enter drücken. So landet der Wert weder im Verlauf der Shell noch mit einem Zeilenumbruch am Ende im Secret.

```bash
read -rs VALUE && printf '%s' "$VALUE" | gcloud secrets create auth-google-secret --data-file=-; unset VALUE
```

```bash
read -rs VALUE && printf '%s' "$VALUE" | gcloud secrets create anthropic-api-key --data-file=-; unset VALUE
```

Solange Du keinen Claude-Schlüssel hast, lässt Du `anthropic-api-key` weg und streichst ihn in Schritt 5 aus der Schleife und im Deploy-Befehl aus `--set-secrets`.

## 5. Dienstkonto

Die App läuft unter einem eigenen Dienstkonto, das nur die Secrets lesen darf.

```bash
gcloud iam service-accounts create kass-istentin-run --display-name="Kass-Istentin Cloud Run"
```

```bash
for SECRET in auth-secret auth-google-secret anthropic-api-key; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:kass-istentin-run@PROJEKT_ID.iam.gserviceaccount.com" \
    --role="roles/secretmanager.secretAccessor"
done
```

## 6. Bereitstellen

```bash
gcloud run deploy kass-istentin \
  --source . \
  --region europe-west6 \
  --service-account kass-istentin-run@PROJEKT_ID.iam.gserviceaccount.com \
  --allow-unauthenticated \
  --min-instances 0 --max-instances 2 \
  --set-env-vars "AUTH_URL=https://kass-istentin-PROJEKTNUMMER.europe-west6.run.app,AUTH_GOOGLE_ID=CLIENT_ID,ALLOWED_GOOGLE_DOMAIN=DOMAIN,ALLOWED_EMAILS=ADRESSE" \
  --set-secrets "AUTH_SECRET=auth-secret:latest,AUTH_GOOGLE_SECRET=auth-google-secret:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest"
```

Der Befehl baut das Image mit dem `Dockerfile` über Cloud Build und legt es in der Artifact Registry ab. Beim ersten Mal fragt gcloud, ob es das Repository dafür anlegen soll.

`--allow-unauthenticated` ist nötig, weil die App die Anmeldung selbst macht: Der Browser muss die Login-Seite ohne Google-Cloud-Rechte erreichen. Verbietet eine Richtlinie der Organisation öffentliche Dienste («Domain Restricted Sharing»), schlägt dieser Teil fehl. Dann braucht das Projekt eine Ausnahme von der Richtlinie.

## 7. Prüfen

1. `https://kass-istentin-PROJEKTNUMMER.europe-west6.run.app/api/health` antwortet mit `{"status":"ok"}`.
2. Die Startseite leitet auf die Login-Seite um.
3. Nach der Anmeldung mit dem Firmenkonto erscheint der Chat und antwortet.
4. Ein Konto ausserhalb der Organisation oder ausserhalb von `ALLOWED_EMAILS` wird abgewiesen.

Meldet Google `redirect_uri_mismatch`, stimmt die Weiterleitungs-URI im OAuth-Client nicht mit der Adresse des Dienstes überein. Die tatsächliche Adresse zeigt:

```bash
gcloud run services describe kass-istentin --region europe-west6 --format='value(status.url)'
```

## Einstellungen

| Variable | Zweck | Ort |
|---|---|---|
| `AUTH_SECRET` | verschlüsselt die Sitzung | Secret Manager |
| `AUTH_GOOGLE_ID` | Client-ID des OAuth-Clients | Umgebungsvariable |
| `AUTH_GOOGLE_SECRET` | Client-Secret des OAuth-Clients | Secret Manager |
| `AUTH_URL` | öffentliche Adresse der App | Umgebungsvariable |
| `ALLOWED_GOOGLE_DOMAIN` | Domain, die sich anmelden darf. Ohne Wert kommt niemand hinein. | Umgebungsvariable |
| `ALLOWED_EMAILS` | optionale Liste erlaubter Adressen, mit Komma getrennt | Umgebungsvariable |
| `ANTHROPIC_API_KEY` | Schlüssel für die Claude-API, optional | Secret Manager |
