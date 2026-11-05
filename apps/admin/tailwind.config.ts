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
        // The Bookyo logo's black for buttons and links, its lime for highlights and pale tints for selected states.
        brand: {
          50: '#f6fde6',
          100: '#ebfbc4',
          200: '#d9f78f',
          300: '#c3f35b',
          400: '#A5F52B',
          500: '#4a4a46',
          600: '#2c2c29',
          700: '#050505',
          800: '#141414',
          900: '#0b0b0b',
          950: '#000000',
        },
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
