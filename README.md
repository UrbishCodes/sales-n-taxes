# Counter sales calculator

A browser calculator for counter sales at New A to Z Mobile Center (Nepal). One customer, one bill, one total, with several items on it. It works offline on a laptop or an iPhone.

Live page: https://urbishcodes.github.io/sales-n-taxes/

---

## 1. Problem

### 1.1 The bill
- The customer pays one total, VAT inclusive. Call it **G**.
- VAT is 13%. The taxable base is **X = G ÷ 1.13**, rounded to paisa. VAT is **G − X**.
- The items on the bill must add up to **X exactly**. Then the bill total equals what the customer paid.

### 1.2 Item rules
Each item comes from the stock summary with three values:

| Value | Source in the stock summary | Meaning |
|---|---|---|
| Buy cost | the `#` value in Particulars | what the shop paid |
| Max sell rate | the Rate column | the highest rate allowed for this item |
| Unit | the Quantity column | pcs, dzn or kg |

Profit band over buy cost:
- **Below 5%** is a loss. Staff, rent and other costs are not covered.
- **5% to 7%** is the target.
- **Above 7%** is over-tax. Profit above the band is taxed more.
- **Above the max sell rate** also means more tax, because the government taxes the profit.

### 1.3 Counting rules
- **Pcs and dozen counts are real pieces.** They are never rounded. You cannot sell half a cover, and one sale cannot be recorded as two.
- Dozens go in halves (½ dozen, 1 dozen, 1½ dozen).
- **Kg** may be decimal, up to 3 places.

### 1.4 Why this is hard
- Every line is count × rate, and rates have two decimals. A multi-item bill has several such lines, so the total can be a few paisa off the bill total.
- Each line must respect its own max rate and, where possible, the 5–7% band.
- Typing item names, rates and buy costs by hand is slow and error-prone.
- Stock is updated manually. Recording bills and deducting stock is a later step.

---

## 2. Solution

### 2.1 Reverse VAT in paisa
`X = round2(G ÷ (1 + V/100))`, `VAT = G − X`. Money is handled as whole paisa in the calculation, so floating-point noise cannot create a fake variance.

### 2.2 Item list from the stock summary
The item list is built from the stock group summary (`items.js`, 93 items). Type a name and a list opens below the box:

- Type part of a name: `mobile`, `glass`, `sticker`. Every word typed must appear in the item name, in any order.
- Common spelling slips in the summary are handled, so `cam protector` finds `CAM Protiction Glass`.
- Tap an item, or pick it with the arrow keys and Enter. An exact name fills the item on its own.
- Picking an item fills the unit, the **max sell rate** and the buy cost. The summary stock is shown for reference only. It is not deducted.

### 2.3 Rate defaults to the max rate
Every line starts at its max sell rate. The rate box shows that rate.

- Type a rate to change it. The line then uses the typed rate, and the box says "Typed rate".
- Tap **Use max rate again** to go back to the max.
- Clearing the rate box also goes back to the max.

Nothing absorbs the difference. Each line is priced as shown, and the status tells you the variance against the bill total.

### 2.4 Flag, never hide
Each line shows its status:

| Flag | Meaning |
|---|---|
| LOSS | Margin over buy cost is below 5%. |
| OVER TAX | Margin is above 7%. |
| Above max rate | Rate is above the max sell rate. More tax applies. |
| Error | A required value is missing or a count is not allowed for its unit. The message says what to fix. |

The status line says either **Exact** (lines + VAT = bill total) or **Off by NPR x**. Flags on any line are added to the status.

Band checks need the buy cost. Without it, the line shows "no buy cost entered".

### 2.5 Billing lines
Each line prints as: name, quantity, rate, amount. Then the taxable total, the VAT, and the bill total. The result can be copied with one tap.

### 2.6 VAT included or excluded
- **VAT included** (default). You type what the customer paid. Taxable base = paid ÷ (1 + V%). VAT = paid − base.
- **VAT excluded**. You type the taxable amount. VAT = taxable × V%. Total = taxable + VAT.
- **VAT excluded, nothing typed**. The bill is built from the items. Each line is priced as entered, the taxable amount is their sum, and VAT goes on top.

### 2.7 Side calculator
A plain calculator for any other sum: + − × ÷ and brackets. "+ VAT" and "− VAT" use the bill's VAT %. "Use as bill total" sends the result to the bill box (the taxable amount in VAT excluded mode).

### 2.8 Reset
Reset clears all items and the total, and returns to VAT included with 13% VAT.

---

## 3. Using the calculator

1. Type the item name (for example `mobile`). Pick the item from the list. Rate and unit fill in at the max rate.
2. Type the count. Type a rate only if you are selling below the max.
3. Add more items with **+ Add item**.
4. Type the total paid in the bill box (or choose VAT excluded for the taxable amount).
5. Check the status says **Exact**. If it says **Off by**, change a count or rate until it is exact, or check the flags.
6. Tap **Copy billing lines**.
7. Tap **Reset** for the next customer.

---

## 4. Limits

- **Not every total can be exact.** Pcs and dozens cannot be split, so many totals cannot be hit to the paisa. The app shows the variance rather than faking a match.
- **Item list is a snapshot.** It is the stock summary of 16-Jul-2026 to 15-Oct-2026. New items or rate changes need an edit to `items.js`.
- **Nothing is saved yet.** Bill recording and stock deduction are the next steps.
- **Extra tax above 7% is flagged, not calculated.** The formula is not confirmed yet.

### 4.1 Data issues in the stock summary
- `Mobile Cover #2750` is listed as kg with rate 2409 and buy 2750. This shows as a LOSS. It is probably a typo in the `#` value. Check it.
- `P B C Sticket` has no `#` buy cost, so its band shows "no buy cost entered".

---

## 5. Files

| File | Role |
|---|---|
| `index.html` | Page layout. |
| `style.css` | Styling. Mobile first, two columns on laptops. |
| `app.js` | Screen logic: item list, line cards, events, results, copy. |
| `solver.js` | Pure rules and item search, no DOM. Runs in the browser and in Node. |
| `items.js` | Item catalog generated from the stock summary. |

Tests are kept outside this repository: solver rules and the page flow (jsdom).

---

## 6. Run it

No build step and no dependencies.
- Open `index.html` in any browser, or
- use the GitHub Pages link above.

---

## 7. Roadmap

1. **Bill recording:** save each bill with its lines, time and staff name.
2. **Backend link:** item list, max rate and buy cost from the live stock records, instead of `items.js`.
3. **Stock deduction:** match sold items by name and rate, deterministically.
4. **Covers alert:** warn when total covers fall below the 95,000 pcs baseline.
5. **Hosting that does not pause when idle** (for example Cloudflare). Festival weeks can mean 7–8 idle days.
6. **Count suggestion:** suggest the count that gives the bill total, if wanted.

### Open questions
- Extra-tax formula above 7%. Assumed 13% of profit above the band. To confirm.
- Cover baseline: group total or per item. Assumed group total.
- "Most low" item for the reorder alert. Assumed lowest stock ÷ last count.
