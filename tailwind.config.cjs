// Tailwind build settings: `npm run build:css` writes public/css/tailwind.css (Vercel runs it on every
// deploy). Scans the page templates and the browser scripts for the classes they use. Eva Scarf's
// design tokens (colours, fonts, shadows, easing) live here.
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/views/**/*.ejs', './public/js/**/*.js'],
  theme: {
    extend: {
      colors: {
        paper: '#FAF5F1',
        sand: '#F3EAE3',
        line: '#EBDDD5',
        ink: { DEFAULT: '#2B1A24', soft: '#6E5862', faint: '#9A8790' },
        eva: { DEFAULT: '#E8339A', deep: '#B4186F', blush: '#FBE3EF', mist: '#FDF3F8' },
        ok: { DEFAULT: '#2F7A55', soft: '#E3F2EA' },
        warn: { DEFAULT: '#9A5B0B', soft: '#FBF0DC' },
      },
      fontFamily: {
        display: ['var(--font-display)'],
        body: ['var(--font-body)'],
        latin: ['Jost', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 1px 2px rgba(139,24,90,.05), 0 6px 18px -10px rgba(139,24,90,.16)',
        lift: '0 2px 4px rgba(139,24,90,.06), 0 14px 34px -14px rgba(139,24,90,.26)',
        float: '0 4px 10px rgba(43,26,36,.08), 0 28px 60px -24px rgba(139,24,90,.38)',
      },
      transitionTimingFunction: {
        spring: 'cubic-bezier(.22,1.25,.36,1)',
        out: 'cubic-bezier(.16,1,.3,1)',
      },
      borderRadius: { card: '14px' },
    },
  },
};
