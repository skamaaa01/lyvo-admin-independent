import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// Admin Back Office build — deployed to admin.lyvo.app.
// Backend runs on the same VPS as the customer app, so VITE_BACKEND_URL
// in the env file points at the API origin (e.g. https://api.lyvo.app).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    // Different from the customer-app dev port (3000) so both can run side-by-side.
    port: 3100,
  },
})
