/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Brand tokens (from the supplied palette)
        surface: {
          dark: "#000000",
          bege: "#F7F5F2",
          white: "#FFFFFF",
        },
        ink: {
          DEFAULT: "#000000",
          secondary: "#5C5A52",
          brand: "#DCD7CB",
          invert: "#F7F5F2",
        },
        success: "#19B924",
        error: "#B93E19",
        alert: "#B99919",
      },
      fontFamily: {
        sans: ["'Hanken Grotesk Variable'", "system-ui", "Arial", "sans-serif"],
      },
      borderColor: {
        DEFAULT: "rgba(0,0,0,0.16)",
      },
      boxShadow: {
        card: "0 1px 2px rgba(0,0,0,0.04), 0 8px 24px rgba(0,0,0,0.05)",
        pop: "0 8px 40px rgba(0,0,0,0.14)",
      },
      borderRadius: {
        xl: "14px",
        "2xl": "20px",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "pop-in": {
          "0%": { opacity: "0", transform: "scale(0.94)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.4s cubic-bezier(0.22,1,0.36,1) both",
        "pop-in": "pop-in 0.45s cubic-bezier(0.22,1,0.36,1) both",
      },
    },
  },
  plugins: [],
};
