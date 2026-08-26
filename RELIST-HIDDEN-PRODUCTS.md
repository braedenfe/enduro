# Relisting the hidden products

Hidden 24 August 2026. Nothing was deleted. Every removal is a commented
block tagged `HIDDEN-AT-LAUNCH` — search that string to find them all.

Hidden: `merino-short-womens` (Ø Short 3″), `cotton-short-womens`
(Essential Short 3″), `wool-long-run-tee` (Merino Long Run Tee).

## To turn one or all back on

1. **`vercel.json`** — remove that product's entry from the `redirects`
   array. Do this first. Until it's gone the page redirects to shop.html
   and nothing else you uncomment will be reachable.

2. **`shop.html`** — find `HIDDEN-AT-LAUNCH`, remove the wrapper `<!--`
   and `-->`. The 3″ shorts share one block; the Merino Tee has its own.
   Inner label comments were stripped so the block could be commented.
   Cosmetic only, but you can put them back:
   `<!-- Women's Merino Short 3" -->`, `<!-- Women's Cotton Short 3" -->`,
   `<!-- Merino Tee -->`

3. **`index.html`** — one `HIDDEN-AT-LAUNCH` block per product in the
   launch rail. Remove each wrapper.

4. **`pages/`** — commented `rel-card` links, one line each. Strip the
   `<!-- HIDDEN-AT-LAUNCH ` prefix and trailing ` -->`. The Merino Tee
   appears on ten product pages; the two shorts on four.

5. **`assets/js/shopify-cart.js`** — commented `CATALOGUE` entries.
   Remove the `/* HIDDEN-AT-LAUNCH */ //` prefix.

6. **`sitemap.xml`** — commented `<url>` entries. Uncomment, then
   re-submit the sitemap in Search Console.

7. **Shopify** — re-enable purchasing. Product IDs were never removed
   from `shopify-cart.js` line 14, so the cart works immediately.

## Left in place deliberately

Lookup tables in `shop.html` keyed by all three handles (quick-add data,
card photos, women's imagery, comfort ranges, colourways) and the fabric
weight map in `shopify-cart.js`. Nothing reaches them while the cards are
commented, and keeping them means relisting needs no rebuilding.

## Unrelated fix made at the same time

`product-o-tee.html` and `product-enduro-tee.html` both had JSON-LD schema
copied from the Merino Long Run Tee: wrong `name`, wrong `sku`, and an
`offers.url` pointing at the wrong product page. Both corrected to their
own product. This was a pre-existing bug, not part of the hiding.
