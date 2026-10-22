'use client';

import { useState } from 'react';
import type { InputHTMLAttributes } from 'react';
import { Icon } from '@/components/icons';
import { Input } from '@/components/ui';

/** Password field with a show/hide toggle. */
export function PasswordInput({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input type={visible ? 'text' : 'password'} className={`pr-10 ${className}`} {...props} />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-gray-400 transition-colors hover:text-gray-700"
      >
        <Icon name={visible ? 'eyeOff' : 'eye'} className="h-[18px] w-[18px]" />
      </button>
    </div>
  );
}
