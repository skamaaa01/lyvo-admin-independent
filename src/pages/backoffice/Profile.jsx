import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { FiEye, FiEyeOff } from "react-icons/fi"
import axios from "../../axiosConfig"
import { boChangePasswordURL, boReset2FAURL } from "../../routes/Url"
import { boPath } from "./boPath"

export default function Profile({ user }) {
  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Profile</h1>
      <p className="text-sm text-gray-500 mb-6">Account settings for the back-office user.</p>

      <Section title="Account">
        <Row label="Name" value={user.name} />
        <Row label="Email" value={user.email} />
        <Row label="Role" value={user.role} />
        <Row label="Last login" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : "—"} />
        <Row label="2FA" value={user.totpEnabled ? "Enabled (TOTP)" : "Not enrolled"} status={user.totpEnabled ? "ok" : "warn"} />
      </Section>

      <ChangePasswordCard />

      <Reset2FACard />
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-3">{title}</h2>
      <dl className="divide-y divide-gray-50 text-sm">{children}</dl>
    </div>
  )
}
function Row({ label, value, status }) {
  const dot = status === "ok" ? "bg-emerald-500" : status === "warn" ? "bg-amber-500" : "bg-transparent"
  return (
    <div className="flex items-center py-2">
      <dt className="w-32 text-gray-500">{label}</dt>
      <dd className="flex-1 flex items-center gap-2 text-gray-900 capitalize">
        {status && <span className={`inline-block w-2 h-2 rounded-full ${dot}`} />}
        <span>{value || "—"}</span>
      </dd>
    </div>
  )
}

function ChangePasswordCard() {
  const [current, setCurrent] = useState("")
  const [next, setNext] = useState("")
  const [confirm, setConfirm] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNext, setShowNext] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null) // { kind: "ok" | "err", text }

  const submit = async (e) => {
    e.preventDefault()
    setMsg(null)
    if (next !== confirm) { setMsg({ kind: "err", text: "New passwords don't match" }); return }
    if (next.length < 10) { setMsg({ kind: "err", text: "New password must be at least 10 characters" }); return }
    setBusy(true)
    try {
      await axios.post(boChangePasswordURL, { currentPassword: current, newPassword: next }, { _silentToast: true })
      setMsg({ kind: "ok", text: "Password updated." })
      setCurrent(""); setNext(""); setConfirm("")
    } catch (err) {
      setMsg({ kind: "err", text: err.response?.data?.message || "Failed to update password" })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 mb-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Change password</h2>
      <p className="text-xs text-gray-500 mb-4">Minimum 10 characters. Use a password manager.</p>
      <form onSubmit={submit} className="space-y-3 max-w-md">
        <PwField label="Current password" value={current} onChange={setCurrent} show={showCurrent} setShow={setShowCurrent} />
        <PwField label="New password"     value={next}    onChange={setNext}    show={showNext}    setShow={setShowNext} />
        <PwField label="Confirm new"      value={confirm} onChange={setConfirm} show={showNext}    setShow={setShowNext} />

        {msg && (
          <div className={`text-sm px-3 py-2 rounded-lg border ${msg.kind === "ok" ? "bg-emerald-50 text-emerald-700 border-emerald-100" : "bg-red-50 text-red-700 border-red-100"}`}>
            {msg.text}
          </div>
        )}
        <button
          type="submit"
          disabled={busy || !current || !next || !confirm}
          className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-medium text-sm disabled:opacity-50"
        >
          {busy ? "Updating…" : "Update password"}
        </button>
      </form>
    </div>
  )
}

function PwField({ label, value, onChange, show, setShow }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div className="relative">
        <input
          type={show ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-full pl-3 pr-10 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
          required
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => setShow(s => !s)}
          aria-label={show ? "Hide password" : "Show password"}
          aria-pressed={show}
          className="absolute inset-y-0 right-0 flex items-center px-3 text-gray-400 hover:text-gray-600"
        >
          {show ? <FiEyeOff size={16} /> : <FiEye size={16} />}
        </button>
      </div>
    </div>
  )
}

function Reset2FACard() {
  const navigate = useNavigate()
  const [password, setPassword] = useState("")
  const [show, setShow] = useState(false)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const submit = async (e) => {
    e.preventDefault()
    setErr("")
    setBusy(true)
    try {
      await axios.post(boReset2FAURL, { currentPassword: password }, { _silentToast: true })
      // Backend cleared our session — go to login
      navigate(boPath("/login"), { replace: true })
    } catch (e) {
      setErr(e.response?.data?.message || "Failed to reset 2FA")
      setBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <h2 className="text-sm font-semibold text-gray-700 mb-1">Reset 2FA</h2>
      <p className="text-xs text-gray-500 mb-3">
        Lost access to your authenticator app? Reset will clear your TOTP secret and force you to re-enroll on the next login. You'll be signed out immediately.
      </p>
      {!open ? (
        <button
          onClick={() => setOpen(true)}
          className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-medium hover:bg-red-50"
        >
          Reset 2FA…
        </button>
      ) : (
        <form onSubmit={submit} className="space-y-3 max-w-md">
          <PwField label="Confirm with current password" value={password} onChange={setPassword} show={show} setShow={setShow} />
          {err && <div className="text-sm px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-100">{err}</div>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy || !password}
              className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium text-sm disabled:opacity-50"
            >
              {busy ? "Resetting…" : "Reset 2FA & sign out"}
            </button>
            <button
              type="button"
              onClick={() => { setOpen(false); setPassword(""); setErr("") }}
              className="px-4 py-2 rounded-lg border border-gray-200 text-sm hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}
