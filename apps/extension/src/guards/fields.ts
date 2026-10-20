const PAYMENT_AUTOCOMPLETE = /\bcc-(number|csc|exp|exp-month|exp-year|name|type)\b/;
const PAYMENT_NAME = /(card.?number|cardnum|ccnum|cc-?num|cvc|cvv|security.?code|iban|routing.?number|account.?number)/i;
const PAYMENT_FRAME = /(js\.stripe\.com|checkout\.stripe\.com|braintreegateway\.com|adyen\.com|checkout\.com|paypal\.com|squareup\.com|recurly\.com)/i;

/** True when the page has a password or payment field (§5.1). */
export function hasSensitiveField(root: ParentNode): boolean {
  if (root.querySelector('input[type="password" i]')) return true;
  for (const input of root.querySelectorAll<HTMLInputElement>("input, select")) {
    const ac = input.getAttribute("autocomplete") ?? "";
    if (PAYMENT_AUTOCOMPLETE.test(ac) || ac.includes("current-password") || ac.includes("new-password")) return true;
    const key = `${input.getAttribute("name") ?? ""} ${input.id} ${input.getAttribute("data-elements-stable-field-name") ?? ""}`;
    if (PAYMENT_NAME.test(key)) return true;
  }
  for (const frame of root.querySelectorAll<HTMLIFrameElement>("iframe[src]")) {
    if (PAYMENT_FRAME.test(frame.getAttribute("src") ?? "")) return true;
  }
  return false;
}
