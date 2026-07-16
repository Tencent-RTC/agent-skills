/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{vue,js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        background: '#F5F6F7',
        foreground: '#0F1115',
        card: '#FFFFFF',
        primary: { DEFAULT: '#0F1115', foreground: '#FFFFFF' },
        muted: '#6B7280',
        muted2: '#9CA3AF',
        border: 'rgba(15,17,21,.08)',
        danger: '#C0362C',
        accent: '#3B7A57',
      },
      fontFamily: {
        sans: ['Inter', 'PingFang SC', 'HarmonyOS Sans SC', 'system-ui', 'sans-serif'],
        mono: ['SF Mono', 'JetBrains Mono', 'Menlo', 'monospace'],
        serif: ['Source Serif 4', 'Source Han Serif SC', 'Georgia', 'serif'],
      },
    },
  },
  plugins: [],
}
