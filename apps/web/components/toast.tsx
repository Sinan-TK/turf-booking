'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

interface ToastApi {
  /** Shows a short message at the bottom middle of the screen; it fades away by itself. */
  show(message: string): void;
}

const ToastContext = createContext<ToastApi>({ show: () => undefined });
export const useToast = () => useContext(ToastContext);

const VISIBLE_MS = 3500;
const FADE_MS = 300;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<{ id: number; message: string; fading: boolean } | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const nextId = useRef(0);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  useEffect(() => clearTimers, []);

  const show = useCallback((message: string) => {
    clearTimers();
    const id = ++nextId.current;
    setToast({ id, message, fading: false });
    timers.current.push(
      setTimeout(() => setToast((t) => (t?.id === id ? { ...t, fading: true } : t)), VISIBLE_MS),
      setTimeout(() => setToast((t) => (t?.id === id ? null : t)), VISIBLE_MS + FADE_MS),
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
            className={`rounded-md bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg transition-opacity duration-300 ${
              toast.fading ? 'opacity-0' : 'opacity-100'
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}
