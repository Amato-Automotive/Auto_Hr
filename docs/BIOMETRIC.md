# Biometric attendance device — how it's connected

Handover document for the direct connection between the office biometric device and Autoform
Connect. It covers what is running, how it works, how to look after it, and how it was built
(including the dead ends), so it can be maintained or rebuilt by someone new.

Server-wide setup (VPS, PM2, nginx, env, deploy routine) lives in [`DEPLOYMENT.md`](../DEPLOYMENT.md);
this document only repeats what's needed for the biometric part.

---

## 1. In one paragraph

The fingerprint/face device at the office pushes every punch, over the internet, straight to a small
receiver program on our VPS. The receiver stores each punch in the database, tells the device "got
it", and rebuilds that employee's attendance for the day (check-in = first punch, check-out = last
punch). Nobody exports files, and no office PC needs to be left on. If the internet or the server is
down, the device keeps its punches and sends them once it can connect again — nothing is lost.

```
 Office (Autoform router, Airtel broadband)                VPS 187.127.162.249
 ┌─────────────────────────────────┐                      ┌───────────────────────────────┐
 │ Secureye S-F4BK                 │  TCP 5005 (XML)      │ PM2 "hr-biometric"            │
 │ 192.168.1.224 ──► router ──► internet ───────────────► │  server/src/biometricServer.ts│
 │                                 │ ◄─── ack per record  │        │                      │
 └─────────────────────────────────┘                      │        ▼                      │
                                                          │ MySQL hr_portal               │
                                                          │  biometric_punches  (raw)     │
                                                          │  attendance        (per day)  │
                                                          │        ▲                      │
                                                          │ PM2 "hr-api" (portal API)     │
                                                          └───────────────────────────────┘
```

---

## 2. Facts sheet

| Item | Value |
|------|-------|
| Device | **Secureye S-F4BK** (made by **Smackbio**; reports TerminalType `M50`) |
| Firmware | M70 v3.11.26s |
| Serial | `S/N102019100001698` (also the receiver's allow-list) |
| Device LAN IP | `192.168.1.224` static, gateway `192.168.1.1` (Autoform router, cable) |
| Office internet | Airtel broadband, **dynamic** public IP, from block `122.161.0.0/16` |
| Receiver | VPS `187.127.162.249`, TCP port **5005**, PM2 process `hr-biometric` |
| Data | MySQL `hr_portal`: tables `biometric_devices`, `biometric_punches`, `attendance` |
| Employee mapping | Device **User ID** = Employee profile → **Biometric ID** |
| Went live | 2026-10-12 (backlog from 2026-06-10 onward — 5,081 punches — imported that day) |

**It is not a ZKTeco device**, even though Secureye devices are often assumed to be. It doesn't
speak the ZKTeco protocol (port 4370) and has no ADMS/cloud option. Don't try ZKTeco libraries.

---

## 3. Device settings

On the device: **Menu → Comm**:

| Setting | Value |
|---------|-------|
| Event Transfer Mode | **TCP/IP** (was "No" originally — this is what turns pushing on) |
| Host PC Addr | `187.127.162.249` |
| Host PC Port | `5005` |
| Device ID | 1 |
| Comm password | none |
| TCP/IP | DHCP **off**, IP `192.168.1.224`, gateway `192.168.1.1` |

The device clock is what attendance uses — keep it correct (it ran a minute or two behind in testing,
which is fine).

---

## 4. How it works

### 4.1 The protocol (Smackbio "Event Transfer Mode = TCP/IP")

- The **device** opens the TCP connection to the server (so the office needs no port forwarding).
- It sends XML messages, each ending in a NUL byte (`\0`). Field values below are illustrative:
  ```xml
  <?xml version="1.0"?><Message><TerminalType>M50</TerminalType><DeviceUID>…</DeviceUID>
  <TerminalID>1</TerminalID><DeviceSerialNo>S/N102019100001698</DeviceSerialNo>
  <TransID>45143</TransID><Event>TimeLog</Event><Year>2026</Year><Month>6</Month><Day>10</Day>
  <Hour>9</Hour><Minute>12</Minute><Second>5</Second><UserID>31</UserID>
  <AttendStat>Duty On</AttendStat><VerifMode>Face</VerifMode>…</Message>\0
  ```
- Events seen: `TimeLog` (a punch), `AdminLog` (menu access, power on), `KeepAlive` (about every minute).
- Every record must be **acknowledged**, or the device resends it forever:
  ```xml
  <?xml version="1.0"?><Message><Request>UploadedLog</Request><TransID>45143</TransID></Message>\0
  ```
  `KeepAlive` is answered the same way with `<Request>KeptAlive</Request>`.
- `TransID` is the device's own running record number. It sends records in order, sometimes twice.
- Times are the device's wall clock (IST) with no timezone info.

### 4.2 What the receiver does with each message (`server/src/biometricServer.ts`)

1. Rejects anything whose `DeviceSerialNo` isn't in `BIOMETRIC_ALLOWED_SERIALS`.
2. Records the device as seen (`biometric_devices.last_seen_at`, `last_ip`), at most every 30 s.
3. For a `TimeLog`: **save → acknowledge → rebuild the day**, in that order.
   - Saving is idempotent on (device, TransID): a repeat is silently skipped.
   - If saving fails, it does **not** acknowledge, so the device keeps the record and retries later.
   - The rebuild runs after the ack; if it fails, the next punch that day rebuilds it again.
4. `AdminLog` is acknowledged and ignored. Unknown events are logged.

Messages on one connection are processed strictly one after another.

### 4.3 Attendance rules (`server/src/biometric/attendance.ts` → `recomputeDay`)

- All of an employee's punches for the date are read; **first = check-in**, **last = check-out**
  (only if there's more than one punch at a different time).
- Late if check-in is after **09:30:00**; overtime counted after **18:00:00**. These match the older
  file-upload path in `routes/attendance.ts`.
- **HR's decisions win.** The day is left untouched if:
  - HR made a manual entry or correction for that day (an `attendance_corrections` row exists), or
  - the status is anything other than Present/Absent (WFH, On Duty, leave, holiday, …).

### 4.4 Employees without a Biometric ID

Punches from a device User ID with no matching employee are **still stored** (`employee_id` empty).
When HR later sets that person's Biometric ID, pressing **Link punches** on the Biometric Device card
attaches those punches and rebuilds the affected days (`POST /api/attendance/biometric/reprocess`).
Unmatched IDs are normal (ex-employees still enrolled on the device, new joiners) and are
deliberately not listed in the UI.

---

## 5. Code map

| File | Role |
|------|------|
| `server/src/biometric/protocol.ts` | Pure functions: split the stream, parse XML, build the ack. No I/O. |
| `server/src/biometric/attendance.ts` | Save punch, plausibility check, rebuild a day, link unmapped punches. |
| `server/src/biometricServer.ts` | The TCP receiver process (entry point for PM2 `hr-biometric`). |
| `server/src/routes/attendance.ts` | `GET /attendance/biometric/status`, `POST /attendance/biometric/reprocess` (HR only). |
| `server/prisma/schema.prisma` | Models `BiometricDevice`, `BiometricPunch`. |
| `frontend/src/components/BiometricDeviceCard.tsx` | HR card on the Attendance page: Online/Offline, last seen, punches in 24 h, latest punch, Link punches. |
| `server/src/config/env.ts` | `BIOMETRIC_PORT` (5005), `BIOMETRIC_ALLOWED_SERIALS`. |

Scripts: `npm run start:biometric` (built) and `npm run dev:biometric` (watch mode) in `server/`.

The older **manual upload** of a device `.txt` export (`POST /attendance/upload/biometric`) still
exists and is a fallback if the push ever has to be switched off.

---

## 6. Server side

- PM2: `hr-biometric` runs `node dist/biometricServer.js` from `server/`; it's a separate process
  from the API, so restarting one doesn't affect the other.
- Env in `server/.env`: `BIOMETRIC_PORT=5005`, `BIOMETRIC_ALLOWED_SERIALS=S/N102019100001698`.
- Firewall (ufw): port 5005 open **only** to `122.161.0.0/16`, rule comment "HR biometric device push".
- Deploy: the normal deploy (pull, `npm ci`, build) plus `pm2 restart hr-biometric` when anything in
  `src/biometric*` changed. Restarting is safe — the device just reconnects and resends.
- **Schema changes:** don't run `prisma db push` blindly on the VPS (it would rebuild unrelated
  foreign keys). Preview with `prisma migrate diff` and apply only the needed SQL — see DEPLOYMENT.md.

---

## 7. Looking after it

**Normal day:** nothing to do. HR can glance at the **Biometric Device** card on the Attendance page.
"Online" means the device checked in within the last 3 minutes.

**New employee:** enrol them on the device, note their User ID, set the same number as
**Biometric ID** on their profile, then press **Link punches** if they already punched before that.

### Troubleshooting

| Symptom | What to check |
|---------|---------------|
| Card says **Offline** | 1. Is the device powered and cabled, and does the office have internet? 2. `pm2 list` on the VPS — is `hr-biometric` online? 3. Office public IP outside `122.161.0.0/16`? (see below) 4. Restart the device — after some network faults its connection only recovers at boot. |
| Offline after a power cut | Usually fixes itself: the router gets a new IP, and the device reconnects within a minute or two on its own (tested 2026-10-12, no restart needed). |
| Office IP outside the allowed block | From an office computer: `curl https://api.ipify.org`. Look up its block (e.g. `https://rdap.apnic.net/ip/<ip>`), then on the VPS: `sudo ufw allow from <block> to any port 5005 proto tcp comment 'HR biometric device push'`. Held punches arrive once it connects. |
| Punches arrive but someone's attendance is blank | Their Biometric ID isn't set or is wrong → fix it, press Link punches. |
| A day shows the wrong times but punches are right | Day was protected (HR correction or non-Present status) — expected; HR edits win. |
| Log says "refusing TimeLog … more than 1000 past the last stored record" | Either a forged record, or the device's record numbers jumped (e.g. its memory was cleared). If it's genuinely the device, see §8. |
| Device was reset / replaced | Re-enter the settings in §3. A new serial must be added to `BIOMETRIC_ALLOWED_SERIALS` and `hr-biometric` restarted. See §8 about record numbers. |

Useful commands on the VPS (`ssh deploy@187.127.162.249`):

```bash
pm2 logs hr-biometric --lines 50 --nostream     # every punch is logged with user, time, employee
pm2 restart hr-biometric
ss -tn state established '( sport = :5005 )'     # is the device connected right now, and from which IP?
sudo ufw status | grep 5005
```

---

## 8. Security model (and the compromise we accepted)

The office line's public IP changes whenever the router loses power (several times a day), and Airtel
won't provide a static IP. A single-IP firewall rule therefore broke constantly, so port 5005 is open
to Airtel's Delhi broadband block `122.161.0.0/16` — meaning other Airtel customers can reach it.

What someone there could and couldn't do:
- **Could:** send fake punches (if they knew the protocol and the device serial) — this would change
  attendance for days HR hasn't corrected; or flood the receiver.
- **Couldn't:** read anything (the receiver only ever replies "got it"), reach the portal, logins,
  salaries or files, or change/delete existing punches.

Hardening in place:
- Only the allowed device serial is accepted. **Keep the GitHub repo private** — the serial is in it.
- A punch whose TransID is more than 1000 past the highest stored one is refused. Without this, a
  forged far-ahead TransID would make the device's real record with that number be skipped later as a
  "duplicate".
- Messages capped at 16 KB (real ones are about 500 bytes), 4 connections per IP, 50 in total.
- Every punch stores `source_ip`, so forged punches can be found and deleted:
  ```sql
  SELECT source_ip, COUNT(*) FROM biometric_punches GROUP BY source_ip;
  ```

**If the device's record numbers ever restart from a low number** (memory cleared, new device with the
same serial), new punches would collide with old TransIDs and be skipped as duplicates. A new device
gets a new serial, which gets its own `biometric_devices` row, so that case is fine. For the same
device after a memory wipe, give it a fresh row (rename the old row's `serial_no`, e.g. append
`-old`, then restart `hr-biometric`).

---

## 9. How it was built — history and dead ends

Worth reading before trying anything "obvious"; most obvious things were tried.

1. **Assumed ZKTeco.** Secureye is often sold as ZK-based, and the codebase originally had a
   `/attendance/sync-device` route using `zkteco-js`. Port 4370 on the device accepted connections
   but never answered ZK commands. Conclusion: not ZKTeco. The route and library were removed.
2. **No ADMS.** The menu has no cloud/ADMS server option. But **Comm → Event Transfer Mode** had a
   `TCP/IP` choice, with Host PC Addr/Port. Turning it on made the device start pushing.
3. **Network gremlins.** The device was unreachable for a while: wrong Wi-Fi on the test laptop, then a
   dead link — the device's network only came back after **restarting the device**. Later the test
   laptop's DHCP address changed, so Host PC Addr had to be updated.
4. **Listening on a laptop first.** A small Node listener on port 5005 on an office laptop received
   the XML messages, which showed the format (§4.1). The device sent the same first record (TransID
   45143, from 2026-06-10) over and over: it was waiting for an acknowledgement.
5. **Guessing the ack failed.** Six plausible reply formats were tried; none stopped the resending.
6. **Decoding the real ack.** Secureye's Windows software, *ONtime Attendance 3.3.22*
   (`https://ontimeemployeemanager.com/Download/ONTime3.3.22/ONtime3.3.22.zip`), was downloaded and
   unpacked **without installing or running it**. Inside is `SbLogServer.dll` by Smackbio — the
   vendor's own push receiver, a .NET assembly with a `SendReply(replyType, transId, …)` function.
   Reading its embedded (UTF-16) string table gave the exact reply XML. The device accepted it first
   try. A 20-record test acked TransIDs 45143–45162 to prove it before building for real.
7. **Where to run the receiver.** There's no always-on office PC, and the API was on Vercel, which
   can't hold a raw TCP connection open. So the whole backend and database moved from Vercel +
   Hostinger MySQL to our VPS (same box as two other company projects), with the receiver as a
   second PM2 process. Frontend stayed on Hostinger.
8. **Backlog.** On go-live the device delivered everything it had held since 2026-06-10 — 5,081
   punches, at roughly 12 per second.
9. **Duplicate punches** were logging unique-constraint errors; switched to
   `createMany({ skipDuplicates: true })`.
10. **Dynamic office IP.** First the firewall allowed only the office's single IP. It changed within
    the first day. A "press this button from the office to re-allow the network" feature was built and
    then dropped, because the router loses power twice a day and HR sits on a different network.
    Airtel's static-IP add-on wasn't available. Final answer: allow Airtel's `122.161.0.0/16` block
    plus the hardening in §8.

### Rebuilding for a different device

If the device is replaced with another model:
1. Check the menu for a push / "Event Transfer" / ADMS / cloud server option and its port.
2. Point it at a laptop and capture what it sends (`nc -l 5005 | xxd`, or a 10-line Node `net`
   server that logs bytes). Don't acknowledge anything yet — an unacknowledged device just resends,
   so nothing is lost.
3. If the format differs, find the vendor's Windows software, unpack it without installing it, and look
   for the receiver component's reply strings (as in step 6 above).
4. Only `protocol.ts` should need changing; the storage and attendance logic is device-independent.
