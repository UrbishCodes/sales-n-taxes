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
- **Kg** may be decimal. The rate is fixed at the standard by default, so the quantity adjusts.

### 1.4 Why this is hard
- Every line is quantity × rate, and rates have two decimals. For a count of 7, the line total moves in steps of 7 paisa. Most totals cannot be hit exactly that way.
- A multi-item bill has several such lines. The rounding adds up, and the total can be a few paisa off.
- Every line must still respect its own max rate and, where possible, the 5–7% band. Fixing the total must not break those rules.
- Today the sold counts are written by hand in the blank Value column of the stock summary. Stock is updated manually. Recording bills and deducting stock is a later step.

---

## 2. Solution

### 2.1 Reverse VAT in paisa
`X = round2(G ÷ (1 + V/100))`, `VAT = G − X`. Money is handled as whole paisa in the calculation, so floating-point noise cannot create a fake variance.

### 2.2 Every line starts at its max rate
Each line is priced at its max sell rate with the count entered. A rate can be typed over (an override). An override is held until you tap "Use max rate again".

### 2.3 One absorbing line takes the rest
The bill has one **absorber** line. Its amount is the taxable base minus the total of the other lines.

| Absorber | What adjusts | How |
|---|---|---|
| Pcs or dozen | Rate | Count is fixed. Rate = remainder ÷ count, rounded to paisa. |
| Kg, "Quantity adjusts" (default) | Weight | Rate is fixed at max. Weight is solved (see below). |
| Kg, "Rate adjusts" | Rate | Weight is typed. Rate = remainder ÷ weight. |

**Kg weight search.** The exact weight is rarely a clean number. The solver tries the 3-decimal weights either side of it (1 gram steps, what a scale reads), and the 4-decimal ones only if needed. It picks, in this order:
1. An exact match.
2. A weight whose leftover gap a 1-piece line can close within its max rate.
3. Fewer decimals.
4. The smaller gap.

**Default absorber.** A line with no count typed yet (it suggests its own count). Otherwise the pcs or dozen line with the smallest count, because a count of 1 keeps the rate exact to the paisa. Otherwise the first kg line, because a typed weight can leave a gap. You can pick any line, or "Nobody" to see the variance. When the absorber changes, its computed box is kept as typed on the screen, so the screen and the pricing agree.

### 2.3a Single bill: the fixed box
On the absorber line, one box is **fixed** and the other follows. Typing in either box makes that box the fixed one.

- **Count typed**: the rate is computed to the paisa.
- **Rate typed**: the count is suggested as the nearest whole count (pcs) or half dozen (dozen) that keeps the rate closest. Rate absorbs the rest, so the total stays the same.
- **Exact counts** for the total are listed under the boxes. If none exists, the variance shows.
- **Count steps** (+1, −1, +10 for pcs; ±½, +1 for dozen) start from the count shown.
- **Fix Count / Rate** switches which box is fixed. The value shown in that box is kept.
- Kg: the rate is fixed by default and the weight follows. Fixing the weight lets the rate follow.

### 2.4 Close the last paisa on a 1-piece line
If the remainder does not divide evenly, the leftover paisa goes to a line with **count 1**. Its rate moves by exactly that gap, so its amount moves by exactly that gap. The rate may go down freely. It may go up only to its max rate, never above it.

If no line can take the gap, the variance stays visible. The solver does not hide it.

### 2.5 Flag, never hide
Each line shows its status:

| Flag | Meaning |
|---|---|
| LOSS | Margin over buy cost is below 5%. |
| OVER TAX | Margin is above 7%. |
| Above max rate | Rate is above the max sell rate. More tax applies. |
| Error | Other lines already reach the bill total, or a required value is missing. The solver stops and says why. It does not invent a rate. |

The status line says either **Exact** (lines + VAT = bill total) or **Off by NPR x**.

Band checks need the buy cost. Without it, the line shows "no buy cost entered".

### 2.6 Billing lines
Each line prints as: name, quantity, rate, amount. Then the taxable total, the VAT, and the bill total. The result can be copied with one tap.

---

## 3. Using the calculator

1. Enter the total paid, VAT inclusive.
2. Add an item. Choose the unit (Pcs, Dozen or Kg). Type the count or the rate; the other box follows so the total stays the same. Buy cost is optional and turns on the band check.
3. Check the absorber. Change it if the default is not the line you want.
4. Check the status says **Exact**. Copy the billing lines.
5. Tap **Reset** for the next customer.

---

## 4. Limits

- **Not every total can be exact.** Without a 1-piece line or a kg line, many totals cannot be hit to the paisa. The app shows the variance rather than faking a match.
- **Buy cost is typed for now.** Item lookup from the stock summary comes with the backend.
- **Nothing is saved yet.** Bill recording and stock deduction are the next steps.
- **Extra tax above 7% is flagged, not calculated.** The formula is not confirmed yet.

---

## 5. Files

| File | Role |
|---|---|
| `index.html` | Page layout. |
| `style.css` | Styling. Mobile first, two columns on laptops. |
| `app.js` | Screen logic: line cards, events, results, copy. |
| `solver.js` | Pure rules, no DOM. Runs in the browser and in Node. |

Tests are kept outside this repository: solver rules (ten cases) and the page flow (jsdom).

---

## 6. Run it

No build step and no dependencies.
- Open `index.html` in any browser, or
- use the GitHub Pages link above.

---

## 7. Roadmap

1. **Bill recording:** save each bill with its lines, time and staff name.
2. **Backend link:** item lookup and buy cost from the stock summary.
3. **Stock deduction:** match sold items by name and rate, deterministically.
4. **Covers alert:** warn when total covers fall below the 95,000 pcs baseline.
5. **Hosting that does not pause when idle** (for example Cloudflare). Festival weeks can mean 7–8 idle days.

### Open questions
- Extra-tax formula above 7%. Assumed 13% of profit above the band. To confirm.
- Cover baseline: group total or per item. Assumed group total.
- "Most low" item for the reorder alert. Assumed lowest stock ÷ last count.
