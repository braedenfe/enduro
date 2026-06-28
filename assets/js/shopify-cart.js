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
    'merino-short-womens': '15871281135985',
    'cotton-short-mens':   '15871285887345',
    'cotton-short-womens': '15876964417905',
    'cotton-long-run-tee': '15871282184561',
    'wool-long-run-tee':   '15871256396145',
    'organic-tote':        '15876958191985'
  };

  const CREDS_READY  = !SHOP_DOMAIN.includes('YOUR-STORE') && !STOREFRONT_TOKEN.includes('YOUR_');
  const HAS_PRODUCTS = Object.values(PRODUCTS).some(v => /^\d+$/.test(v));
  if (!CREDS_READY || !HAS_PRODUCTS) return;

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

  /* ---------- resolve size -> variant (cached) ---------- */
  const variantCache = {};
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
  const updateLine = (cartId, lineId, quantity) => gql(
    `mutation($cartId:ID!,$lines:[CartLineUpdateInput!]!){cartLinesUpdate(cartId:$cartId,lines:$lines){cart{${CART}} userErrors{message}}}`,
    { cartId, lines:[{ id: lineId, quantity }] }).then(d => d.cartLinesUpdate.cart);

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
    .ec-line .p{font-size:.88rem;margin-top:6px;color:#0E1512}
    .ec-qty{display:inline-flex;align-items:center;gap:8px;margin-top:8px}
    .ec-qty button{width:24px;height:24px;border:1px solid rgba(14,21,18,.2);border-radius:50%;background:none;font-size:1rem;line-height:1;cursor:pointer;color:#0E1512}
    .ec-qty span{font-size:.88rem;min-width:16px;text-align:center;color:#0E1512;font-weight:500}
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
        <div class="p">${money(v.price.amount * node.quantity, v.price.currencyCode)}</div>
        <div class="ec-qty">
          <button data-line="${node.id}" data-qty="${node.quantity - 1}">&#8722;</button>
          <span>${node.quantity}</span>
          <button data-line="${node.id}" data-qty="${node.quantity + 1}">+</button>
        </div></div></div>`;
    }).join('');
    document.getElementById('ec-sub').textContent = money(cart.cost.subtotalAmount.amount, cart.cost.subtotalAmount.currencyCode);
    foot.style.display = 'block';
    lines.querySelectorAll('.ec-qty button').forEach(b => b.addEventListener('click', async () => {
      const lineId = b.dataset.line, qty = parseInt(b.dataset.qty);
      const cid = localStorage.getItem(CART_KEY);
      try {
        if (qty < 1) { render(await removeLine(cid, lineId)); }
        else { render(await updateLine(cid, lineId, qty)); }
      } catch (e) {}
    }));
  }

  document.getElementById('ec-co').addEventListener('click', () => {
    if (!current) return;
    const items = current.lines.edges.map(({ node }) => {
      const v = node.merchandise;
      return { ProductName: v.product.title, ProductID: v.id, Quantity: node.quantity, ItemPrice: parseFloat(v.price.amount) };
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
      const v = (list && list.length === 1) ? list[0] : (list && pickVariant(list, size, colorName));
      if (!v) { if (window.showToast) showToast('That option isn\u2019t available'); return; }
      const cart = await addToCartFlow(v.id);
      render(cart); openDrawer();
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
