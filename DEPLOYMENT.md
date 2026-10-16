# Autoform Connect (HR Portal) — Deployment Guide

How the app is deployed, how to make changes live, and the gotchas to avoid.
Written after moving off Vercel to the VPS (2026-10-12). Never put passwords, keys or
database URLs in this file — the repo is public.

---

## 1. Architecture at a glance

| Part | Tech | Where it runs | Public URL |
|------|------|---------------|------------|
| Frontend | React + Vite (static) | **Hostinger** static hosting, `/public_html/connect` | `https://connect.amatoautomotive.co.in` |
| Backend API | Express + Prisma (Node 20) | **VPS** `srv1645350`, PM2 `hr-api`, behind nginx | `https://connect-api.amatoautomotive.co.in/api` |
| Biometric receiver | Node TCP server | **VPS**, PM2 `hr-biometric`, port 5005 | (device only, office IP only) |
| Database | MySQL 8 | **VPS**, `127.0.0.1:3306`, db `hr_portal`, user `hr_user` | (not public) |
| Uploaded files | Hostinger FTP | `/public_html/connect/uploads` (public), `/private-uploads` (employee docs) | `https://connect.amatoautomotive.co.in/uploads/...` |

```
Browser ──> connect.amatoautomotive.co.in        (Hostinger: static React app)
   └─ fetch ──> connect-api.amatoautomotive.co.in (VPS: nginx ──> hr-api :3001 ──> MySQL hr_portal)

Biometric device (office LAN) ──TCP 5005──> VPS hr-biometric ──> MySQL hr_portal
```

The API URL is **baked into the frontend at build time** (`VITE_API_URL`).

---

## 2. Infrastructure reference

### VPS (shared with other projects — be careful)
- Host `srv1645350`, IP `187.127.162.249`, Ubuntu 24.04, SSH user `deploy`.
- Also runs **`warranty-api`** (port 3000) and **`mis-api`** (port 8000). Do not touch their PM2
  processes, nginx sites or databases.
- HR checkout: `/home/deploy/HR_Portal` (server code in `server/`).
- Secrets: `/home/deploy/HR_Portal/server/.env` (mode 600, not in git). DB credentials also in
  `server/.db_credentials`.

### PM2 processes
| Name | Command | Port |
|------|---------|------|
| `hr-api` | `node dist/index.js` (cwd `server/`) | 127.0.0.1:3001 |
| `hr-biometric` | `node dist/biometricServer.js` (cwd `server/`) | 0.0.0.0:5005 |

Background jobs (announcement publishing, course reminders, auto-assign, certificate expiry)
run **inside `hr-api`** on timers — there is no cron any more.

### nginx / TLS
- Site: `/etc/nginx/sites-available/connect-api` → `127.0.0.1:3001`, `client_max_body_size 60M`.
- Let's Encrypt cert for `connect-api.amatoautomotive.co.in` (auto-renews; `sudo certbot certificates`).

### Firewall (ufw)
- Port **5005** allowed from the office ISP's address block **`122.161.0.0/16`** (Airtel Delhi
  broadband, rule comment "HR biometric device push"). The office line has a **dynamic** IP that
  changes whenever the router loses power (several times a day) and no static IP is available, so a
  single-IP rule doesn't work. The device reconnects on its own once its new IP is allowed.
- Compromise: other Airtel Delhi broadband users can reach the port. They can't read anything —
  the receiver only accepts punches. Hardening in `biometricServer.ts`: allowed device serial only,
  TransIDs more than 1000 past the last stored one are refused, 16 KB message cap, 4 connections
  per IP, and every punch records `source_ip` so forged ones can be found and deleted.
- If the card shows Offline for long and the office IP (`curl https://api.ipify.org` from the
  office) is outside that block, add its block too:
  `sudo ufw allow from <block> to any port 5005 proto tcp comment 'HR biometric device push'`.
  The device holds its punches and resends them, so nothing is lost while it's blocked.
- Pre-existing, not ours: 3306 (MySQL) is open to Anywhere — worth closing if nothing needs it.

### DNS
- `connect-api.amatoautomotive.co.in` → A `187.127.162.249` (Hostinger DNS). **No AAAA record**
  (an old Hostinger IPv6 record would send IPv6 users to Hostinger). Don't recreate a Hostinger
  "subdomain" with this name — it re-adds those records.

---

## 3. Environment variables (`server/.env` on the VPS)

| Key | Notes |
|-----|-------|
| `DATABASE_URL` | `mysql://hr_user:<pass>@127.0.0.1:3306/hr_portal` |
| `JWT_SECRET` | strong random (≥64 chars). Changing it logs everyone out. |
| `NODE_ENV=production`, `PORT=3001` | |
| `FRONTEND_URL` | `https://connect.amatoautomotive.co.in` (CORS) |
| `SALARY_ENCRYPTION_KEY` | **Never change** once real salary slips exist — they become unreadable. Keep a copy in a password manager. (The 2026-10-12 move used the local key; the one pre-move dev slip is unreadable.) |
| `SALARY_API_KEY` | Tally sync script auth |
| `SMTP_*` | outgoing email |
| `UPLOAD_STORAGE_DRIVER=hostinger-ftp`, `UPLOAD_PUBLIC_BASE_URL`, `FTP_*` | Hostinger upload storage. `FTP_REMOTE_ROOT=/connect/uploads`, `FTP_PRIVATE_REMOTE_ROOT=/private-uploads`, `FTP_USER=u823909847.connect` |
| `BIOMETRIC_PORT=5005` | receiver port |
| `BIOMETRIC_ALLOWED_SERIALS` | `S/N102019100001698` — only this device may push |

---

## 4. Making BACKEND changes live

```bash
ssh deploy@187.127.162.249
cd ~/HR_Portal && git pull origin main
cd server
npm ci                      # only if package.json / lock changed (also runs prisma generate)
npx tsc -p . && node -e "require('node:fs').cpSync('src/assets','dist/assets',{recursive:true})"
pm2 restart hr-api          # restart hr-biometric too if src/biometric* changed
pm2 logs hr-api --lines 20 --nostream
curl -s https://connect-api.amatoautomotive.co.in/api/health
```

### Database schema changes — read before running anything
There is no migrations folder; the schema is applied with SQL. **Do not run `prisma db push`
blindly**: the VPS database (copied from Hostinger MariaDB) has small foreign-key drift, and
`db push` would drop and recreate 11 FKs on `users` along with your change. Instead preview:

```bash
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script
```

and apply only the statements your change needs (via `mysql` with the credentials in
`.db_credentials`). Take a backup first (§7).

Ready-made scripts for past schema changes live in `server/prisma/sql/` (dated). Apply each one
once, in date order, before restarting `hr-api` with code that needs it.

---

## 5. Making FRONTEND changes live

```bash
# On your machine (any shell), in frontend/ — the API URL comes from frontend/.env.production
npm run build
grep -l "connect-api.amatoautomotive.co.in/api" dist/assets/*.js   # must find the bundle
grep -l "localhost:3001" dist/assets/*.js                          # must find nothing
```

Upload via hPanel File Manager (or FTP) into `/public_html/connect`:
1. `dist/assets/` first (including the hidden `assets/.htaccess`), then `dist/index.html` last.
2. Leave the root `.htaccess` (SPA rewrite), `uploads/` and `default.php` alone.
3. Hard-refresh (Ctrl-Shift-R).

---

## 6. Biometric device (Secureye S-F4BK)

The device **pushes** punches to the VPS; nothing pulls from it.

- Device menu → **Comm.**: Event Transfer Mode = **TCP/IP**, Host PC Addr = **187.127.162.249**,
  Host PC Port = **5005**. TCP/IP settings: static `192.168.1.224`, gateway `192.168.1.1`.
  Communication password: none. P2P: off.
- Protocol: NUL-terminated XML (`<Event>TimeLog</Event>`, `<TransID>`, `<UserID>`...). Each record is
  acknowledged with `<Request>UploadedLog</Request>`; unacknowledged records are resent (the device
  keeps a queue, so an outage loses nothing — it catches up when the receiver is back). It is **not**
  ZKTeco-compatible; don't try zkteco libraries. See `server/src/biometric/protocol.ts`.
- Every punch is stored in `biometric_punches`; attendance rows are rebuilt from them (first punch =
  check-in, last = check-out; late after 09:30, overtime after 18:00). Days HR corrected or set to
  WFH / On Duty / leave are never overwritten.
- `<UserID>` maps to **Employee → Biometric ID**. Punches from unmapped IDs are kept; after HR sets
  the Biometric ID, press **Link punches** on the Attendance page (or
  `POST /api/attendance/biometric/reprocess`).
- Health: Attendance page → "Biometric Device" card (HR), or `pm2 logs hr-biometric`.

| Symptom | Check |
|---------|-------|
| Card says Offline | Device powered/networked? (restart it — its network sometimes only comes up at boot). Office public IP changed (ufw rule, §2)? `pm2 list` shows `hr-biometric` online? |
| Punches arrive but someone's attendance is empty | Their Biometric ID isn't set → set it, then Link punches. |
| Device's own clock wrong | Menu → System → Date/Time (IST). All times come from the device clock. |

---

## 7. Common operations

```bash
pm2 list
pm2 logs hr-api --lines 40 --nostream
pm2 logs hr-biometric --lines 40 --nostream
pm2 restart hr-api | hr-biometric

# Database backup (do this before any schema change)
cd ~/HR_Portal/server
mysqldump --defaults-extra-file=<(printf '[client]\nuser=hr_user\npassword=%s\n' "$(sed -E 's|.*://[^:]+:([^@]+)@.*|\1|' .db_credentials)") \
  --single-transaction hr_portal > ~/hr_backup_$(date +%F).sql
```

**Daily automatic backup:** handled by the VPS provider's own 24-hourly server backup; there is no
separate database dump job. Take a manual dump (above) before risky changes.

---

## 8. Gotchas

| Symptom | Cause / fix |
|---------|-------------|
| Values in `.env` subtly wrong after copying from Windows | CRLF line endings — strip `\r` (`sed -i 's/\r$//'`). |
| Inline env var with a leading `/` mangled in Git Bash | MSYS path conversion (bit the 2026-07-06 storage migration) — use PowerShell or `MSYS_NO_PATHCONV=1`. |
| `mysqldump` from Hostinger fails on `COLUMN_STATISTICS` | Source is MariaDB — add `--column-statistics=0`. |
| Everyone logged out after a deploy | `JWT_SECRET` changed. |
| Salary slips show 0 | `SALARY_ENCRYPTION_KEY` doesn't match the key used when they were imported. |

---

## 9. Open items
- Rotate the Hostinger FTP password (was committed to this public repo in the old plan) and update
  `FTP_PASSWORD` in `server/.env`; consider making the GitHub repo private.
- Make the GitHub repo private: the device serial (the receiver's main check) is in it.
- Decommission the Vercel project `auto-hr-api` (its daily cron still runs against the old Hostinger DB).
