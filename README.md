# RallyScore

Volleyball-first live scoreboard ecosystem. Free Lite app for the App Store funnel, Pro subscription with live video and family notifications.

**Live demo (after deployment):** https://rallyscore.vercel.app
**Stack:** Static HTML + Supabase (Postgres, Realtime, Auth) + WebRTC (peer-to-peer video) + Stripe (subscriptions) + Vercel (hosting)

---

## File map

```
rallyscore/
├── public/                          ← static site (deployed to Vercel)
│   ├── index.html                   Hub / landing page
│   ├── lite.html                    Free universal scoreboard (offline + localStorage)
│   ├── app.html                     Pro fan companion (live scoreboard, team page, stats)
│   ├── viewer.html                  Pro live broadcast viewer (WebRTC + scoreboard sync)
│   ├── broadcaster.html             Pro broadcaster (the scorer's iPhone-on-tripod app)
│   └── account.html                 User account / subscription management
├── src/                             ← shared client-side modules
│   ├── supabase-client.js           Supabase config, auth, realtime helpers
│   ├── webrtc-live.js               WebRTC broadcaster ↔ viewer signaling
│   └── auth-ui.js                   Magic-link sign-in modal + paywall modal
├── api/                             ← Vercel serverless functions
│   ├── create-checkout-session.js   POST → Stripe Checkout URL
│   └── stripe-webhook.js            Stripe → Supabase subscription sync
├── supabase/
│   └── schema.sql                   ← run this in your Supabase SQL Editor
├── vercel.json                      Routing + headers
└── package.json                     Stripe + Supabase server SDK
```

---

## 5-minute setup

### Step 1. Run the SQL schema in Supabase

1. Open [supabase.com/dashboard](https://supabase.com/dashboard) → your project → **SQL Editor** → **New query**.
2. Open `supabase/schema.sql` from this repo, copy the entire contents into the editor.
3. Click **Run**. You should see: `Success. No rows returned.`
4. Confirm by going to **Table Editor** — you should see ~13 tables (`profiles`, `clubs`, `teams`, `players`, `matches`, `points`, etc.) and one demo team called *Madison Eagles 16U* with 7 players seeded in.

### Step 2. Enable Magic Link auth

1. **Authentication → Providers → Email**.
2. Toggle "Enable Email Provider" **on**.
3. Toggle "Enable email confirmations" **off** for now (smoother demo). Re-enable for production.
4. Toggle "Enable Magic Link" **on**.
5. **Settings → Authentication → URL Configuration**:
   - Site URL: `https://rallyscore.vercel.app` (or your domain)
   - Redirect URLs: add `https://rallyscore.vercel.app/**` (the `**` is important — it matches `/account.html`, `/viewer.html?match=…`, etc.)

### Step 3. Configure the frontend

The Supabase URL + publishable key are already injected in:
- `public/lite.html` (none needed — Lite is offline)
- `public/app.html`
- `public/viewer.html`
- `public/broadcaster.html`
- `public/account.html`
- `src/supabase-client.js`

If you ever need to swap the project, search-and-replace these two strings everywhere:
```
https://vasmvjhxpgfxitvadndh.supabase.co
sb_publishable_vZjergeml_5fTODHt-KApA_hMR2-Y6y
```

### Step 4. Deploy to Vercel

**Option A — via GitHub (recommended):**
1. Push this folder to a GitHub repo.
2. Go to [vercel.com/new](https://vercel.com/new) → Import the repo.
3. **Don't change any build settings** — `vercel.json` handles it. Output directory is `public`.
4. Click **Deploy**.

**Option B — via CLI:**
```bash
npm install -g vercel
vercel login
vercel --prod
```

You should now have a working site at `https://your-project.vercel.app`.

### Step 5. Test the end-to-end flow

1. Open `/broadcaster.html` on your phone or laptop (any device with a camera).
2. Fill in team names, tap each pre-flight check, enable the camera, tap **Go live**.
3. You'll be asked to sign in with magic link — check your inbox.
4. After clicking the link, you're redirected back. Tap **Go live** again. The 3-2-1 countdown plays, then you're scoring.
5. On a **second device** (or a second browser), open `/viewer.html` and tap **Join live**. You should see the camera feed and live scoreboard.
6. Score a point on the broadcaster — the viewer's score bumps within ~1 second.
7. Open `/app.html` on a third device — the Live tab should show the same match data.

---

## Stripe setup (for paid subscriptions)

The site works without Stripe — paywall flows show a "demo mode" message. To enable real payments:

### Step 1. Create products in Stripe

1. [stripe.com/dashboard](https://dashboard.stripe.com) → **Products → Add product**.
2. Create **RallyScore Pro Family — Monthly**: $4.99/month, recurring. Copy the price ID.
3. Create **RallyScore Pro Family — Yearly**: $39.99/year, recurring. Copy the price ID.

### Step 2. Set environment variables in Vercel

Vercel project → Settings → Environment Variables. Add:

| Key                                | Value (example)                           |
|------------------------------------|-------------------------------------------|
| `STRIPE_SECRET_KEY`                | `sk_live_…` or `sk_test_…`                |
| `STRIPE_FAMILY_PRICE_ID`           | `price_…` (monthly)                       |
| `STRIPE_FAMILY_YEARLY_PRICE_ID`    | `price_…` (yearly)                        |
| `STRIPE_WEBHOOK_SECRET`            | `whsec_…` (set after step 3)              |
| `SUPABASE_URL`                     | `https://vasmvjhxpgfxitvadndh.supabase.co`|
| `SUPABASE_SERVICE_ROLE_KEY`        | `eyJ…` (Settings → API → service_role)    |
| `PUBLIC_SITE_URL`                  | `https://rallyscore.vercel.app`           |

⚠ **The `service_role` key bypasses Row Level Security** — only use it in serverless functions, never in browser code.

### Step 3. Configure the Stripe webhook

1. Stripe Dashboard → **Developers → Webhooks → Add endpoint**.
2. Endpoint URL: `https://rallyscore.vercel.app/api/stripe-webhook`.
3. Events to send (select these 6):
   - `checkout.session.completed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
4. Click **Add endpoint**, then click on it and reveal the **Signing secret** (starts with `whsec_…`). Copy it into the `STRIPE_WEBHOOK_SECRET` env var in Vercel and redeploy.

### Step 4. Update the frontend with the publishable key

In each HTML page, find the `__RALLYSCORE_CONFIG__` block and add:
```js
STRIPE_PUBLISHABLE_KEY: 'pk_live_…',
STRIPE_FAMILY_PRICE_ID: 'price_…',
STRIPE_FAMILY_YEARLY_PRICE_ID: 'price_…',
```

---

## How it works under the hood

### Live scoreboard sync

The broadcaster calls `score_point` (a Postgres function defined in `schema.sql`) which atomically:
1. Increments the score
2. Detects set/match wins (volleyball best-of-3/5 with 2-point lead, 5th set to 15)
3. Inserts a row in `points` and optionally `match_sets`
4. Updates the `matches` row

All connected viewers receive the update via Supabase Realtime (Postgres logical replication → WebSocket) in ~200ms.

### Live video

Pure WebRTC peer-to-peer with Supabase Realtime as the signaling channel. No server bills for media transit. Limit: ~30 concurrent viewers per match before the broadcaster's upstream becomes the bottleneck.

When you exceed that, swap `src/webrtc-live.js` for a Mux/IVS implementation (the broadcaster.html / viewer.html public surface stays the same — just the internals change).

### COPPA / privacy

The schema has a `player_follows.is_verified` boolean and an `approved_by` reference. The intent is: a parent requests to follow their kid, the club admin approves. Until verified, they don't get score notifications.

For full compliance you'd add a club admin dashboard (not in this MVP) — but the data model is ready. Until then, every follow counts as "pending verification" so it's safe to demo to clubs.

---

## Going to the App Store

`lite.html` is the App Store candidate. It's offline-capable, has its own settings, persists state to `localStorage`, and exports match summaries. To wrap it for the stores:

```bash
npm i -g @ionic/cli
npx cap init RallyScore com.rallyscore.lite --web-dir=public
npx cap add ios
npx cap add android
npx cap copy
npx cap open ios
```

Apple developer account: $99/year. Google Play: $25 once.

Apple's #1 reason for rejecting "scoreboard" apps is **thin content**. Lite already has Settings, multi-sport rules, IAP placeholders, and PDF export — that should clear the bar. Add 3-4 screenshots, a privacy policy URL, and the App Store Connect listing.

---

## Roadmap

| When | What |
|---|---|
| Now | Lite to App Store · pilot 3-5 clubs on Pro web |
| Month 2 | Club admin dashboard (manage families, approve verifications, manage roster) |
| Month 3 | Auto-clip engine (slice 8-12s around each scored point) |
| Month 6 | Switch from WebRTC P2P to Mux Live for 100+ viewer matches |
| Month 12 | Sponsorship layer (local businesses overlay on club broadcasts) |

---

## Questions / debugging

- **Magic link redirects don't work** → check your Site URL and Redirect URLs in Supabase Auth settings.
- **Realtime updates not arriving** → check the table is in the publication (`schema.sql` registers them, but if you re-run only parts, double-check `select * from pg_publication_tables`).
- **WebRTC fails on cellular** → add a TURN server (Cloudflare Calls, Twilio NTS, or self-host). STUN-only works ~85% of the time.
- **Apple / iOS Safari camera issues** → `getUserMedia` requires HTTPS. Vercel domains are HTTPS by default — you're fine.
