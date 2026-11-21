export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document): T => {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`요소 없음: ${sel}`);
  return el;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> & { text?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'text') e.textContent = String(v);
    else e.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) e.append(c);
  return e;
}

/** 값이 바뀔 때만 글자를 쓴다(매 프레임 다시 쓰면 선택·읽기 도구가 방해받는다) */
export function setText(e: Element, text: string): void {
  if (e.textContent !== text) e.textContent = text;
}
export function setAttr(e: Element, name: string, value: string | null): void {
  if (value === null) {
    if (e.hasAttribute(name)) e.removeAttribute(name);
  } else if (e.getAttribute(name) !== value) e.setAttribute(name, value);
}

export const won = (n: number): string => `${n.toLocaleString('ko-KR')}원`;
export const hms = (ms: number): string => new Date(ms + 9 * 3600_000).toISOString().slice(11, 19);
