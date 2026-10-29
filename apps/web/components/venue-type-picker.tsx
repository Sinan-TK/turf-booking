'use client';

import { useEffect, useRef, useState } from 'react';
import { CategoryIcon, Icon } from '@/components/ui';
import type { VenueCategory } from '@/lib/categories';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Picks any number of venue types to search at once. The ticks are a draft until "Show venues"; closing it (Escape,
 * the X, the backdrop) leaves the search as it was. No ticks = every venue type.
 */
export function VenueTypePicker({
  categories,
  selected,
  onApply,
  onClose,
}: {
  categories: VenueCategory[];
  selected: string[];
  onApply: (slugs: string[]) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<string[]>(selected);

  const toggle = (slug: string) => setDraft((d) => (d.includes(slug) ? d.filter((s) => s !== slug) : [...d, slug]));

  // Focus, scroll lock, Escape and a focus trap, as in the location picker.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.querySelector<HTMLElement>('[role="checkbox"]')?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const items = Array.from(panel.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/50" onMouseDown={onClose} aria-hidden="true" />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="venue-type-picker-title"
        className="relative flex max-h-[80vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-2xl"
      >
        <header className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
          <div className="flex-1">
            <h2 id="venue-type-picker-title" className="text-base font-extrabold text-slate-900">
              Venue types
            </h2>
            <p className="text-xs font-medium text-slate-500">Pick one or more. None picked shows every type.</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <Icon name="close" className="text-[1.125rem]" />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {categories.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">No venue types to choose from yet.</p>
          ) : (
            <div className="grid grid-cols-2 gap-2.5">
              {categories.map((c) => {
                const isOn = draft.includes(c.slug);
                return (
                  <button
                    key={c.slug}
                    type="button"
                    role="checkbox"
                    aria-checked={isOn}
                    onClick={() => toggle(c.slug)}
                    className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left text-sm transition ${
                      isOn
                        ? 'border-brand-600 bg-brand-50 font-bold text-brand-800'
                        : 'border-slate-200 font-semibold text-slate-700 hover:border-brand-400 hover:bg-slate-50'
                    }`}
                  >
                    <CategoryIcon iconKey={c.iconKey} iconSvg={c.iconSvg} className={`text-[1.125rem] ${isOn ? 'text-brand-600' : 'text-slate-400'}`} />
                    <span className="min-w-0 flex-1 truncate">{c.name}</span>
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        isOn ? 'border-brand-600 bg-brand-600 text-white' : 'border-slate-300 bg-white'
                      }`}
                    >
                      {isOn && <Icon name="check" className="text-[0.75rem]" />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-3 border-t border-slate-100 px-5 py-3.5">
          <button
            type="button"
            onClick={() => setDraft([])}
            disabled={draft.length === 0}
            className="rounded-full px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:text-slate-300 disabled:hover:bg-transparent"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={() => onApply(draft)}
            className="rounded-xl bg-brand-700 px-5 py-2.5 text-xs font-bold text-white shadow-glow hover:bg-brand-800"
          >
            {draft.length === 0 ? 'Show all venues' : `Show venues (${draft.length} ${draft.length === 1 ? 'type' : 'types'})`}
          </button>
        </footer>
      </div>
    </div>
  );
}
