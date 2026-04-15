import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        canvas: "#eef3f6",
        ink: "#112033",
        accent: "#0f6c7a",
        line: "#d6dee3"
      },
      boxShadow: {
        panel: "0 18px 40px rgba(17, 32, 51, 0.08)"
      }
    }
  },
  plugins: []
};

export default config;
