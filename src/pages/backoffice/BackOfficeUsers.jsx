import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { FiPlus, FiTrash2, FiRefreshCw, FiChevronDown } from "react-icons/fi"
import axios from "../../axiosConfig"
import { boUsersURL } from "../../routes/Url"
import { useConfirm } from "../../components/ConfirmDialog"

const ROLES = ["admin", "support", "readonly"]
const ROLE_BADGE = {
  admin: "bg-orange-50 text-orange-700",
  support: "bg-blue-50 text-blue-700",
  readonly: "bg-gray-100 text-gray-600",
}

export default function BackOfficeUsers({ user }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const isAdmin = user.role === "admin"

  const reload = () => {
    setLoading(true)
    return axios.get(boUsersURL, { _silentToast: true })
      .then(({ data }) => { setItems(data.items); setLoading(false) })
      .catch(() => setLoading(false))
  }

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [])

  return (
    <div className="p-8 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Back-office users</h1>
          <p className="text-sm text-gray-500 mt-1">Internal accounts that can sign into admin.lyvo.app.</p>
        </div>
        {isAdmin && (
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 inline-flex items-center gap-1.5"
          >
            <FiPlus size={14} /> New user
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Email</th>
              <th className="text-left px-4 py-2.5">Name</th>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="text-left px-4 py-2.5">2FA</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Last login</th>
              {isAdmin && <th className="text-left px-4 py-2.5">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading && <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-gray-400">Loading…</td></tr>}
            {!loading && items.map(u => (
              <UserRow key={u._id} u={u} self={user} isAdmin={isAdmin} onChange={reload} />
            ))}
            {!loading && items.length === 0 && (
              <tr><td colSpan={isAdmin ? 7 : 6} className="px-4 py-8 text-center text-gray-400">No users.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {creating && <CreateModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload() }} />}
    </div>
  )
}

function UserRow({ u, self, isAdmin, onChange }) {
  const isSelf = String(u._id) === String(self._id)
  const [busy, setBusy] = useState(false)
  const { confirm } = useConfirm()

  const setRole = async (role) => {
    setBusy(true)
    try { await axios.patch(`${boUsersURL}/${u._id}`, { role }) } finally { setBusy(false); onChange() }
  }
  const toggleActive = async () => {
    setBusy(true)
    try { await axios.patch(`${boUsersURL}/${u._id}`, { isActive: !u.isActive }) } finally { setBusy(false); onChange() }
  }
  const reset2FA = async () => {
    if (!(await confirm(`They'll be forced to re-enroll on next login.`, {
      title: `Reset 2FA for ${u.email}?`,
      confirmLabel: "Reset 2FA",
    }))) return
    setBusy(true)
    try { await axios.post(`${boUsersURL}/${u._id}/reset-2fa`) } finally { setBusy(false); onChange() }
  }
  const remove = async () => {
    if (!(await confirm(`Audit log entries are retained, but the account itself is removed permanently.`, {
      title: `Delete ${u.email}?`,
      confirmLabel: "Delete user",
    }))) return
    setBusy(true)
    try { await axios.delete(`${boUsersURL}/${u._id}`) } finally { setBusy(false); onChange() }
  }

  return (
    <tr className={`${!u.isActive ? "opacity-60" : ""}`}>
      <td className="px-4 py-2.5 font-medium text-gray-900">
        {u.email}
        {isSelf && <span className="ml-2 text-[10px] uppercase tracking-wide text-gray-400">you</span>}
      </td>
      <td className="px-4 py-2.5 text-gray-700">{u.name}</td>
      <td className="px-4 py-2.5">
        {isAdmin && !isSelf ? (
          <select
            value={u.role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
            className="px-2 py-1 text-xs border border-gray-200 rounded"
          >
            {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        ) : (
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${ROLE_BADGE[u.role]}`}>{u.role}</span>
        )}
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-xs ${u.totpEnabled ? "text-emerald-700" : "text-amber-700"}`}>
          {u.totpEnabled ? "Enrolled" : "Not enrolled"}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <span className={`text-xs ${u.isActive ? "text-emerald-700" : "text-red-700"}`}>
          {u.isActive ? "Active" : "Disabled"}
        </span>
      </td>
      <td className="px-4 py-2.5 text-gray-400 text-xs">
        {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : "—"}
      </td>
      {isAdmin && (
        <td className="px-4 py-2.5">
          {!isSelf && (
            <div className="flex items-center gap-2">
              <button onClick={toggleActive} disabled={busy} className="text-xs text-gray-600 hover:text-orange-600">
                {u.isActive ? "Disable" : "Enable"}
              </button>
              <span className="text-gray-200">·</span>
              <button onClick={reset2FA} disabled={busy} className="text-xs text-gray-600 hover:text-orange-600 inline-flex items-center gap-1" title="Reset 2FA">
                <FiRefreshCw size={11} /> Reset 2FA
              </button>
              <span className="text-gray-200">·</span>
              <button onClick={remove} disabled={busy} className="text-xs text-red-600 hover:text-red-700 inline-flex items-center gap-1" title="Delete">
                <FiTrash2 size={11} /> Delete
              </button>
            </div>
          )}
        </td>
      )}
    </tr>
  )
}

function CreateModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ email: "", name: "", password: "", role: "support" })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const submit = async (e) => {
    e.preventDefault()
    setErr("")
    if (form.password.length < 10) { setErr("Password must be at least 10 characters"); return }
    setBusy(true)
    try {
      await axios.post(boUsersURL, form, { _silentToast: true })
      onCreated()
    } catch (e) {
      setErr(e.response?.data?.message || "Failed")
    } finally {
      setBusy(false)
    }
  }
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    // Backdrop sits BELOW the modal so the modal's own stacking context wins.
    // max-h-[90vh] + overflow-y-auto on the form means the modal scrolls
    // internally if it's taller than the viewport instead of pushing the
    // submit buttons off-screen.
    <div className="fixed inset-0 z-[100] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 className="text-lg font-bold text-gray-900 mb-4">New back-office user</h2>
        <div className="space-y-3">
          <Input label="Email" type="email" value={form.email} onChange={(v) => set("email", v)} required />
          <Input label="Name" value={form.name} onChange={(v) => set("name", v)} required />
          <Input label="Initial password" type="password" value={form.password} onChange={(v) => set("password", v)} required hint="≥ 10 chars. They'll set their own 2FA on first login." />
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Role</label>
            {/* Custom dropdown — native <select> dropdown renders in the OS
                overlay layer which on some browsers / certain modal setups
                falls behind the dialog backdrop. Portalled fixed-position
                popover guarantees it always sits on top. */}
            <RoleSelect value={form.role} onChange={(v) => set("role", v)} />
          </div>
          {err && <div className="text-sm px-3 py-2 rounded-lg bg-red-50 text-red-700 border border-red-100">{err}</div>}
          <div className="flex gap-2 justify-end pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={busy} className="px-4 py-2 text-sm rounded-lg bg-orange-500 text-white font-medium hover:bg-orange-600 disabled:opacity-50">
              {busy ? "Creating…" : "Create user"}
            </button>
          </div>
        </div>
      </form>
    </div>
  )
}

// Custom role dropdown — portal + position:fixed + z-[10000] so it's always
// on top of any modal backdrop. Same pattern as DatePicker / MultiSelect.
function RoleSelect({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef(null)
  const popoverRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })

  useEffect(() => {
    if (!open) return
    const onClick = (e) => {
      if (triggerRef.current?.contains(e.target)) return
      if (popoverRef.current?.contains(e.target)) return
      setOpen(false)
    }
    document.addEventListener("mousedown", onClick)
    return () => document.removeEventListener("mousedown", onClick)
  }, [open])

  useLayoutEffect(() => {
    if (!open) return
    const POPOVER_H = 140
    const GAP = 4
    const reposition = () => {
      if (!triggerRef.current) return
      const r = triggerRef.current.getBoundingClientRect()
      const vh = window.innerHeight
      const placement = vh - r.bottom >= POPOVER_H + GAP ? "below" : "above"
      const top = placement === "below" ? r.bottom + GAP : r.top - POPOVER_H - GAP
      setPos({ top, left: r.left, width: r.width })
    }
    reposition()
    window.addEventListener("scroll", reposition, true)
    window.addEventListener("resize", reposition)
    return () => {
      window.removeEventListener("scroll", reposition, true)
      window.removeEventListener("resize", reposition)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white hover:border-gray-300 focus:outline-none focus:ring-2 focus:ring-orange-400"
      >
        <span className="capitalize">{value}</span>
        <FiChevronDown size={14} className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && createPortal(
        <ul
          ref={popoverRef}
          style={{ position: "fixed", top: pos.top, left: pos.left, width: pos.width, zIndex: 10000 }}
          className="bg-white border border-gray-200 rounded-lg shadow-lg py-1 max-h-44 overflow-y-auto"
        >
          {ROLES.map(r => (
            <li key={r}>
              <button
                type="button"
                onClick={() => { onChange(r); setOpen(false) }}
                className={`w-full text-left px-3 py-1.5 text-sm capitalize hover:bg-orange-50 ${r === value ? "bg-orange-50 text-orange-700 font-medium" : "text-gray-700"}`}
              >
                {r}
              </button>
            </li>
          ))}
        </ul>,
        document.body
      )}
    </>
  )
}

function Input({ label, value, onChange, type = "text", required, hint }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={required}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
      />
      {hint && <p className="text-[11px] text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}
