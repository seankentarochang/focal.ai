const PAYMENT_AUTOCOMPLETE = /\bcc-(number|csc|exp|exp-month|exp-year|name|type)\b/;
const PAYMENT_NAME = /(card.?(number|num|no\b)|(credit|debit).?card|ccnum|cc-?num|cvv|cvc|csc\b|expir(y|ation)|security.?code|iban|routing.?number|account.?number)/i;
const PAYMENT_FRAME = /(js\.stripe\.com|checkout\.stripe\.com|braintreegateway\.com|adyen\.com|checkout\.com|paypal\.com|squareup\.com|recurly\.com|worldpay\.com|authorize\.net)/i;

/** False for fields the user can't see, like a closed sign-in dialog. */
function rendered(el: HTMLElement): boolean {
  if (typeof el.checkVisibility === "function") return el.checkVisibility({ visibilityProperty: true });
  const view = el.ownerDocument.defaultView;
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.hasAttribute("hidden")) return false;
    const style = view?.getComputedStyle(n);
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  }
  return true;
}

/** True when the page shows a password field or has a payment field (§5.1). */
export function hasSensitiveField(root: ParentNode): boolean {
  for (const input of root.querySelectorAll<HTMLInputElement>('input[type="password" i]')) {
    if (rendered(input)) return true;
  }
  for (const input of root.querySelectorAll<HTMLInputElement>("input, select")) {
    const ac = input.getAttribute("autocomplete") ?? "";
    if (PAYMENT_AUTOCOMPLETE.test(ac)) return true;
    if ((ac.includes("current-password") || ac.includes("new-password")) && rendered(input)) return true;
    const key = `${input.getAttribute("name") ?? ""} ${input.id} ${input.getAttribute("data-elements-stable-field-name") ?? ""} ${input.placeholder ?? ""} ${input.getAttribute("aria-label") ?? ""}`;
    if (PAYMENT_NAME.test(key)) return true;
  }
  for (const frame of root.querySelectorAll<HTMLIFrameElement>("iframe[src]")) {
    if (PAYMENT_FRAME.test(frame.getAttribute("src") ?? "")) return true;
  }
  return false;
}
