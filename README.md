# Dodo Checkout

A checkout you can drop into any website with one script tag. It slides in, takes a card, and gets out of the way. The card never touches your page.

Try it: https://dodo-checkout-demo-two.vercel.app (buy some sambar powder, it's fake, the confetti is real)

Smallest possible version: https://dodo-checkout-demo-two.vercel.app/minimal.html (view source, that's all of it)

## Why it looks like this

I order from Cookd a lot. Their checkout always had a little "Secured by Shopflo" line at the bottom, and I got curious enough to read up on Shopflo well before this assignment landed in my inbox. Lucky me. So I went back and bought some masala like a normal person, but this time I paid attention.

Things that made me happy to press pay: the drawer keeps the store behind it, the little milestone bar hands you free stuff and throws confetti, there's one big button in the brand colour, and that button never moves. Things I didn't need: the OTP login, and a lot going on at once.

So I kept the good parts, dropped the rest, and borrowed the look from shadcn's Luma preset (Geist, grey canvas, white cards, pill inputs). The receipt at the end is my nod to Apple Pay.

## Use it

```html
<script src="https://dodo-checkout-flame.vercel.app/sdk/dodo-checkout.js"></script>
<button id="buy">Buy now</button>
<script>
  document.getElementById("buy").onclick = () =>
    DodoCheckout.open({
      productId: "prod_123",
      onSuccess: ({ sessionId }) => console.log("paid", sessionId),
      onClose: ({ reason }) => console.log("closed", reason),
      onError: ({ code, message }) => console.log("oops", code, message),
    });
</script>
```

One function, three callbacks. Every open ends in exactly one `onClose`. `onSuccess` fires once at most. That's the whole API.

Prefer no JavaScript? Put the options on the script tag and a `data-dodo-product` on any button. See `/declarative.html` in the demo.

A store can set the layout (drawer or modal), colour, corners, font, name and logo. Leave the colour out and the checkout reads it from the page it's sitting on. A store can't change the copy, the fields, or the lock line. Those are the bits that make it feel safe.

## Run it

```
pnpm install
pnpm dev          # Lakshmi Stores on :5173, checkout on :5174, different origins on purpose
pnpm test:e2e     # 75 checks in headless Chrome, with pnpm dev still running
```

Cards to try:

| Card | What happens |
|---|---|
| 4242 4242 4242 4242 | pays |
| 4000 0000 0000 0002 | your bank says no |
| 4000 0000 0000 0341 | fails once, slowly, then pays on retry |
| 4000 0000 0000 3220 | your bank wants a word first |

Also fun: press Buy twice, pull the network cable mid-payment, hit Escape while it's paying, try to buy nine packets when there are eight. It handles all of it and tells the host page the truth each time.

## How the pieces talk

The script draws an overlay in a closed shadow root and loads the checkout in an iframe on another origin. They talk over `postMessage`, and every message is checked for origin, source, protocol and session id on both sides. The host learns four things: paid, failed, closed, and why. Never the email, never the card. The checkout also re-validates everything the host sends it, because a page can skip the script and talk to the iframe directly.

## Two things I went back and forth on

**Failure as a banner or a card.** A red banner over a form full of card digits reads as "you typed it wrong". So a declined payment gets its own card under the order: what happened, nothing charged, try again or use a different card. After three declines it stops offering "try again".

**Reading the brand from the store, which needs a server.** The brief said no server needed. But a checkout that matches the store is most of what makes it trustworthy, and a browser can't read another site's HTML. So there's one small function that reads public signals from a public page and falls back to a plain default if it can't. The payment is still fake and client-side.

## If I had another day

A real backend with `sessionId` as the idempotency key and a webhook. The real bank challenge. Apple Pay and Google Pay above the form. Stripe-style one iframe per card field.

## Deploying

Two Vercel projects from this repo, root `apps/checkout` and `apps/demo`, the demo with `VITE_CHECKOUT_ORIGIN` pointing at the checkout. Turn off Deployment Protection on both or the embed gets redirected to a Vercel login and quietly dies.
