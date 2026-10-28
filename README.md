# OTMS – Overtime Monitoring System

Plain HTML + JavaScript front end, Supabase (Postgres + Auth) back end, hosted on Netlify.

```
public/            <- the ONLY folder Netlify publishes
  index.html  css/styles.css  js/app.js  js/config.js
supabase/schema.sql      tables, Row Level Security, pay computation, approval function
scripts/import-users.mjs bulk-create 1,000+ accounts (runs on your PC only)
netlify.toml             publish dir + security headers
```

## 1. Supabase
1. Create a project at supabase.com.
2. **SQL Editor** > paste all of `supabase/schema.sql` > Run.
3. **Authentication > Providers > Email**: turn **off** "Allow new users to sign up" (only admins create accounts), and set minimum password length to 10 or more.
4. **Project Settings > API**: copy the *Project URL* and the *anon public* key into `public/js/config.js`.
   The `service_role` key goes ONLY in your local `.env`. Never in `public/`, never in Git.

## 2. Create the accounts (1,000+)
1. Copy `users.sample.csv` to `users.csv`; fill one row per person. Columns: `employee_id,full_name,office,role,supervisor_employee_id,monthly_salary`. List supervisors and admins; each user's `supervisor_employee_id` links them to a supervisor. No commas inside fields.
2. Copy `.env.example` to `.env` and fill in the URL and service_role key.
3. `npm install` then `node --env-file=.env scripts/import-users.mjs users.csv` (Node 20.6+).
4. Random temporary passwords land in `credentials-out.csv`. Hand them out securely, then delete the file. Users change theirs with the **Password** button.
   Employees sign in with their Employee ID (it maps to `<id>@otms.example.com`; the domain is set in `config.js` and `.env`).

## 3. Run locally in VS Code
Install the **Live Server** extension, right-click `public/index.html` > *Open with Live Server*. Or: `npx serve public`.

## 4. Deploy to Netlify (free)
1. Push this folder to a private GitHub repo (`.gitignore` already excludes `.env`, `users.csv`, `credentials-out.csv`).
2. Netlify > *Add new site > Import from Git*. Build command: empty. Publish directory: `public` (already in `netlify.toml`).
3. In `netlify.toml`, replace both `YOUR-PROJECT-REF` in the Content-Security-Policy with your Supabase project ref, then commit and push.

## 5. Smoke test before real use
Sign in as an admin, a supervisor and a user, then check:
- a user sees only their own entries; a supervisor only their team; an admin everything
- file an entry and compare the saved amount with the formula (server value wins over the on-screen estimate)
- a supervisor cannot approve their own entry or another team's
- a user cannot approve anything, even when calling the API from the browser console
- sending a different `pay` or `status` from the browser console is ignored or rejected

## Operations notes
- Free Supabase projects can pause after about a week of inactivity and have limited backup options. Verify the current free-plan terms, and export your data regularly (table CSV exports or `pg_dump`). A backup only counts once you have restored it somewhere.
- The Supabase library is pinned to 2.45.4 in `index.html`. Check for a newer release you have vetted before upgrading.
- Default multipliers are common Philippine private-sector premiums. Confirm them against your agency's rules (admin: Rates & rules).
