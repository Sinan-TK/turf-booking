'use client';

import { useState } from 'react';
import type { ImgHTMLAttributes } from 'react';

/**
 * A picture that stays invisible until it has arrived, then fades in. Put the icon (or colour) it stands for behind it: that is what
 * shows while the picture loads, and for good if it never loads, so there is never a blank box or the browser's broken-picture mark.
 * The picture should fill its box (`absolute inset-0`) so it covers what is behind it.
 */
export function FadeImage({ className = '', onLoad, ...rest }: ImgHTMLAttributes<HTMLImageElement>) {
  const [loaded, setLoaded] = useState(false);
  return (
    <img
      {...rest}
      alt={rest.alt ?? ''}
      // A picture already in the browser's cache can finish before React listens for it.
      ref={(el) => {
        if (el?.complete && el.naturalWidth > 0) setLoaded(true);
      }}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      className={`${className} transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
    />
  );
}
