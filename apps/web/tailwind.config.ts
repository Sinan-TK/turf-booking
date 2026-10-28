import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // The customer site's theme. Change this one scale to re-theme every page.
        // brand: deep pitch green, for headings, selected states and the solid buttons (white text from 600 up).
        brand: {
          50: '#eef7f3',
          100: '#d5ede3',
          200: '#abdac7',
          300: '#77c0a4',
          400: '#3f9f7e',
          500: '#1e8263',
          600: '#106b51',
          700: '#0c5a44',
          800: '#0a4a39',
          900: '#083d30',
          950: '#04231b',
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
        'glow': '0 4px 20px -2px rgba(12, 90, 68, 0.28)',
        'subtle': '0 2px 10px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)',
        'card': '0 10px 30px -5px rgba(10, 46, 29, 0.05)',
      }
    },
  },
  plugins: [],
};

export default config;
