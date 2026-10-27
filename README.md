# Counter sales calculator

One bill, many items. Reverse VAT and unit rate solver. Works offline in any browser, including iPhone Safari.

- Enter the bill total (VAT inclusive). Taxable base = total ÷ (1 + VAT %).
- Add an item per line: unit (Pcs, Dozen, Kg), count or weight, max rate, optional buy cost.
- Each line keeps its max rate. One line "absorbs the rest", so all lines add up to the taxable base exactly.
- Pcs and dozen counts are never rounded. The absorbing rate takes the difference.
- Kg: quantity adjusts by default (rate fixed at max). "Rate adjusts" lets you type the weight instead.
- A line above its max rate, or outside the 5–7% band over buy cost, is flagged.
- Copy the billing lines at the end.

Files: `index.html`, `style.css`, `app.js`, `solver.js`. No build step, no dependencies.
Tests live outside this repo.
