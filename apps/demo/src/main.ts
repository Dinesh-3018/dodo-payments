import "@fontsource-variable/geist";
import type { OpenOptions, CheckoutHandle, Layout } from "@dodo/sdk";

// ---- what the host is allowed to know: exactly what these callbacks receive ----

const settings = {
  layout: "drawer" as Layout,
  accent: "" as string,
  site: "" as string,
  prefill: false,
  identity: false,
  radius: false,
  productId: "prod_123",
};

let current: CheckoutHandle | null = null;

function buildOptions(productId: string, quantity = quantityOf(productId)): OpenOptions {
  const options: OpenOptions = {
    productId,
    layout: settings.layout,
    ...(quantity > 1 ? { quantity } : {}),
    onSuccess: ({ sessionId }) => log("onSuccess", { sessionId }),
    onClose: ({ reason }) => {
      log("onClose", { reason });
      current = null;
    },
    onError: ({ code, message }) => log("onError", { code, message }),
  };
  const theme: NonNullable<OpenOptions["theme"]> = {};
  if (settings.accent) theme.accent = settings.accent;
  if (settings.radius) theme.radius = "large";
  if (Object.keys(theme).length) options.theme = theme;

  const merchant: NonNullable<OpenOptions["merchant"]> = {};
  if (settings.site) merchant.site = settings.site;
  if (settings.identity) {
    merchant.name = "Lakshmi Stores";
    merchant.logo = `${location.origin}/logo.svg`;
  }
  if (Object.keys(merchant).length) options.merchant = merchant;

  if (settings.prefill) options.customerEmail = "sam@example.com";
  return options;
}

function openCheckout(productId = "prod_123"): CheckoutHandle | null {
  if (!window.DodoCheckout) {
    log("sdk", { error: "DodoCheckout script did not load. Is the checkout app running?" });
    return null;
  }
  try {
    const handle = window.DodoCheckout.open(buildOptions(productId));
    const reused = current !== null && current.sessionId === handle.sessionId;
    current = handle;
    log("open()", { sessionId: handle.sessionId, ...(reused ? { note: "same session returned; nothing new opened" } : {}) });
    return handle;
  } catch (error) {
    log("open() threw", { error: String(error) });
    return null;
  }
}

// ---- wiring --------------------------------------------------------------

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const MAX_QUANTITY = 10; // same ceiling as the checkout's own stepper
const quantities = new Map<string, number>();
const quantityOf = (productId: string) => quantities.get(productId) ?? 1;

document.querySelectorAll<HTMLElement>("[data-product]").forEach((card) => {
  const productId = card.dataset.product ?? "";
  const value = card.querySelector<HTMLElement>(".qty-value")!;
  const minus = card.querySelector<HTMLButtonElement>('[data-qty="-1"]')!;
  const plus = card.querySelector<HTMLButtonElement>('[data-qty="1"]')!;
  const render = () => {
    const q = quantityOf(productId);
    value.textContent = String(q);
    minus.disabled = q <= 1;
    plus.disabled = q >= MAX_QUANTITY;
  };
  [minus, plus].forEach((button) =>
    button.addEventListener("click", () => {
      quantities.set(productId, Math.min(MAX_QUANTITY, Math.max(1, quantityOf(productId) + Number(button.dataset.qty))));
      render();
      if (productId === settings.productId) renderSnippet();
    }),
  );
  card.querySelector<HTMLButtonElement>("[data-buy]")!.addEventListener("click", () => {
    settings.productId = productId;
    renderSnippet();
    openCheckout(productId);
  });
  render();
});

document.querySelectorAll<HTMLButtonElement>("[data-layout]").forEach((button) => {
  button.addEventListener("click", () => {
    settings.layout = button.dataset.layout as Layout;
    document.querySelectorAll<HTMLButtonElement>("[data-layout]").forEach((b) => {
      const active = b === button;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", String(active));
    });
    renderSnippet();
  });
});

document.querySelectorAll<HTMLButtonElement>("[data-accent]").forEach((button) => {
  button.addEventListener("click", () => {
    settings.accent = button.dataset.accent ?? "";
    document.querySelectorAll<HTMLButtonElement>("[data-accent]").forEach((b) => {
      const active = b === button;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", String(active));
    });
    renderSnippet();
  });
});

const siteInput = $<HTMLInputElement>("#site");
const CHECKOUT_ORIGIN = (import.meta.env.VITE_CHECKOUT_ORIGIN as string | undefined) ?? "http://localhost:5174";
let previewTimer = 0;
let previewSeq = 0;

function normaliseSite(raw: string): string {
  const text = raw.trim();
  if (!text) return "";
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`;
}

/** Ask the checkout's brand reader what it sees, so the answer is visible before Buy is pressed. */
async function previewBrand(site: string) {
  const box = $("#brand-preview");
  const seq = ++previewSeq;
  if (!site) {
    box.innerHTML = "";
    return;
  }
  box.innerHTML = `<span class="brand-preview-note">Reading ${escapeHtml(site)}…</span>`;
  try {
    const response = await fetch(`${CHECKOUT_ORIGIN}/api/brand?url=${encodeURIComponent(site)}`, { signal: AbortSignal.timeout(8000) });
    const body = (await response.json()) as { ok: true; brand: { accent?: string; name?: string; logo?: string; palette: string[] } } | { ok: false; message: string };
    if (seq !== previewSeq) return;
    if (!body.ok) {
      box.innerHTML = `<span class="brand-preview-note">Couldn't read it: ${escapeHtml(body.message)}</span>`;
      return;
    }
    const { accent, name, logo, palette } = body.brand;
    box.innerHTML = [
      `<span class="brand-preview-label">Found</span>`,
      logo ? `<img class="brand-preview-logo" src="${escapeHtml(logo)}" alt="" referrerpolicy="no-referrer" />` : "",
      name ? `<span class="brand-preview-name">${escapeHtml(name)}</span>` : `<span class="brand-preview-note">no name</span>`,
      accent ? `<span class="brand-preview-swatch" style="--c:${escapeHtml(accent)}"></span><code>${escapeHtml(accent)}</code>` : `<span class="brand-preview-note">no accent</span>`,
      palette.slice(0, 3).map((c) => `<span class="brand-preview-swatch is-small" style="--c:${escapeHtml(c)}" title="${escapeHtml(c)}"></span>`).join(""),
    ].join("");
  } catch {
    if (seq === previewSeq) box.innerHTML = `<span class="brand-preview-note">Couldn't reach that site.</span>`;
  }
}

siteInput.addEventListener("input", () => {
  settings.site = normaliseSite(siteInput.value);
  // A store URL means "use that store's colours": drop any explicit swatch.
  if (settings.site && settings.accent) {
    settings.accent = "";
    document.querySelectorAll<HTMLButtonElement>("[data-accent]").forEach((b) => {
      const active = b.dataset.accent === "";
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-checked", String(active));
    });
  }
  renderSnippet();
  clearTimeout(previewTimer);
  previewTimer = window.setTimeout(() => void previewBrand(settings.site), 500);
});
$("#site-clear").addEventListener("click", () => {
  siteInput.value = "";
  settings.site = "";
  renderSnippet();
  void previewBrand("");
});

for (const key of ["prefill", "identity", "radius"] as const) {
  const box = $<HTMLInputElement>(`#${key}`);
  box.addEventListener("change", () => {
    settings[key] = box.checked;
    renderSnippet();
  });
}

document.querySelectorAll<HTMLButtonElement>("[data-edge]").forEach((button) => {
  button.addEventListener("click", () => {
    switch (button.dataset.edge) {
      case "double": {
        log("host", { note: "calling open() twice in the same tick" });
        openCheckout();
        openCheckout();
        break;
      }
      case "unknown":
        openCheckout("prod_does_not_exist");
        break;
      case "hostclose": {
        const handle = openCheckout();
        if (!handle) break;
        log("host", { note: "will call handle.close() in 3s" });
        setTimeout(() => handle.close(), 3000);
        break;
      }
      case "badcall": {
        try {
          // @ts-expect-error deliberate misuse: missing productId
          window.DodoCheckout?.open({ onSuccess: "not a function" });
        } catch (error) {
          log("open() threw", { error: String(error) });
        }
        break;
      }
    }
  });
});

$("#clear").addEventListener("click", () => {
  $("#log").innerHTML = "";
});

// ---- rendering -----------------------------------------------------------

function renderSnippet() {
  const options = buildOptions(settings.productId);
  const lines: string[] = [
    `<script src="${CHECKOUT_ORIGIN}/sdk/dodo-checkout.js"></script>`,
    "",
    "DodoCheckout.open({",
    `  productId: "${settings.productId}",`,
  ];
  if (options.quantity) lines.push(`  quantity: ${options.quantity},`);
  if (options.layout) lines.push(`  layout: "${options.layout}",`);
  if (options.theme) lines.push(`  theme: ${JSON.stringify(options.theme)},`);
  if (options.merchant) lines.push(`  merchant: ${JSON.stringify(options.merchant)},`);
  if (options.customerEmail) lines.push(`  customerEmail: "${options.customerEmail}",`);
  lines.push("  onSuccess: ({ sessionId }) => { /* fulfil the order */ },");
  lines.push("  onClose: ({ reason }) => { /* \"user\" | \"complete\" | \"host\" | \"error\" */ },");
  lines.push("  onError: ({ code, message }) => { /* log it */ },");
  lines.push("});");
  $("#snippet").textContent = lines.join("\n");
}

function log(event: string, payload: Record<string, unknown>) {
  const item = document.createElement("li");
  const time = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const kind = event.startsWith("on") ? "callback" : event === "open()" ? "call" : "note";
  item.className = `log-item is-${kind}`;
  item.innerHTML = `<span class="log-event">${escapeHtml(event)}</span><span class="log-time">${time}</span><code class="log-payload">${escapeHtml(JSON.stringify(payload))}</code>`;
  const list = $("#log");
  list.prepend(item);
  while (list.children.length > 60) list.lastElementChild?.remove();
}


function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

renderSnippet();
if (!window.DodoCheckout) {
  log("sdk", { error: "DodoCheckout script did not load. Start the checkout app (pnpm dev) and reload." });
}
