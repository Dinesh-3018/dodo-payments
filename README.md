# Dodo Checkout

A tiny embeddable checkout. A site adds one script, calls one function, and a checkout opens on top of the page. The customer never leaves the page, and the page never sees the card.

The payment network is simulated inside the checkout: nothing is charged and no card data leaves the iframe. The copy is written as the real product would say it (the lock line, the bank wording), so the fake exercises the same states a real gateway would.

- **Live demo:** https://dodo-checkout-demo-two.vercel.app (minimal embed: https://dodo-checkout-demo-two.vercel.app/minimal.html; no-JS embed: https://dodo-checkout-demo-two.vercel.app/declarative.html; requirement and edge-case coverage: https://dodo-checkout-demo-two.vercel.app/coverage.html)
- **Hosted checkout and SDK:** https://dodo-checkout-flame.vercel.app (script at `/sdk/dodo-checkout.js`)

## Embed it

Two tags on any page. Nothing to install, no framework, no build step on the host side.

```html
<!-- 1. Load the script from the checkout's origin. It defines one global, DodoCheckout. -->
<script src="https://dodo-checkout-flame.vercel.app/sdk/dodo-checkout.js"></script>

<button id="buy">Buy now</button>

<!-- 2. Open the checkout when the customer asks for it. -->
<script>
  document.getElementById("buy").addEventListener("click", () => {
    DodoCheckout.open({
      productId: "prod_123",                                   // what is being sold
      onSuccess: ({ sessionId }) => { /* fulfil the order */ }, // the payment went through
      onClose:   ({ reason })    => { /* "user" | "complete" | "host" | "error" */ },
      onError:   ({ code, message }) => { /* log it; the checkout usually stays open */ },
    });
  });
</script>
```

That is the whole contract: one function, three callbacks. `open()` returns a handle with `sessionId` and `close()`. Every `open()` ends in exactly one `onClose`; `onSuccess` fires at most once; `onError` can fire before either and does not close the checkout unless `onClose({ reason: "error" })` follows.

Or with no JavaScript at all. The script tag carries the defaults, and any element with `data-dodo-product` opens the checkout; the element receives `dodo:success`, `dodo:close` and `dodo:error` events with the same payloads.

```html
<script src="https://dodo-checkout-flame.vercel.app/sdk/dodo-checkout.js"
        data-layout="modal" data-accent="#1d4ed8" data-merchant-name="Kestrel Supply Co."></script>
<button data-dodo-product="prod_123" data-dodo-quantity="2">Buy 2 notebooks</button>
```

Script-tag attributes: `data-layout`, `data-accent`, `data-radius`, `data-font`, `data-merchant-name`, `data-merchant-logo`, `data-merchant-site`. Trigger attributes: `data-dodo-product` (required), `data-dodo-quantity`, `data-dodo-layout`, `data-dodo-email`. Explicit `open()` options always win over the tag's defaults, and both go through the same validation.

`apps/demo/minimal.html` is the JavaScript version and nothing else: a plain HTML page with a Buy button and a log. `apps/demo/declarative.html` is the attribute version. The full demo store (`apps/demo/index.html`) is the same integration with a playground around it. The SDK source is one plain TypeScript file, `packages/sdk/src/index.ts`, with no dependencies; it builds to `dodo-checkout.js`, which the checkout app serves at `/sdk/dodo-checkout.js`.

## The position

**A checkout should never lie, and it should ask for as little as possible.**

Every spinner says what it is doing. Every failure says what happened, that no money was taken, and what to do next. The host page always learns the truth: every `open()` ends in exactly one `onClose`, and a failed payment reaches `onError` even when the customer retries and succeeds afterwards.

And the form is email plus card. No name, no account, no address, no upsell. The amount is on the button. Nothing moves under your thumb: error text has reserved height, the card brand icon lives in a fixed slot, and the panel does not resize while you type.

## How it looks, and why

One canvas, white cards, one accent. The panel floats off the edge of the page like a sheet rather than a sidebar glued to it. Inside, an order card with the item and a large total, and a payment card with filled, borderless inputs and a pill button. The host's brand colour appears in exactly two places, the pay button and the focus ring; everything else is neutral, so a lime store and a navy store both look designed rather than tinted. Type is Geist, bundled with the checkout and served from its own origin (no third-party font requests, and the CSP stays strict), with tabular numerals on every amount.

Friction taken out on purpose: a pre-filled email shows as a line with a Change link instead of a field, the phone keyboard is not opened until the buyer taps, Backspace walks back across fields the way Tab walks forward, the failure screen restates the amount so nobody has to reopen the summary, and nothing on screen changes size when an error appears.

**Perks, and when the confetti is allowed.** The order card has a quantity stepper and a perks track (thresholds come from the store's config, here the fake catalogue): free shipping from $15, a free sleeve from $40, free engraving from $70. Badges tick as the total crosses each line and a line under the track says how far the next one is. Confetti is a reward, not a greeting: it rains across the panel when a perk is crossed, once on open if a perk is already earned, and bursts when the payment succeeds. It never fires just because the panel opened.

**Why email and not something else.** The brief defines the checkout as product, email, card, pay. Beyond that, a card payment needs a receipt destination and email is the only one that works everywhere with one tap of autofill. Phone plus OTP adds a screen, a wait and a failure mode, and only pays off with a shopper network behind it; no contact at all leaves the buyer with no proof that money moved. So the field stays, and everything around it is there to make it cost almost nothing.

## What is here

```
packages/sdk        the one script a site drops in (one plain TypeScript file; 12 KB built, 4.8 KB gzipped)
apps/checkout       the hosted checkout (React + Vite) and the brand reader function, served from their own origin
apps/demo           a fake store, "Kestrel Supply Co.": index.html (store + playground), minimal.html (the JS embed),
                    declarative.html (the no-JS embed), coverage.html (requirements and edge cases)
tests/e2e.mjs       the end-to-end suite, 75 checks
```

### Run it

```
pnpm install
pnpm dev
```

- Demo store: http://localhost:5173 (also `/minimal.html`, `/declarative.html`, `/coverage.html`)
- Checkout: http://localhost:5174 (also serves the SDK at `/sdk/dodo-checkout.js` and the brand reader at `/api/brand`)

The two apps run on different ports on purpose. That makes the iframe cross-origin locally, exactly as it is in production, so the isolation is real and not just claimed.

`pnpm build` builds all three. `pnpm typecheck` checks all three.

### How the edge cases are tested

With `pnpm dev` running, `pnpm test:e2e` drives the installed Google Chrome headlessly against the two dev servers (Playwright is a dev dependency; no browser download needed). It exercises every condition in the states table, including a real double-click, going offline before and after Pay, the bank challenge, three declines, the stock cap, a page that posts a crafted `init` straight to the iframe, a host stylesheet that tries to hide the overlay, reduced motion, and the brand reader with private, IPv6-mapped, DNS-rebound and redirecting targets plus a megabyte of pathological CSS. The two things a browser cannot check are the CSP header and the leave-page prompt: `curl -I https://dodo-checkout-flame.vercel.app/` shows the header, and reloading the page while a payment is in flight shows the prompt.

### Test cards

| Card | Result |
|---|---|
| 4242 4242 4242 4242 | succeeds |
| 4000 0000 0000 0002 | declined by the bank |
| 4000 0000 0000 0341 | fails once (slowly), succeeds on retry |
| 4000 0000 0000 3220 | the bank asks for an extra check (a stand-in for 3-D Secure); approve or decline it |

Any other Luhn-valid number succeeds. Expiry must be in the future. To see the offline states, set DevTools Network to Offline either before pressing Pay (nothing is sent, the button is held) or right after (the charge is out, the checkout waits for the connection and never guesses). The notebook has 8 in stock; the stepper stops there and the pay step re-checks it.

## How the pieces talk

```
host page                          SDK (in host page)                     checkout (iframe, other origin)
──────────                         ──────────────────                     ────────────────────────────────
DodoCheckout.open(opts) ─────────▶ validate opts, make sessionId
                                   draw overlay in a closed shadow root
                                   iframe.src = <checkout origin>/  ────▶ boot
                                                                   ◀──── { type: "ready" }               to "*", carries nothing
                                   { type: "init", sessionId,     ────▶ re-validate everything, remember
                                     productId, quantity, layout,        hostOrigin + sessionId
                                     theme, merchant, customerEmail }
                                                                   ◀──── { type: "init_ok" }             now "loaded" means "usable"
                                                                         fetch product + brand in parallel, render
                                                                   ◀──── { type: "resize" }              modal layout only
          customer types card, presses Pay                               submit the charge, await its outcome
                                                                   ◀──── { type: "dismissable", false }  SDK refuses backdrop / Esc
                                   Esc or backdrop anyway ──────────────▶ { type: "close_request" }
                                                                   ◀──── { type: "nudge" }               panel shakes, nothing closes
                                                                   ◀──── { type: "error", code }         decline or transient failure
onError({ code, message }) ◀────── (checkout stays open; customer retries)
                                                                   ◀──── { type: "success" }
onSuccess({ sessionId }) ◀────────
                                                                   ◀──── { type: "close", reason }
onClose({ reason }) ◀───────────── tear down overlay, restore focus and scroll
```

Every message on both sides is checked for **origin**, **source window**, **protocol tag**, and (after init) **session id**. Anything that fails a check is dropped without a reply. The SDK sends with an explicit `targetOrigin`, never `"*"`. The checkout replies only to the origin that sent `init`.

Where the checkout lives is decided by the script, not the host: the SDK derives the checkout origin from its own `src`. A host cannot point it at a look-alike.

### What the host can and cannot know

The host gets four facts and nothing else:

| Callback | Payload | Meaning |
|---|---|---|
| `onSuccess` | `{ sessionId }` | a payment succeeded. In a real integration your server would verify the session before fulfilling; here the id is minted in the browser |
| `onError` | `{ code, message }` | something went wrong. Not terminal unless followed by `onClose({ reason: "error" })` |
| `onClose` | `{ reason }` | `"user"`, `"complete"`, `"host"` or `"error"`. Exactly one per `open()` |
| `open()` return | `{ sessionId, close() }` | the handle |

The host never receives the email, the card, the last four, or the amount. The card is typed into a different origin; the host's DOM, memory and network never contain it. The overlay lives in a closed shadow root so host CSS cannot restyle it and host scripts cannot casually reach in.

The checkout does not trust its parent either. A page can skip the SDK and post to the iframe directly, so the checkout re-runs the same validation on everything in `init` (the validators are exported from the SDK's single file and imported by the checkout, one source of truth), only ever writes a hex colour into a CSS variable, and ships with a Content-Security-Policy (`vercel.json`, mirrored in the preview server) that blocks inline scripts and unexpected origins. The overlay's host element pins its own display, position and visibility inline, so a global `display: none !important` in the host's stylesheet cannot blank it.

Error codes. Terminal: `load_failed`, `product_not_found`. Recoverable, the customer is still in the checkout: `payment_declined`, `payment_failed`, `authentication_failed`, `insufficient_stock`, `offline`. Informational: `payment_unconfirmed` (the charge was sent, the connection dropped, and the customer closed before the answer; resolve it by session id), and `invalid_options` (only from a misconfigured `data-dodo-product` element; `open()` throws instead).

### What the host can change

An allow-list, validated in the SDK (so developers get a warning) and again in the checkout (so the SDK is a convenience, not the boundary):

```ts
DodoCheckout.open({
  productId: "prod_123",
  quantity: 2,                             // 1 to 99, default 1; the customer can change it inside
  layout: "drawer" | "modal",              // drawer slides from the right and is a full-height sheet on phones; modal is centred and a bottom sheet on phones
  theme: { accent: "#0f766e", radius: "none" | "small" | "medium" | "large", font: "Inter, sans-serif" },
  merchant: { site: "https://store.example", name: "Store", logo: "https://store.example/logo.png" },
  customerEmail: "sam@example.com",
});
```

If you pass nothing, the checkout reads the store's accent colour, name and logo from the page it was opened on (`/api/brand` fetches the public homepage and looks at `theme-color`, brand CSS variables, button colours, `og:site_name` and the touch icon). `merchant.site` points it at another URL. Explicit values always win. The pay button text picks white or near-black automatically so a lime accent stays legible.

That fetcher runs on behalf of anyone, so it is written for hostile input: every redirect hop is re-validated, hostnames are resolved and refused if they point at a private address, IPv6 literals and private IPv4 ranges are refused, bodies are size-capped, requests are time-capped, the CSS scanners are linear, the cache is bounded, each caller gets 30 lookups a minute, and the function has a 10 s ceiling. The limits are per instance, which is what a serverless function can promise on its own.

Not on the list, on purpose: custom CSS, copy, field order, the pay button label, the lock line. Those are the trust cues, and a host must not be able to remove them.

## The open calls

**Buy pressed twice.** Three different things can go wrong, and each has its own guard. A second `open()` while a checkout is open returns the existing handle and refocuses it: no second iframe, no second session, no duplicate callbacks. A real double-click is subtler: the first click mounts the overlay, so the second click lands on the backdrop where the button was, about 100 ms later, and a naive overlay treats that as "dismiss" and closes what it just opened. So the backdrop only dismisses on a deliberate gesture: pointer down and up on the backdrop itself, and never in the first half second. Inside the checkout, Pay ignores further presses while processing (the button stays focusable, with `aria-disabled` and `aria-busy`, so focus does not jump), the state machine ignores a second submit, and the SDK delivers `onSuccess` at most once per session. This is how the established players do it too: Stripe and Shopify disable the pay button while a confirmation is in flight and rely on an idempotency key server-side; Razorpay's modal ignores a second `open()`; Apple Pay's sheet is system-modal, so a second tap has nowhere to go. What is left for a real backend is the idempotency key itself: `sessionId` is the natural one.

**Close then reopen straight away.** `handle.close(); DodoCheckout.open(...)` in the same tick is fine: scroll lock and focus are restored synchronously, only the exit animation and `onClose` are deferred.

**Payment fails halfway.** The order card stays where it was and a failure card appears under it: what happened in plain words, the card and amount, a Status row reading "Nothing charged", then "Try again with this card" and "Use a different card" (the second is kept off the offline variant, where the card is not the problem). Every field value survives. After three declines the retry disappears and only a different card is offered. The host hears about each failure through `onError` while the checkout stays open. If the connection drops after the charge was sent, nothing is guessed: the checkout waits, and after 12 seconds says so and tells the customer not to pay again.

**Closing mid-payment.** The customer cannot: the close button disables, and Escape (inside or outside the iframe) and backdrop clicks nudge the panel and announce "Hang on, we're confirming your payment" to screen readers. The host can: `handle.close()` is always honoured, because the host owns the page. That is the one case where the outcome of an in-flight payment is unknown, and the reason `"host"` says so.

**A page the checkout cannot talk to.** A `file://` page or a sandboxed preview frame has an opaque origin, so the checkout could never reply safely. It says so once, the SDK closes with `onError(load_failed)` and `onClose(error)`, and nobody is left staring at a locked overlay. The handshake is acknowledged (`ready`, `init`, `init_ok`), so "loaded" means "usable", not "rendered".

**Opening the checkout URL directly.** It renders a plain explanation instead of a broken form. There is no product, no session and no host to report to.

**Bad calls.** Missing `productId` or a callback that is not a function throws a `TypeError` synchronously, so the mistake shows up in development, not as a silent no-op in production. Bad brand values (an accent that is not hex, an http logo) are dropped with a `console.warn` and the checkout still opens.

## Weird states

| State | What the customer sees | What the host hears |
|---|---|---|
| SDK loading the iframe | overlay with "Opening secure checkout" | nothing yet |
| Iframe never loads, or never acknowledges init (10 s) | overlay closes | `onError(load_failed)` then `onClose(error)` |
| Host page has an opaque origin | overlay closes | `onError(load_failed)` then `onClose(error)` |
| Checkout hits an unexpected error while setting up | "Something went wrong opening the checkout", Close | `onError(load_failed)` then `onClose(error)` |
| Product + brand loading | skeleton with "Matching the store's look" | nothing |
| Unknown product | "We couldn't find that product", Close | `onError(product_not_found)` then `onClose(error)` |
| Invalid field | specific message under the field, on blur or on submit, focus moves to the first problem | nothing |
| Processing | button spinner + "Confirming payment", then "Still confirming, hang on" after 4 s (the flaky test card's first attempt takes 5 s, so you can see it), dismissal blocked | nothing |
| Declined | failure card with the card and amount, Try again / Use a different card | `onError(payment_declined)` |
| Declined three times | "This card keeps getting declined", only Use a different card | `onError(payment_declined)` |
| Transient failure | failure card, Try again | `onError(payment_failed)` |
| Bank asks for an extra check | a stand-in for the bank's page with Approve and Decline; closing it counts as declining | `onError(authentication_failed)` on decline |
| Offline before Pay | notice above the button, Pay held, nothing sent | nothing |
| Connection drops after the charge was sent | "Connection lost, waiting for it"; after 12 s an "unconfirmed" card that says don't pay again; the result appears the moment the connection returns | `onError(payment_unconfirmed)` only if the customer closes before the answer |
| Leaving the page mid-payment | the browser's own "leave this page?" prompt, armed only while a payment is in flight | nothing (the page is gone) |
| Fewer units left than asked for | "Only 8 left" on the stepper; if it slips through, a failure card with "Pay for 8" | `onError(insufficient_stock)` |
| Left open for 20 minutes | "This checkout timed out", card details cleared, Start again | nothing |
| Success | a receipt card (paid, to, card, receipt email), one confetti burst, Done | `onSuccess` then `onClose(complete)` |
| Escape / backdrop / X | closes when idle; nudges and announces when processing; if the checkout never answers a close request, the SDK closes anyway after 1.5 s | `onClose(user)` |
| Double-click on Buy | one checkout opens and stays open; the second click is absorbed | one `open()`, one session |
| Drag from the panel that ends on the backdrop | nothing; only a press and release on the backdrop dismisses | nothing |
| Checkout reports success twice, or an error after success | the host hears success once and nothing after it | one `onSuccess` |
| Host page reloads or navigates mid-payment | the iframe dies with the page; a real backend would resolve the outcome by session id and webhook | nothing (page is gone) |
| Host's CSP blocks the iframe or the script | nothing renders; after 10 s the SDK gives up | `onError(load_failed)` then `onClose(error)` |
| Host `close()` | closes immediately | `onClose(host)` |
| Reduced motion | no slide, no confetti, instant states | same |

## Two decisions I went back and forth on

**1. A failure card or an inline banner.** The banner keeps the form in view and is one fewer transition. I ended up with a dedicated failure card in place of the payment card because a failed payment is the moment the customer is most likely to bail, and a banner above a form full of card digits reads as "you typed it wrong". A card of its own can say clearly that the bank said no, that nothing was charged, and offer the two useful actions, while the order stays visible above it. The cost is one extra state and a transition back; the form values survive it.

**2. Reading brand from the store's URL, which needs a server.** The brief says no server is needed and I liked that purity. But a checkout that looks like the store it sits on is most of what makes an embed feel trustworthy, and a browser cannot read another site's HTML. So there is one small function (`apps/checkout/api/brand.ts`, also mounted in the Vite dev server) that reads public signals from a public page. It is heuristic, cached, size-capped, time-capped, and blocks private addresses. If it fails, the checkout falls back to a plain default and nobody notices. The trade-off I accepted: the payment is still fake and client-side; only this read-only lookup touches a server.

Other calls I considered and settled quickly: three callbacks rather than an event emitter (small API, hard to misuse); `onError` as informational and `onClose` as the only terminal event (one place to end every flow); a closed shadow root for the overlay (host CSS cannot break it).

## What I'd explore next

- **Real card isolation per field.** Today the card lives in one iframe. Stripe-style per-field iframes would keep the number, expiry and CVC in separate documents.
- **Express row.** Apple Pay and Google Pay above the form with an "or" divider, following Apple's rule that the button is never smaller than the others.
- **Idempotency and webhooks.** `sessionId` as an idempotency key and a server-side webhook so the host does not need to trust the browser callback, and so an "unconfirmed" payment can be resolved after the page is gone.
- **A real bank challenge.** The stand-in shows the state and the copy; the real thing is the bank's iframe and a return path keyed by session id.
- **Caret-preserving formatting** when editing the middle of the card number. Backspace over a separator already removes the right digit, but the caret still jumps to the end.
- **A real renderer** for the brand reader, for sites whose colours only exist in JavaScript. Rate limiting and DNS checks are in, but per instance; a shared store would make them global.
- **Unit tests** for the card utilities and the message guards, and `pnpm test:e2e` as a CI job with a shared brand-lookup budget so the rate-limit check does not starve the rest.
- **Dark surfaces, RTL and localised currency** once there is a second locale to test against.

## Deploying (Vercel, two projects, one repo)

Two projects so the demo and the checkout sit on different origins, which is the whole point.

1. **Checkout project:** Root Directory `apps/checkout`, framework Vite, no env vars. The `api/` folder becomes a serverless function on its own.
2. **Demo project:** Root Directory `apps/demo`, env var `VITE_CHECKOUT_ORIGIN=https://<checkout-project>.vercel.app` (the script tag in every demo page is built from it).
3. **Turn off Deployment Protection on both projects** (Settings, Deployment Protection). It is on by default for team accounts and answers every request, including the SDK script and the iframe, with a redirect to a Vercel login, so an embed on any other site silently fails.
4. From the CLI the same thing is `vercel build --prod && vercel deploy --prebuilt --prod` inside each app folder; the build runs locally, where the pnpm workspace is available.

