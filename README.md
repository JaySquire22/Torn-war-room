# Torn War Room

A shared availability planner for coordinating faction wars across timezones.

## What this is

A React + Vite app, using Supabase as the shared backend (replacing the
Claude-artifact-only `window.storage` it started life with). Deploying this
gives you one fixed URL that keeps working across every future code update -
no more re-sharing new links every time something changes.

## Environment variables

This app needs two environment variables to connect to Supabase:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

Both are safe to expose publicly (the publishable key is designed for
client-side use - it only works within the access rules/policies set on the
Supabase table itself). Set them in your hosting provider's dashboard
(e.g. Vercel's Project Settings -> Environment Variables) rather than
committing a real `.env` file.

See `.env.example` for the expected format.

## Local development (optional)

If you ever want to run this on a real computer instead of just deploying it:

```
npm install
cp .env.example .env   # then fill in the real values
npm run dev
```

## Deployment

Push this project to a GitHub repository, then connect that repository to
Vercel (or Netlify/Cloudflare Pages). Set the two environment variables in
the host's dashboard before the first deploy. Every future push to the repo
automatically redeploys to the same URL.
