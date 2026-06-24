/* ============================================================
   Enduro — Shopify Storefront Cart
   Drop-in cart for the static site. No build step, no dependencies.

   You only need to give it the PRODUCT ID for each product (the number
   in the admin URL: admin.shopify.com/store/.../products/THISNUMBER).
   The cart looks up each size's variant automatically via the
   Storefront API — no variant IDs to hunt down.

   Include before </body> on every product page + shop.html.
   Stays dormant until at least one real product ID is filled in, so
   it's safe to deploy early — existing pre-order behaviour is untouched.
   ============================================================ */
(function () {
  'use strict';

  /* ====================== CONFIG ====================== */
  const SHOP_DOMAIN      = 'xerhmr-re.myshopify.com';
  const STOREFRONT_TOKEN = '637eb21c2c085b6e9a1ab3cfad9b6464';  // public Storefront API token
  const API_VERSION      = '2026-04';

  // Map each page's PAGE.key -> Shopify PRODUCT ID (the number in the admin URL).
  const PRODUCTS = {
    'merino-short-mens':   '15871280546161',
    'merino-short-womens': '15871281135985',
    'cotton-short-mens':   '15871285887345',
    'cotton-long-run-tee': '15871282184561',
    'wool-long-run-tee':   '15871256396145'
  };
  /* ==================================================== */

  const CREDS_READY  = !SHOP_DOMAIN.includes('YOUR-STORE') && !STOREFRONT_TOKEN.includes('YOUR_');
  const HAS_PRODUCTS = Object.values(PRODUCTS).some(v => /^\d+$/.test(v));
  if (!CREDS_READY || !HAS_PRODUCTS) return; // dormant until creds AND >=1 real product ID

  const ENDPOINT = 'https://' + SHOP_DOMAIN + '/api/' + API_VERSION + '/graphql.json';
  const CART_KEY = 'enduro_cart_id';
  const money = (a, c) => new Intl.NumberFormat(undefined, { style:'currency', currency:c }).format(a);
  const gid = (id) => 'gid://shopify/Product/' + id;

  async function gql(query, variables) {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'X-Shopify-Storefront-Access-Token': STOREFRONT_TOKEN },
      body: JSON.stringify({ query, variables })
    });
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json.data;
  }

  /* ---------- resolve size -> variant id (cached) ---------- */
  const variantCache = {}; // key -> [ { id, available, size, color } ]
  async function resolveVariants(key) {
    if (variantCache[key]) return variantCache[key];
    const id = PRODUCTS[key];
    if (!id || !/^\d+$/.test(id)) return null;
    const d = await gql(
      `query($id:ID!){ product(id:$id){ title variants(first:100){ edges{ node{
        id availableForSale selectedOptions{ name value } } } } } }`,
      { id: gid(id) });
    if (!d.product) { console.warn('[enduro-cart] product not found / not published to Headless:', key); return null; }
    const list = d.product.variants.edges.map(({ node }) => {
      const opt = (n) => { const o = node.selectedOptions.find(x => x.name.toLowerCase() === n); return o ? o.value.toLowerCase() : null; };
      return { id: node.id, available: node.availableForSale, size: opt('size'), color: opt('color') };
    });
    variantCache[key] = list;
    return list;
  }

  // match on size, and on colour only when the page exposes a colour choice
  function pickVariant(list, size, colorName) {
    const s = (size || '').toLowerCase();
    const c = (colorName || '').toLowerCase();
    return list.find(v => {
      if (v.size && v.size !== s) return false;
      if (c && v.color && !(c.indexOf(v.color) > -1 || v.color.indexOf(c) > -1)) return false;
      return true;
    });
  }

  /* ---------- Cart API ---------- */
  const CART = `id checkoutUrl totalQuantity
    cost { subtotalAmount { amount currencyCode } }
    lines(first:50){ edges { node { id quantity
      merchandise { ... on ProductVariant {
        id title price { amount currencyCode }
        product { title featuredImage { url altText } } } } } } }`;

  const createCart = (line) => gql(
    `mutation($lines:[CartLineInput!]){cartCreate(input:{lines:$lines}){cart{${CART}} userErrors{message}}}`,
    { lines:[line] }).then(d => d.cartCreate.cart);
  const addLine = (cartId, line) => gql(
    `mutation($cartId:ID!,$lines:[CartLineInput!]!){cartLinesAdd(cartId:$cartId,lines:$lines){cart{${CART}} userErrors{message}}}`,
    { cartId, lines:[line] }).then(d => d.cartLinesAdd.cart);
  const getCart = (id) => gql(`query($id:ID!){cart(id:$id){${CART}}}`, { id }).then(d => d.cart);
  const removeLine = (cartId, lineId) => gql(
    `mutation($cartId:ID!,$lineIds:[ID!]!){cartLinesRemove(cartId:$cartId,lineIds:$lineIds){cart{${CART}} userErrors{message}}}`,
    { cartId, lineIds:[lineId] }).then(d => d.cartLinesRemove.cart);

  async function addToCartFlow(variantId) {
    const line = { merchandiseId: variantId, quantity: 1 };
    const id = localStorage.getItem(CART_KEY);
    let cart;
    if (id) { try { cart = await addLine(id, line); } catch (e) { cart = null; } }
    if (!cart) { cart = await createCart(line); }
    localStorage.setItem(CART_KEY, cart.id);
    return cart;
  }

  /* ---------- UI: drawer + nav link ---------- */
  const css = `
    #ec-link{cursor:pointer}
    #ec-overlay{position:fixed;inset:0;background:rgba(14,21,18,.45);opacity:0;pointer-events:none;transition:opacity .3s;z-index:500}
    #ec-overlay.open{opacity:1;pointer-events:auto}
    #ec-drawer{position:fixed;top:0;right:0;height:100dvh;width:min(420px,100vw);background:#FAFAF8;transform:translateX(100%);transition:transform .35s cubic-bezier(.2,.7,.2,1);z-index:501;display:flex;flex-direction:column;font-family:'DM Sans',sans-serif}
    #ec-drawer.open{transform:translateX(0)}
    .ec-head{display:flex;justify-content:space-between;align-items:center;padding:22px 24px;border-bottom:1px solid rgba(14,21,18,.1)}
    .ec-head h3{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:1.3rem;color:#0E1512}
    .ec-x{background:none;border:none;font-size:1.4rem;color:#0E1512;line-height:1}
    .ec-lines{flex:1;overflow-y:auto;padding:8px 24px}
    .ec-line{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid rgba(14,21,18,.08)}
    .ec-line img{width:64px;height:80px;object-fit:cover;border-radius:3px;background:#EAE6DE}
    .ec-line .t{font-size:.92rem;color:#0E1512}
    .ec-line .s{font-family:'Barlow Condensed',sans-serif;letter-spacing:.1em;text-transform:uppercase;font-size:.74rem;color:rgba(14,21,18,.5);margin-top:2px}
    .ec-line .p{font-size:.88rem;margin-top:6px}
    .ec-rm{background:none;border:none;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(14,21,18,.45);text-decoration:underline;margin-top:6px}
    .ec-foot{padding:20px 24px;border-top:1px solid rgba(14,21,18,.1)}
    .ec-sub{display:flex;justify-content:space-between;font-size:.95rem;margin-bottom:14px}
    .ec-co{display:block;width:100%;text-align:center;padding:16px;border:none;border-radius:99px;background:#1F3D35;color:#F5F2EC;font-family:'Barlow Condensed',sans-serif;font-size:.88rem;font-weight:500;letter-spacing:.24em;text-transform:uppercase}
    .ec-empty{padding:60px 24px;text-align:center;color:rgba(14,21,18,.5);font-size:.92rem}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const overlay = document.createElement('div'); overlay.id = 'ec-overlay';
  const drawer = document.createElement('aside'); drawer.id = 'ec-drawer';
  drawer.innerHTML = `<div class="ec-head"><h3>Cart</h3><button class="ec-x" aria-label="Close">&times;</button></div>
    <div class="ec-lines" id="ec-lines"></div>
    <div class="ec-foot" id="ec-foot" style="display:none">
      <div class="ec-sub"><span>Subtotal</span><span id="ec-sub"></span></div>
      <button class="ec-co" id="ec-co">Checkout</button></div>`;
  document.body.appendChild(overlay); document.body.appendChild(drawer);

  const openDrawer = () => { overlay.classList.add('open'); drawer.classList.add('open'); };
  const closeDrawer = () => { overlay.classList.remove('open'); drawer.classList.remove('open'); };
  overlay.addEventListener('click', closeDrawer);
  drawer.querySelector('.ec-x').addEventListener('click', closeDrawer);

  let current = null;
  function render(cart) {
    current = cart;
    const link = document.getElementById('ec-link');
    if (link) link.textContent = 'Cart (' + (cart && cart.totalQuantity || 0) + ')';
    const lines = document.getElementById('ec-lines');
    const foot = document.getElementById('ec-foot');
    if (!cart || cart.totalQuantity === 0) {
      lines.innerHTML = '<div class="ec-empty">Your cart is empty.</div>'; foot.style.display = 'none'; return;
    }
    lines.innerHTML = cart.lines.edges.map(({ node }) => {
      const v = node.merchandise, img = v.product.featuredImage;
      return `<div class="ec-line">
        ${img ? `<img src="${img.url}" alt="${img.altText||''}">` : '<div style="width:64px"></div>'}
        <div><div class="t">${v.product.title}</div><div class="s">${v.title}</div>
        <div class="p">${money(v.price.amount, v.price.currencyCode)}</div>
        <button class="ec-rm" data-id="${node.id}">Remove</button></div></div>`;
    }).join('');
    document.getElementById('ec-sub').textContent = money(cart.cost.subtotalAmount.amount, cart.cost.subtotalAmount.currencyCode);
    foot.style.display = 'block';
    lines.querySelectorAll('.ec-rm').forEach(b => b.addEventListener('click', async () => {
      try { render(await removeLine(localStorage.getItem(CART_KEY), b.dataset.id)); } catch (e) {}
    }));
  }
  document.getElementById('ec-co').addEventListener('click', () => { if (current) window.location.href = current.checkoutUrl; });

  const navList = document.querySelector('.nav-links');
  if (navList) {
    const li = document.createElement('li');
    li.innerHTML = '<a id="ec-link">Cart (0)</a>';
    li.querySelector('a').addEventListener('click', openDrawer);
    navList.appendChild(li);
  }

  /* ---------- override addToCart() ---------- */
  const _origAddToCart = window.addToCart; // page's existing pre-order handler
  window.addToCart = async function () {
    const sizeEl = document.querySelector('.size-btn.active');
    if (!sizeEl) { if (window.showToast) showToast('Please select a size'); return; }
    const size = sizeEl.textContent.trim();
    const key = (window.PAGE && PAGE.key) || '';

    // products without a configured ID fall back to the original pre-order flow
    if (!PRODUCTS[key] || !/^\d+$/.test(PRODUCTS[key])) {
      if (typeof _origAddToCart === 'function') return _origAddToCart();
      if (window.showToast) showToast('That size isn\u2019t available yet'); return;
    }

    const btn = document.querySelector('.atc'); const label = btn && btn.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Adding\u2026'; }
    try {
      const list = await resolveVariants(key);
      const colorEl = document.getElementById('sel-colour');
      const colorName = colorEl ? colorEl.textContent.trim() : null;
      const v = list && pickVariant(list, size, colorName);
      if (!v) { if (window.showToast) showToast('That option isn\u2019t available'); return; }
      const cart = await addToCartFlow(v.id);
      render(cart); openDrawer();
      if (window.klaviyo) klaviyo.push(['track', 'Added to Cart', { ProductID: key, Size: size, $value: (window.PAGE && PAGE.priceNum) || undefined }]);
    } catch (e) {
      if (window.showToast) showToast('Something went wrong. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  };

  /* ---------- restore existing cart on load ---------- */
  (async function () {
    const id = localStorage.getItem(CART_KEY);
    if (!id) return;
    try { const cart = await getCart(id); if (cart) render(cart); else localStorage.removeItem(CART_KEY); }
    catch (e) { localStorage.removeItem(CART_KEY); }
  })();
})();
