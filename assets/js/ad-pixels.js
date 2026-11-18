/* Ad measurement pixels. Loaded in the <head> of every page.
   Meta, ChatGPT Ads and Reddit: page view on every page, product view on product
   pages, add to cart from shopify-cart.js via window.adTrack.
   Checkout and purchase happen on Shopify's checkout and are tracked there
   (Meta by the Facebook & Instagram app, ChatGPT and Reddit by Shopify custom pixels),
   so they are not sent from here. */
(function () {
  var META_PIXEL_ID = '1516251996931568';
  var OPENAI_PIXEL_ID = 'M66SKkQ8gBu9twzftJTBq9';
  var REDDIT_PIXEL_ID = 'a2_k1fdenc6vtb2';

  /* page key to Shopify product ID, so events match the Meta catalog */
  var IDS = {
    'merino-short-mens':'15871280546161','o-merino-short-mens':'15979936186737',
    'merino-short-womens':'15871281135985','cotton-short-mens':'15871285887345',
    'o-cotton-short-mens':'15979935007089','cotton-short-womens':'15876964417905',
    'cotton-long-run-tee':'15871282184561','wool-long-run-tee':'15871256396145',
    'organic-tote':'15876958191985','merino-long-run-sock':'15974934675825',
    'merino-micro-short':'15905028702577','merino-bandeau':'15904981254513',
    'o-tee':'15947967398257','enduro-tee':'15948280660337',
    'organic-cotton-dad-cap':'16031761924465'
  };
  function idFor(key) { return IDS[key] || String(key); }

  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', META_PIXEL_ID);
  fbq('track', 'PageView');

  /* ChatGPT Ads (OpenAI) pixel. Amounts are integers in cents. */
  !function(w,d,s,u){if(w.oaiq)return;var q=function(){q.q.push(arguments)};q.q=[];
  w.oaiq=q;var j=d.createElement(s);j.async=1;j.src=u;var f=d.getElementsByTagName(s)[0];
  f.parentNode.insertBefore(j,f)}(window,document,"script","https://bzrcdn.openai.com/sdk/oaiq.min.js");
  oaiq('init', { pixelId: OPENAI_PIXEL_ID });
  function cents(n) { return Math.round(Number(n || 0) * 100); }
  function oai(event, data) { try { oaiq('measure', event, data); } catch (e) {} }
  oai('page_viewed', { type: 'contents', contents: [{ id: location.pathname, content_type: 'page' }] });

  /* Reddit pixel */
  !function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};
  p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js";t.async=!0;
  var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);
  rdt('init', REDDIT_PIXEL_ID);
  rdt('track', 'PageVisit');
  function rd(event, data) { try { rdt('track', event, data); } catch (e) {} }

  /* one entry point the site calls; add other ad platforms here later */
  window.adTrack = function (event, data) {
    try {
      if (event === 'add_to_cart') {
        fbq('track', 'AddToCart', {
          content_ids: [idFor(data.key)],
          content_type: 'product_group',
          content_name: data.name,
          value: data.value,
          currency: data.currency || 'AUD'
        });
        oai('items_added', {
          type: 'contents',
          amount: cents(data.value),
          currency: data.currency || 'AUD',
          contents: [{ id: idFor(data.key), name: data.name, content_type: 'product', quantity: 1, amount: cents(data.value) }]
        });
        rd('AddToCart', {
          currency: data.currency || 'AUD', value: data.value, itemCount: 1,
          products: [{ id: idFor(data.key), name: data.name, category: 'Apparel' }]
        });
      }
    } catch (e) {}
  };

  /* product pages define PAGE with the product key and price */
  window.addEventListener('DOMContentLoaded', function () {
    try {
      if (typeof PAGE === 'undefined' || !PAGE.key) return;
      fbq('track', 'ViewContent', {
        content_ids: [idFor(PAGE.key)],
        content_type: 'product_group',
        content_name: PAGE.klName || document.title,
        value: PAGE.priceNum,
        currency: 'AUD'
      });
      oai('contents_viewed', {
        type: 'contents',
        contents: [{ id: idFor(PAGE.key), name: PAGE.klName || document.title, content_type: 'product', amount: cents(PAGE.priceNum), currency: 'AUD' }]
      });
      rd('ViewContent', {
        currency: 'AUD', value: PAGE.priceNum,
        products: [{ id: idFor(PAGE.key), name: PAGE.klName || document.title, category: 'Apparel' }]
      });
    } catch (e) {}
  });
})();

/* Traffic source: remember where a visitor came from (ad, email, social or
   another site) and pass it on to Shopify checkout, so each order shows its
   real source instead of "enduroapparel.com.au". Kept for 30 days. */
(function () {
  var KEY = 'enduro_src', DAYS = 30;
  var PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'fbclid', 'gclid', 'oppref'];
  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && Date.now() - v.t < DAYS * 864e5) return v;
    } catch (e) {}
    return null;
  }
  function save(p) { try { localStorage.setItem(KEY, JSON.stringify({ t: Date.now(), p: p })); } catch (e) {} }
  try {
    var q = new URLSearchParams(location.search), found = {}, any = false;
    PARAMS.forEach(function (k) { var v = q.get(k); if (v) { found[k] = v; any = true; } });
    if (any) {
      if (!found.utm_source && found.fbclid) { found.utm_source = 'facebook'; found.utm_medium = found.utm_medium || 'social'; }
      if (!found.utm_source && found.gclid) { found.utm_source = 'google'; found.utm_medium = found.utm_medium || 'cpc'; }
      save(found);
    } else if (!read() && document.referrer) {
      var host = new URL(document.referrer).hostname.replace(/^www\./, '');
      if (host && !/enduroapparel\.com\.au$|myshopify\.com$|shop\.app$/.test(host)) {
        save({ utm_source: host, utm_medium: 'referral' });
      }
    }
  } catch (e) {}
  window.enduroSource = {
    decorate: function (url) {
      try {
        var v = read(); if (!v) return url;
        var u = new URL(url);
        Object.keys(v.p).forEach(function (k) { if (!u.searchParams.has(k)) u.searchParams.set(k, v.p[k]); });
        return u.toString();
      } catch (e) { return url; }
    }
  };
})();
