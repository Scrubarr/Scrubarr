/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#20242b",
        panel: "#343b47",
        line: "#566070",
        accent: "#f5c542",
      },
    },
  },
  plugins: [],
};
