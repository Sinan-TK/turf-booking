'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

interface ToastApi {
  /** Shows a short message at the bottom middle of the screen; it fades away by itself. */
  show(message: React.ReactNode): void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(ToastContext);

const VISIBLE_MS = 4000;
const FADE_MS = 300;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: React.ReactNode; fading: boolean } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const show = useCallback((message: React.ReactNode) => {
    clearTimers();
    const id = ++nextId.current;
    const shown = typeof message === 'string' ? VISIBLE_MS : VISIBLE_MS * 2;
    setToast({ id, message, fading: false });
    timers.current.push(
      // A message with a link in it (not just text) stays longer, so there is time to click it.
      setTimeout(() => setToast((t) => (t?.id === id ? { ...t, fading: true } : t)), shown),
      setTimeout(() => setToast((t) => (t?.id === id ? null : t)), shown + FADE_MS),
    );
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[120] flex justify-center px-4">
          <div
            role="status"
            aria-live="polite"
            className={`pointer-events-auto rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-opacity duration-300 ${
              toast.fading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            <span className="[&_a]:font-semibold [&_a]:underline">{toast.message}</span>
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
