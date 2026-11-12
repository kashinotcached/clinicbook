# ClinicBook

A phone app for a hair clinic (PRP / GFC): patients, six-session courses, visits with head photos, and kit stock.
**All records stay on the phone.** There is no server, no account and no cloud database.

## What it does

- **Today**: reminders still to send for today and tomorrow, who is due, who is overdue, the next 7 days, a stock warning
  and a backup reminder. Where the phone or PC supports it, the app icon shows how many reminders are waiting.
- **Patients**: each patient has courses (PRP, GFC, …). A course has a number of sessions, the days between them, and the
  **dose**: what one session uses from stock (e.g. 4 PRP bottles, 1 pair of gloves, …).
  - **Change dose** records the change from a date (4 → 2 bottles after improvement). Visits already logged keep what they used.
  - **Log session** fills in the current dose; adjust it if that day was different. Logging a session takes the items off stock.
  - **Book next** creates the next appointment; "Save and add to Google Calendar" opens a pre-filled Google Calendar entry
    (initials only by default, set in Settings).
  - **WhatsApp reminders**: each calendar entry carries a link back into ClinicBook (only a random code, nothing about the
    patient). When the calendar reminds him, he taps the link and ClinicBook opens with a written reminder for that patient.
    One tap opens WhatsApp with it, ready to send. The 💬 buttons on Today and the patient page do the same without the calendar.
    Wording, clinic name and country code are set in Settings → WhatsApp reminders. On iPhone the link opens Safari, which
    does not share data with the home-screen app, so use the 💬 buttons there.
  - **Photos**: "Take photos" opens the camera inside the app. Pick the area (Front / hairline, Crown…), take as many shots as
    needed, move to the next area, and upload from the gallery in the same screen. The last photo of that area from an
    earlier visit is shown faintly over the camera, to line up the same angle. Each area also has its own Camera / Upload
    buttons. The Photos tab lines each area up across visits. Photos are shrunk to ~1600 px (~250 KB) before saving.
  - **Fee charged** per visit (the treatment's usual fee is filled in) feeds the profit report.
- **Stock**: two groups, items used in every session (PRP kit, gloves, syringes…) and other stock used now and then
  (anaesthetic vials, medicines, equipment). Session items show what booked and expected sessions will need in the next
  14 / 30 / 60 days at each patient's current dose. "Received stock" records supplier (pick from the list or add a new one),
  quantity and amount paid; "Used up / opened" records an occasional item being finished; "Correct the count" fixes the count.
- **Suppliers** (from Stock): name, phone, notes, every purchase and the total spent; call or WhatsApp them.
- **Reports**: per month or year, income, cost of the items used (at the average price paid), profit, money spent on stock,
  and breakdowns by treatment, item and supplier. Rent, staff and other running costs are not included.
- **PC**: on a wide screen the menu moves to the side and pages use the width. Data is per device: a PC has its own records
  unless a backup from the phone is restored on it.
- **Settings**: encrypted backup and restore, app PIN, treatments with their usual fee and dose, stock items and low-stock levels,
  photo areas, calendar naming.

## Sync between phone and PC (Google Drive)

Settings → **Sync with Google Drive** keeps the phone and a PC on the same records.

- Records and photos are kept in the app's own hidden folder in the doctor's Google Drive (scope `drive.appdata`): the app cannot
  see his other Drive files, and these files do not show among them.
- Everything is encrypted on the device with the **sync password** before upload (AES-256-GCM, key from PBKDF2). Google stores
  only unreadable files. The first device chooses the password; every other device must enter the same one. It cannot be recovered.
- Each record carries the time it last changed and removals are remembered, so changes made on both devices merge: for each
  record the latest change wins, and a removal wins over older changes. Stock counts add up correctly because stock is a list of
  entries, not a single number.
- Sync runs on opening, about 15 seconds after a change, every 5 minutes while open, and when the internet returns. A Google
  sign-in lasts about an hour; after that the Today screen shows "tap to sign in" (a static app cannot keep a longer sign-in
  without a server).
- Photos are separate encrypted files; "Download photos to this device" can be switched off on a device with little space.

Google setup (once, by the developer): a Google Cloud project with the Drive API enabled, an OAuth consent screen with the
`drive.appdata` scope, and an OAuth client of type *Web application* whose authorized JavaScript origin and redirect URI are the
app's address. Its client ID goes in `src/config.ts`.

Testing sync locally without Google: `node scripts/fake-drive.mjs`, `npm run dev -- --host`, then in two origins
(`http://localhost:5173` and `http://127.0.0.1:5173`) run `localStorage.fakeDrive = 'http://127.0.0.1:4599'` and reload.

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
