# Dodo Checkout

A small checkout any website can embed. Add one script, call one function, and the checkout opens on top of the page. The customer stays on the page. The page never sees the card.

- Live demo: https://dodo-checkout-demo-two.vercel.app
- Minimal embed (one script tag, one call): https://dodo-checkout-demo-two.vercel.app/minimal.html
- No-JS embed (attributes only): https://dodo-checkout-demo-two.vercel.app/declarative.html
- The hosted checkout and the script: https://dodo-checkout-flame.vercel.app/sdk/dodo-checkout.js

The payment is faked inside the checkout. Nothing is charged. The copy is written the way the real thing would say it, so the fake goes through the same states a real gateway would.

## Where the ideas came from

I buy from Cookd (shop.cookdtv.com) fairly often, and their checkout always had a small "Secured by Shopflo" line at the bottom. That name stuck with me, and some time before this assignment turned up I had already gone and read up on what Shopflo does. So when the brief said "build a checkout", I went back to Cookd as a buyer and paid attention to what actually made me comfortable pressing pay, and what got in the way.

What I kept from that:

- The drawer. It slides over the store instead of taking me somewhere else, so I never lose the thing I am buying.
- The milestone bar. Free shipping at one amount, a free gift at the next, badges that tick, and confetti when you cross one. It makes adding one more feel like winning something.
- One big button in the brand colour, and the "secured by" line right under the card fields.
- The bottom of the drawer never moves. The pay button is always where your thumb expects it.

What I dropped: the OTP login step (a wait and a failure mode I did not need for a single product), and the amount of stuff competing for attention. I wanted less on screen, said more clearly.

For the visual system I used the shadcn "Luma" preset as the reference: Geist, a light grey canvas, white cards with big radii, filled pill inputs, one accent. For the receipt at the end I looked at how Apple Pay's sheet does it. Everything else in here is my own call, and I have written down why for each one.

## Embed it

```html
<script src="https://dodo-checkout-flame.vercel.app/sdk/dodo-checkout.js"></script>

<button id="buy">Buy now</button>

<script>
  document.getElementById("buy").addEventListener("click", () => {
    DodoCheckout.open({
      productId: "prod_123",
      onSuccess: ({ sessionId }) => { /* fulfil the order */ },
      onClose: ({ reason }) => { /* "user" | "complete" | "host" | "error" */ },
      onError: ({ code, message }) => { /* log it */ },
    });
  });
</script>
```

That is the whole API. `open()` returns `{ sessionId, close() }`. Every open ends in exactly one `onClose`. `onSuccess` fires at most once. `onError` can fire before either and does not close the checkout unless an `onClose({ reason: "error" })` follows.

If you would rather not write JavaScript, the script tag can carry the defaults and any element with `data-dodo-product` opens the checkout. It gets `dodo:success`, `dodo:close` and `dodo:error` events with the same payloads.

```html
<script src="https://dodo-checkout-flame.vercel.app/sdk/dodo-checkout.js"
        data-layout="modal" data-accent="#1d4ed8" data-merchant-name="Kestrel Supply Co."></script>
<button data-dodo-product="prod_123" data-dodo-quantity="2">Buy 2 notebooks</button>
```

What a store can set: `layout` (drawer or modal), `theme.accent`, `theme.radius`, `theme.font`, `merchant.name`, `merchant.logo`, `merchant.site`, `quantity`, `customerEmail`. Leave the brand out and the checkout reads the store's colour, name and logo from the page it opened on. Copy, fields, the pay button label and the lock line are not configurable on purpose. Those are the things that make it feel safe, and a store should not be able to remove them.

## The repo

```
packages/sdk        the script a site drops in. One plain TypeScript file, no dependencies. 12 KB built.
apps/checkout       the hosted checkout (React + Vite) plus one small function that reads a store's brand
apps/demo           the fake store "Kestrel Supply Co." with a playground, a callback log, and the two small embed pages
tests/e2e.mjs       75 browser checks, run with pnpm test:e2e
```

Run it:

```
pnpm install
pnpm dev
```

Store on http://localhost:5173, checkout on http://localhost:5174. Two ports on purpose, so the iframe is cross-origin locally, the same as in production.

Test it, with `pnpm dev` still running:

```
pnpm test:e2e
```

It drives the installed Chrome headlessly and goes through every state below, plus the security cases: a page posting a crafted message straight to the iframe, a host stylesheet trying to hide the overlay, hostile URLs sent to the brand reader, going offline before and after pressing pay, a real double click, reduced motion.

Test cards:

| Card | What happens |
|---|---|
| 4242 4242 4242 4242 | succeeds |
| 4000 0000 0000 0002 | declined |
| 4000 0000 0000 0341 | fails once, slowly, then succeeds on retry |
| 4000 0000 0000 3220 | the bank asks for an extra check, approve or decline it |

Any other Luhn-valid number succeeds. The notebook has 8 in stock.

## How it works

The script draws an overlay on the host page and puts the checkout inside an iframe on a different origin. The two talk over `postMessage`. Every message on both sides is checked for origin, source window, protocol tag and session id, and anything that fails is dropped without a reply. The script decides where the checkout lives, from its own `src`, so a page cannot point it at a look-alike.

The host page learns four things: that a payment succeeded (session id), that something went wrong (code and message), why the checkout closed (reason), and the handle from `open()`. It never gets the email, the card, the last four or the amount.

The checkout does not trust the host either. A page can skip the script and post to the iframe directly, so the checkout runs the same validation on everything it receives, only ever writes a hex colour into CSS, and ships a Content-Security-Policy. The overlay sits in a closed shadow root, and its host element pins its own display and position inline so a global `display: none !important` cannot blank it.

## The calls the brief left open

**How much a store can change.** An allow-list, above. Colour, corners, font, name, logo, layout. Not copy, not fields, not the trust cues.

**A payment that fails halfway.** The order stays on screen and a failure card appears under it: what happened, the card and amount, a "Nothing charged" line, then "Try again with this card" and "Use a different card". After three declines only the second is offered. If the connection drops after the charge is sent, the checkout waits for it and says so. It never guesses. After twelve seconds it tells the buyer not to pay again and that the result will show up when they are back online.

**Buy pressed twice.** A second `open()` returns the same session. A real double click is the sneaky one: the second click lands on the backdrop where the button was, and a naive overlay closes what it just opened. So the backdrop only dismisses on a deliberate press and release, never in the first half second. Inside, pay ignores repeats, and success reaches the host once.

**What the host may know.** The four things above, nothing more.

## States

Loading, unknown product, a page the checkout cannot talk to, invalid fields, offline before pay, processing, slow processing, declined, declined three times, transient failure, bank check, connection lost after the charge, unconfirmed, leaving the page mid-payment, fewer units left than asked for, left open for twenty minutes, success, close and reopen, host close, reduced motion. Each one has its own copy, tells the host something true, and has a test in `tests/e2e.mjs`.

## Two decisions I went back and forth on

**A failure card or an inline banner.** The banner keeps the form in view and is one less transition. I went with a card of its own in place of the payment card, because a failed payment is the moment people leave, and a red banner above a form full of card digits reads as "you typed it wrong". The card can say plainly that the bank said no and nothing was charged, and offer the two useful actions, while the order stays visible above it. The cost is one extra state and a transition back. The form values survive it.

**Reading the brand from the store's URL, which needs a server.** The brief says no server is needed and I liked that. But a checkout that looks like the store it sits in is most of what makes it feel trustworthy, and a browser cannot read another site's HTML. So there is one small function that reads public signals from a public page: the theme colour, the brand and button colours in the CSS, the site name, the icons. It is written for hostile input, since anyone can call it. If it fails, the checkout falls back to a plain default and nobody notices. The payment itself is still fake and client-side. Only this read-only lookup touches a server.

## What I would do next

- A real backend: `sessionId` as the idempotency key, a webhook so the store does not have to trust the browser callback, and a way to resolve an "unconfirmed" payment after the page is gone.
- The real bank challenge, with the bank's own iframe and a return path.
- Express wallets above the form.
- Per-field card iframes, the way Stripe does it.
- Keeping the caret in place when editing the middle of a card number.
- Unit tests for the card helpers, and the end-to-end run in CI.

## Deploying

Two Vercel projects from this repo, so the store and the checkout are on different origins. Root directory `apps/checkout` for one, `apps/demo` for the other with `VITE_CHECKOUT_ORIGIN` set to the checkout's URL. Turn off Deployment Protection on both, or the script and the iframe get redirected to a Vercel login and the embed fails silently on any other site.
