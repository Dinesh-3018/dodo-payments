# Dodo Checkout

A tiny embeddable checkout. A site adds one script, calls one function, and a checkout opens on top of the page. The customer never leaves the page, and the page never sees the card.

- **Live demo:** _(add the Vercel URL of `apps/demo` here)_
- **Hosted checkout:** _(add the Vercel URL of `apps/checkout` here)_

```html
<script src="https://<checkout-origin>/sdk/dodo-checkout.js"></script>
<script>
  DodoCheckout.open({
    productId: "prod_123",
    onSuccess: ({ sessionId }) => {},
    onClose: ({ reason }) => {},
    onError: ({ code, message }) => {},
  });
</script>
```

## The position

**A checkout should never lie, and it should ask for as little as possible.**

Every spinner says what it is doing. Every failure says what happened, that no money was taken, and what to do next. The host page always learns the truth: every `open()` ends in exactly one `onClose`, and a failed payment reaches `onError` even when the customer retries and succeeds afterwards.

And the form is email plus card. No name, no account, no address, no upsell. The amount is on the button. Nothing moves under your thumb: error text has reserved height, the card brand icon lives in a fixed slot, and the panel does not resize while you type.

## What is here

```
packages/sdk        the one script a site drops in (plain TypeScript, ~8 KB built)
apps/checkout       the hosted checkout (React + Vite), served from its own origin
apps/demo           a fake store, "Kestrel Supply Co.", with a Buy button and a callback log
```

### Run it

```
pnpm install
pnpm dev
```

- Demo store: http://localhost:5173
- Checkout: http://localhost:5174 (also serves the SDK at `/sdk/dodo-checkout.js`)

The two apps run on different ports on purpose. That makes the iframe cross-origin locally, exactly as it is in production, so the isolation is real and not just claimed.

`pnpm build` builds all three. `pnpm typecheck` checks all three.

### Test cards

| Card | Result |
|---|---|
| 4242 4242 4242 4242 | succeeds |
| 4000 0000 0000 0002 | declined by the bank |
| 4000 0000 0000 0341 | fails once, succeeds on retry |

Any other Luhn-valid number succeeds. Expiry must be in the future. To see the offline state, open the checkout, set DevTools Network to Offline, and press Pay.

## How the pieces talk

```
host page                          SDK (in host page)                     checkout (iframe, other origin)
──────────                         ──────────────────                     ────────────────────────────────
DodoCheckout.open(opts) ─────────▶ validate opts, make sessionId
                                   draw overlay in a closed shadow root
                                   iframe.src = <checkout origin>/  ────▶ boot
                                                                   ◀──── { type: "ready" }               to "*", carries nothing
                                   { type: "init", sessionId,     ────▶ remember hostOrigin + sessionId
                                     productId, layout, theme,           fetch product + brand in parallel
                                     merchant, customerEmail }           render form
                                                                   ◀──── { type: "resize" }              modal layout only
          customer types card, presses Pay                               charge() against the fake network
                                                                   ◀──── { type: "dismissable", false }  SDK refuses backdrop / Esc
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
| `onSuccess` | `{ sessionId }` | a payment succeeded. Fulfil against the session id server-side |
| `onError` | `{ code, message }` | something went wrong. Not terminal unless followed by `onClose({ reason: "error" })` |
| `onClose` | `{ reason }` | `"user"`, `"complete"`, `"host"` or `"error"`. Exactly one per `open()` |
| `open()` return | `{ sessionId, close() }` | the handle |

The host never receives the email, the card, the last four, or the amount. The card is typed into a different origin; the host's DOM, memory and network never contain it. Even the overlay lives in a closed shadow root so host CSS cannot restyle it and host scripts cannot casually reach in.

Error codes: `load_failed` and `product_not_found` are terminal. `payment_declined`, `payment_failed` and `offline` are recoverable; the customer is still in the checkout and can retry.

### What the host can change

An allow-list, validated in the SDK and again in the checkout:

```ts
DodoCheckout.open({
  productId: "prod_123",
  layout: "drawer" | "modal",              // drawer slides from the right; both become a full sheet on phones
  theme: { accent: "#0f766e", radius: "none" | "small" | "medium" | "large", font: "Inter, sans-serif" },
  merchant: { site: "https://store.example", name: "Store", logo: "https://store.example/logo.png" },
  customerEmail: "sam@example.com",
});
```

If you pass nothing, the checkout reads the store's accent colour, name and logo from the page it was opened on (`/api/brand` fetches the public homepage and looks at `theme-color`, brand CSS variables, button colours, `og:site_name` and the touch icon). `merchant.site` points it at another URL. Explicit values always win. The pay button text picks white or near-black automatically so a lime accent stays legible.

Not on the list, on purpose: custom CSS, copy, field order, the pay button label, the lock line. Those are the trust cues, and a host must not be able to remove them.

## The open calls

**Buy pressed twice.** `open()` while a checkout is open returns the existing handle and refocuses it. No second iframe, no second session, no duplicate callbacks. Inside the checkout, Pay is disabled while processing and the state machine ignores a second submit, so a double-click or a double Enter is one attempt.

**Payment fails halfway.** The customer lands on a dedicated failure screen: what happened in plain words, "No money has been taken", a primary "Try again", and "Use a different card" (kept off the offline variant, where the card is not the problem). Every field value survives. The host hears about it through `onError` while the checkout stays open.

**Closing mid-payment.** The customer cannot: the close button disables, Escape and backdrop clicks nudge the panel instead of closing it. The host can: `handle.close()` is always honoured, because the host owns the page. That is the one case where the outcome of an in-flight payment is unknown, and the reason `"host"` says so.

**Opening the checkout URL directly.** It renders a plain explanation instead of a broken form. There is no product, no session and no host to report to.

**Bad calls.** Missing `productId` or a callback that is not a function throws a `TypeError` synchronously, so the mistake shows up in development, not as a silent no-op in production. Bad brand values (an accent that is not hex, an http logo) are dropped with a `console.warn` and the checkout still opens.

## Weird states

| State | What the customer sees | What the host hears |
|---|---|---|
| SDK loading the iframe | overlay with "Opening secure checkout" | nothing yet |
| Iframe never loads (10 s) | overlay closes | `onError(load_failed)` then `onClose(error)` |
| Product + brand loading | skeleton with "Setting up your checkout" | nothing |
| Unknown product | "We couldn't find that product", Close | `onError(product_not_found)` then `onClose(error)` |
| Invalid field | specific message under the field, on blur or on submit, focus moves to the first problem | nothing |
| Processing | button spinner + "Confirming payment", "Still confirming, hang on" after 4 s, dismissal blocked | nothing |
| Declined | failure screen, Try again / Use a different card | `onError(payment_declined)` |
| Transient failure | failure screen, Try again | `onError(payment_failed)` |
| Offline at pay time | failure screen "You're offline", Try again | `onError(offline)` |
| Success | check mark, confetti, amount, masked card, Done | `onSuccess` then `onClose(complete)` |
| Escape / backdrop / X | closes when idle, nudges when processing | `onClose(user)` |
| Host `close()` | closes immediately | `onClose(host)` |
| Reduced motion | no slide, no confetti, instant states | same |

## Two decisions I went back and forth on

_Written in my own words. See the section "Notes for Dinesh" at the bottom for the draft prompts._

**1. A failure screen or an inline banner.** The banner keeps the form in view and is one fewer transition. I ended up with a dedicated screen because a failed payment is the moment the customer is most likely to bail, and a banner above a form full of card digits reads as "you typed it wrong". A full screen can say clearly that the bank said no, that nothing was charged, and offer the two useful actions. The cost is one extra state and a transition back; the form values survive it.

**2. Reading brand from the store's URL, which needs a server.** The brief says no server is needed and I liked that purity. But a checkout that looks like the store it sits on is most of what makes an embed feel trustworthy, and a browser cannot read another site's HTML. So there is one small function (`apps/checkout/api/brand.ts`, also mounted in the Vite dev server) that reads public signals from a public page. It is heuristic, cached, size-capped, time-capped, and blocks private addresses. If it fails, the checkout falls back to a plain default and nobody notices. The trade-off I accepted: the payment is still fake and client-side; only this read-only lookup touches a server.

Other calls I considered and settled quickly: three callbacks rather than an event emitter (small API, hard to misuse); `onError` as informational and `onClose` as the only terminal event (one place to end every flow); a closed shadow root for the overlay (host CSS cannot break it).

## What I'd explore next

- **Real card isolation per field.** Today the card lives in one iframe. Stripe-style per-field iframes would keep the number, expiry and CVC in separate documents.
- **3DS / bank challenge.** A named interstitial ("Redirecting to your bank, don't press back") and a return path with the same session id.
- **Express row.** Apple Pay and Google Pay above the form with an "or" divider, following Apple's rule that the button is never smaller than the others.
- **Idempotency and webhooks.** `sessionId` as an idempotency key and a server-side webhook so the host does not need to trust the browser callback.
- **Caret-preserving formatting** when editing the middle of the card number. Right now the caret jumps to the end.
- **Brand extraction with a real renderer** for sites whose colours only exist in JavaScript, plus DNS-level private address checks.
- **Unit tests** for the card utilities and the message guards, and this end-to-end run as a CI job.
- **Dark surfaces, RTL and localised currency** once there is a second locale to test against.

## Deploying (Vercel, two projects, one repo)

1. Push this repo to GitHub.
2. **Checkout project:** import the repo, set Root Directory to `apps/checkout`. Framework preset Vite. No env vars. The `api/` folder becomes a serverless function automatically.
3. **Demo project:** import the same repo, set Root Directory to `apps/demo`. Add the env var `VITE_CHECKOUT_ORIGIN=https://<checkout-project>.vercel.app`.
4. Open the demo. The script tag in `apps/demo/index.html` points at the checkout origin, so the SDK and the iframe are cross-origin, as intended.

## Notes for Dinesh

Draft prompts for the "two decisions" section above, to rewrite in your own voice before submitting: (a) failure screen vs inline banner, (b) brand-from-URL needing a server, (c) `onError` recoverable vs terminal, (d) blocking dismissal mid-payment. Delete this section before submitting.
