import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b',
          950: '#022c22',
        },
        venue: {
          primary: '#0F5132',
          accent: '#22C55E',
          dark: '#0A2E1D',
          surface: '#F8FAF9',
        },
        whatsapp: '#25D366',
      },
      fontFamily: {
        sans: ['var(--font-akshar)', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'glow': '0 4px 20px -2px rgba(16, 185, 129, 0.25)',
        'subtle': '0 2px 10px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)',
        'card': '0 10px 30px -5px rgba(10, 46, 29, 0.05)',
      }
    },
  },
  plugins: [],
};

export default config;
