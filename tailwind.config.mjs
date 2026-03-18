/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        beige: {
          50:  '#fdfdf8',
          100: '#faf9ef',
          200: '#f5f5dc', // base
          300: '#eeecbe',
          400: '#e0db93',
        },
        teal: {
          DEFAULT: '#008d8d',
          light:   '#00b3b3',
          dark:    '#006666',
        },
        orange: {
          DEFAULT: '#e8720c',
          light:   '#f59040',
          dark:    '#b85509',
        },
      },
      fontFamily: {
        sans: ['"Noto Sans JP"', 'sans-serif'],
        mono: ['"Source Code Pro"', 'monospace'],
      },
      typography: (theme) => ({
        samurai: {
          css: {
            '--tw-prose-body':    theme('colors.stone.800'),
            '--tw-prose-headings': theme('colors.teal.dark'),
            '--tw-prose-links':    theme('colors.teal.DEFAULT'),
            '--tw-prose-code':     theme('colors.teal.dark'),
            '--tw-prose-pre-bg':   theme('colors.stone.900'),
            fontSize: '1.0625rem',
            lineHeight: '1.85',
          },
        },
      }),
    },
  },
  plugins: [
    require('@tailwindcss/typography'),
  ],
}
