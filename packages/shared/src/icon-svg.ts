/**
 * A facility's custom icon: an SVG an admin pastes in. It is shown on the customer site, so it is held to a strict allow-list:
 * only plain drawing shapes with plain presentation attributes. Anything that could run code, load something or restyle the page
 * (scripts, links, images, styles, event handlers, gradients, external references) is refused, never "cleaned" silently.
 */

export const ICON_SVG_MAX_CHARS = 8000;

const SVG_NS = 'http://www.w3.org/2000/svg';
const TAGS = new Set(['svg', 'g', 'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon']);
const ATTRS = new Set([
  'xmlns', 'version', 'viewbox', 'preserveaspectratio', 'width', 'height',
  'd', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'points', 'transform',
  'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
  'fill-rule', 'clip-rule', 'opacity', 'fill-opacity', 'stroke-opacity',
]);

export type IconSvgResult = { ok: true; svg: string } | { ok: false; problem: string };

const refuse = (problem: string): IconSvgResult => ({ ok: false, problem });

/** Checks a pasted SVG and returns it tidied (one line, namespace and viewBox present), or says what is wrong with it. */
export function cleanIconSvg(input: string): IconSvgResult {
  let s = input.trim();
  if (!s) return refuse('Paste the SVG code.');
  if (s.length > ICON_SVG_MAX_CHARS) return refuse(`The SVG is too long (${s.length} characters; at most ${ICON_SVG_MAX_CHARS}). Simplify the drawing.`);

  // Harmless wrappers some tools add: an XML declaration, comments, and a title/description (their text is dropped).
  s = s.replace(/^<\?xml[^>]*\?>\s*/i, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<(title|desc)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  if (/<!doctype|<!entity|<!\[cdata\[/i.test(s)) return refuse('The SVG can only contain drawing shapes.');
  if (!/^<svg[\s>]/i.test(s)) return refuse('It must start with <svg ...> and end with </svg>.');

  const tags = s.match(/<[^>]*>/g) ?? [];

  const stack: string[] = [];
  let rootClosed = false;
  let root = '';
  for (const [i, tag] of tags.entries()) {
    const m = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)([\s\S]*?)(\/?)>$/.exec(tag);
    if (!m) return refuse('The SVG is not well formed.');
    const [, closing, rawName, rest, selfClose] = m;
    const name = rawName!.toLowerCase();
    if (!TAGS.has(name)) return refuse(`"<${rawName}>" is not supported. Use plain shapes: path, circle, rect, ellipse, line, polyline, polygon, g.`);
    if (rootClosed) return refuse('Only one <svg> is allowed.');
    if (closing) {
      if (rest!.trim() !== '' || stack.pop() !== name) return refuse('The SVG tags are not closed properly.');
      if (stack.length === 0) rootClosed = true;
      continue;
    }
    if (i === 0 && name !== 'svg') return refuse('It must start with <svg ...>.');
    if (i > 0 && name === 'svg') return refuse('A nested <svg> is not supported.');

    const attrRe = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let leftover = rest!;
    for (const a of rest!.matchAll(attrRe)) {
      leftover = leftover.replace(a[0], '');
      const attr = a[1]!.toLowerCase();
      const value = a[2] ?? a[3] ?? '';
      if (!ATTRS.has(attr)) return refuse(`The attribute "${a[1]}" is not supported (no styles, links, classes or event handlers).`);
      if (/url\s*\(|javascript:|data:|expression|[<&]/i.test(value)) return refuse(`The value of "${a[1]}" is not allowed (no gradients, links or entities).`);
      if (attr === 'xmlns' && value !== SVG_NS) return refuse(`xmlns must be ${SVG_NS}.`);
    }
    if (leftover.replace(/\s+/g, '') !== '') return refuse('An attribute is not written as name="value".');

    if (name === 'svg') root = tag;
    if (!selfClose) stack.push(name);
    else if (stack.length === 0) rootClosed = true;
  }
  if (s.replace(/<[^>]*>/g, '').trim() !== '') return refuse('The SVG can only contain drawing shapes, no text.');
  if (stack.length > 0 || !rootClosed) return refuse('The SVG is not closed. It must end with </svg>.');

  // The root must say how big the drawing is, so it scales: a viewBox, or a numeric width and height to make one from.
  let out = s.replace(/>\s+</g, '><');
  let head = root.replace(/\s+/g, ' ');
  const view = /\sviewbox\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(head);
  if (view) {
    const nums = (view[1] ?? view[2] ?? '').trim().split(/[\s,]+/).map(Number);
    if (nums.length !== 4 || nums.some((n) => !Number.isFinite(n)) || nums[2]! <= 0 || nums[3]! <= 0) return refuse('The viewBox must be four numbers: min-x min-y width height.');
  } else {
    const w = /\swidth\s*=\s*["']?([\d.]+)(?:px)?["']?/i.exec(head)?.[1];
    const h = /\sheight\s*=\s*["']?([\d.]+)(?:px)?["']?/i.exec(head)?.[1];
    if (!w || !h || !(Number(w) > 0) || !(Number(h) > 0)) return refuse('The <svg> needs a viewBox (for example viewBox="0 0 24 24").');
    head = head.replace(/^<svg/i, `<svg viewBox="0 0 ${Number(w)} ${Number(h)}"`);
  }
  if (!/\sxmlns\s*=/i.test(head)) head = head.replace(/^<svg/i, `<svg xmlns="${SVG_NS}"`);
  out = out.replace(root, () => head); // a function, so a "$" in an attribute is never read as a replacement pattern
  return { ok: true, svg: out };
}
