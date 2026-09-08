import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#1d1f20",
        paper: "#f2f2f3",
        surface: "#ffffff",
        accent: "#5980a6",
        steel: "#1d2d3d",
        divider: "#d4d4d7",
        muted: "#71717a",
        warn: "#b45309",
        danger: "#9f1239",
      },
      fontFamily: {
        sans: ["var(--font-barlow)", "system-ui", "sans-serif"],
        cond: ["var(--font-barlow-cond)", "var(--font-barlow)", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
