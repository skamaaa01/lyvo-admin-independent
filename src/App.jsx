import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom"
import BackOfficeLogin from "./pages/backoffice/BackOfficeLogin.jsx"
import BackOfficeLayout from "./pages/backoffice/BackOfficeLayout.jsx"
import BackOfficeRoute from "./routes/BackOfficeRoute.jsx"
import { ConfirmProvider } from "./components/ConfirmDialog.jsx"

// Back office is a self-contained app served from admin.lyvo.app. No host
// detection or path prefix — every route mounts at the site root.
export default function App() {
  return (
    <ConfirmProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<BackOfficeLogin />} />
          <Route
            path="/*"
            element={
              <BackOfficeRoute>
                <BackOfficeLayout />
              </BackOfficeRoute>
            }
          />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </ConfirmProvider>
  )
}
