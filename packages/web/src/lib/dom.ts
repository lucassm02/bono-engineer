/** Tiny DOM writers for rAF renderers: they skip the write when the value did not change. */

export function setText(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export function setAttr(el: Element | null | undefined, name: string, value: string): void {
  if (el && el.getAttribute(name) !== value) el.setAttribute(name, value);
}

export function setStyle(
  el: HTMLElement | SVGElement | null | undefined,
  prop: string,
  value: string,
): void {
  if (el && el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}
