# Sensei Google Docs Exporter — Setup

This integration adds a completed L1 or L2 evaluation as a new tab in the existing Sensei Google Doc.

Target document:

`101FjJy7Q0gT4XSAlcOmXX0WbqbMh0W3Q9B0fUgtfZkU`

## What it does

- Creates a new Google Docs tab named `[Project Name] L1` or `[Project Name] L2`.
- Prevents accidental overwrites.
- If the title already exists, creates `- 2`, `- 3`, and so on.
- Inserts the final report only.
- Converts Markdown headings into Google Docs heading styles.
- Preserves `**bold**` text and Markdown links.
- Returns the direct URL to the new tab.

## Important platform constraint

A standard ChatGPT Project can store and use the Sensei skill files, but it cannot call an arbitrary custom HTTP API.

For automatic export from ChatGPT, use one of these action-capable routes:

1. A private Custom GPT with the included GPT Action schema.
2. A separate tool-enabled agent or automation layer that can call this endpoint.

The existing ChatGPT Project can continue to be the working knowledge base, but automatic export requires an action-capable surface.

## 1. Create the Apps Script project

1. Open Google Apps Script.
2. Create a new standalone project named `Sensei Google Docs Exporter`.
3. Replace the default `Code.gs` with the contents of `Code.gs` from this folder.
4. Open **Project Settings**.
5. Enable **Show "appsscript.json" manifest file in editor**.
6. Replace the generated manifest with the contents of `appsscript.json` from this folder.

## 2. Configure Script Properties

In **Project Settings → Script Properties**, add:

| Property | Value |
|---|---|
| `TARGET_DOCUMENT_ID` | `101FjJy7Q0gT4XSAlcOmXX0WbqbMh0W3Q9B0fUgtfZkU` |
| `EXPORTER_SHARED_SECRET` | A long random secret of at least 32 characters |

Generate a secret locally, for example:

```bash
openssl rand -hex 32
```

Do not commit the real secret to GitHub.

## 3. Authorize the script

1. In Apps Script, select the `doGet` function.
2. Click **Run**.
3. Complete Google's authorization flow.
4. Confirm the script is running under the Google account that owns or can edit the target document.

The manifest requests only:

- Google Docs document access.
- External HTTP requests, required to call the Google Docs API from Apps Script.

## 4. Deploy as a web app

1. Click **Deploy → New deployment**.
2. Choose **Web app**.
3. Set **Execute as** to `Me`.
4. Set **Who has access** to `Anyone`.
5. Click **Deploy**.
6. Copy the web app URL. It will resemble:

```text
https://script.google.com/macros/s/DEPLOYMENT_ID/exec
```

The endpoint is public at the network level but rejects requests without the configured shared secret.

## 5. Test the endpoint

Replace the URL and secret below:

```bash
curl -L \
  -X POST \
  'https://script.google.com/macros/s/DEPLOYMENT_ID/exec' \
  -H 'Content-Type: application/json' \
  --data '{
    "sharedSecret": "YOUR_SHARED_SECRET",
    "projectName": "Exporter Test",
    "evaluationType": "L1",
    "decision": "Soft approve",
    "reportMarkdown": "# Exporter Test L1 Review\n\n## General\n\n**Launched:** 2026\n\n## Evaluation\n\nExporter integration test.\n\n**Decision:** Soft approve"
  }'
```

Expected response:

```json
{
  "ok": true,
  "tabTitle": "Exporter Test L1",
  "documentUrl": "https://docs.google.com/document/d/.../edit?tab=..."
}
```

Delete the test tab manually after verification.

## 6. Configure a private Custom GPT Action

1. Create or edit a private Custom GPT.
2. Upload the same Sensei skill and reference files used in the ChatGPT Project.
3. Open **Configure → Actions → Create new action**.
4. Copy `openapi.yaml` into the schema editor.
5. Replace:

```text
REPLACE_WITH_DEPLOYMENT_ID
```

with the Apps Script deployment ID.
6. Keep the GPT private because the action requires the shared secret in its request body.
7. Add the instructions from `skill-export-addon.md` to the GPT instructions or the skill package.
8. Test the action in Preview.

## 7. Secret handling note

Apps Script web apps do not expose arbitrary request headers to `doPost(e)`, so this implementation validates a shared secret inside the JSON body.

For a personal, private GPT this is acceptable. Do not publish the GPT or expose the secret in public instructions.

For a public or multi-user product, replace Apps Script with a proper backend such as Cloud Run, Vercel, or AWS Lambda and use header-based authentication plus per-user authorization.

## 8. Updating the deployment

After changing `Code.gs`:

1. Open **Deploy → Manage deployments**.
2. Edit the existing deployment.
3. Create a new version.
4. Deploy it.

The web app URL normally remains unchanged.

## Troubleshooting

### `Unauthorized request`

The `sharedSecret` sent by the action does not exactly match `EXPORTER_SHARED_SECRET` in Script Properties.

### `Google Docs API error (403)`

The Apps Script execution account does not have edit access to the target document, or the authorization scopes were not approved.

### The report appears in the first tab

Confirm the deployed version includes the current `Code.gs`. The current implementation sends the created `tabId` with every insert and formatting request.

### Duplicate tab names

This is expected. Existing tabs are never overwritten. The exporter appends `- 2`, `- 3`, and so on.

### Custom GPT cannot call the action

Confirm the schema server URL contains the correct deployment ID and that the GPT is configured with Actions rather than Apps. A GPT can use Actions to call external APIs defined by an OpenAPI schema.
