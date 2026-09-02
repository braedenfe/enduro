/* ============================================================
   Enduro — Shopify Storefront Cart
   Drop-in cart for the static site. No build step, no dependencies.
   ============================================================ */
(function () {
  'use strict';

  const SHOP_DOMAIN      = 'xerhmr-re.myshopify.com';
  const STOREFRONT_TOKEN = '637eb21c2c085b6e9a1ab3cfad9b6464';
  const API_VERSION      = '2026-04';

  const PRODUCTS = {
    'merino-short-mens':   '15871280546161',
    'o-merino-short-mens': '15979936186737',
    'merino-short-womens': '15871281135985',
    'cotton-short-mens':   '15871285887345',
    'o-cotton-short-mens': '15979935007089',
    'cotton-short-womens': '15876964417905',
    'cotton-long-run-tee': '15871282184561',
    'wool-long-run-tee':   '15871256396145',
    'organic-tote':        '15876958191985',
    'merino-long-run-sock':'15974934675825',
    'merino-micro-short':  '15905028702577',
    'merino-bandeau':      '15904981254513',
    'o-tee':               '15947967398257',
    'enduro-tee':          '15948280660337',
    'gift-with-purchase':  '15906560278897'
  };

  const CREDS_READY  = !SHOP_DOMAIN.includes('YOUR-STORE') && !STOREFRONT_TOKEN.includes('YOUR_');
  const HAS_PRODUCTS = Object.values(PRODUCTS).some(v => /^\d+$/.test(v));
  if (!CREDS_READY || !HAS_PRODUCTS) return;

  const ENDPOINT = 'https://' + SHOP_DOMAIN + '/api/' + API_VERSION + '/graphql.json';
  const CART_KEY = 'enduro_cart_id';
  const money = (a, c) => new Intl.NumberFormat(undefined, { style:'currency', currency:c }).format(a);
  const gid = (id) => 'gid://shopify/Product/' + id;

  /* ---------- Free gift promotion (modular) ----------
     To change the offer, edit THRESHOLD or productKey only. */
  const GIFT = {
    enabled:       true,
    threshold:     100,               // qualifying AUD subtotal (excludes shipping & the gift line)
    productKey:    'organic-tote',    // standard gift (BXGY discount zeroes it at checkout)
    bundleSafeKey: 'gift-with-purchase', // $0 product used when a bundle is in the cart (BXGY can't see bundles)
    displayValue:  20,                // struck-through value shown in the cart drawer
    label:         'Enduro Tote'
  };
  /* ---------- Free shipping milestone (modular) ----------
     Shown on the same progress bar as the gift. Edit threshold only. */
  const SHIPPING = {
    enabled:   true,
    threshold: 150,                   // qualifying AUD subtotal for free standard AUS shipping
    label:     'free standard AUS shipping'
  };
  /* ---------- Bundle: Micro Short + Bandeau (modular) ----------
     When one of each is in the cart, the pair is swapped for the
     matching bundle variant so the set discount applies. */
  const BUNDLE = {
    enabled:   true,
    productId: '15905319354737',
    partShort: 'merino-micro-short',  // option name containing 'micro short' holds this size
    partBand:  'merino-bandeau'       // the plain 'Size' option holds this size
  };

  /* ---------- Afterpay on-site messaging ----------
     Cart placement ID comes from Business Hub > On-Site Messaging >
     Implementation guide > section 3 (Cart page). */
  const AFTERPAY = {
    enabled:     true,
    mpid:        '8d553645-40c0-4122-97f9-9c8e90287c7d',
    cartPlacement: 'c283ee40-6e80-4d5e-937c-621c419202d9',
    currency:    'AUD',
    locale:      'en_AU'
  };

  const GIFT_ATTR = '_enduro_gift';
  const giftProductGid = () =>
    (GIFT.enabled && PRODUCTS[GIFT.productKey]) ? gid(PRODUCTS[GIFT.productKey]) : null;
  // a line counts as "the gift" only if WE tagged it, so a tote the customer buys is unaffected
  const isGiftLine = (node) =>
    !!(node.attributes && node.attributes.some(a => a.key === GIFT_ATTR && a.value === '1'));
  // amount the customer actually pays for non-gift items (the gift is complimentary)
  const qualifyingSubtotal = (cart) =>
    cart.lines.edges.reduce((sum, { node }) =>
      isGiftLine(node) ? sum : sum + parseFloat(node.merchandise.price.amount) * node.quantity, 0);

  const giftVariantIds = {};
  async function resolveGiftVariant(key) {
    key = key || GIFT.productKey;
    if (giftVariantIds[key]) return giftVariantIds[key];
    const list = await resolveVariants(key);
    if (!list || !list.length) return null;
    giftVariantIds[key] = (list.find(v => v.available && v.priceNum === 0) || list.find(v => v.available) || list[0]).id;
    return giftVariantIds[key];
  }
  // which gift product should this cart carry?
  function desiredGiftKey(cart) {
    const bs = GIFT.bundleSafeKey;
    if (bs && PRODUCTS[bs] && /^\d+$/.test(PRODUCTS[bs]) && typeof BUNDLE !== 'undefined' && BUNDLE.productId) {
      const bGid = gid(BUNDLE.productId);
      const hasBundle = cart.lines.edges.some(({ node }) => node.merchandise.product.id === bGid);
      if (hasBundle) return bs;
    }
    return GIFT.productKey;
  }

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

  /* ---------- resolve size -> variant (cached) ---------- */
  const variantCache = {};
  async function resolveVariants(key) {
    if (variantCache[key]) return variantCache[key];
    const id = PRODUCTS[key];
    if (!id || !/^\d+$/.test(id)) return null;
    const d = await gql(
      `query($id:ID!){ product(id:$id){ title variants(first:100){ edges{ node{
        id availableForSale price { amount } selectedOptions{ name value } } } } } }`,
      { id: gid(id) });
    if (!d.product) { console.warn('[enduro-cart] product not found / not published to Headless:', key); return null; }
    const list = d.product.variants.edges.map(({ node }) => {
      const opt = (n) => { const o = node.selectedOptions.find(x => x.name.toLowerCase() === n); return o ? o.value.toLowerCase() : null; };
      return { id: node.id, available: node.availableForSale, priceNum: parseFloat(node.price.amount), size: opt('size'), color: opt('color') };
    });
    variantCache[key] = list;
    return list;
  }

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
    cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
    discountCodes { code applicable }
    discountAllocations { discountedAmount { amount currencyCode } }
    lines(first:50){ edges { node { id quantity attributes { key value }
      cost { subtotalAmount { amount currencyCode } totalAmount { amount currencyCode } }
      discountAllocations { discountedAmount { amount currencyCode } }
      merchandise { ... on ProductVariant {
        id title price { amount currencyCode }
        product { id title featuredImage { url altText } } } } } } }`;

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
  const updateLine = (cartId, lineId, quantity) => gql(
    `mutation($cartId:ID!,$lines:[CartLineUpdateInput!]!){cartLinesUpdate(cartId:$cartId,lines:$lines){cart{${CART}} userErrors{message}}}`,
    { cartId, lines:[{ id: lineId, quantity }] }).then(d => d.cartLinesUpdate.cart);
  const updateCodes = (cartId, codes) => gql(
    `mutation($cartId:ID!,$codes:[String!]!){cartDiscountCodesUpdate(cartId:$cartId,discountCodes:$codes){cart{${CART}} userErrors{message}}}`,
    { cartId, codes }).then(d => d.cartDiscountCodesUpdate.cart);

  async function addToCartFlow(variantId) {
    const cartId = localStorage.getItem(CART_KEY);
    let cart;
    if (cartId) {
      try {
        // check if variant already in cart — if so, increment quantity
        const existing = await getCart(cartId);
        if (existing) {
          const existingLine = existing.lines.edges.find(({ node }) => node.merchandise.id === variantId);
          if (existingLine) {
            cart = await updateLine(cartId, existingLine.node.id, existingLine.node.quantity + 1);
          } else {
            cart = await addLine(cartId, { merchandiseId: variantId, quantity: 1 });
          }
        }
      } catch (e) { cart = null; }
    }
    if (!cart) { cart = await createCart({ merchandiseId: variantId, quantity: 1 }); }
    localStorage.setItem(CART_KEY, cart.id);
    return cart;
  }

  /* ---------- Klaviyo helper ---------- */
  function klTrack(event, props) {
    window.klaviyo = window.klaviyo || [];
    window.klaviyo.push(['track', event, props]);
  }

  /* ---------- GA4 helper ---------- */
  function ga(event, params) {
    if (typeof window.gtag !== 'function') return;
    window.gtag('event', event, params);
  }
  function gaItems(cart) {
    if (!cart || !cart.lines) return [];
    return cart.lines.edges.map(function (e) {
      const n = e.node, m = n.merchandise;
      return {
        item_id: (m.sku || m.id || '').split('/').pop(),
        item_name: m.product ? m.product.title : '',
        item_variant: m.title || '',
        price: Number(m.price && m.price.amount) || 0,
        quantity: n.quantity
      };
    });
  }

  /* ---------- UI: drawer + nav link ---------- */
  const css = `
    #ec-link{cursor:pointer}
    #ec-overlay{position:fixed;inset:0;overscroll-behavior:contain;touch-action:none;background:rgba(14,21,18,.45);opacity:0;pointer-events:none;transition:opacity .3s;z-index:500}
    #ec-overlay.open{opacity:1;pointer-events:auto}
    #ec-drawer{position:fixed;top:0;right:0;height:100dvh;overscroll-behavior:contain;width:min(420px,100vw);background:#FAFAF8;transform:translateX(100%);transition:transform .35s cubic-bezier(.2,.7,.2,1);z-index:501;display:flex;flex-direction:column;font-family:'DM Sans',sans-serif;color:#0E1512}
    #ec-drawer.open{transform:translateX(0)}
    .ec-head{display:flex;justify-content:space-between;align-items:center;padding:22px 24px;border-bottom:1px solid rgba(14,21,18,.1)}
    .ec-head h3{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:1.3rem;color:#0E1512}
    .ec-x{background:none;border:none;font-size:1.4rem;color:#0E1512;line-height:1}
    .ec-lines{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;padding:8px 24px}
    .ec-line{display:flex;gap:14px;padding:16px 0;border-bottom:1px solid rgba(14,21,18,.08)}
    .ec-line img{width:64px;height:80px;object-fit:cover;border-radius:3px;background:#EAE6DE}
    .ec-line .t{font-size:.92rem;color:#0E1512}
    .ec-line .s{font-family:'Barlow Condensed',sans-serif;letter-spacing:.1em;text-transform:uppercase;font-size:.74rem;color:rgba(14,21,18,.5);margin-top:2px}
    .ec-line .p{font-size:.88rem;margin-top:6px;color:#0E1512}
    .ec-line .p s{color:rgba(14,21,18,.4);font-weight:300;margin-right:7px}
    .ec-line .dtag{display:inline-block;font-family:'Barlow Condensed',sans-serif;font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:#1F3D35;background:rgba(31,61,53,.08);border-radius:99px;padding:3px 9px;margin-top:7px}
    .ec-row{display:flex;justify-content:space-between;font-size:.9rem;margin-bottom:8px;color:rgba(14,21,18,.75)}
    .ec-row.disc span:last-child{color:#1F3D35;font-weight:500}
    .ec-total{display:flex;justify-content:space-between;font-size:1rem;font-weight:500;margin:2px 0 14px;color:#0E1512}
    .ec-qty{display:inline-flex;align-items:center;gap:8px;margin-top:8px}
    .ec-qty button{width:24px;height:24px;border:1px solid rgba(14,21,18,.2);border-radius:50%;background:none;font-size:1rem;line-height:1;cursor:pointer;color:#0E1512}
    .ec-qty span{font-size:.88rem;min-width:16px;text-align:center;color:#0E1512;font-weight:500}
    .ec-rm{background:none;border:none;font-size:.72rem;letter-spacing:.06em;text-transform:uppercase;color:rgba(14,21,18,.45);text-decoration:underline;margin-top:6px}
    .ec-foot{padding:20px 24px;border-top:1px solid rgba(14,21,18,.1);color:#0E1512}
    .ec-code{display:flex;gap:8px;margin-bottom:12px}
    .ec-code input{flex:1;border:1px solid rgba(14,21,18,.18);border-radius:99px;padding:11px 16px;font-family:'DM Sans',sans-serif;font-size:.85rem;background:#fff;min-width:0;outline:none;text-transform:uppercase}
    .ec-code input:focus{border-color:#1F3D35}
    .ec-code input::placeholder{text-transform:none;color:rgba(14,21,18,.4)}
    .ec-code button{border:none;border-radius:99px;background:#0E1512;color:#F5F2EC;font-family:'Barlow Condensed',sans-serif;font-size:.78rem;letter-spacing:.18em;text-transform:uppercase;padding:0 18px;cursor:pointer}
    .ec-code button:disabled{opacity:.5}
    .ec-code-msg{font-size:.78rem;color:#8C3B2E;margin:-4px 0 10px}
    .ec-code-msg:empty{display:none}
    .ec-chip{display:inline-flex;align-items:center;gap:6px;font-family:'Barlow Condensed',sans-serif;font-size:.76rem;letter-spacing:.14em;text-transform:uppercase;color:#1F3D35;background:rgba(31,61,53,.08);border-radius:99px;padding:6px 8px 6px 13px;margin-bottom:12px}
    .ec-chip button{background:none;border:none;color:#1F3D35;font-size:1rem;line-height:1;padding:0 4px;cursor:pointer}
    .ec-sub{display:flex;justify-content:space-between;font-size:.95rem;margin-bottom:5px;color:#0E1512}
    .ec-co{display:block;width:100%;text-align:center;padding:16px;border:none;border-radius:99px;background:#1F3D35;color:#F5F2EC;font-family:'Barlow Condensed',sans-serif;font-size:.88rem;font-weight:500;letter-spacing:.24em;text-transform:uppercase}
    .ec-empty{padding:60px 24px;text-align:center;color:rgba(14,21,18,.5);font-size:.92rem}
    .ec-gift{padding:18px 24px 16px;border-bottom:1px solid rgba(14,21,18,.1);background:#FAFAF8}
    .ec-gift-msg{display:flex;align-items:center;gap:7px;font-family:'DM Sans',sans-serif;font-size:.82rem;line-height:1.4;color:#0E1512;margin-bottom:11px}
    .ec-gift-msg .amt{font-weight:600}
    .ec-gift-check{flex:0 0 auto;width:15px;height:15px;color:#071e04;opacity:0;transform:scale(.6);transition:opacity .45s ease,transform .45s cubic-bezier(.2,.7,.2,1)}
    .ec-gift.qualified .ec-gift-check{opacity:1;transform:scale(1)}
    #ec-afterpay{margin:0 0 16px;min-height:0;color:#0E1512}
    #ec-afterpay square-placement{color:#0E1512}
    #ec-afterpay:empty{margin:0 0 9px}
    #ec-afterpay square-placement{display:block}
    .ec-gift-track{position:relative;height:4px;border-radius:99px;background:rgba(7,30,4,.12)}
    .ec-gift-fill{height:100%;width:0;border-radius:99px;background:#071e04;transition:width .6s cubic-bezier(.4,0,.1,1)}
    .ec-gift-dot{position:absolute;top:50%;width:9px;height:9px;border-radius:50%;background:#FAFAF8;border:1.5px solid rgba(7,30,4,.25);transform:translate(-50%,-50%);transition:border-color .45s,background .45s}
    .ec-gift-dot.passed{background:#071e04;border-color:#071e04}
    #ec-sticky{position:fixed;left:0;right:0;bottom:0;z-index:490;display:none;align-items:center;gap:14px;padding:12px 20px calc(12px + env(safe-area-inset-bottom));background:rgba(250,250,248,.96);-webkit-backdrop-filter:blur(12px);backdrop-filter:blur(12px);border-top:1px solid rgba(14,21,18,.1);transform:translateY(110%);transition:transform .35s cubic-bezier(.2,.7,.2,1);font-family:'DM Sans',sans-serif}
    #ec-sticky.show{transform:translateY(0)}
    @media(max-width:920px){#ec-sticky{display:flex}}
    .ec-sticky-info{flex:1;min-width:0}
    .ec-sticky-name{font-size:.9rem;color:#0E1512;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .ec-sticky-sub{font-family:'Barlow Condensed',sans-serif;font-size:.76rem;letter-spacing:.12em;text-transform:uppercase;color:rgba(14,21,18,.55);margin-top:1px}
    .ec-sticky-btn{flex:0 0 auto;border:none;border-radius:99px;background:#1F3D35;color:#F5F2EC;font-family:'Barlow Condensed',sans-serif;font-size:.84rem;font-weight:500;letter-spacing:.2em;text-transform:uppercase;padding:14px 26px;cursor:pointer}
    .ec-sticky-btn:disabled{opacity:.6}`;
  const style = document.createElement('style'); style.textContent = css; document.head.appendChild(style);

  const overlay = document.createElement('div'); overlay.id = 'ec-overlay';
  const drawer = document.createElement('aside'); drawer.id = 'ec-drawer';
  drawer.innerHTML = `<div class="ec-head"><h3>Cart</h3><button class="ec-x" aria-label="Close">&times;</button></div>
    <div class="ec-gift" id="ec-gift" style="display:none">
      <div class="ec-gift-msg" id="ec-gift-msg"></div>
      <div class="ec-gift-track"><div class="ec-gift-fill" id="ec-gift-fill"></div></div>
    </div>
    <div class="ec-lines" id="ec-lines"></div>
    <div class="ec-foot" id="ec-foot" style="display:none">
      <div class="ec-code" id="ec-code-row">
        <input id="ec-code-input" type="text" placeholder="Discount code" autocomplete="off">
        <button id="ec-code-apply" type="button">Apply</button>
      </div>
      <div class="ec-code-msg" id="ec-code-msg"></div>
      <div id="ec-chips"></div>
      <div class="ec-sub"><span>Subtotal</span><span id="ec-sub"></span></div>
      <div id="ec-afterpay"></div>
      <div class="ec-row disc" id="ec-disc-row" style="display:none"><span>Discount</span><span id="ec-disc"></span></div>
      <div class="ec-total" id="ec-total-row" style="display:none"><span>Total</span><span id="ec-total"></span></div>
      <button class="ec-co" id="ec-co">Checkout</button></div>`;
  document.body.appendChild(overlay); document.body.appendChild(drawer);

  let _scrollY = 0;
  const lockPage = (on) => {
    if (on) {
      _scrollY = window.scrollY || window.pageYOffset || 0;
      /* compensate for the scrollbar so the page doesn't jump sideways on desktop */
      const sbw = window.innerWidth - document.documentElement.clientWidth;
      if (sbw > 0) document.body.style.paddingRight = sbw + 'px';
      document.body.style.position = 'fixed';
      document.body.style.top = -_scrollY + 'px';
      document.body.style.left = '0';
      document.body.style.right = '0';
      document.body.style.width = '100%';
    } else {
      document.body.style.paddingRight = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      window.scrollTo(0, _scrollY);
    }
  };
  const openDrawer = () => {
    overlay.classList.add('open'); drawer.classList.add('open'); lockPage(true);
    ga('view_cart', {
      currency: 'AUD',
      value: qualifyingSubtotal(current),
      items: gaItems(current)
    });
  };
  const closeDrawer = () => { overlay.classList.remove('open'); drawer.classList.remove('open'); lockPage(false); };
  // expose a global so the nav cart icon can open the cart (named distinctly to avoid the shop page's quick-view openDrawer)
  window.ecOpenCart = openDrawer;
  overlay.addEventListener('click', closeDrawer);
  drawer.querySelector('.ec-x').addEventListener('click', closeDrawer);

  let current = null;
  /* ---------- gift reconciliation (auto add / remove, once per order) ---------- */
  async function reconcileGift(cart) {
    if (!GIFT.enabled || !cart || !giftProductGid()) return cart;
    const cartId = localStorage.getItem(CART_KEY);
    if (!cartId) return cart;
    try {
      const sub = qualifyingSubtotal(cart);
      const giftLine = cart.lines.edges.find(({ node }) => isGiftLine(node));
      if (sub >= GIFT.threshold) {
        const key = desiredGiftKey(cart);
        const wantGid = gid(PRODUCTS[key]);
        if (!giftLine) {
          const vid = await resolveGiftVariant(key);
          if (vid) return await addLine(cartId, { merchandiseId: vid, quantity: 1, attributes: [{ key: GIFT_ATTR, value: '1' }] });
        } else if (giftLine.node.merchandise.product.id !== wantGid) {
          // bundle presence changed: swap the gift for the right type
          const vid = await resolveGiftVariant(key);
          let c = await removeLine(cartId, giftLine.node.id);
          if (vid) c = await addLine(cartId, { merchandiseId: vid, quantity: 1, attributes: [{ key: GIFT_ATTR, value: '1' }] });
          return c;
        } else if (giftLine.node.quantity !== 1) {
          return await updateLine(cartId, giftLine.node.id, 1); // enforce single gift
        }
      } else if (giftLine) {
        return await removeLine(cartId, giftLine.node.id);
      }
    } catch (e) { /* gift add/remove failed (e.g. tote not on Headless) — fail soft */ }
    return cart;
  }

  /* ---------- Bundle reconcile ---------- */
  let bundleVariants = null;
  async function resolveBundleVariants() {
    if (bundleVariants) return bundleVariants;
    const d = await gql(
      `query($id:ID!){ product(id:$id){ variants(first:100){ edges{ node{
        id availableForSale selectedOptions{ name value } } } } } }`,
      { id: gid(BUNDLE.productId) });
    if (!d.product) { console.warn('[enduro-cart] bundle product not found / not published to Headless'); return null; }
    bundleVariants = d.product.variants.edges.map(({ node }) => {
      let shortSize = null, bandSize = null;
      node.selectedOptions.forEach(o => {
        if (o.name.toLowerCase().indexOf('micro short') > -1) shortSize = o.value.toLowerCase();
        else bandSize = o.value.toLowerCase();
      });
      return { id: node.id, available: node.availableForSale, shortSize: shortSize, bandSize: bandSize };
    });
    return bundleVariants;
  }

  async function reconcileBundle(cart) {
    if (!BUNDLE.enabled || !cart || !PRODUCTS[BUNDLE.partShort] || !PRODUCTS[BUNDLE.partBand]) return cart;
    try {
      const shortGid = gid(PRODUCTS[BUNDLE.partShort]);
      const bandGid  = gid(PRODUCTS[BUNDLE.partBand]);
      const shortLine = cart.lines.edges.find(({ node }) => node.merchandise.product.id === shortGid);
      const bandLine  = cart.lines.edges.find(({ node }) => node.merchandise.product.id === bandGid);
      if (!shortLine || !bandLine) return cart;
      const list = await resolveBundleVariants();
      if (!list) return cart;
      const sSize = (shortLine.node.merchandise.title || '').toLowerCase();
      const bSize = (bandLine.node.merchandise.title || '').toLowerCase();
      const v = list.find(x => x.shortSize === sSize && x.bandSize === bSize);
      if (!v || !v.available) {
        if (v && !v.available) console.warn('[enduro-cart] bundle variant unavailable (check inventory / continue-selling):', sSize, bSize);
        return cart;
      }
      const qty = Math.min(shortLine.node.quantity, bandLine.node.quantity);
      let c = cart;
      c = (shortLine.node.quantity - qty) > 0
        ? await updateLine(c.id, shortLine.node.id, shortLine.node.quantity - qty)
        : await removeLine(c.id, shortLine.node.id);
      c = (bandLine.node.quantity - qty) > 0
        ? await updateLine(c.id, bandLine.node.id, bandLine.node.quantity - qty)
        : await removeLine(c.id, bandLine.node.id);
      const exist = c.lines.edges.find(({ node }) => node.merchandise.id === v.id);
      c = exist
        ? await updateLine(c.id, exist.node.id, exist.node.quantity + qty)
        : await addLine(c.id, { merchandiseId: v.id, quantity: qty });
      // repeat in case other size combinations of the pair remain
      return await reconcileBundle(c);
    } catch (e) { return cart; /* fail soft: parts stay as separate lines */ }
  }

  /* reconcile gift state, then paint */
  async function refresh(cart) {
    const bundled = await reconcileBundle(cart);
    const updated = await reconcileGift(bundled);
    render(updated);
    return updated;
  }

  function updateGiftBar(cart) {
    const box = document.getElementById('ec-gift');
    if (!box) return;
    const giftOn = GIFT.enabled && !!giftProductGid();
    const shipOn = SHIPPING.enabled;
    if (!giftOn && !shipOn) { box.style.display = 'none'; return; }
    const cur = (cart.cost.subtotalAmount && cart.cost.subtotalAmount.currencyCode) || 'AUD';
    const sub = qualifyingSubtotal(cart);
    const maxT = shipOn ? SHIPPING.threshold : GIFT.threshold;
    const pct = Math.max(0, Math.min(100, (sub / maxT) * 100));
    box.style.display = 'block';
    const fill = document.getElementById('ec-gift-fill');
    if (fill) fill.style.width = pct + '%';
    /* mid-track marker for the gift milestone when both are active */
    const track = box.querySelector('.ec-gift-track');
    if (track) {
      let dot = document.getElementById('ec-gift-dot');
      if (giftOn && shipOn && GIFT.threshold < SHIPPING.threshold) {
        if (!dot) {
          dot = document.createElement('div');
          dot.id = 'ec-gift-dot'; dot.className = 'ec-gift-dot';
          track.appendChild(dot);
        }
        dot.style.left = ((GIFT.threshold / SHIPPING.threshold) * 100) + '%';
        dot.classList.toggle('passed', sub >= GIFT.threshold);
      } else if (dot) { dot.remove(); }
    }
    const check = '<svg class="ec-gift-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    const msg = document.getElementById('ec-gift-msg');
    const giftDone = giftOn && sub >= GIFT.threshold;
    const shipDone = shipOn && sub >= SHIPPING.threshold;
    box.classList.toggle('qualified', giftDone || shipDone);
    if (giftOn && shipOn) {
      if (!giftDone) {
        msg.innerHTML = check + '<span>Spend <span class="amt">' + money(GIFT.threshold - sub, cur) +
          '</span> more to receive a complimentary ' + GIFT.label + '.</span>';
      } else if (!shipDone) {
        msg.innerHTML = check + '<span>' + GIFT.label + ' unlocked. Spend <span class="amt">' + money(SHIPPING.threshold - sub, cur) +
          '</span> more for ' + SHIPPING.label + '.</span>';
      } else {
        msg.innerHTML = check + '<span>You\u2019ve qualified for a complimentary ' + GIFT.label + ' and ' + SHIPPING.label + '.</span>';
      }
    } else if (shipOn) {
      msg.innerHTML = shipDone
        ? check + '<span>You\u2019ve qualified for ' + SHIPPING.label + '.</span>'
        : check + '<span>Spend <span class="amt">' + money(SHIPPING.threshold - sub, cur) + '</span> more for ' + SHIPPING.label + '.</span>';
    } else {
      msg.innerHTML = giftDone
        ? check + '<span>You\u2019ve qualified for a complimentary ' + GIFT.label + '.</span>'
        : check + '<span>Spend <span class="amt">' + money(GIFT.threshold - sub, cur) + '</span> more to receive a complimentary ' + GIFT.label + '.</span>';
    }
  }

  function render(cart) {
    current = cart;
    const link = document.getElementById('ec-link');
    if (link) link.textContent = 'Cart (' + (cart && cart.totalQuantity || 0) + ')';
    // update nav cart count badge(s) across the site
    const qty = (cart && cart.totalQuantity) || 0;
    document.querySelectorAll('.nav-cart-count').forEach(function(b){
      b.textContent = qty;
      b.style.display = qty > 0 ? 'flex' : 'flex';
    });
    const lines = document.getElementById('ec-lines');
    const foot = document.getElementById('ec-foot');
    if (!cart || cart.totalQuantity === 0) {
      lines.innerHTML = '<div class="ec-empty">Your cart is empty.</div>'; foot.style.display = 'none';
      const gEmpty = document.getElementById('ec-gift'); if (gEmpty) gEmpty.style.display = 'none';
      return;
    }
    lines.innerHTML = cart.lines.edges.map(({ node }) => {
      const v = node.merchandise, img = v.product.featuredImage;
      if (isGiftLine(node)) {
        return `<div class="ec-line">
        ${img ? `<img src="${img.url}" alt="${img.altText||''}">` : '<div style="width:64px"></div>'}
        <div><div class="t">${v.product.title}</div><div class="s">Gift</div>
        <div class="p"><s>${money(GIFT.displayValue || v.price.amount, v.price.currencyCode)}</s>Complimentary &middot; ${money(0, v.price.currencyCode)}</div></div></div>`;
      }
      return `<div class="ec-line">
        ${img ? `<img src="${img.url}" alt="${img.altText||''}">` : '<div style="width:64px"></div>'}
        <div><div class="t">${v.product.title}</div><div class="s">${v.title}</div>
        <div class="p">${(function(){
          const cur = v.price.currencyCode;
          const sub = node.cost ? parseFloat(node.cost.subtotalAmount.amount) : v.price.amount * node.quantity;
          const tot = node.cost ? parseFloat(node.cost.totalAmount.amount) : sub;
          return tot < sub ? '<s>' + money(sub, cur) + '</s>' + money(tot, cur) : money(sub, cur);
        })()}</div>
        ${(function(){
          const s = node.cost ? parseFloat(node.cost.subtotalAmount.amount) : 0;
          const t = node.cost ? parseFloat(node.cost.totalAmount.amount) : s;
          return t < s ? '<span class="dtag">Discount applied</span>' : '';
        })()}
        <div class="ec-qty">
          <button data-line="${node.id}" data-qty="${node.quantity - 1}">&#8722;</button>
          <span>${node.quantity}</span>
          <button data-line="${node.id}" data-qty="${node.quantity + 1}">+</button>
        </div></div></div>`;
    }).join('');
    const footCur = (cart.cost.subtotalAmount && cart.cost.subtotalAmount.currencyCode) || 'AUD';
    document.getElementById('ec-sub').textContent = money(qualifyingSubtotal(cart), footCur);
    updateAfterpay(cart);
    /* discount + total rows (shown only when a discount is active) */
    let savings = 0;
    cart.lines.edges.forEach(({ node }) => {
      if (isGiftLine(node)) return; // gift is presented as Complimentary, not as a discount
      (node.discountAllocations || []).forEach(d => { savings += parseFloat(d.discountedAmount.amount); });
    });
    (cart.discountAllocations || []).forEach(d => { savings += parseFloat(d.discountedAmount.amount); });
    const discRow = document.getElementById('ec-disc-row');
    const totalRow = document.getElementById('ec-total-row');
    if (savings > 0 && cart.cost.totalAmount) {
      let total = parseFloat(cart.cost.totalAmount.amount);
      const gl = cart.lines.edges.find(({ node }) => isGiftLine(node));
      if (gl && gl.node.cost) {
        const giftPaid = parseFloat(gl.node.cost.totalAmount.amount);
        if (giftPaid > 0) total -= giftPaid; // gift is complimentary; keep drawer consistent
      }
      document.getElementById('ec-disc').textContent = '\u2212' + money(savings, footCur);
      document.getElementById('ec-total').textContent = money(total, footCur);
      discRow.style.display = 'flex';
      totalRow.style.display = 'flex';
    } else {
      discRow.style.display = 'none';
      totalRow.style.display = 'none';
    }
    /* discount code chips */
    const chips = document.getElementById('ec-chips');
    const appliedCodes = (cart.discountCodes || []).filter(c => c.applicable);
    chips.innerHTML = appliedCodes.map(c =>
      '<span class="ec-chip">' + c.code + '<button data-code="' + c.code + '" aria-label="Remove discount code">&times;</button></span>'
    ).join('');
    chips.querySelectorAll('button').forEach(b => b.addEventListener('click', async () => {
      const cid = localStorage.getItem(CART_KEY);
      const remain = appliedCodes.filter(c => c.code !== b.dataset.code).map(c => c.code);
      try {
        document.getElementById('ec-code-msg').textContent = '';
        render(await updateCodes(cid, remain));
      } catch (e) {}
    }));
    document.getElementById('ec-code-row').style.display = appliedCodes.length ? 'none' : 'flex';
    foot.style.display = 'block';
    updateGiftBar(cart);
    lines.querySelectorAll('.ec-qty button').forEach(b => b.addEventListener('click', async () => {
      const lineId = b.dataset.line, qty = parseInt(b.dataset.qty);
      const cid = localStorage.getItem(CART_KEY);
      try {
        if (qty < 1) { await refresh(await removeLine(cid, lineId)); }
        else { await refresh(await updateLine(cid, lineId, qty)); }
      } catch (e) {}
    }));
  }

  /* ---------- discount codes ---------- */
  async function applyCode() {
    const input = document.getElementById('ec-code-input');
    const msg = document.getElementById('ec-code-msg');
    const btn = document.getElementById('ec-code-apply');
    const code = input.value.trim();
    const cartId = localStorage.getItem(CART_KEY);
    if (!code || !cartId || !current) return;
    btn.disabled = true; msg.textContent = '';
    try {
      let cart = await updateCodes(cartId, [code]);
      const dc = (cart.discountCodes || []).find(c => c.code.toLowerCase() === code.toLowerCase());
      if (!dc || !dc.applicable) {
        cart = await updateCodes(cartId, []);
        msg.textContent = 'That code isn\u2019t valid or doesn\u2019t apply to this cart.';
      } else {
        input.value = '';
      }
      render(cart);
    } catch (e) {
      msg.textContent = 'Something went wrong. Please try again.';
    } finally { btn.disabled = false; }
  }
  document.getElementById('ec-code-apply').addEventListener('click', applyCode);
  document.getElementById('ec-code-input').addEventListener('keydown', function(e){ if (e.key === 'Enter') { e.preventDefault(); applyCode(); } });

  document.getElementById('ec-co').addEventListener('click', () => {
    if (!current) return;
    const items = current.lines.edges.map(({ node }) => {
      const v = node.merchandise;
      return { ProductName: v.product.title, ProductID: v.id, Quantity: node.quantity, ItemPrice: parseFloat(v.price.amount) };
    });
    ga('begin_checkout', {
      currency: (current && current.cost && current.cost.subtotalAmount && current.cost.subtotalAmount.currencyCode) || 'AUD',
      value: qualifyingSubtotal(current),
      items: gaItems(current)
    });
    klTrack('Started Checkout', {
      $value: parseFloat(current.cost.subtotalAmount.amount),
      ItemNames: items.map(i => i.ProductName),
      Items: items
    });
    window.location.href = current.checkoutUrl;
  });

  const navList = document.querySelector('.nav-links');
  if (navList) {
    const li = document.createElement('li');
    li.innerHTML = '<a id="ec-link">Cart (0)</a>';
    li.querySelector('a').addEventListener('click', openDrawer);
    navList.appendChild(li);
  }

  /* ---------- quick add from a product card (shop page) ---------- */
  window.ecQuickAdd = async function (key, size, colourName) {
    if (!PRODUCTS[key] || !/^\d+$/.test(PRODUCTS[key])) {
      if (window.showToast) showToast('That option isn\u2019t available yet');
      return false;
    }
    try {
      const list = await resolveVariants(key);
      const sellable = list ? list.filter(x => !(x.priceNum === 0)) : list;
      const v = (sellable && sellable.length === 1)
        ? sellable[0]
        : (sellable && pickVariant(sellable, size, colourName || null));
      if (!v) { if (window.showToast) showToast('That option isn\u2019t available'); return false; }
      const cart = await addToCartFlow(v.id);
      await refresh(cart); openDrawer();
      const justAdded = cart.lines.edges.find(({ node }) => node.merchandise.id === v.id);
      const m = justAdded && justAdded.merchandise;
      klTrack('Added to Cart', {
        $value: parseFloat(cart.cost.subtotalAmount.amount),
        AddedItemProductName: m ? m.product.title : key,
        AddedItemProductID: key,
        AddedItemQuantity: 1
      });
      ga('add_to_cart', {
        currency: (cart && cart.cost && cart.cost.subtotalAmount && cart.cost.subtotalAmount.currencyCode) || 'AUD',
        value: Number(cart && cart.cost && cart.cost.subtotalAmount && cart.cost.subtotalAmount.amount) || 0,
        items: gaItems(cart)
      });
      return true;
    } catch (e) {
      if (window.showToast) showToast('Something went wrong. Please try again.');
      return false;
    }
  };

  /* ---------- override addToCart() ---------- */
  const _origAddToCart = window.addToCart;
  window.addToCart = async function () {
    const sizeEl = document.querySelector('.size-btn.active');
    if (!sizeEl) { if (window.showToast) showToast('Please select a size'); return; }
    const size = sizeEl.textContent.trim();
    const key = (typeof PAGE !== 'undefined' && PAGE.key) || '';

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
      const sellable = list ? list.filter(x => !(x.priceNum === 0)) : list; // $0 variants are gift-only
      const v = (sellable && sellable.length === 1) ? sellable[0] : (sellable && pickVariant(sellable, size, colorName));
      if (!v) { if (window.showToast) showToast('That option isn\u2019t available'); return; }
      const cart = await addToCartFlow(v.id);
      await refresh(cart); openDrawer();
      const pageUrl = window.location.href.split('?')[0];
      const justAdded = cart.lines.edges.find(({ node }) => node.merchandise.id === v.id);
      const m = justAdded && justAdded.merchandise;
      const addedImg = m && m.product.featuredImage ? m.product.featuredImage.url : undefined;
      klTrack('Added to Cart', {
        $value: parseFloat(cart.cost.subtotalAmount.amount),
        AddedItemProductName: m ? m.product.title : ((typeof PAGE !== 'undefined' && PAGE.klName) || key),
        AddedItemProductID: key,
        AddedItemSize: size,
        AddedItemImageURL: addedImg,
        AddedItemURL: pageUrl,
        CheckoutURL: cart.checkoutUrl,
        ItemNames: cart.lines.edges.map(({ node }) => node.merchandise.product.title),
        Items: cart.lines.edges.map(({ node }) => {
          const mm = node.merchandise;
          return {
            ProductID: mm.product.title,
            ProductName: mm.product.title,
            Quantity: node.quantity,
            ItemPrice: parseFloat(mm.price.amount),
            RowTotal: parseFloat(mm.price.amount) * node.quantity,
            ProductURL: pageUrl,
            ImageURL: mm.product.featuredImage ? mm.product.featuredImage.url : undefined
          };
        })
      });
      ga('add_to_cart', {
        currency: (cart && cart.cost && cart.cost.subtotalAmount && cart.cost.subtotalAmount.currencyCode) || 'AUD',
        value: Number(cart && cart.cost && cart.cost.subtotalAmount && cart.cost.subtotalAmount.amount) || 0,
        items: gaItems(cart)
      });
    } catch (e) {
      if (window.showToast) showToast('Something went wrong. Please try again.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  };

  /* product name from the H1, excluding the fabric/weight suffix */
  function productName(fallback) {
    const el = document.querySelector('.p-name');
    if (!el) return fallback || '';
    const c = el.cloneNode(true);
    const meta = c.querySelector('.p-meta');
    if (meta) meta.remove();
    return c.textContent.replace(/\s+/g, ' ').trim() || (fallback || '');
  }

  /* ---------- Sticky mobile add-to-cart (product pages only) ---------- */
  (function () {
    const mainBtn = document.querySelector('.atc');
    if (!mainBtn || !('IntersectionObserver' in window)) return;
    const priceEl = document.querySelector('.p-price');
    const priceTxt = priceEl ? priceEl.textContent.trim() : '';
    const bar = document.createElement('div'); bar.id = 'ec-sticky';
    bar.innerHTML = '<div class="ec-sticky-info">' +
      '<div class="ec-sticky-name">' + productName('Add to cart') + '</div>' +
      '<div class="ec-sticky-sub" id="ec-sticky-sub">' + priceTxt + '</div></div>' +
      '<button class="ec-sticky-btn" id="ec-sticky-btn">' + (mainBtn.textContent.trim() || 'Add to cart') + '</button>';
    document.body.appendChild(bar);
    const btn = document.getElementById('ec-sticky-btn');
    btn.addEventListener('click', function () {
      if (mainBtn.disabled) return;
      if (!document.querySelector('.size-btn.active')) {
        const row = document.getElementById('size-row');
        if (row) row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        if (window.showToast) showToast('Please select a size');
        return;
      }
      window.addToCart();
    });
    /* reflect the chosen size next to the price */
    document.addEventListener('click', function (e) {
      if (!e.target.closest || !e.target.closest('.size-btn')) return;
      setTimeout(function () {
        const s = document.querySelector('.size-btn.active');
        const sub = document.getElementById('ec-sticky-sub');
        if (sub) sub.textContent = priceTxt + (s ? ' \u00B7 Size ' + s.textContent.trim() : '');
      }, 0);
    });
    /* mirror the main button's label and busy state */
    new MutationObserver(function () {
      btn.disabled = mainBtn.disabled;
      const t = mainBtn.textContent.trim();
      if (t && btn.textContent !== t) btn.textContent = t;
    }).observe(mainBtn, { attributes: true, childList: true, characterData: true, subtree: true });
    /* show whenever the panel button is out of view */
    const io = new IntersectionObserver(function (entries) {
      bar.classList.toggle('show', !entries[0].isIntersecting);
    }, { threshold: 0 });
    io.observe(mainBtn);
  })();

  /* ============================================================
     UX enhancements (site-wide, injected — no page markup edits)
     1. Page fade transitions    2. Product gallery zoom
     3. Related-section reveal   4. Recently viewed strip
     5. Fit finder modal         6. Shop conditions selector
     ============================================================ */
  (function () {
    const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const uxCss = `
      #ec-fade{position:fixed;inset:0;background:#F5F2EC;opacity:0;pointer-events:none;transition:opacity .18s ease;z-index:9999}
      #ec-fade.on{opacity:1;pointer-events:auto}
      #g-main.ec-zoomable #g-img{cursor:zoom-in}
      #g-main.ec-zoomed #g-img{cursor:zoom-out}
      #g-main #g-img{transition:transform .3s ease}
      #g-main.ec-zoomed #g-img{transition:transform .25s ease}
      .ec-rev{opacity:0;transform:translateY(24px);transition:opacity .7s ease,transform .7s cubic-bezier(.2,.7,.2,1)}
      .ec-rev.in{opacity:1;transform:none}
      #ec-recent{max-width:1380px;margin:0 auto;padding:0 32px clamp(72px,10vh,120px)}
      #ec-recent h2{font-family:'Cormorant Garamond',serif;font-weight:500;font-size:clamp(1.9rem,4vw,3rem);letter-spacing:-0.01em;margin-bottom:28px;color:#0E1512}
      #ec-recent h2 .em{font-style:italic;color:#1F3D35}
      @media(max-width:760px){#ec-recent{padding-left:20px;padding-right:20px}}
      #ec-fit-btn{margin-left:14px}
      #ec-fit-ov{position:fixed;inset:0;background:rgba(14,21,18,.45);opacity:0;pointer-events:none;transition:opacity .3s;z-index:600;display:flex;align-items:center;justify-content:center;padding:20px}
      #ec-fit-ov.open{opacity:1;pointer-events:auto}
      #ec-fit{background:#F5F2EC;border-radius:4px;max-width:380px;width:100%;padding:30px 28px;font-family:'DM Sans',sans-serif;transform:translateY(14px);transition:transform .3s cubic-bezier(.2,.7,.2,1)}
      #ec-fit-ov.open #ec-fit{transform:none}
      #ec-fit h3{font-family:'Cormorant Garamond',serif;font-weight:600;font-size:1.5rem;color:#0E1512;margin:0 0 4px}
      #ec-fit .sub{font-size:.84rem;color:rgba(14,21,18,.6);margin:0 0 18px}
      .ec-fit-row{display:flex;gap:10px;margin-bottom:12px}
      .ec-fit-field{flex:1}
      .ec-fit-field label{display:block;font-family:'Barlow Condensed',sans-serif;font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(14,21,18,.55);margin-bottom:6px}
      .ec-fit-field input{width:100%;border:1px solid rgba(14,21,18,.18);border-radius:99px;padding:11px 16px;font-family:'DM Sans',sans-serif;font-size:.9rem;background:#fff;outline:none;box-sizing:border-box}
      .ec-fit-field input:focus{border-color:#1F3D35}
      #ec-fit-go{display:block;width:100%;border:none;border-radius:99px;background:#1F3D35;color:#F5F2EC;font-family:'Barlow Condensed',sans-serif;font-size:.84rem;letter-spacing:.2em;text-transform:uppercase;padding:14px;cursor:pointer;margin-top:4px}
      #ec-fit-res{font-size:.95rem;color:#0E1512;margin:16px 0 0;min-height:1.2em}
      #ec-fit-res .sz{font-weight:600}
      #ec-fit-sel{display:none;width:100%;border:1px solid #1F3D35;border-radius:99px;background:transparent;color:#1F3D35;font-family:'Barlow Condensed',sans-serif;font-size:.8rem;letter-spacing:.18em;text-transform:uppercase;padding:12px;cursor:pointer;margin-top:12px}
      #ec-fit .note{font-size:.76rem;color:rgba(14,21,18,.5);margin:14px 0 0}
      #ec-fit-x{float:right;background:none;border:none;font-size:1.3rem;color:#0E1512;line-height:1;cursor:pointer;padding:0}`;
    const st = document.createElement('style'); st.textContent = uxCss; document.head.appendChild(st);

    /* ---------- 1. page fade transitions ---------- */
    if (!REDUCED) {
      const ov = document.createElement('div'); ov.id = 'ec-fade';
      document.body.appendChild(ov);
      document.addEventListener('click', function (e) {
        const a = e.target.closest && e.target.closest('a[href]');
        if (!a) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;
        if (a.target && a.target !== '_self') return;
        if (a.hasAttribute('download')) return;
        const href = a.getAttribute('href');
        if (!href || href.charAt(0) === '#' || href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0) return;
        let url; try { url = new URL(href, location.href); } catch (err) { return; }
        if (url.origin !== location.origin) return;
        if (url.pathname === location.pathname && url.hash) return;
        e.preventDefault();
        ov.classList.add('on');
        setTimeout(function () { location.href = url.href; }, 190);
      });
      window.addEventListener('pageshow', function () { ov.classList.remove('on'); });
    }

    /* ---------- 2. product gallery zoom ---------- */
    (function () {
      const wrap = document.getElementById('g-main');
      const img = document.getElementById('g-img');
      if (!wrap || !img) return;
      wrap.classList.add('ec-zoomable');
      let zoomed = false;
      const Z = 2.2;
      function setOrigin(x, y) {
        const r = wrap.getBoundingClientRect();
        const px = Math.max(0, Math.min(100, (x - r.left) / r.width * 100));
        const py = Math.max(0, Math.min(100, (y - r.top) / r.height * 100));
        img.style.transformOrigin = px + '% ' + py + '%';
      }
      function zoomOff() {
        if (!zoomed) return;
        zoomed = false; wrap.classList.remove('ec-zoomed'); img.style.transform = '';
      }
      img.addEventListener('click', function (e) {
        if (zoomed) { zoomOff(); return; }
        zoomed = true; wrap.classList.add('ec-zoomed');
        setOrigin(e.clientX, e.clientY);
        img.style.transform = 'scale(' + Z + ')';
      });
      wrap.addEventListener('mousemove', function (e) { if (zoomed) setOrigin(e.clientX, e.clientY); });
      wrap.addEventListener('touchmove', function (e) {
        if (zoomed) { setOrigin(e.touches[0].clientX, e.touches[0].clientY); e.preventDefault(); }
      }, { passive: false });
      /* while zoomed, swallow touchend before the gallery swipe handler sees it */
      document.addEventListener('touchend', function (e) { if (zoomed) e.stopPropagation(); }, true);
      /* leaving the image (nav arrows / colour change) exits zoom */
      new MutationObserver(zoomOff).observe(img, { attributes: true, attributeFilter: ['src'] });
    })();

    /* ---------- 4. recently viewed (built before reveal so it animates too) ---------- */
    (function () {
      const KEY = 'enduro_recent';
      let list = [];
      try { list = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) {}
      if (typeof PAGE === 'undefined' || !PAGE.key || !document.querySelector('.atc')) return;
      const priceEl = document.querySelector('.p-price');
      const gimg = document.getElementById('g-img');
      const entry = {
        key: PAGE.key,
        name: productName(PAGE.klName || ''),
        price: priceEl ? priceEl.textContent.trim() : '',
        img: gimg ? new URL(gimg.getAttribute('src'), location.href).href : '',
        url: location.pathname
      };
      list = [entry].concat(list.filter(function (i) { return i.key !== entry.key; })).slice(0, 9);
      try { localStorage.setItem(KEY, JSON.stringify(list)); } catch (e) {}
      const others = list.filter(function (i) { return i.key !== PAGE.key && i.img; }).slice(0, 3);
      const rel = document.getElementById('related');
      if (!others.length || !rel) return;
      const sec = document.createElement('section');
      sec.id = 'ec-recent'; sec.setAttribute('aria-label', 'Recently viewed');
      sec.innerHTML = '<h2>Recently <span class="em">viewed.</span></h2><div class="rel-grid">' +
        others.map(function (i) {
          return '<a class="rel-card" href="' + i.url + '"><div class="rel-img"><img src="' + i.img +
            '" alt="' + i.name + '" loading="lazy"></div><div class="rel-info"><div><div class="rel-name">' +
            i.name + '</div></div><span class="rel-price">' + i.price + '</span></div></a>';
        }).join('') + '</div>';
      rel.after(sec);
    })();

    /* ---------- 3. reveal below-the-fold cards on product pages ---------- */
    if (!REDUCED && 'IntersectionObserver' in window) {
      const targets = document.querySelectorAll('#related h2, #related .rel-card, #ec-recent h2, #ec-recent .rel-card');
      if (targets.length) {
        const io = new IntersectionObserver(function (entries) {
          entries.forEach(function (en) {
            if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); }
          });
        }, { threshold: 0.12 });
        targets.forEach(function (t, i) {
          t.classList.add('ec-rev');
          t.style.transitionDelay = (i % 4) * 70 + 'ms';
          io.observe(t);
        });
      }
    }

    /* ---------- 5. fit finder modal ---------- */
    (function () {
      const guideBtn = document.querySelector('.size-guide');
      const sizeBtns = document.querySelectorAll('.size-btn');
      if (!guideBtn || !sizeBtns.length) return;
      const ORDER = ['XS', 'S', 'M', 'L', 'XL'];
      const btn = document.createElement('button');
      btn.className = 'size-guide'; btn.id = 'ec-fit-btn'; btn.type = 'button';
      btn.textContent = 'Find my size';
      guideBtn.after(btn);
      const ov = document.createElement('div'); ov.id = 'ec-fit-ov';
      ov.innerHTML = '<div id="ec-fit" role="dialog" aria-label="Find your size">' +
        '<button id="ec-fit-x" aria-label="Close">&times;</button>' +
        '<h3>Find your size</h3><p class="sub">Enter your height and weight for a suggested fit.</p>' +
        '<div class="ec-fit-row">' +
        '<div class="ec-fit-field"><label for="ec-fit-h">Height (cm)</label><input id="ec-fit-h" type="number" inputmode="numeric" min="120" max="230" placeholder="178"></div>' +
        '<div class="ec-fit-field"><label for="ec-fit-w">Weight (kg)</label><input id="ec-fit-w" type="number" inputmode="numeric" min="35" max="180" placeholder="76"></div></div>' +
        '<button id="ec-fit-go" type="button">Suggest my size</button>' +
        '<p id="ec-fit-res"></p>' +
        '<button id="ec-fit-sel" type="button"></button>' +
        '<p class="note">A guide only. Between sizes? We suggest sizing up for a relaxed fit.</p></div>';
      document.body.appendChild(ov);
      const open = function () { ov.classList.add('open'); };
      const close = function () { ov.classList.remove('open'); };
      btn.addEventListener('click', open);
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      document.getElementById('ec-fit-x').addEventListener('click', close);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
      function isWomens() {
        const k = (PAGE && PAGE.key) || '';
        if (k.indexOf('womens') > -1 || k === 'merino-micro-short' || k === 'merino-bandeau') return true;
        const g = document.getElementById('sel-gender');
        return !!(g && g.textContent.indexOf('Women') === 0);
      }
      function band(v, arr) { for (let i = 0; i < arr.length; i++) { if (v < arr[i]) return i; } return arr.length; }
      document.getElementById('ec-fit-go').addEventListener('click', function () {
        const h = parseFloat(document.getElementById('ec-fit-h').value);
        const w = parseFloat(document.getElementById('ec-fit-w').value);
        const res = document.getElementById('ec-fit-res');
        const sel = document.getElementById('ec-fit-sel');
        sel.style.display = 'none';
        if (!h || !w || h < 120 || h > 230 || w < 35 || w > 180) {
          res.textContent = 'Please enter a valid height and weight.'; return;
        }
        const women = isWomens();
        const H = women ? [160, 166, 172, 178] : [168, 174, 181, 188];
        const W = women ? [50, 58, 66, 75] : [60, 70, 80, 92];
        const b = Math.max(band(h, H), band(w, W)); /* 0..4 in XS..XL space */
        /* map to the sizes this product actually offers */
        const avail = Array.prototype.map.call(document.querySelectorAll('.size-btn'), function (x) { return x.textContent.trim(); });
        let pick = ORDER[b];
        if (avail.indexOf(pick) === -1) {
          let best = null, bestD = 99;
          avail.forEach(function (s) {
            const d = Math.abs(ORDER.indexOf(s) - b) - (ORDER.indexOf(s) > b ? 0.25 : 0); /* prefer sizing up on ties */
            if (ORDER.indexOf(s) > -1 && d < bestD) { bestD = d; best = s; }
          });
          pick = best || avail[0];
        }
        res.innerHTML = 'We suggest size <span class="sz">' + pick + '</span>.';
        const target = Array.prototype.find.call(document.querySelectorAll('.size-btn'), function (x) {
          return x.textContent.trim() === pick && !x.classList.contains('sold-out');
        });
        if (target) {
          sel.textContent = 'Select ' + pick;
          sel.style.display = 'block';
          sel.onclick = function () { target.click(); close(); };
        }
      });
    })();
  })();

  /* ============================================================
     UX module 2 — conversion + brand texture
     ============================================================ */
  (function () {
    const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const inPages = location.pathname.indexOf('/pages/') > -1;
    const base = inPages ? '' : 'pages/';
    const root = inPages ? '../' : '';

    const CATALOGUE = [
      /* HIDDEN-AT-LAUNCH */ //{ key:'wool-long-run-tee',   name:'Merino Long Run Tee',    fibre:'Merino',        price:'A$140', file:'product-wool-long-run-tee.html',   img:'assets/images/products/wool-long-run-tee/wool-long-run-tee-white-front-flat.jpg' },
      { key:'cotton-long-run-tee', name:'Essential Tee',          fibre:'Organic cotton',price:'A$100', file:'product-cotton-long-run-tee.html', img:'assets/images/products/cotton-long-run-tee/cotton-long-run-tee-white-front-flat.jpg' },
      { key:'o-tee',               name:'Ø Tee',                  fibre:'Merino',        price:'A$140', file:'product-o-tee.html',               img:'assets/images/products/o-tee/o-tee-white-front-flat.jpg' },
      { key:'enduro-tee',          name:'Enduro Tee',             fibre:'Merino',        price:'A$140', file:'product-enduro-tee.html',          img:'assets/images/products/enduro-tee/enduro-tee-white-front-flat.jpg' },
      { key:'merino-short-mens',   name:'FTLR Merino Lined Short 5\u2033', fibre:'Merino', price:'A$150', file:'product-merino-short-mens.html',   img:'assets/images/products/merino-short-mens/merino-short-mens-front-flat.jpg' },
{ key:'o-merino-short-mens',   name:'\u00d8 Merino Lined Short 5\u2033', fibre:'Merino', price:'A$150', file:'product-o-merino-short-mens.html',   img:'assets/images/products/o-merino-short-mens/o-merino-short-mens-black-front-flat.jpg' },
      /* HIDDEN-AT-LAUNCH */ //{ key:'merino-short-womens', name:'Merino Long Run Short 3\u2033', fibre:'Merino', price:'A$150', file:'product-merino-short-womens.html', img:'assets/images/products/merino-short-womens/merino-short-womens-front-flat.jpg' },
      { key:'cotton-short-mens',   name:'FTLR CottonLite\u2122 Short 5\u2033', fibre:'Organic cotton',price:'A$110',file:'product-cotton-short-mens.html',   img:'assets/images/products/cotton-short-mens/cotton-short-mens-black-front-flat.jpg' },
      { key:'o-cotton-short-mens', name:'\u00d8 CottonLite\u2122 Short 5\u2033', fibre:'Organic cotton',price:'A$110',file:'product-o-cotton-short-mens.html', img:'assets/images/products/o-cotton-short-mens/o-cotton-short-mens-black-front-flat.jpg' },
      /* HIDDEN-AT-LAUNCH */ //{ key:'cotton-short-womens', name:'Essential Short 3\u2033', fibre:'Organic cotton',price:'A$100',file:'product-cotton-short-womens.html', img:'assets/images/products/cotton-short-womens/cotton-short-womens-front-flat.jpg' },
      { key:'merino-micro-short',  name:'Merino Micro Short',     fibre:'Merino',        price:'A$100', file:'product-merino-micro-short.html',  img:'assets/images/products/merino-micro-short/merino-micro-short-black-front-flat.jpg' },
      { key:'merino-bandeau',      name:'Merino Bandeau',         fibre:'Merino',        price:'A$60',  file:'product-merino-bandeau.html',      img:'assets/images/products/merino-bandeau/merino-bandeau-black-front-flat.jpg' },
      { key:'organic-tote',        name:'Organic Tote',           fibre:'Organic cotton',price:'A$20',  file:'product-organic-tote.html',        img:'assets/images/products/organic-tote/organic-tote-front.jpg' },
{ key:'merino-long-run-sock',        name:'Merino Long Run Sock',           fibre:'95% merino',price:'A$30',  file:'product-merino-long-run-sock.html',        img:'assets/images/products/merino-long-run-sock/merino-long-run-sock-natural-white-front-model.jpg' }
    ];

    const css2 = `
      #ec-o{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:84px;height:auto;opacity:0;transition:opacity .16s ease;z-index:10000;pointer-events:none}
      #ec-fade.on #ec-o{opacity:1}
      #ec-o path{fill:#1F3D35;animation:ecOpulse 1.15s ease-in-out infinite}
      @keyframes ecOpulse{0%,100%{opacity:.32}50%{opacity:1}}
      .ec-nudge{margin:2px 0 14px;padding:13px 15px;background:rgba(31,61,53,.06);border-radius:4px;display:flex;align-items:center;gap:12px}
      .ec-nudge span{flex:1;font-size:.83rem;line-height:1.4;color:#0E1512}
      .ec-nudge a{flex:0 0 auto;font-family:'Barlow Condensed',sans-serif;font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:#1F3D35;border-bottom:1px solid rgba(31,61,53,.4);padding-bottom:2px;text-decoration:none;cursor:pointer}
      #ec-search-ov{position:fixed;inset:0;background:rgba(14,21,18,.5);opacity:0;pointer-events:none;transition:opacity .25s;z-index:700;padding:14vh 20px 20px;display:flex;justify-content:center}
      #ec-search-ov.open{opacity:1;pointer-events:auto}
      #ec-search{width:100%;max-width:520px;background:#F5F2EC;border-radius:4px;overflow:hidden;font-family:'DM Sans',sans-serif;height:max-content;transform:translateY(12px);transition:transform .25s cubic-bezier(.2,.7,.2,1)}
      #ec-search-ov.open #ec-search{transform:none}
      #ec-search-in{width:100%;border:none;border-bottom:1px solid rgba(14,21,18,.1);padding:20px 22px;font-family:'DM Sans',sans-serif;font-size:1rem;background:#fff;outline:none;box-sizing:border-box}
      #ec-search-res{max-height:46vh;overflow-y:auto}
      .ec-sr{display:flex;align-items:center;gap:13px;padding:11px 22px;text-decoration:none;border-bottom:1px solid rgba(14,21,18,.06)}
      .ec-sr:last-child{border-bottom:none}
      .ec-sr.sel{background:rgba(31,61,53,.07)}
      .ec-sr img{width:44px;height:55px;object-fit:contain;background:#fff;border-radius:2px;flex:0 0 auto}
      .ec-sr-n{font-size:.9rem;color:#0E1512}
      .ec-sr-f{font-family:'Barlow Condensed',sans-serif;font-size:.72rem;letter-spacing:.13em;text-transform:uppercase;color:rgba(14,21,18,.5);margin-top:2px}
      .ec-sr-p{margin-left:auto;font-size:.86rem;color:#0E1512}
      .ec-sr-empty{padding:26px 22px;font-size:.88rem;color:rgba(14,21,18,.5)}
      .ec-sr-hint{padding:10px 22px;font-family:'Barlow Condensed',sans-serif;font-size:.7rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(14,21,18,.38);border-top:1px solid rgba(14,21,18,.07)}
      .ec-gsm{margin:16px 0 0}
      .ec-gsm-lab{font-family:'Barlow Condensed',sans-serif;font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(14,21,18,.55)}
      .care-item{position:relative}
      .care-item[data-tip]{cursor:help}
      .care-item[data-tip]:hover::after,.care-item[data-tip]:focus-visible::after{content:attr(data-tip);position:absolute;bottom:calc(100% + 7px);left:0;background:#0E1512;color:#F5F2EC;font-family:'DM Sans',sans-serif;font-size:.75rem;line-height:1.4;padding:8px 11px;border-radius:3px;width:max-content;max-width:250px;z-index:20;pointer-events:none}
      #ec-prog{position:fixed;top:0;left:0;height:2px;width:0;background:#1F3D35;z-index:480;transition:width .1s linear}
      #ec-share{background:none;border:none;font-family:'Barlow Condensed',sans-serif;font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(14,21,18,.5);text-decoration:underline;cursor:pointer;padding:0;margin-top:12px}`;
    const st2 = document.createElement('style'); st2.textContent = css2; document.head.appendChild(st2);


    /* ---------- Ø loader inside the page fade ---------- */
    (function () {
      const fade = document.getElementById('ec-fade');
      if (!fade || REDUCED) return;
      fade.innerHTML = '<svg id="ec-o" viewBox="0 0 100 61.28" aria-hidden="true">' +
        '<path fill-rule="evenodd" d="M82.55,0.00 L99.89,0.00 L85.86,10.44 L87.71,11.90 L89.39,13.80 L90.57,15.99 L91.13,18.07 L91.30,21.27 L91.08,23.29 L90.40,26.15 L89.28,29.24 L87.09,33.50 L84.90,36.70 L81.93,40.12 L78.56,43.21 L74.41,46.24 L70.26,48.65 L65.66,50.79 L60.83,52.53 L56.34,53.76 L52.86,54.49 L48.93,55.11 L43.88,55.61 L40.63,55.78 L35.07,55.78 L30.30,55.50 L25.65,54.94 L17.23,61.22 L0.06,61.22 L13.69,51.07 L13.64,50.84 L12.29,49.89 L10.83,48.43 L9.88,47.08 L9.20,45.74 L8.81,44.67 L8.36,42.37 L8.31,40.07 L8.42,38.72 L8.87,36.25 L9.43,34.23 L10.44,31.59 L11.50,29.41 L14.14,25.25 L17.45,21.32 L21.16,17.90 L23.34,16.22 L26.21,14.31 L28.73,12.85 L31.65,11.39 L35.24,9.88 L37.93,8.92 L41.36,7.91 L46.02,6.85 L50.11,6.17 L54.88,5.67 L59.20,5.44 L64.31,5.44 L69.53,5.72 L74.19,6.23 L82.49,0.06 Z M56.45,15.99 L59.65,16.05 L60.66,16.22 L60.49,16.39 L34.40,35.63 L35.30,33.28 L36.87,30.19 L38.83,27.16 L41.19,24.24 L43.38,22.05 L44.56,21.04 L45.96,19.98 L48.37,18.46 L50.34,17.51 L52.53,16.72 L54.66,16.22 L56.40,16.05 Z M65.10,25.81 L65.21,25.76 L64.70,27.10 L63.47,29.74 L62.18,31.99 L60.77,34.06 L58.31,37.09 L56.40,39.00 L53.93,41.02 L51.68,42.48 L49.72,43.49 L46.80,44.56 L44.84,45.01 L42.99,45.23 L40.40,45.23 L39.11,45.06 L65.04,25.87 Z"/></svg>';
    })();

    /* ---------- bundle nudge in the drawer ---------- */
    (function () {
      const lines = document.getElementById('ec-lines');
      if (!lines || typeof BUNDLE === 'undefined' || !BUNDLE.enabled) return;
      const PAIR = {
        'merino-micro-short': { partner:'merino-bandeau', label:'Merino Bandeau', file:'product-merino-bandeau.html' },
        'merino-bandeau':     { partner:'merino-micro-short', label:'Merino Micro Short', file:'product-merino-micro-short.html' }
      };
      let syncing = false;
      const obs = new MutationObserver(function () {
        if (syncing) return;              /* our own edits must not retrigger this */
        syncing = true;
        obs.disconnect();
        try { drawNudge(); } finally {
          obs.observe(lines, { childList: true });
          syncing = false;
        }
      });
      function drawNudge() {
        const old = document.getElementById('ec-nudge'); if (old) old.remove();
        if (!current || !current.lines) return;
        const have = {};
        current.lines.edges.forEach(function (e) {
          Object.keys(PAIR).forEach(function (k) {
            if (PRODUCTS[k] && e.node.merchandise.product.id === gid(PRODUCTS[k])) have[k] = true;
          });
        });
        const keys = Object.keys(PAIR).filter(function (k) { return have[k]; });
        if (keys.length !== 1) return;
        const p = PAIR[keys[0]];
        const el = document.createElement('div');
        el.id = 'ec-nudge'; el.className = 'ec-nudge';
        el.innerHTML = '<span>Add the ' + p.label + ' to complete the set and the pair price applies.</span>' +
          '<a href="' + base + p.file + '">View</a>';
        lines.prepend(el);
      }
      obs.observe(lines, { childList: true });
    })();

    /* ---------- search overlay ---------- */
    (function () {
      const ov = document.createElement('div'); ov.id = 'ec-search-ov';
      ov.innerHTML = '<div id="ec-search" role="dialog" aria-label="Search products">' +
        '<input id="ec-search-in" type="search" placeholder="Search products\u2026" autocomplete="off">' +
        '<div id="ec-search-res"></div>' +
        '<div class="ec-sr-hint">Enter to open &middot; Esc to close</div></div>';
      document.body.appendChild(ov);
      const input = document.getElementById('ec-search-in');
      const res = document.getElementById('ec-search-res');
      let sel = 0, shown = [];
      function paint(q) {
        const t = q.trim().toLowerCase();
        shown = !t ? CATALOGUE.slice(0, 5) : CATALOGUE.filter(function (p) {
          return (p.name + ' ' + p.fibre + ' ' + p.key).toLowerCase().indexOf(t) > -1;
        });
        sel = 0;
        if (!shown.length) { res.innerHTML = '<div class="ec-sr-empty">Nothing matched that.</div>'; return; }
        res.innerHTML = shown.map(function (p, i) {
          return '<a class="ec-sr' + (i === 0 ? ' sel' : '') + '" href="' + base + p.file + '">' +
            '<img src="' + root + p.img + '" alt="" loading="lazy">' +
            '<div><div class="ec-sr-n">' + p.name + '</div><div class="ec-sr-f">' + p.fibre + '</div></div>' +
            '<span class="ec-sr-p">' + p.price + '</span></a>';
        }).join('');
      }
      function mark() {
        res.querySelectorAll('.ec-sr').forEach(function (a, i) { a.classList.toggle('sel', i === sel); });
      }
      const open = function () { ov.classList.add('open'); input.value = ''; paint(''); setTimeout(function () { input.focus(); }, 60); };
      const close = function () { ov.classList.remove('open'); };
      window.ecOpenSearch = open;
      ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
      input.addEventListener('input', function () { paint(input.value); });
      input.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowDown') { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); mark(); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
        else if (e.key === 'Enter' && shown[sel]) { location.href = base + shown[sel].file; }
      });
      /* ---------- keyboard shortcuts ---------- */
      document.addEventListener('keydown', function (e) {
        const tag = (e.target.tagName || '').toLowerCase();
        const typing = tag === 'input' || tag === 'textarea' || e.target.isContentEditable;
        if (e.key === 'Escape') { close(); return; }
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === '/') { e.preventDefault(); open(); }
        else if (e.key === 'c' || e.key === 'C') { if (window.ecOpenCart) { e.preventDefault(); window.ecOpenCart(); } }
      });
    })();

    /* ---------- returning cart nudge ---------- */
    (function () {
      if (sessionStorage.getItem('enduro_seen')) return;
      sessionStorage.setItem('enduro_seen', '1');
      if (!localStorage.getItem(CART_KEY)) return;
      setTimeout(function () {
        if (!current || !current.totalQuantity) return;
        if (window.showToast) showToast('Your cart is waiting \u2014 ' + current.totalQuantity + ' item' + (current.totalQuantity > 1 ? 's' : '') + ' saved');
      }, 1800);
    })();

    /* ---------- fabric weight scale (product pages) ---------- */
    (function () {
      const line = document.querySelector('.p-fabric-line');
      if (!line || typeof PAGE === 'undefined') return;
      if (line.hasAttribute('data-gsm-inline')) return; /* page prints the weight in the title line */
      const GSM = { 'merino-micro-short':210, 'merino-bandeau':210, 'wool-long-run-tee':170, 'o-tee':170, 'enduro-tee':170,
                    'cotton-long-run-tee':90, 'merino-short-mens':250, 'merino-short-womens':250 };
      const g = GSM[PAGE.key];
      if (!g) return;
      const box = document.createElement('div');
      box.className = 'ec-gsm';
      box.innerHTML = '<div class="ec-gsm-lab">Fabric weight &middot; ' + g + ' gsm</div>';
      const tag = document.querySelector('.p-tagline');
      if (tag) tag.after(box); else line.after(box);
    })();

    /* ---------- care icon tooltips ---------- */
    (function () {
      const TIPS = [
        ['machine wash', 'Warm machine wash up to 40\u00B0C. Wool is more resilient than most assume, but a gentle cycle preserves the handle.'],
        ['detergent', 'A Woolmark-approved detergent protects the fibre. Bleach breaks down the protein structure of wool.'],
        ['tumble', 'Warm tumble dry, cool iron. Reshaping while damp keeps the panel lines true.'],
        ['cold', 'Cold machine wash preserves the cotton fibre and keeps colour from fading.'],
        ['dry', 'Line dry where you can. It uses no energy and is kinder to natural fibre.'],
        ['iron', 'Cool iron only. High heat flattens the surface texture of the knit.']
      ];
      document.querySelectorAll('.care-item').forEach(function (it) {
        const t = (it.textContent || '').toLowerCase();
        for (let i = 0; i < TIPS.length; i++) {
          if (t.indexOf(TIPS[i][0]) > -1) { it.setAttribute('data-tip', TIPS[i][1]); it.setAttribute('tabindex', '0'); return; }
        }
      });
    })();

    /* ---------- journal reading progress ---------- */
    (function () {
      const doc = document.querySelector('.doc-body');
      if (!doc) return;
      const bar = document.createElement('div'); bar.id = 'ec-prog';
      document.body.appendChild(bar);
      const upd = function () {
        const r = doc.getBoundingClientRect();
        const total = r.height - window.innerHeight;
        const done = Math.min(1, Math.max(0, -r.top / (total > 0 ? total : 1)));
        bar.style.width = (done * 100) + '%';
      };
      addEventListener('scroll', upd, { passive: true });
      addEventListener('resize', upd);
      upd();
    })();

    /* ---------- share (product pages, where supported) ---------- */
    (function () {
      const note = document.querySelector('.atc-note');
      if (!note || !navigator.share) return;
      const b = document.createElement('button');
      b.id = 'ec-share'; b.type = 'button'; b.textContent = 'Share this';
      note.after(b);
      b.addEventListener('click', function () {
        navigator.share({
          title: productName('Enduro') + ' \u00B7 Enduro',
          url: location.href.split('?')[0]
        }).catch(function () {});
      });
    })();
  })();

  /* ---------- Afterpay cart placement ---------- */
  function updateAfterpay(cart) {
    const host = document.getElementById('ec-afterpay');
    if (!host) return;
    if (!AFTERPAY.enabled) { host.innerHTML = ''; return; }
    const amt = qualifyingSubtotal(cart);
    if (!amt) { host.innerHTML = ''; return; }
    const skus = cart.lines.edges.map(e => e.node.merchandise.product.title).join(',');
    let el = host.querySelector('square-placement');
    if (!el) {
      el = document.createElement('square-placement');
      el.setAttribute('data-mpid', AFTERPAY.mpid);
      el.setAttribute('data-placement-id', AFTERPAY.cartPlacement);
      el.setAttribute('data-page-type', 'cart');
      el.setAttribute('data-currency', AFTERPAY.currency);
      el.setAttribute('data-consumer-locale', AFTERPAY.locale);
      el.setAttribute('data-is-eligible', 'true');
      host.appendChild(el);
    }
    el.setAttribute('data-amount', amt.toFixed(2));
    el.setAttribute('data-item-skus', skus);
  }

  /* ---------- restore existing cart on load ---------- */
  (async function () {
    const id = localStorage.getItem(CART_KEY);
    if (!id) return;
    try { const cart = await getCart(id); if (cart) refresh(cart); else localStorage.removeItem(CART_KEY); }
    catch (e) { localStorage.removeItem(CART_KEY); }
  })();
})();
