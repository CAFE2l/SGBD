import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
      },
      boxShadow: {
        glow: "0 0 20px rgba(56, 189, 248, 0.25)",
        "glow-sm": "0 0 10px rgba(56, 189, 248, 0.2)",
      },
      backgroundColor: {
        glass: "rgba(255, 255, 255, 0.05)",
      },
    },
  },
  plugins: [],
};
export default config;
