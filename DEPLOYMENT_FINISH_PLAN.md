# Deployment Finish Plan

> **Superseded 2026-10-12.** The app no longer runs on Vercel + Hostinger MySQL: the API and
> database moved to the VPS (`https://connect-api.amatoautomotive.co.in`). See **`DEPLOYMENT.md`**
> for the current setup. This file is kept for history (Vercel setup, upload-storage notes, the
> 2026-07-06 migration incident). Hostinger FTP upload storage described below is still in use.

This file is local memory for the final production rollout. Do not paste real passwords, FTP credentials, JWT secrets, salary keys, or database URLs into this file.

**Redeployed 2026-10-01** (branch `perf-mobile-and-home-redesign`): backend now runs in Vercel region `bom1` (Mumbai) via `"regions": ["bom1"]` in `server/vercel.json`, next to the Hostinger DB — responses show `X-Vercel-Id: bom1::bom1::…` (previously `bom1::iad1`, i.e. US). DB-backed requests dropped from ~2.1s to ~0.3–0.5s. Deployed with `npx vercel deploy --prod` from `server/` (CLI logged in as the project owner).

**Status as of 2026-07-06:** Full stack is deployed and verified live:

- Backend: `https://auto-hr-api.vercel.app` (Vercel project `auto-hr-api`, team `prabhatthakurs-projects`). `/api/health` returns 200, DB queries and auth both confirmed working against the real Hostinger MySQL database.
- Frontend: `https://connect.amatoautomotive.co.in` (Hostinger, `/public_html/connect`). Loads correctly, talks to the backend (CORS verified), SPA routing/refresh fixed via `.htaccess`.
- Uploads: **all** file/media uploads across the app (avatars, hero banners, E-Library documents, course thumbnails/module content, learning path thumbnails, announcement media) now go through `putUploadFile` to Hostinger FTP instead of base64-in-DB. Employee documents (private, per-employee, authenticated) go through a separate `putPrivateUploadFile`/`getPrivateUploadFile` pair — stored outside the public webroot (`/private-uploads`, sibling to `public_html`, not reachable by any URL), only ever fetched server-side after an auth check in `documents.ts`, never given out as a direct link.
- A one-time migration (`npm run migrate:storage -- --apply`) converted all pre-existing base64 rows to real uploaded files. See "Known incident" below — worth reading before touching this script again.

The employee user provisioning script (`users:provision`) referenced near the bottom does **not** exist in the repo; that section is a spec for future work, not a completed step.

## Known incident: Git Bash path mangling destroyed test data during migration (2026-07-06)

While running `scripts/migrateBase64ToStorage.ts` from this project's Bash tool (Git Bash / MSYS on Windows), env vars set inline on the command line (e.g. `FTP_REMOTE_ROOT=/connect/uploads node ...`) were **silently rewritten** by MSYS's automatic POSIX-path-to-Windows-path conversion: `/connect/uploads` became `C:/Program Files/Git/connect/uploads`. The FTP client happily created that directory tree on Hostinger and reported success; the DB rows were updated with URLs pointing at the correct intended path (`https://connect.amatoautomotive.co.in/uploads/...`), which doesn't match where the bytes actually went — so every migrated row broke, and clearing the old base64 columns as part of the same "successful" write lost the source content.

**Root cause, in one line:** never set a leading-`/` FTP/path env var inline in a Git Bash command on Windows. Either use PowerShell (confirmed clean — no mangling), or prefix the value with `MSYS_NO_PATHCONV=1`, or load it from a real `.env` file via `dotenv`.

**What was actually lost:** all of it was pre-launch test/placeholder content (3 hero banners, 1 library doc, 2 course thumbnails, 2 course module files, 2 announcement media, 1 test employee document) — confirmed with the user, nothing a real employee had uploaded. The broken rows were deleted (HeroBanner, LibraryDocument, AnnouncementMedia) or had just their thumbnail/content URL cleared back to null (Course, CourseModule) so the underlying records survived. One real employee document (Aadhar card, employee 24) was migrated correctly afterward, verified byte-for-byte against the original.

**If this script needs to run again** (e.g. after restoring a DB backup that reintroduces old base64 rows): run it via PowerShell, dry-run first (no `--apply`), and manually verify at least one row's file exists on Hostinger via FTP `list` before trusting the "Migration complete" message.

## Target Setup

- Backend API: Vercel
- Database: Hostinger MySQL
- Static frontend: Hostinger website hosting
- Upload storage: Hostinger FTP-backed public upload folder for public assets such as avatars
- Domain: already configured by owner

## Backend On Vercel

✅ Deployed. Project root: `server`. Live URL: `https://auto-hr-api.vercel.app`.

Vercel entry (zero-config `/api` convention, not the legacy `builds` key):

- `api/index.ts` re-exports the app from `src/vercel.ts` — this is what Vercel actually builds and runs as the serverless function.
- `src/vercel.ts` exports the Express app without `app.listen()` and without schedulers.
- `vercel.json` no longer uses `builds`/`routes` (legacy format skipped TypeScript errors and shipped broken builds — this bit us during setup). It now uses `rewrites` to send `/api/*` to `/api`, plus a no-op `buildCommand` and a placeholder `public/` dir, because this project has no static output — the framework preset otherwise expects one.
- `package.json` has a `postinstall: prisma generate` script. This is required — without it, Vercel's build never generates the Prisma client and every file importing `@prisma/client` types (`Role`, etc.) fails to compile.
- Local `src/index.ts` remains for normal development and starts schedulers. (Unchanged.)

Environment variables — all already set on the Vercel project (Production) via `vercel env add`, values pulled from local `.env` plus the fixes below. Nothing here is stored in this file:

```text
DATABASE_URL              (same Hostinger MySQL URL as local .env)
JWT_SECRET                (regenerated — local .env still has the placeholder, do not reuse it)
JWT_EXPIRES_IN=24h
NODE_ENV=production
FRONTEND_URL=https://connect.amatoautomotive.co.in
SALARY_API_KEY / SALARY_ENCRYPTION_KEY   (same as local .env)
SMTP_HOST / PORT / USER / PASSWORD / FROM (same as local .env)
UPLOAD_STORAGE_DRIVER=hostinger-ftp
UPLOAD_PUBLIC_BASE_URL=https://connect.amatoautomotive.co.in/uploads
FTP_HOST=217.21.90.142
FTP_PORT=21
FTP_USER=u823909847.connect   (Hostinger auto-prefixes the account number — the plain "connect" username shown at account-creation time does NOT work)
FTP_PASSWORD                  (set on Vercel; weak by choice, see Hostinger Upload Storage section)
FTP_SECURE=false
FTP_REMOTE_ROOT=/connect/uploads   (relative to this FTP account's jail root, which is /public_html — "connect" is the existing subfolder serving connect.amatoautomotive.co.in)
```

Notes:

- `JWT_SECRET` on Vercel is a real random 64-byte value, not the `CHANGE_THIS_TO_A_RANDOM_64_CHAR_STRING` placeholder still sitting in local `.env` — don't copy that placeholder into any other environment.
- Use a stable `SALARY_ENCRYPTION_KEY`; changing it after salary slips are generated will make existing encrypted values unreadable.
- Vercel serverless should not run interval schedulers. The Vercel entry intentionally avoids `startAnnouncementScheduler`, `startLearningReminderScheduler`, `startLearningAutoAssignScheduler`, and `startCertificateExpiryScheduler`.
- ✅ Scheduled jobs run via **Vercel Cron** (added 2026-10-01): `vercel.json` → `crons` calls `GET /api/cron/daily` at `30 3 * * *` UTC (09:00 IST). It runs course due/overdue reminders, course auto-assignment, certificate-expiry notices and an announcement catch-up (`server/src/routes/cron.ts`). Daily is the Hobby-plan limit and fine for these day-granular jobs.
- The endpoint only accepts `Authorization: Bearer <CRON_SECRET>` (Vercel sends this automatically). `CRON_SECRET` is set on the Vercel project (Production). If you ever re-create it, pipe the value from Git Bash — PowerShell piping added a BOM and a literal `
` to the stored value.
- Scheduled announcements also publish on demand: `GET /api/notifications` (polled every 30s by logged-in clients) calls `processDueAnnouncementsThrottled()`, at most once a minute per instance, so they go out on time without waiting for the daily cron.
- `BIOMETRIC_DEVICE_IP` (LAN-only device, `192.168.1.224`) is unreachable from Vercel. The manual attendance-sync endpoint in `server/src/routes/attendance.ts` that uses it will fail if triggered in production — it's not a background job, so it won't crash the server, but the feature itself won't work unless run from a machine on that LAN.
- A stray, unused Vercel project named `server` (auto-created before we renamed to `auto-hr-api`) still exists in the account and can be deleted manually from the dashboard.

## Frontend On Hostinger

Set frontend API URL before building:

```text
VITE_API_URL=https://your-api-domain/api
```

Build:

```powershell
cd D:\HR_Project\frontend
npm.cmd run build
```

Upload the contents of:

```text
D:\HR_Project\frontend\dist
```

✅ Deployed. Live at `https://connect.amatoautomotive.co.in`, served from `/public_html/connect` on the Hostinger account (this is the same subfolder later reused as `FTP_REMOTE_ROOT`'s parent for uploads — `connect/uploads`). Uploaded via FTP using the same `u823909847.connect` account as the upload driver.

Built with:

```powershell
cd D:\HR_Project\frontend
$env:VITE_API_URL="https://auto-hr-api.vercel.app/api"
npm run build
```

SPA deep-link/refresh 404s: ✅ fixed. Added `/public_html/connect/.htaccess` with a rewrite-to-`index.html` fallback for any path that isn't a real file/directory. Verified `/dashboard` (and by extension any other client-side route) returns 200 directly, while `/assets/*` and `/uploads/*` still serve as real files/get their own 403-on-listing rule untouched.

To redeploy the frontend after a code change: rebuild with the same `VITE_API_URL`, then FTP-upload the new `dist/` contents into `/connect` (overwriting `index.html` and `assets/`); leave `.htaccess`, `uploads/`, and `default.php` alone.

- Upload `assets/` first and `index.html` last, so the live page never references files that aren't there yet.
- `dist/assets/.htaccess` (from `frontend/public/assets/.htaccess`) marks the content-hashed bundles as cacheable for a year. It must be uploaded with the rest of `assets/`; it only affects `/connect/assets`, not the root `.htaccess`.
- The FTP password is on the Vercel project (`FTP_PASSWORD`); `vercel env pull` retrieves it — keep only the FTP_* lines and delete the pulled file afterwards.

## Hostinger Upload Storage

✅ Implemented and verified end-to-end (uploaded a real PNG via FTP, fetched it back over HTTPS, got 200 with correct image bytes).

`server/src/utils/uploadStorage.ts` picks local-disk vs Hostinger FTP based on `UPLOAD_STORAGE_DRIVER`. Every public-media route (`avatarStorage.ts`, `heroBanners.ts`, `library.ts`, `learning.ts` course/module/path thumbnails and content, `announcements.ts` media) calls `putUploadFile` instead of inlining base64. Default remains `local` (dev-safe); Vercel is set to `hostinger-ftp`.

On first FTP upload per cold start, the driver also uploads an `.htaccess` with `Options -Indexes` into `FTP_REMOTE_ROOT`, so the uploads folder can't be browsed as a directory listing — only files whose exact (random UUID) name you already have are reachable.

Env vars: see the Vercel section above — same values, this is the same driver.

Expected public URL shape:

```text
https://connect.amatoautomotive.co.in/uploads/avatars/<prefix>-<uuid>.<ext>
https://connect.amatoautomotive.co.in/uploads/hero-banners/<uuid>.<ext>
https://connect.amatoautomotive.co.in/uploads/library/<uuid>.<ext>
https://connect.amatoautomotive.co.in/uploads/course-thumbnails/<uuid>.<ext>
https://connect.amatoautomotive.co.in/uploads/course-modules/<uuid>.<ext>
https://connect.amatoautomotive.co.in/uploads/learning-path-thumbnails/<uuid>.<ext>
https://connect.amatoautomotive.co.in/uploads/announcements/<uuid>.<ext>
```

### Employee documents — private storage, not public uploads

Employee documents (`EmployeeDocument` model, `server/src/routes/documents.ts`) are per-employee, access-controlled, and audited on download — they must never be reachable by a guessable public URL the way avatars are. They use a separate pair of functions in the same file: `putPrivateUploadFile` / `getPrivateUploadFile` / `removePrivateUploadFile`.

- Storage path: `FTP_PRIVATE_REMOTE_ROOT` (`/private-uploads`), a **sibling of `public_html`** on this FTP account's own jail root — not a subfolder of `connect/uploads`, not served by any domain's document root. Even without the `.htaccess`, there is no URL that reaches it.
- Defense in depth anyway: an `.htaccess` with `Require all denied` is uploaded into that folder on first write, same pattern as the public folder's anti-listing `.htaccess`.
- The DB row (`EmployeeDocument.storageKey`) holds only the relative path (e.g. `employee-documents/24/<uuid>.jpg`) — never a URL. `GET /api/documents/:id/download` is the only way to read the bytes: it checks the requester can access that employee's documents (self/team/HR scoping, same as before), fetches the bytes over FTP server-side, and returns them as a `data:` URL in the JSON response — the browser never gets a direct Hostinger link.
- `EmployeeDocument.contentBase64` is now nullable and kept only as a fallback for rows not yet migrated (`storageKey IS NULL`) — `toDownloadPayload()` in `documents.ts` reads from FTP if `storageKey` is set, else falls back to the inline column.

Security notes:

- The FTP account (`u823909847.connect`) is scoped to Hostinger's main `public_html` jail, same as the primary account — it is **not** restricted to only the `connect/uploads` subfolder. A leaked credential could write anywhere under `public_html`, including inside the WordPress install that lives there. Consider asking Hostinger/hPanel whether a home-directory-restricted FTP account is possible for tighter scoping.
- `FTP_SECURE=false` (plain FTP, not FTPS) — credentials and file bytes are sent unencrypted between Vercel and Hostinger on every upload. Password was also kept as a weak user-chosen value against a stronger-password recommendation (removed from this file 2026-10-12 — it was exposed in a public repo; rotate it). Both were explicit user calls, not blockers, but worth revisiting if this account's blast radius ever becomes a concern.

## One-time base64 → storage migration script

`server/scripts/migrateBase64ToStorage.ts` (run via `npm run migrate:storage` or `npm run migrate:storage -- --apply`). Converts any remaining `data:mime;base64,...` rows in HeroBanner, LibraryDocument, Course, LearningPath, CourseModule, AnnouncementMedia, and EmployeeDocument into real Hostinger-hosted files, updating each row to point at the new location. Safe to re-run — only touches rows that still look like inline base64/null `storageKey`. **Read the "Known incident" note near the top of this file before running it** — it must be run from PowerShell, not Git Bash, on Windows.

## Employee User Provisioning

❌ Not built. There is no `users:provision` script in `server/package.json` and no matching file in `server/scripts`. The commands and "dry-run result" below are a spec for future work, not something that has run. Treat this whole section as not-yet-implemented until the script actually exists.

Dry run:

```powershell
cd D:\HR_Project\server
npm.cmd run users:provision
```

Apply with a generic password:

```powershell
cd D:\HR_Project\server
npm.cmd run users:provision -- --apply --password="YourGenericPasswordHere"
```

Behavior:

- Creates users only for active employees who do not already have a linked user.
- Existing users are not modified.
- Default role is `EMPLOYEE`.
- Username is generated from employee number, email local-part, biometric id, or name, with collision handling.

Current dry-run result on 2026-07-03:

```text
No active employees without users were found.
```

## Known Fixed Bugs (from this deployment)

- `server/src/config/env.ts` used `z.coerce.boolean()` for `FTP_SECURE`. Zod's coercion does `Boolean(value)` on the raw string, so the literal string `"false"` coerced to `true` (any non-empty string is truthy) — meaning FTPS would have been silently forced on regardless of the env var's actual value, breaking connections to a plain-FTP-only server. Fixed with an explicit `"true"/"false"` enum-to-boolean transform (`booleanString()` helper in the same file). Any other boolean env var added in the future should use the same helper, not `z.coerce.boolean()`.

## Verification Commands

```powershell
cd D:\HR_Project\server
npx.cmd prisma validate
npx.cmd prisma generate
npm.cmd run build

cd D:\HR_Project\frontend
npm.cmd run build
```

Local health:

```powershell
Invoke-WebRequest -Uri http://localhost:3001/api/health -UseBasicParsing
Invoke-WebRequest -Uri http://localhost:5173 -UseBasicParsing
```

