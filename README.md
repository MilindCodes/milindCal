# MilindCal

Dark themed, Google-synced personal calendar built with Next.js + TypeScript.

## Included in v1

- Google OAuth sign-in only
- Two-way Google Calendar sync (read/create/update/delete)
- Push channel wiring for near-real-time event refresh
- Create new Google calendars
- Day / Week / Month / Year calendar views
- Event editor with:
  - attendees
  - recurrence
  - reminders (email + popup)
  - location
  - event type color mapping
- Local tasks sidebar (saved in browser localStorage)
- Gmail inbox panel in the sidebar with full-read, archive, and quick-reply

## Tech stack

- Next.js (App Router)
- TypeScript
- NextAuth.js
- Google Calendar API (`googleapis`)
- Gmail API (`googleapis`)
- FullCalendar
- Framer Motion

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Copy env vars:

```bash
cp .env.example .env.local
```

3. Fill `.env.local` with your Google OAuth credentials.

4. For push webhooks, set `GOOGLE_WEBHOOK_URL` to a public HTTPS URL:

- Production example: `https://your-domain.com/api/google/watch/webhook`
- Local development: use an HTTPS tunnel URL (for example, Cloudflare Tunnel or ngrok)

5. Start dev server:

```bash
npm run dev
```

## Google OAuth setup

In Google Cloud Console:

1. Create an OAuth Client ID (Web Application).
2. Add authorized redirect URI:

- `http://localhost:3000/api/auth/callback/google`

3. Enable Google Calendar API and Gmail API for the same project.
4. In your OAuth consent/scopes, ensure calendar + Gmail scopes are allowed:

- `https://www.googleapis.com/auth/calendar`
- `https://www.googleapis.com/auth/gmail.modify`
- `https://www.googleapis.com/auth/gmail.send`

## Deployment options

### 1) Vercel (recommended for this app)

- Fastest path for Next.js deployment
- Add environment variables in Vercel project settings
- Required env vars:
  - `NEXTAUTH_URL`
  - `NEXTAUTH_SECRET`
  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_WEBHOOK_URL`
  - `WATCH_WEBHOOK_SECRET`
- Add production callback URL in Google OAuth:
  - `https://<your-domain>/api/auth/callback/google`
- Set webhook URL env:
  - `GOOGLE_WEBHOOK_URL=https://<your-domain>/api/google/watch/webhook`

### 2) Railway/Render

- Better when you want long-running workers and cron in the same service
- Deploy the same Next.js app and set environment variables

### 3) Google Cloud Run

- Most control and strongest GCP integration
- More infra setup overhead

### 4) Firebase Hosting + Functions

- Fully managed within Google ecosystem
- Good if you want to expand into more Firebase services

## Notes

- Tasks are stored locally in the browser on the same computer/profile.
- This is currently single-user personal usage by design.
- Push watch channel metadata is stored in `WATCH_STATE_PATH` (default `/tmp/milindcal-watch-state.json`).
- On multi-instance/serverless production, use a shared data store (Redis/Postgres) for watch state in the next hardening pass.
- If push setup fails (for example, no HTTPS webhook URL), the UI automatically falls back to polling refresh.
- After adding new OAuth scopes, sign out and sign in again so Google issues a token with the new permissions.
