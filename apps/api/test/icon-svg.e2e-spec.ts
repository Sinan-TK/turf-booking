import { cleanIconSvg } from '@venue/shared';

/** The custom facility icon checker. Pure: touches no database. */
describe('cleanIconSvg', () => {
  const ok = (svg: string) => {
    const r = cleanIconSvg(svg);
    if (!r.ok) throw new Error(`expected ok, got: ${r.problem}`);
    return r.svg;
  };
  const refused = (svg: string) => {
    const r = cleanIconSvg(svg);
    expect(r.ok).toBe(false);
    return r.ok ? '' : r.problem;
  };

  it('accepts a plain icon and tidies it: one line, namespace added', () => {
    const out = ok(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2 L22 22 L2 22 Z" stroke-linejoin="round"/>
      <circle cx="12" cy="14" r="3"></circle>
    </svg>`);
    expect(out).toBe(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2 L22 22 L2 22 Z" stroke-linejoin="round"/><circle cx="12" cy="14" r="3"></circle></svg>',
    );
  });

  it('accepts the usual export wrappers: XML declaration, comments, title; and builds a viewBox from width and height', () => {
    const out = ok(`<?xml version="1.0"?><!-- made by a tool --><svg xmlns="http://www.w3.org/2000/svg" width="32px" height="32"><title>Ball</title><g fill="#000"><rect x="1" y="1" width="30" height="30" rx="4"/></g></svg>`);
    expect(out).toContain('viewBox="0 0 32 32"');
    expect(out).not.toContain('Ball');
    expect(out).not.toContain('made by a tool');
  });

  it('refuses anything that can run code, load something or restyle the page', () => {
    const wrap = (inner: string, attrs = '') => `<svg viewBox="0 0 24 24"${attrs}>${inner}</svg>`;
    expect(refused(wrap('<script>alert(1)</script>'))).toMatch(/script/);
    expect(refused(wrap('<path d="M0 0" onclick="alert(1)"/>'))).toMatch(/onclick/);
    expect(refused(wrap('<path d="M0 0" onload="x()"/>'))).toMatch(/onload/);
    expect(refused(wrap('<a href="https://evil.example"><path d="M0 0"/></a>'))).toMatch(/<a>/);
    expect(refused(wrap('<image href="https://evil.example/x.png"/>'))).toMatch(/image/);
    expect(refused(wrap('<foreignObject><div>hi</div></foreignObject>'))).toMatch(/foreignObject/);
    expect(refused(wrap('<style>path{fill:red}</style><path d="M0 0"/>'))).toMatch(/style/);
    expect(refused(wrap('<use href="#x"/>'))).toMatch(/use/);
    expect(refused(wrap('<path d="M0 0" style="fill:red"/>'))).toMatch(/style/);
    expect(refused(wrap('<path d="M0 0" class="x"/>'))).toMatch(/class/);
    expect(refused(wrap('<path d="M0 0" fill="url(#g)"/>'))).toMatch(/not allowed/);
    expect(refused(wrap('<path d="M0 0" fill="javascript:alert(1)"/>'))).toMatch(/not allowed/);
    expect(refused(wrap('<path d="M0 0" xlink:href="x"/>'))).toMatch(/xlink:href/);
    expect(refused(wrap('<path d="M0 0&#10;"/>'))).toMatch(/not allowed/);
    expect(refused('<svg viewBox="0 0 24 24" xmlns="http://evil.example/ns"><path d="M0 0"/></svg>')).toMatch(/xmlns/);
    expect(refused('<!DOCTYPE svg [<!ENTITY x "y">]><svg viewBox="0 0 24 24"><path d="M0 0"/></svg>')).toMatch(/drawing shapes/);
  });

  it('refuses text content, broken markup, a second root and a missing size', () => {
    expect(refused('<svg viewBox="0 0 24 24">hello<path d="M0 0"/></svg>')).toMatch(/no text/);
    expect(refused('<svg viewBox="0 0 24 24"><path d="M0 0"/>')).toMatch(/not closed/);
    expect(refused('<svg viewBox="0 0 24 24"><g><path d="M0 0"/></svg>')).toMatch(/not closed properly|not closed/);
    expect(refused('<svg viewBox="0 0 24 24"><path d="M0 0" fill=red/></svg>')).toMatch(/name="value"/);
    expect(refused('<svg viewBox="0 0 24 24"></svg><svg viewBox="0 0 24 24"></svg>')).toMatch(/Only one/);
    expect(refused('<svg viewBox="0 0 24 24"><svg viewBox="0 0 1 1"/></svg>')).toMatch(/nested/);
    expect(refused('<svg><path d="M0 0"/></svg>')).toMatch(/viewBox/);
    expect(refused('<svg viewBox="0 0 0 24"><path d="M0 0"/></svg>')).toMatch(/viewBox/);
    expect(refused('<div></div>')).toMatch(/start with <svg/);
    expect(refused('')).toMatch(/Paste/);
    expect(refused(`<svg viewBox="0 0 24 24"><path d="${'M0 0 '.repeat(2000)}"/></svg>`)).toMatch(/too long/);
  });

  it('keeps a "$" in a value as it was written', () => {
    expect(ok('<svg viewBox="0 0 24 24" fill="$1"><path d="M0 0"/></svg>')).toContain('fill="$1"');
  });
});
