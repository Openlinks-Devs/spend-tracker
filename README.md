# SpendTracker Agent

Autonomous agent that scans Gmail for bank transaction emails, records them in
Postgres, and notifies over Telegram. Port of the original n8n flow.

## Setup

1. `cp .env.example .env` and fill in the values.
2. Get a Gmail refresh token: run the app, open `/oauth/start`, complete the Google
   consent screen, then copy the `GOOGLE_REFRESH_TOKEN` printed by `/oauth/callback`
   into your `.env`.
3. Register the Telegram webhook:
   ```
   npx tsx src/scripts/set-webhook.ts
   ```
4. Run locally:
   ```
   npm run dev
   ```
5. Build and start:
   ```
   npm run build
   npm start
   ```

## Docker

```
docker build -t spend-tracker .
docker run --env-file .env -p 3000:3000 spend-tracker
```

## Tests

```
npm test
```
