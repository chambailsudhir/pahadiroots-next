import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Pahadi Roots brand palette
        forest: {
          50:  '#f0f7f1',
          100: '#d9edd9',
          200: '#b2dab5',
          300: '#7fc083',
          400: '#4ea354',
          500: '#2d8533',
          600: '#1a6b20',
          700: '#155419',
          800: '#124216',
          900: '#0d3211',
          950: '#061a08',
        },
        earth: {
          50:  '#fdf8f0',
          100: '#f9eed8',
          200: '#f2d9a8',
          300: '#e9bc6d',
          400: '#de9b38',
          500: '#d4821e',
          600: '#b96716',
          700: '#9a4e15',
          800: '#7d3f17',
          900: '#673516',
          950: '#3a1a08',
        },
        stone: {
          50:  '#f8f6f2',
          100: '#ede9e0',
          200: '#d9d1c1',
          300: '#c2b59a',
          400: '#ab9776',
          500: '#9a825f',
          600: '#836d50',
          700: '#6c5942',
          800: '#5a4a38',
          900: '#4c3e30',
        },
      },
      fontFamily: {
        sans: ['var(--font-geist-sans)', 'system-ui', 'sans-serif'],
        serif: ['Georgia', 'serif'],
      },
      animation: {
        'ticker': 'ticker 30s linear infinite',
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-up': 'slideUp 0.3s ease-out',
        'slide-down': 'slideDown 0.2s ease-out',
      },
      keyframes: {
        ticker: {
          '0%':   { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(-100%)' },
        },
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideUp: {
          '0%':   { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',    opacity: '1' },
        },
        slideDown: {
          '0%':   { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',     opacity: '1' },
        },
      },
      screens: {
        'xs': '475px',
      },
    },
  },
  plugins: [],
}

export default config
