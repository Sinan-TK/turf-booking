'use client';

import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * Keyboard handling shared by the modal dialogs: Esc closes (unless a request is in flight) and
 * Tab never leaves the dialog. It listens on the document, not on the dialog, because focus can
 * drop out of the dialog while it is open (a focused button gets disabled while saving), and Esc
 * and Tab must keep working from there.
 */
export function useDialogKeys(panel: RefObject<HTMLElement>, onClose: () => void, busy: boolean) {
  const latest = useRef({ onClose, busy });
  latest.current = { onClose, busy };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (latest.current.busy) return;
        e.stopPropagation();
        latest.current.onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const focusable = panel.current.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (focusable.length === 0) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      if (!panel.current.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [panel]);
}
