import type { Config } from 'tailwindcss';
import colors from 'tailwindcss/colors';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-inter)', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Cool slate neutrals replace Tailwind's warm-ish gray everywhere,
        // so every existing text-gray-* / bg-gray-* utility picks up the
        // new look without touching each page.
        gray: colors.slate,
        brand: colors.emerald,
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        pop: '0 10px 30px -10px rgb(15 23 42 / 0.25)',
      },
    },
  },
  plugins: [],
};

export default config;
