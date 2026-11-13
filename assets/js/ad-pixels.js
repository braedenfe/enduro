/* Ad measurement pixels. Loaded in the <head> of every page.
   Meta and ChatGPT Ads: page view on every page, product view on product
   pages, add to cart from shopify-cart.js via window.adTrack.
   Checkout and purchase happen on Shopify's checkout and are tracked there
   (Meta by the Facebook & Instagram app, ChatGPT by a Shopify custom pixel),
   so they are not sent from here. */
(function () {
  var META_PIXEL_ID = '1516251996931568';
  var OPENAI_PIXEL_ID = 'M66SKkQ8gBu9twzftJTBq9';

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
    } catch (e) {}
  });
})();
