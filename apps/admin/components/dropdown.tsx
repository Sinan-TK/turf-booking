'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Icon } from '@/components/icons';

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  /** Small secondary line under the label. */
  hint?: string;
}

interface DropdownProps<T extends string> {
  /** Short caption shown before the current value, e.g. "Style". */
  label: string;
  value: T;
  options: Array<DropdownOption<T>>;
  onChange: (value: T) => void;
  /** Right-align the panel to the trigger (for dropdowns near the edge). */
  align?: 'left' | 'right';
  /** Value that counts as "no filter"; the trigger is highlighted otherwise. */
  neutral?: T;
}

/** A styled listbox replacing the native <select> popup: keyboard operable
 * (arrows, Home/End, Enter/Space, Esc, type-to-close on blur) and closes on
 * outside click. */
export function Dropdown<T extends string>({ label, value, options, onChange, align = 'left', neutral }: DropdownProps<T>) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();
  const current = options.find((o) => o.value === value) ?? options[0];
  const filtered = neutral !== undefined && value !== neutral;

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function openList() {
    setCursor(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  }

  function choose(v: T) {
    onChange(v);
    setOpen(false);
    root.current?.querySelector('button')?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(options.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Home') {
      e.preventDefault();
      setCursor(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      setCursor(options.length - 1);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      const picked = options[cursor];
      if (picked) choose(picked.value);
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  return (
    <div ref={root} className="relative shrink-0" onKeyDown={onKeyDown}>
      <button
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => (open ? setOpen(false) : openList())}
        className={`inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-lg border bg-white px-3 text-sm shadow-sm transition hover:border-gray-400 focus:outline-none focus-visible:border-brand-500 focus-visible:ring-4 focus-visible:ring-brand-500/15 ${
          filtered ? 'border-brand-400 bg-brand-50/50' : 'border-gray-300'
        } ${open ? 'border-brand-500 ring-4 ring-brand-500/15' : ''}`}
      >
        <span className="text-gray-500">{label}</span>
        <span className={`font-medium ${filtered ? 'text-brand-800' : 'text-gray-900'}`}>{current?.label}</span>
        <svg
          viewBox="0 0 20 20"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.75}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`h-4 w-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`}
          aria-hidden="true"
        >
          <path d="M5 7.5l5 5 5-5" />
        </svg>
      </button>

      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={label}
          className={`absolute top-full z-30 mt-1.5 min-w-full max-w-xs animate-[fade-in_0.12s_ease-out] overflow-hidden rounded-xl border border-gray-200 bg-white p-1 shadow-pop ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {options.map((o, i) => {
            const selected = o.value === value;
            return (
              <li
                key={o.value}
                role="option"
                aria-selected={selected}
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(o.value)}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  i === cursor ? 'bg-gray-100' : ''
                } ${selected ? 'font-medium text-gray-900' : 'text-gray-700'}`}
              >
                <span className="min-w-0 flex-1 whitespace-nowrap">
                  {o.label}
                  {o.hint && <span className="block text-xs font-normal text-gray-400">{o.hint}</span>}
                </span>
                {selected && <Icon name="check" className="h-4 w-4 shrink-0 text-brand-600" />}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
