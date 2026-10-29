# DEPLOY — FanumTaxxed

Autonomous deployment sheet. The app is **pure static files** (HTML + CSS + vanilla JS).
**No env vars. No secrets. No database. No build step.** Any agent (or human) can deploy it
with one of the three options below.

## Files to deploy

```
index.html    style.css    app.js    calc.js    solver.js    items.js    .nojekyll
```

Optional (only for Cloudflare CLI): `wrangler.toml`.
Optional (only for Vercel CLI): `vercel.json` — not required; Vercel serves the folder as-is.

---

## Option A — GitHub Pages (current live host)

The repo `UrbishCodes/sales-n-taxes` already serves GitHub Pages at
<https://urbishcodes.github.io/sales-n-taxes/>.

```bash
git clone https://github.com/UrbishCodes/sales-n-taxes.git
cd sales-n-taxes
# REPLACE these files with the new build:
#   index.html  style.css  app.js  solver.js  items.js  README.md  .nojekyll
# ADD these new files:
#   calc.js  DEPLOY.md  wrangler.toml  vercel.json
git add -A
git commit -m "FanumTaxxed: restore auto-adjust engine (user edits never reverted), fix VAT-space trap, recalibrate band, merge duplicate item, FNT-991ES PLUS calculator"
git push origin main
```

GitHub Pages deploys automatically on push (Settings → Pages → Branch: `main` / root).
Verify after ~1 minute: the header says **FanumTaxxed**, and the Items card shows the
**Auto-adjust** switch, ON.

## Option B — Vercel

CLI (logged-in machine):

```bash
npm i -g vercel
cd <folder containing index.html>
vercel deploy --prod        # accept defaults ("Other" framework, no build command, output ./)
```

Dashboard (no CLI):

1. Go to <https://vercel.com/new>
2. Drag the folder onto the page (or import the GitHub repo).
3. Framework preset: **Other**. Build command: *(empty)*. Output directory: `./`
4. Deploy. Nothing else to configure — there are no environment variables.

## Option C — Cloudflare Workers (Static Assets)

CLI:

```bash
npm i -g wrangler
cd <folder containing wrangler.toml and the site files>
wrangler login              # one-time browser consent
wrangler deploy
```

`wrangler.toml` (already in this folder):

```toml
name = "fanumtaxxed"
compatibility_date = "2024-11-01"
[assets]
directory = "."
```

Dashboard (no CLI):

1. Workers & Pages → Create → **Workers** → "Upload assets" (or Pages → Direct Upload).
2. Upload the folder. Route/URL is assigned automatically.

## Post-deploy smoke test (60 seconds)

1. Header shows **FanumTaxxed**; footer credits Urbish with GitHub + LinkedIn links.
2. Items card: **Auto-adjust** switch is ON; line card shows the **AMOUNTS — LINKED** section;
   the **SALES CALC — NON-REV · 13%** card sits directly after the Items card.
3. The user scenario: pick `Mobile Cover #810` (doz, max 867, buy 810), type rate **870**,
   then type **42473** into GROSS — INCL. VAT. Expect: count **43**, message
   "Typed rate NPR 870.00 → 43 doz @ NPR 874.11 (rate absorbs)", status **Exact**, VAT 4,886.27.
4. Type a different count (say 44) — it must stay exactly what you typed; only the rate moves.
5. Calculator: type `465893` fast — every digit registers (pointerdown path). SOUND is on,
   VOICE is off by default. `37586.70` → `−VAT` → `Use as bill total` (REV mode) must set
   **37,586.70**, not 33,262.57 (BASE badge shows on the LCD after −VAT).
6. Item search: typing `screen protrector #25` finds the single merged entry (stock 6,008).
