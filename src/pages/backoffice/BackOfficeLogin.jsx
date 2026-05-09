import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { QRCodeSVG } from "qrcode.react"
import { FiEye, FiEyeOff } from "react-icons/fi"
import axios from "../../axiosConfig"
import {
  boLoginURL,
  boSetup2FAURL,
  boVerifyEnrollURL,
  boVerify2FAURL,
} from "../../routes/Url"
import { boPath } from "./boPath"

export default function BackOfficeLogin() {
  const navigate = useNavigate()
  const [stage, setStage] = useState("credentials") // credentials | mfa_setup | mfa_verify
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [preToken, setPreToken] = useState("")
  const [secret, setSecret] = useState("")
  const [otpauthUri, setOtpauthUri] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  // Sticky preference — reflects what the user picked last time on this browser.
  const [rememberDevice, setRememberDevice] = useState(() => {
    try { return localStorage.getItem("bo_remember_device") === "1" } catch { return false }
  })

  function rememberPref(value) {
    setRememberDevice(value)
    try { localStorage.setItem("bo_remember_device", value ? "1" : "0") } catch {}
  }

  async function submitCredentials(e) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      const { data } = await axios.post(boLoginURL, { email, password }, { _silentToast: true })
      setPreToken(data.preToken)
      if (data.stage === "mfa_setup_required") {
        // Trigger setup
        const setupRes = await axios.post(boSetup2FAURL, { preToken: data.preToken }, { _silentToast: true })
        setSecret(setupRes.data.secret)
        setOtpauthUri(setupRes.data.otpauthUri)
        setStage("mfa_setup")
      } else if (data.stage === "ok") {
        // Trusted-device shortcut — backend skipped 2FA because we have a
        // valid bo_device cookie. Go straight to the dashboard.
        navigate(boPath("/dashboard"), { replace: true })
      } else {
        setStage("mfa_verify")
      }
    } catch (err) {
      setError(err.response?.data?.message || "Login failed")
    } finally {
      setBusy(false)
    }
  }

  async function submitEnroll(e) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      await axios.post(boVerifyEnrollURL, { preToken, code, rememberDevice }, { _silentToast: true })
      navigate(boPath("/dashboard"), { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || "Invalid code")
    } finally {
      setBusy(false)
    }
  }

  async function submitVerify(e) {
    e.preventDefault()
    setError("")
    setBusy(true)
    try {
      await axios.post(boVerify2FAURL, { preToken, code, rememberDevice }, { _silentToast: true })
      navigate(boPath("/dashboard"), { replace: true })
    } catch (err) {
      setError(err.response?.data?.message || "Invalid code")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-100 px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-md p-8">
        <div className="text-center mb-6">
          <div className="inline-block px-3 py-1 rounded-full bg-orange-100 text-orange-600 text-xs font-semibold tracking-wide">
            LYVO BACK OFFICE
          </div>
          <h1 className="mt-4 text-2xl font-bold text-gray-900">
            {stage === "credentials" && "Sign in"}
            {stage === "mfa_setup" && "Set up 2FA"}
            {stage === "mfa_verify" && "Two-factor code"}
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            {stage === "credentials" && "Internal use only."}
            {stage === "mfa_setup" && "Scan the QR with your authenticator app, then enter the 6-digit code."}
            {stage === "mfa_verify" && "Enter the 6-digit code from your authenticator app."}
          </p>
        </div>

        {error && (
          <div className="mb-4 px-3 py-2 rounded-lg bg-red-50 text-red-700 text-sm border border-red-100">
            {error}
          </div>
        )}

        {stage === "credentials" && (
          <form onSubmit={submitCredentials} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-3 pr-10 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  // tabIndex=-1 so the toggle doesn't interrupt keyboard flow
                  // between the password field and the submit button.
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  aria-pressed={showPassword}
                  className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600 focus:outline-none focus:text-orange-500"
                >
                  {showPassword ? <FiEyeOff size={16} /> : <FiEye size={16} />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Continue"}
            </button>
          </form>
        )}

        {stage === "mfa_setup" && (
          <form onSubmit={submitEnroll} className="space-y-4">
            <div className="flex justify-center bg-white p-4 rounded-lg border border-gray-100">
              {otpauthUri && <QRCodeSVG value={otpauthUri} size={180} />}
            </div>
            <div className="text-center">
              <p className="text-xs text-gray-500 mb-1">Or enter this secret manually:</p>
              <code className="text-xs bg-gray-50 px-2 py-1 rounded border border-gray-200 break-all">
                {secret}
              </code>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 text-center tracking-widest"
                required
                autoFocus
              />
            </div>
            <RememberDeviceCheckbox value={rememberDevice} onChange={rememberPref} />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
          </form>
        )}

        {stage === "mfa_verify" && (
          <form onSubmit={submitVerify} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">6-digit code</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="\d{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400 text-center tracking-widest"
                required
                autoFocus
              />
            </div>
            <RememberDeviceCheckbox value={rememberDevice} onChange={rememberPref} />
            <button
              type="submit"
              disabled={busy || code.length !== 6}
              className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm disabled:opacity-50"
            >
              {busy ? "Verifying…" : "Sign in"}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

// Sticky checkbox shown on both 2FA stages. When checked, the backend issues
// a 30-day bo_device cookie so 2FA is skipped on this browser next time.
// Preference is persisted in localStorage so the checkbox starts in the
// state the user last picked.
function RememberDeviceCheckbox({ value, onChange }) {
  return (
    <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer select-none">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-3.5 h-3.5 rounded accent-orange-500"
      />
      <span>Trust this browser for 30 days (skip 2FA on next sign-in)</span>
    </label>
  )
}
