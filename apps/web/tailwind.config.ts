import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    // Boxes have only a slight curve across the customer site; true circles (rounded-full on a square: avatars, dots, spinners) stay round.
    borderRadius: { none: '0', DEFAULT: '3px', sm: '2px', md: '4px', lg: '5px', xl: '6px', '2xl': '8px', '3xl': '8px', full: '9999px' },
    extend: {
      colors: {
        // The customer site's theme, taken from the Bookyo logo. Change this one scale to re-theme every page.
        // brand: the logo's black (#050505) for headings, links and the solid buttons (white text from 500 up), with the dart's lime
        // green (#A5F52B, 400) for highlights and its pale tints (50-300) for selected states and soft backgrounds.
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
        // The logo's other colours: the kayak wave's aqua, and the page background's warm white.
        aqua: { DEFAULT: '#42DDE0', soft: '#e2f9fa', deep: '#0f8f93' },
        cream: '#FFFCF6',
        // The page background (warm white) wherever the site used the palest grey.
        gray: { 50: '#FFFCF6' },
        slate: { 50: '#FFFCF6' },
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
        'glow': '0 4px 20px -2px rgba(5, 5, 5, 0.18)',
        'subtle': '0 2px 10px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.03)',
        'card': '0 10px 30px -5px rgba(5, 5, 5, 0.06)',
      }
    },
  },
  plugins: [],
};

export default config;
