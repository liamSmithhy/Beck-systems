# Beck Systems — Portal Setup

Your marketing site is unchanged. This adds a real client & project portal at
**/portal/** backed by Supabase (database + logins) and Stripe (payments).

Nothing here contains secrets — every key lives in Vercel environment variables.
Do these steps once and the portal goes live.

---

## What you'll connect
- **Supabase** — free account (database + secure logins). https://supabase.com
- **Stripe** — your account (payments). https://stripe.com
- **Vercel** — where the site already deploys.

---

## 1) Create a Supabase project
1. Sign in at supabase.com → **New project**. Pick any name/region, set a database
   password (save it), and wait ~2 minutes for it to provision.

## 2) Create the database
1. In Supabase: **SQL Editor → New query**.
2. Open `supabase/schema.sql` from this repo, paste the whole thing, click **Run**.
   This creates every table and the security rules (owner sees all; each client
   sees only their own data).

## 3) Create your owner login
1. In Supabase: **Authentication → Users → Add user**.
   - Email: `owner@becksystems.studio`
   - Password: `Manuel`
   - Turn ON **Auto Confirm User**.
2. Back in **SQL Editor**, run this to promote that user to owner:
   ```sql
   insert into public.profiles (id, role, full_name, email)
   select id, 'owner', 'Beck Systems', email from auth.users
   where lower(email) = 'owner@becksystems.studio'
   on conflict (id) do update set role = 'owner';
   ```
   > You'll log in with the username **BeckSystems** (the portal maps it to that
   > email automatically) and password **Manuel**. Change the password after your
   > first login — Supabase → Authentication → Users → your user.

## 4) Get your Supabase keys
Supabase → **Project Settings → API**. Copy three values:
- **Project URL**  → `SUPABASE_URL`
- **anon public** key → `SUPABASE_ANON_KEY`
- **service_role** key → `SUPABASE_SERVICE_ROLE_KEY`  *(secret — never share)*

## 5) Set up Stripe
1. Stripe Dashboard → **Developers → API keys** → copy the **Secret key**
   (`sk_live_…` or `sk_test_…`) → `STRIPE_SECRET_KEY`.
2. Stripe Dashboard → **Developers → Webhooks → Add endpoint**:
   - URL: `https://www.becksystems.studio/api/stripe-webhook`
   - Event: **checkout.session.completed**
   - After creating it, copy the **Signing secret** (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.

## 6) Add environment variables in Vercel
Vercel → your project → **Settings → Environment Variables**. Add these (Production):

| Name | Value |
|------|-------|
| `SUPABASE_URL` | your Project URL |
| `SUPABASE_ANON_KEY` | anon public key |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `STRIPE_SECRET_KEY` | Stripe secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `APP_URL` | `https://www.becksystems.studio` |

Then **Deployments → Redeploy** so the new variables take effect.

---

## 7) You're live
- Go to **https://www.becksystems.studio/portal/**
- Log in as **BeckSystems / Manuel** → you land on the **owner dashboard**.
- Create a client: **Clients → Create a client account** (their email + a starting
  password). Give them those; they log in with their **email**.
- Open a client to add their **project, milestones, invoices, and contracts**, and
  update progress / deployment status — they see it live.
- Clients can submit **feedback/revisions** and **maintenance tickets**; those show
  up in your **Feedback** and **Tickets** tabs.
- When a client pays an invoice, Stripe Checkout runs and the invoice flips to
  **Paid** automatically via the webhook.

## Security notes
- The **anon key is safe to be public** — the database is protected by row-level
  security so clients can only ever read/write their own rows.
- The **service_role** and **Stripe** keys are secret and only ever used inside the
  serverless functions (`/api`), never sent to the browser.
- Please change the owner password from `Manuel` to something strong after first login.
- Test with Stripe **test mode** keys first if you want to try a payment without
  real money (card `4242 4242 4242 4242`, any future expiry/CVC).
