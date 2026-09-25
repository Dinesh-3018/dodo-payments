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
};

let current: CheckoutHandle | null = null;

function buildOptions(productId: string): OpenOptions {
  const options: OpenOptions = {
    productId,
    layout: settings.layout,
    onSuccess: ({ sessionId }) => {
      log("onSuccess", { sessionId });
      setStatus("Paid", "is-paid");
    },
    onClose: ({ reason }) => {
      log("onClose", { reason });
      current = null;
      setStatus("Checkout closed", "");
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
    merchant.name = "Kestrel Supply Co.";
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
    setStatus("Checkout open", "is-open");
    return handle;
  } catch (error) {
    log("open() threw", { error: String(error) });
    return null;
  }
}

// ---- wiring --------------------------------------------------------------

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

$("#buy").addEventListener("click", () => openCheckout());

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
siteInput.addEventListener("input", () => {
  settings.site = siteInput.value.trim();
  renderSnippet();
});
$("#site-clear").addEventListener("click", () => {
  siteInput.value = "";
  settings.site = "";
  renderSnippet();
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
  const options = buildOptions("prod_123");
  const lines: string[] = ["DodoCheckout.open({", `  productId: "prod_123",`];
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

function setStatus(text: string, className: string) {
  const el = $("#status");
  el.textContent = text;
  el.className = `status ${className}`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c);
}

renderSnippet();
if (!window.DodoCheckout) {
  log("sdk", { error: "DodoCheckout script did not load. Start the checkout app (pnpm dev) and reload." });
}
