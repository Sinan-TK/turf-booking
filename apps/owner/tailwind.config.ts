import type { Config } from 'tailwindcss';

// Material-3-flavored design tokens for the Owner portal — carried over
// from the reference design the user supplied (colors/spacing/type
// scale), kept as its own token layer rather than raw Tailwind grays/
// greens so every page restyled through components/ui.tsx picks it up
// consistently instead of hand-tuning each page.
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        error: '#ba1a1a',
        'error-container': '#ffdad6',
        'on-error': '#ffffff',
        'on-error-container': '#93000a',
        primary: '#006c49',
        'primary-container': '#10b981',
        'on-primary': '#ffffff',
        'on-primary-container': '#00422b',
        'primary-fixed': '#6ffbbe',
        'primary-fixed-dim': '#4edea3',
        'inverse-primary': '#4edea3',
        secondary: '#565e74',
        'secondary-container': '#dae2fd',
        'on-secondary': '#ffffff',
        'on-secondary-container': '#5c647a',
        tertiary: '#a43a3a',
        'tertiary-container': '#fc7c78',
        'on-tertiary': '#ffffff',
        'on-tertiary-container': '#711419',
        background: '#f7f9fb',
        'on-background': '#191c1e',
        surface: '#f7f9fb',
        'surface-dim': '#d8dadc',
        'surface-bright': '#f7f9fb',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f2f4f6',
        'surface-container': '#eceef0',
        'surface-container-high': '#e6e8ea',
        'surface-container-highest': '#e0e3e5',
        'surface-variant': '#e0e3e5',
        'on-surface': '#191c1e',
        'on-surface-variant': '#3c4a42',
        outline: '#6c7a71',
        'outline-variant': '#bbcabf',
        'inverse-surface': '#2d3133',
        'inverse-on-surface': '#eff1f3',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: '0.5rem',
        xl: '0.75rem',
        full: '9999px',
      },
      spacing: {
        'card-gap': '20px',
        unit: '8px',
        gutter: '16px',
        'section-margin': '40px',
        'container-padding': '24px',
      },
      fontFamily: {
        'label-md': ['Manrope', 'sans-serif'],
        'headline-sm': ['Manrope', 'sans-serif'],
        'headline-md': ['Manrope', 'sans-serif'],
        'body-md': ['Manrope', 'sans-serif'],
        'body-lg': ['Manrope', 'sans-serif'],
        'display-lg': ['Manrope', 'sans-serif'],
        'stat-lg': ['Manrope', 'sans-serif'],
      },
      fontSize: {
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.05em', fontWeight: '600' }],
        'headline-sm': ['20px', { lineHeight: '28px', fontWeight: '600' }],
        'headline-md': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'body-md': ['14px', { lineHeight: '20px', fontWeight: '400' }],
        'body-lg': ['16px', { lineHeight: '24px', fontWeight: '400' }],
        'display-lg': ['32px', { lineHeight: '40px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'stat-lg': ['28px', { lineHeight: '34px', fontWeight: '700' }],
      },
    },
  },
  plugins: [],
};

export default config;
