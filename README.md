# ClinicBook

A phone app for a hair clinic (PRP / GFC): patients, six-session courses, visits with head photos, and kit stock.
**All records stay on the phone.** There is no server, no account and no cloud database.

## What it does

- **Today**: who is due today, who is overdue, the next 7 days, a stock warning and a backup reminder.
- **Patients**: each patient has courses (PRP, GFC, …). A course has a number of sessions, the days between them, and the
  **dose**: what one session uses from stock (e.g. 4 PRP bottles, 1 pair of gloves, …).
  - **Change dose** records the change from a date (4 → 2 bottles after improvement). Visits already logged keep what they used.
  - **Log session** fills in the current dose; adjust it if that day was different. Logging a session takes the items off stock.
  - **Book next** creates the next appointment; "Save and add to Google Calendar" opens a pre-filled Google Calendar entry
    (initials only by default, set in Settings).
  - Photos per head area on each visit; the Photos tab lines each area up across visits to compare progress.
    Photos are shrunk to ~1600 px (~250 KB) before saving.
- **Stock**: stock on hand per item, plus what booked and expected sessions of active courses will need in the next 14 / 30 / 60 days
  at each patient's current dose. Record deliveries with "Received stock"; fix a wrong count with "Correct the count".
- **Settings**: encrypted backup and restore, app PIN, treatments and their default dose, stock items and low-stock levels,
  photo areas, calendar naming.

## Backups (important)

The data lives only on the phone. If the phone is lost or reset, only a backup brings it back.

- **Back up records** makes a small file of every record (no photos).
- **New photos / All photos** makes a separate file of the photos (photo files can be big, so they are kept apart).
- Files are encrypted (AES-256-GCM, key from the backup password via PBKDF2) before they leave the app. The phone's
  share menu then lets you save them to Google Drive or send them to yourself on WhatsApp. Neither can read them.
- **Without the backup password a backup cannot be opened.** Write it down somewhere safe.
- Restore: Settings → Restore → pick the file → its password. A records file replaces all records; a photos file only adds photos.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/
npm run preview    # serve dist/ (offline mode and install work here)
```

Stack: React + TypeScript + Vite, Dexie (IndexedDB) for storage, fflate for zip, Web Crypto for encryption,
vite-plugin-pwa for offline use and install. App icons are drawn by `node scripts/make-icons.mjs`.

## Putting it on the phone

The app is a set of static files. It must be served over **https** for install and offline to work. Only the app's code
is hosted; patient data never goes there.

1. Host `dist/` on any static host, e.g. GitHub Pages, Netlify or Cloudflare Pages (all free). The build uses relative
   paths, so a sub-folder such as `https://<user>.github.io/clinicbook/` works.
2. On the phone (Android, Chrome): open the address → menu ⋮ → **Install app** / **Add to Home screen**.
   On iPhone (Safari): Share → **Add to Home Screen**. Use the installed icon from then on: on iPhone, data of a website
   that is only opened in Safari may be cleared after weeks of no use, but home-screen apps are kept.
3. Settings → set a PIN, set a backup password, and make the first backup.

Moving to a new phone (including Android → iPhone): install the app on the new phone, then restore the latest records file
and the photo files.

## Data model (src/db.ts)

| Table | Holds |
|---|---|
| patients | name, phone, age, gender, notes |
| courses | treatment, sessions, days apart, start date, status, `plan` = dose history |
| visits | date, time, status (scheduled / done / missed), what was used, notes |
| photos / photoBlobs | photo details / the image and its thumbnail |
| stockItems | PRP kit, GFC tube, gloves, syringes… with low-stock level |
| stockMoves | every + / − to stock: received, used by a visit, correction. Stock on hand = sum of moves |
| treatments | PRP / GFC defaults for new courses |
| settings | PIN hash, photo areas, calendar naming, backup dates |

All ids are random UUIDs and rows carry timestamps, so syncing between devices can be added later without reworking the data.
