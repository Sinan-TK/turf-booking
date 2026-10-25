'use client';

import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Icon, Input } from '@/components/ui';

/** A password field with an eye button that shows or hides what was typed. */
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={`pr-11 ${className}`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-1.5 my-auto flex h-8 w-8 items-center justify-center rounded-md text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
      >
        <Icon name={shown ? 'visibility_off' : 'visibility'} className="text-[1.125rem]" />
      </button>
    </div>
  );
}
