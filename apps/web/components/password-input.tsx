'use client';

import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Input } from '@/components/ui';

/** A password field with a Show / Hide switch. */
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? 'text' : 'password'} className={`pr-16 ${className}`} />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-pressed={shown}
        aria-label={shown ? 'Hide password' : 'Show password'}
        className="absolute inset-y-0 right-2 my-auto h-7 rounded-md px-2 text-xs font-semibold text-slate-500 hover:bg-slate-100 hover:text-slate-800"
      >
        {shown ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}
