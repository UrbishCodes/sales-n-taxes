# Counter sales calculator

Reverse VAT and unit rate solver for counter sales. Works offline in any browser, including iPhone Safari.

- Enter the bill total (incl. VAT). The taxable base is total ÷ (1 + VAT %).
- Pick Pcs, Dozen or Kg. Enter the count, or tap a quick count.
- Pcs and dozen counts are never rounded: the rate absorbs the difference.
- Kg: quantity adjusts by default (rate fixed at standard). Switch to "Rate adjusts" to type the weight.
- Optional buy cost checks the 5–7% profit band.
- Copy the billing line at the end.

Files: `index.html`, `style.css`, `app.js`. No build step, no dependencies.
