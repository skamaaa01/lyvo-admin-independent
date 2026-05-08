import { useEffect, useState } from "react"
import { Navigate } from "react-router-dom"
import axios from "../axiosConfig"
import { boMeURL } from "./Url"

// Auth gate. Pings /auth/me; redirects to /login on 401. Renders nothing
// while the check is in flight so the layout doesn't flash for unauth users.
export default function BackOfficeRoute({ children }) {
  const [state, setState] = useState({ status: "loading" })

  useEffect(() => {
    let alive = true
    axios.get(boMeURL, { _silentToast: true })
      .then(() => { if (alive) setState({ status: "ok" }) })
      .catch(() => { if (alive) setState({ status: "no" }) })
    return () => { alive = false }
  }, [])

  if (state.status === "loading") return null
  if (state.status === "no") return <Navigate to="/login" replace />
  return children
}
