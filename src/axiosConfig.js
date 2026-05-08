// Axios instance for the back office. Sends cookies on every request so the
// bo_token (issued by /api/admin/auth/login + 2FA verify) is included.
// Trimmed copy of the customer-app axiosConfig — no device-token redirect, no
// google-auth flows, no marketing-page error suppression.
import axios from "axios"
import NProgress from "nprogress"
import "nprogress/nprogress.css"
import { showToast } from "./utils/toast"

let requestCount = 0
const startLoading = () => {
  requestCount++
  document.body.classList.add("loading-overlay-active")
  NProgress.start()
}
const stopLoading = () => {
  requestCount = Math.max(0, requestCount - 1)
  if (requestCount === 0) {
    NProgress.done()
    document.body.classList.remove("loading-overlay-active")
  }
}

// Status codes the calling component handles itself — skip the global toast.
//   400 — validation/inline form errors
//   401 — auth (login flow handles its own message)
//   403 — IP allowlist / role denial (page-level message)
//   404 — empty states
const SILENT_STATUSES = new Set([400, 401, 403, 404])

const ERROR_MESSAGES = {
  423: "Account is locked. Try again in a few minutes.",
  429: "Too many requests — please slow down and try again.",
  500: "Server error — something went wrong on our end.",
  502: "Server is unreachable — please try again shortly.",
  503: "Service unavailable — the server is temporarily down.",
  504: "Request timed out — the server took too long to respond.",
}

const instance = axios.create({ withCredentials: true })

instance.interceptors.request.use((config) => {
  startLoading()
  return config
})

instance.interceptors.response.use(
  (response) => { stopLoading(); return response },
  (error) => {
    stopLoading()
    const status = error.response?.status

    if (!error.config?._silentToast) {
      if (status && !SILENT_STATUSES.has(status)) {
        const serverMessage = error.response?.data?.message
        const message = ERROR_MESSAGES[status]
          || (serverMessage ? `Error: ${serverMessage}` : `Unexpected error (${status})`)
        showToast(message, "error")
      }
      if (!error.response) {
        showToast("Network error — check your connection and try again.", "error")
      }
    }

    return Promise.reject(error)
  }
)

export default instance
