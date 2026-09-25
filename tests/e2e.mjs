/**
 * End-to-end suite. Drives the installed Google Chrome headlessly against the
 * two dev servers and exercises every condition in the README's states table.
 *
 *   pnpm dev            (in one terminal)
 *   pnpm test:e2e       (in another)
 *
 * Screenshots land in tests/shots (ignored by git). The last check uses up
 * this machine's brand-lookup allowance for a minute, so run it once, not in a loop.
 */
import { chromium } from "playwright";
import http from "node:http";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DEMO = "http://localhost:5173/";
const CHECKOUT = "http://localhost:5174";
const SHOTS = fileURLToPath(new URL("./shots", import.meta.url));
mkdirSync(SHOTS, { recursive: true });
const results = [];
const consoleErrors = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond, extra }); if (!cond) console.log("FAIL", name, extra); };

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await context.newPage();
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

const overlayPresent = () => page.evaluate(() => !!document.querySelector("[data-dodo-checkout]"));
async function waitOverlay(present, timeout = 8000) {
  await page.waitForFunction((p) => !!document.querySelector("[data-dodo-checkout]") === p, present, { timeout });
}
async function checkoutFrame() {
  for (let i = 0; i < 100; i++) {
    const f = page.frames().find((fr) => fr.url().startsWith(CHECKOUT));
    if (f) return f;
    await page.waitForTimeout(50);
  }
  throw new Error("checkout frame not found");
}
const logTexts = () => page.locator("#log .log-item").allTextContents();
const lastLog = async () => (await logTexts())[0] ?? "";
async function fillCard(frame, number, email = "sam@example.com") {
  await frame.getByLabel("Email").fill(email);
  await frame.getByLabel("Card number").fill(number);
  await frame.getByLabel("Expiry").fill("1230");
  await frame.getByLabel("CVC").fill("123");
}

await page.goto(DEMO);
await page.waitForLoadState("networkidle");
ok("sdk global present", await page.evaluate(() => typeof window.DodoCheckout?.open === "function"));
await page.screenshot({ path: `${SHOTS}/00-demo.png` });

// 1. happy path, drawer
await page.click("#buy");
await waitOverlay(true);
let frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/01-drawer-form.png` });
ok("brand name from site", (await frame.locator(".hdr-name").textContent())?.includes("Lakshmi"));
const accent = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
ok("accent auto-read from site", accent === "#1d4ed8", accent);

// perks and quantity
ok("one perk unlocked at qty 1", (await frame.locator(".perk.is-unlocked").count()) === 1);
await frame.getByRole("button", { name: "Increase quantity" }).click();
await frame.getByRole("button", { name: "Increase quantity" }).click();
ok("two perks at qty 3 and total updates", (await frame.locator(".perk.is-unlocked").count()) === 2 && (await frame.locator(".pay").textContent()) === "Pay ₹1,047");
ok("away line names the next perk", (await frame.locator(".perks-line").textContent())?.includes("₹452 away from a free tote bag"));
await frame.getByRole("button", { name: "Decrease quantity" }).click();
await frame.getByRole("button", { name: "Decrease quantity" }).click();
ok("back to qty 1", (await frame.locator(".pay").textContent()) === "Pay ₹349" && (await frame.getByRole("button", { name: "Decrease quantity" }).isDisabled()));

// validation: submit empty
await frame.getByRole("button", { name: /^Pay/ }).click();
await page.waitForTimeout(200);
ok("empty submit shows errors", (await frame.locator(".field.has-error").count()) >= 3);
ok("focus moved to first invalid", await frame.evaluate(() => document.activeElement?.id === "email"));
await page.screenshot({ path: `${SHOTS}/02-validation.png` });

await fillCard(frame, "4242424242424242");
ok("visa icon detected", (await frame.locator('svg[aria-label="Visa"]').count()) === 1);
await page.screenshot({ path: `${SHOTS}/03-filled.png` });
await frame.getByRole("button", { name: /^Pay ₹349$/ }).click();
await frame.locator(".pay.is-busy").waitFor();
ok("processing copy", (await frame.locator(".pay").textContent())?.includes("Confirming payment"));
// try to dismiss mid-payment: Escape in the frame and backdrop click on host
await frame.press("body", "Escape");
await page.mouse.click(200, 400);
await page.waitForTimeout(150);
ok("cannot dismiss while processing", await overlayPresent());
await page.screenshot({ path: `${SHOTS}/04-processing.png` });
await frame.getByText("Payment complete").waitFor({ timeout: 6000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/05-success.png` });
ok("onSuccess logged", (await logTexts()).some((t) => t.includes("onSuccess")));
ok("success payload is only sessionId", (await logTexts()).some((t) => /onSuccess.*\{"sessionId":"cs_[a-z0-9]+"\}$/.test(t)));
await frame.getByRole("button", { name: "Done" }).click();
await waitOverlay(false);
ok("onClose complete", (await lastLog()).includes('"reason":"complete"'));
ok("body scroll restored", await page.evaluate(() => document.body.style.overflow === ""));
ok("focus restored to Buy", await page.evaluate(() => document.activeElement?.id === "buy"));

// 2. declined then different card
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
await fillCard(frame, "4000000000000002");
await frame.getByRole("button", { name: /^Pay/ }).click();
await frame.getByText("Your card was declined").waitFor({ timeout: 6000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/06-declined.png` });
ok("onError payment_declined logged", (await lastLog()).includes("payment_declined"));
ok("checkout stays open after decline", await overlayPresent());
await frame.getByRole("button", { name: "Use a different card" }).click();
await frame.getByLabel("Card number").waitFor();
ok("card cleared, email kept", (await frame.getByLabel("Card number").inputValue()) === "" && (await frame.getByLabel("Email").inputValue()) === "sam@example.com");
ok("focus on card number", await frame.evaluate(() => document.activeElement?.id === "number"));
await frame.getByLabel("Card number").fill("4242424242424242");
await frame.getByLabel("Expiry").fill("1230");
await frame.getByLabel("CVC").fill("123");
await frame.getByRole("button", { name: /^Pay/ }).click();
await frame.getByText("Payment complete").waitFor({ timeout: 6000 });
await frame.press("body", "Escape");
await waitOverlay(false);
ok("escape after success closes with complete", (await lastLog()).includes('"reason":"complete"'));

// 3. fails once (slowly) then succeeds on retry
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
await fillCard(frame, "4000000000000341");
await frame.getByRole("button", { name: /^Pay/ }).click();
await frame.getByText("Still confirming, hang on").waitFor({ timeout: 6000 });
ok("slow copy after 4s", true);
await frame.getByText("Something went wrong on our side").waitFor({ timeout: 6000 });
await page.screenshot({ path: `${SHOTS}/07-failed-retry.png` });
ok("onError payment_failed logged", (await lastLog()).includes("payment_failed"));
await frame.getByRole("button", { name: "Try again" }).click();
await frame.getByText("Payment complete").waitFor({ timeout: 6000 });
ok("retry succeeds", true);
await frame.getByRole("button", { name: "Done" }).click();
await waitOverlay(false);

// 3b. connection drops after the charge was sent: wait, then confirm when it returns
await page.click("#clear");
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
await fillCard(frame, "4242424242424242");
await frame.getByRole("button", { name: /^Pay/ }).click();
await frame.locator(".pay.is-busy").waitFor();
await context.setOffline(true);
await frame.getByText("Connection lost, waiting for it").waitFor({ timeout: 4000 });
ok("offline mid-payment waits instead of guessing", true);
await page.waitForTimeout(2500);
ok("still waiting, no verdict while offline", !(await logTexts()).some((t) => t.includes("onSuccess")));
await context.setOffline(false);
await frame.getByText("Payment complete").waitFor({ timeout: 8000 });
ok("outcome delivered once the connection returns", (await logTexts()).some((t) => t.includes("onSuccess")));
await frame.getByRole("button", { name: "Done" }).click();
await waitOverlay(false);

// 3c. offline before paying: nothing is sent
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
await fillCard(frame, "4242424242424242");
await context.setOffline(true);
await frame.getByText("You're offline. Pay when you're back online").waitFor({ timeout: 4000 });
await frame.getByRole("button", { name: /^Pay/ }).click({ force: true });
await page.waitForTimeout(400);
ok("pay is held while offline", (await frame.locator(".pay.is-busy").count()) === 0 && (await frame.getByLabel("Card number").inputValue()) !== "");
await context.setOffline(false);
await page.waitForTimeout(300);
ok("notice clears when back online", (await frame.locator(".notice").count()) === 0);
await page.keyboard.press("Escape");
await waitOverlay(false);

// 3d. bank challenge: decline, then approve
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
await fillCard(frame, "4000000000003220");
await frame.getByRole("button", { name: /^Pay/ }).click();
await frame.getByText("Your bank wants to confirm it's you").waitFor({ timeout: 6000 });
await page.screenshot({ path: `${SHOTS}/14-challenge.png` });
await frame.getByRole("button", { name: "Decline" }).click();
await frame.getByText("Your bank didn't confirm the payment").waitFor({ timeout: 6000 });
ok("declined challenge -> authentication_failed", (await lastLog()).includes("authentication_failed"));
await frame.getByRole("button", { name: "Try again with this card" }).click();
await frame.getByText("Your bank wants to confirm it's you").waitFor({ timeout: 6000 });
await frame.getByRole("button", { name: "Approve" }).click();
await frame.getByText("Payment complete").waitFor({ timeout: 8000 });
ok("approved challenge -> success", true);
await frame.getByRole("button", { name: "Done" }).click();
await waitOverlay(false);

// 3e. three declines -> only "use a different card"
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
await fillCard(frame, "4000000000000002");
await frame.getByRole("button", { name: /^Pay/ }).click();
await frame.getByText("Your card was declined").waitFor({ timeout: 6000 });
await frame.getByRole("button", { name: "Try again with this card" }).click();
await frame.getByText("Your card was declined").waitFor({ timeout: 6000 });
await frame.getByRole("button", { name: "Try again with this card" }).click();
await frame.getByText("This card keeps getting declined").waitFor({ timeout: 6000 });
ok("decline limit reached: no retry offered", (await frame.getByRole("button", { name: "Try again with this card" }).count()) === 0);
await page.screenshot({ path: `${SHOTS}/15-decline-limit.png` });
await page.keyboard.press("Escape");
await waitOverlay(false);

// 3f. stock cap
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Email").waitFor({ timeout: 10000 });
for (let i = 0; i < 9; i++) await frame.getByRole("button", { name: "Increase quantity" }).click({ force: true }).catch(() => {});
ok("stepper stops at stock with a note", (await frame.locator(".stepper-value").textContent()) === "8" && (await frame.locator(".stepper-note").textContent())?.includes("Only 8 left") === true && (await frame.getByRole("button", { name: "Increase quantity" }).isDisabled()));
await page.keyboard.press("Escape");
await waitOverlay(false);

// 4. double open
await page.click('[data-edge="double"]');
await waitOverlay(true);
await page.waitForTimeout(300);
const logs4 = await logTexts();
ok("double open reuses session", logs4.some((t) => t.includes("same session returned")));
ok("only one overlay", (await page.evaluate(() => document.querySelectorAll("[data-dodo-checkout]").length)) === 1);
await page.keyboard.press("Escape");
await waitOverlay(false);
ok("escape closes with reason user", (await lastLog()).includes('"reason":"user"'));

// 4b. a real double-click on Buy: opens once, stays open
await page.dblclick("#buy");
await waitOverlay(true);
await page.waitForTimeout(900);
ok("double-click keeps the checkout open", await overlayPresent());
ok("double-click made exactly one session and no close", (await logTexts()).slice(0, 2).filter((t) => t.includes("open()")).length === 1 && !(await lastLog()).includes("onClose"));
await page.waitForTimeout(400);
await page.mouse.click(200, 400); // a deliberate backdrop click after the entrance still closes
await waitOverlay(false);
ok("deliberate backdrop click closes", (await lastLog()).includes('"reason":"user"'));

// 5. unknown product
await page.click('[data-edge="unknown"]');
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByText("We couldn't find that product").waitFor({ timeout: 10000 });
await page.screenshot({ path: `${SHOTS}/08-not-found.png` });
ok("onError product_not_found", (await logTexts()).some((t) => t.includes("product_not_found")));
await frame.getByRole("button", { name: "Close", exact: true }).click();
await waitOverlay(false);
ok("close reason error", (await lastLog()).includes('"reason":"error"'));

// 6. host closes after 3s
await page.click('[data-edge="hostclose"]');
await waitOverlay(true);
await waitOverlay(false, 8000);
ok("host close reason host", (await lastLog()).includes('"reason":"host"'));

// 6b. close then reopen in the same tick
await page.evaluate(() => {
  const h = window.DodoCheckout.open({ productId: "prod_123", onClose: ({ reason }) => (window.__r1 = reason) });
  h.close();
  window.__h2 = window.DodoCheckout.open({ productId: "prod_123", onClose: ({ reason }) => (window.__r2 = reason) });
});
await page.waitForTimeout(500);
ok("second session is a new one", await page.evaluate(() => document.querySelectorAll("[data-dodo-checkout]").length === 1 && window.__r1 === "host" && window.__h2 && window.__h2.sessionId));
ok("scroll still locked for session 2", await page.evaluate(() => document.body.style.overflow === "hidden"));
await page.evaluate(() => window.__h2.close());
await page.waitForFunction(() => window.__r2 === "host");
ok("scroll unlocked after session 2", await page.evaluate(() => document.body.style.overflow === ""));

// 6c. backspace over a separator removes the digit before it
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Card number").waitFor({ timeout: 10000 });
await frame.getByLabel("Card number").fill("42424242");
await frame.getByLabel("Card number").evaluate((el) => el.setSelectionRange(5, 5));
await frame.getByLabel("Card number").press("Backspace");
ok("backspace over space removes digit 4", (await frame.getByLabel("Card number").inputValue()) === "4244 242", await frame.getByLabel("Card number").inputValue());
await page.keyboard.press("Escape");
await waitOverlay(false);

// 7. bad call throws synchronously
await page.click('[data-edge="badcall"]');
ok("bad call throws TypeError", (await lastLog()).includes("TypeError"));
ok("no overlay after bad call", !(await overlayPresent()));

// 8. modal layout with explicit accent + prefilled email + quantity from the host
await page.click('[data-layout="modal"]');
await page.click('[data-qty="1"]');
await page.click('[data-accent="#c2410c"]');
await page.check("#prefill");
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Card number").waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${SHOTS}/09-modal.png` });
ok("email prefilled as a row and focus on card", (await frame.locator(".email-row-value").textContent()) === "sam@example.com" && (await frame.evaluate(() => document.activeElement?.id)) === "number");
await frame.getByRole("button", { name: "Change" }).click();
await frame.getByLabel("Email").waitFor();
ok("change reveals the email field with the value", (await frame.getByLabel("Email").inputValue()) === "sam@example.com" && (await frame.evaluate(() => document.activeElement?.id)) === "email");
const accent2 = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
ok("explicit accent wins", accent2 === "#c2410c", accent2);
ok("host quantity honoured", (await frame.locator(".stepper-value").textContent()) === "2" && (await frame.locator(".pay").textContent()) === "Pay ₹698");
await page.keyboard.press("Escape");
await waitOverlay(false);
await page.click('[data-qty="-1"]');

// 9. lime accent -> dark ink on the button
await page.click('[data-accent="#c6fe1e"]');
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Card number").waitFor({ timeout: 10000 });
const ink = await frame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent-ink").trim());
ok("light accent gets dark text", ink === "#0b0f14", ink);
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/10-modal-lime.png` });
await page.keyboard.press("Escape");
await waitOverlay(false);

// 10. mobile drawer
const mobile = await context.newPage();
await mobile.setViewportSize({ width: 390, height: 844 });
mobile.on("console", (m) => { if (m.type() === "error") consoleErrors.push("mobile: " + m.text()); });
await mobile.goto(DEMO);
await mobile.click("#buy");
await mobile.waitForFunction(() => !!document.querySelector("[data-dodo-checkout]"));
let mframe;
for (let i = 0; i < 100 && !mframe; i++) { mframe = mobile.frames().find((f) => f.url().startsWith(CHECKOUT)); if (!mframe) await mobile.waitForTimeout(50); }
await mframe.getByLabel("Email").waitFor({ timeout: 10000 });
await mobile.waitForTimeout(400);
await mobile.screenshot({ path: `${SHOTS}/11-mobile-drawer.png` });
const inputFont = await mframe.evaluate(() => getComputedStyle(document.getElementById("number")).fontSize);
ok("input font 16px on mobile", inputFont === "16px", inputFont);
await mobile.close();

// 10b. host with an opaque origin gets load_failed instead of a stuck overlay
const opaque = await context.newPage();
await opaque.setContent(`<script src="${CHECKOUT}/sdk/dodo-checkout.js"></script><button id=b>buy</button>`);
await opaque.waitForFunction(() => typeof window.DodoCheckout?.open === "function");
const opaqueResult = await opaque.evaluate(() => new Promise((resolve) => {
  const events = [];
  window.DodoCheckout.open({
    productId: "prod_123",
    onError: (e) => events.push("error:" + e.code),
    onClose: (e) => { events.push("close:" + e.reason); resolve(events); },
  });
  setTimeout(() => resolve(events.concat("timeout")), 12000);
}));
ok("opaque origin -> load_failed then close(error)", JSON.stringify(opaqueResult) === JSON.stringify(["error:load_failed", "close:error"]), JSON.stringify(opaqueResult));
ok("opaque origin overlay removed", await opaque.evaluate(() => !document.querySelector("[data-dodo-checkout]")));
await opaque.close();

// 10c. the minimal plain-HTML embed: one script tag, one call
const mini = await context.newPage();
mini.on("console", (m) => { if (m.type() === "error") consoleErrors.push("minimal: " + m.text()); });
await mini.goto(DEMO + "minimal.html");
ok("minimal page loads the SDK from the checkout origin", await mini.evaluate(() => typeof window.DodoCheckout?.open === "function" && !!document.querySelector('script[src^="http://localhost:5174/sdk/"]')));
await mini.click("#buy");
await mini.waitForFunction(() => !!document.querySelector("[data-dodo-checkout]"));
let miniFrame;
for (let i = 0; i < 100 && !miniFrame; i++) { miniFrame = mini.frames().find((f) => f.url().startsWith(CHECKOUT)); if (!miniFrame) await mini.waitForTimeout(50); }
await miniFrame.getByLabel("Email").waitFor({ timeout: 10000 });
await miniFrame.getByLabel("Email").fill("sam@example.com");
await miniFrame.getByLabel("Card number").fill("4242424242424242");
await miniFrame.getByLabel("Expiry").fill("1230");
await miniFrame.getByLabel("CVC").fill("123");
await miniFrame.getByRole("button", { name: /^Pay/ }).click();
await miniFrame.getByText("Payment complete").waitFor({ timeout: 8000 });
await miniFrame.getByRole("button", { name: "Done" }).click();
await mini.waitForFunction(() => !document.querySelector("[data-dodo-checkout]"));
const miniLog = await mini.locator("#log").textContent();
ok("minimal page logged success then close", /onSuccess\s+sessionId=cs_[a-z0-9]+[\s\S]*onClose\s+reason=complete/.test(miniLog ?? ""), (miniLog ?? "").slice(-80));
await mini.screenshot({ path: `${SHOTS}/13-minimal.png` });
await mini.close();

// 10d. declarative embed: attributes on the tag, a data-dodo-product button, events back
const decl = await context.newPage();
decl.on("console", (m) => { if (m.type() === "error") consoleErrors.push("declarative: " + m.text()); });
await decl.goto(DEMO + "declarative.html");
ok("script tag defaults are read", await decl.evaluate(() => window.DodoCheckout?.defaults?.layout === "modal" && window.DodoCheckout.defaults.theme?.accent === "#1d4ed8"));
await decl.click("[data-dodo-product]");
await decl.waitForFunction(() => !!document.querySelector("[data-dodo-checkout]"));
let declFrame;
for (let i = 0; i < 100 && !declFrame; i++) { declFrame = decl.frames().find((f) => f.url().startsWith(CHECKOUT)); if (!declFrame) await decl.waitForTimeout(50); }
await declFrame.getByLabel("Email").waitFor({ timeout: 10000 });
ok("declarative open used tag defaults and element quantity", (await declFrame.locator(".stepper-value").textContent()) === "2" && (await declFrame.locator(".hdr-name").textContent()) === "Lakshmi Stores" && (await declFrame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim())) === "#1d4ed8");
await declFrame.getByLabel("Email").fill("sam@example.com");
await declFrame.getByLabel("Card number").fill("4242424242424242");
await declFrame.getByLabel("Expiry").fill("1230");
await declFrame.getByLabel("CVC").fill("123");
await declFrame.getByRole("button", { name: /^Pay ₹698$/ }).click();
await declFrame.getByText("Payment complete").waitFor({ timeout: 8000 });
await declFrame.getByRole("button", { name: "Done" }).click();
await decl.waitForFunction(() => !document.querySelector("[data-dodo-checkout]"));
const declLog = await decl.locator("#log").textContent();
ok("declarative events delivered", /dodo:success\s+\{"sessionId":"cs_[a-z0-9]+"\}[\s\S]*dodo:close\s+\{"reason":"complete"\}/.test(declLog ?? ""), (declLog ?? "").slice(-90));
await decl.close();

// 12. hostile URLs sent to the brand reader
const api = (u) => fetch(`${CHECKOUT}/api/brand?url=${encodeURIComponent(u)}`).then(async (r) => ({ status: r.status, body: await r.json() }));
ok("brand: private IPv4 target refused", (await api("http://10.0.0.1/")).status === 400);
ok("brand: IPv6-mapped loopback refused", (await api("http://[::ffff:127.0.0.1]/")).status === 400);
ok("brand: hostname that resolves to a private address refused", (await api("http://10.0.0.1.nip.io/")).body.code === "blocked_host");
const hop = http.createServer((req, res) => { res.writeHead(302, { Location: "http://10.0.0.1/" }); res.end(); });
await new Promise((r) => hop.listen(0, "127.0.0.1", r));
ok("brand: redirect that hops to a private address refused", (await api(`http://127.0.0.1:${hop.address().port}/`)).body.code === "blocked_host");
hop.close();
const big = http.createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.write("<html><head><meta name=theme-color content=#123456><style>"); res.write("--a".repeat(400000)); res.end("</style></head></html>"); });
await new Promise((r) => big.listen(0, "127.0.0.1", r));
const t0 = Date.now();
const bigResult = await api(`http://127.0.0.1:${big.address().port}/`);
ok("brand: pathological CSS handled quickly", bigResult.status === 200 && Date.now() - t0 < 4000, `${Date.now() - t0}ms`);
big.close();

// 13. a page talks to the iframe without the SDK
const rogue = await context.newPage();
await rogue.goto(DEMO + "minimal.html");
const rogueEvents = await rogue.evaluate(async (CHECKOUT) => {
  const iframe = document.createElement("iframe");
  iframe.src = CHECKOUT + "/";
  document.body.appendChild(iframe);
  const events = [];
  const sessionId = "cs_" + "a".repeat(24);
  return await new Promise((resolve) => {
    window.addEventListener("message", (e) => {
      if (e.source !== iframe.contentWindow || !e.data || e.data.protocol !== "dodo-checkout/1") return;
      events.push(e.data.type);
      if (e.data.type === "ready") {
        iframe.contentWindow.postMessage({ protocol: "dodo-checkout/1", type: "init", sessionId, productId: "prod_123", layout: "drawer",
          theme: { accent: 'url("https://evil.example/fake-pay.png")', font: "x; background: red" },
          merchant: { name: "<img src=x onerror=alert(1)>" + "x".repeat(60), logo: "javascript:alert(1)" } }, "*");
      }
      if (e.data.type === "init_ok") {
        iframe.contentWindow.postMessage({ protocol: "dodo-checkout/1", type: "close_request", sessionId: "cs_wrong" }, "*");
        setTimeout(() => resolve(events), 2500);
      }
    });
  });
}, CHECKOUT);
ok("rogue page: init accepted, close with a wrong session ignored", rogueEvents.includes("init_ok") && !rogueEvents.includes("close"));
let rogueFrame;
for (let i = 0; i < 100 && !rogueFrame; i++) { rogueFrame = rogue.frames().find((f) => f.url().startsWith(CHECKOUT)); if (!rogueFrame) await rogue.waitForTimeout(50); }
await rogueFrame.getByLabel("Email").waitFor({ timeout: 10000 });
const rogueAccent = await rogueFrame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--accent").trim());
const rogueName = await rogueFrame.locator(".hdr-name").textContent();
ok("rogue page: injected accent, font and name rejected", /^#[0-9a-f]{6}$/.test(rogueAccent) && !rogueName.includes("<img") && !(await rogueFrame.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font"))).includes("red"), `${rogueAccent} / ${rogueName}`);
await rogue.close();

// 14. host CSS and scripts cannot reach the overlay
await page.addStyleTag({ content: "[data-dodo-checkout], [data-dodo-checkout] *, .panel, .backdrop, .frame, iframe { display: none !important; visibility: hidden !important; opacity: 0 !important; }" });
await page.click("#buy");
await waitOverlay(true);
frame = await checkoutFrame();
await frame.getByLabel("Card number").waitFor({ timeout: 10000 });
ok("host CSS cannot hide or restyle the checkout", await frame.getByLabel("Card number").isVisible());
ok("host scripts cannot reach inside: shadow root is closed", await page.evaluate(() => document.querySelector("[data-dodo-checkout]").shadowRoot === null));
await page.keyboard.press("Escape");
await waitOverlay(false);

// 15. reduced motion
const calm = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce" });
const calmPage = await calm.newPage();
await calmPage.goto(DEMO);
await calmPage.click("#buy");
await calmPage.waitForFunction(() => !!document.querySelector("[data-dodo-checkout]"));
let calmFrame;
for (let i = 0; i < 100 && !calmFrame; i++) { calmFrame = calmPage.frames().find((f) => f.url().startsWith(CHECKOUT)); if (!calmFrame) await calmPage.waitForTimeout(50); }
await calmFrame.getByLabel("Email").waitFor({ timeout: 10000 });
await calmPage.waitForTimeout(900);
ok("reduced motion: no screen animation, no confetti on open", (await calmFrame.evaluate(() => getComputedStyle(document.querySelector(".screen")).animationName)) === "none" && (await calmFrame.locator("canvas").count()) === 0);
await calmFrame.getByLabel("Email").fill("sam@example.com");
await calmFrame.getByLabel("Card number").fill("4242424242424242");
await calmFrame.getByLabel("Expiry").fill("1230");
await calmFrame.getByLabel("CVC").fill("123");
await calmFrame.getByRole("button", { name: /^Pay/ }).click();
await calmFrame.getByText("Payment complete").waitFor({ timeout: 8000 });
await calmPage.waitForTimeout(300);
ok("reduced motion: no confetti on success", (await calmFrame.locator("canvas").count()) === 0);
await calm.close();

// 11. standalone visit
const solo = await context.newPage();
await solo.goto(CHECKOUT + "/");
await solo.getByText("This is the Dodo checkout").waitFor({ timeout: 5000 });
await solo.screenshot({ path: `${SHOTS}/12-standalone.png` });
ok("standalone notice", true);
await solo.close();

// 16. rate limit, last because it uses up this caller's minute
let rateStatus = 200;
for (let i = 0; i < 40 && rateStatus !== 429; i++) rateStatus = (await fetch(`${CHECKOUT}/api/brand?url=${encodeURIComponent(DEMO)}`)).status;
ok("brand: rate limited within 40 lookups in a minute", rateStatus === 429);

await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
for (const r of results) console.log((r.pass ? "  ok  " : "  FAIL") + " " + r.name + (r.extra ? "  [" + r.extra + "]" : ""));
console.log("\nconsole errors:", consoleErrors.length ? consoleErrors : "none");
process.exitCode = passed === results.length && consoleErrors.length === 0 ? 0 : 1;
