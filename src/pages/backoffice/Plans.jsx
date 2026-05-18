/**
 * Back-office Plans & Pricing management.
 * ─────────────────────────────────────────────────────────────────────────
 * Edit subscription plans — price, limits, features, and the Stripe price
 * IDs (test + live) that were previously only settable directly in Mongo.
 *
 *   GET    /api/admin/plans        list
 *   POST   /api/admin/plans        create  (admin only)
 *   PATCH  /api/admin/plans/:id    update  (admin only)
 *   DELETE /api/admin/plans/:id    delete  (admin only)
 *
 * `name` MUST stay one of Compliance / Control / Scale (case-insensitive) —
 * the plan-gate resolves a tenant's tier from this name. The page warns if
 * a name strays from those so pricing edits can't silently break gating.
 */
import { useEffect, useState } from "react"
import axios from "../../axiosConfig"
import { boPlansURL } from "../../routes/Url"
import { useConfirm } from "../../components/ConfirmDialog"

const KNOWN_TIERS = ["compliance", "control", "scale"]
const EMPTY = {
  name: "", description: "", price: 0, billingCycle: "monthly",
  features: [], limits: { shops: 1, users: 0, managers: 0 },
  isActive: true, isFree: false, trialDays: 30, color: "#6366f1",
  isPopular: false, stripePriceIdTest: "", stripePriceIdLive: "",
}

export default function Plans({ user }) {
  const canEdit = user?.role === "admin"
  const confirm = useConfirm()

  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // plan object or "new" or null
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const reload = () =>
    axios.get(boPlansURL, { _silentToast: true })
      .then(({ data }) => { setItems(data.items || []); setLoading(false) })
      .catch(() => setLoading(false))

  useEffect(() => { reload() }, [])

  const openNew  = () => { setForm(EMPTY); setEditing("new"); setErr(null) }
  const openEdit = (p) => {
    setForm({
      ...EMPTY, ...p,
      features: Array.isArray(p.features) ? p.features : [],
      limits: { shops: p.limits?.shops ?? 1, users: p.limits?.users ?? 0, managers: p.limits?.managers ?? 0 },
    })
    setEditing(p)
    setErr(null)
  }
  const close = () => { setEditing(null); setForm(EMPTY); setErr(null) }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setLimit = (k, v) => setForm(f => ({ ...f, limits: { ...f.limits, [k]: v === "" ? "" : Number(v) } }))

  const save = async () => {
    setErr(null)
    if (!form.name.trim()) return setErr("Name is required")
    if (form.price === "" || isNaN(Number(form.price))) return setErr("Price must be a number in pence (e.g. 2900 = £29.00)")
    setSaving(true)
    try {
      const payload = {
        ...form,
        price: Number(form.price),
        trialDays: Number(form.trialDays) || 0,
        limits: {
          shops: Number(form.limits.shops),
          users: Number(form.limits.users),
          managers: Number(form.limits.managers),
        },
      }
      if (editing === "new") await axios.post(boPlansURL, payload, { _silentToast: true })
      else                   await axios.patch(`${boPlansURL}/${editing._id}`, payload, { _silentToast: true })
      close()
      setLoading(true)
      await reload()
    } catch (e) {
      setErr(e?.response?.data?.message || "Save failed")
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p) => {
    if (!await confirm(`Delete the "${p.name}" plan? This cannot be undone.`, { title: "Delete plan", confirmLabel: "Delete" })) return
    try {
      await axios.delete(`${boPlansURL}/${p._id}`, { _silentToast: true })
      setLoading(true); await reload()
    } catch (e) { /* axios toasts */ }
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="p-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Plans &amp; Pricing</h1>
          <p className="text-xs text-gray-400 mt-1">Price is in <strong>pence</strong> (2900 = £29.00). Stripe price IDs drive checkout + tier resolution.</p>
        </div>
        {canEdit && (
          <button onClick={openNew} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">
            + New plan
          </button>
        )}
      </div>

      {/* Plan cards */}
      <div className="grid gap-3">
        {items.map(p => {
          const tierOk = KNOWN_TIERS.includes(String(p.name).trim().toLowerCase())
          return (
            <div key={p._id} className="bg-white border border-gray-100 rounded-2xl p-4 flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-bold text-gray-900">{p.name}</span>
                  <span className="text-sm text-gray-500">£{(p.price / 100).toFixed(2)}/{p.billingCycle === "yearly" ? "yr" : "mo"}</span>
                  {p.isActive ? <Badge className="bg-green-100 text-green-700">Active</Badge> : <Badge className="bg-gray-200 text-gray-600">Inactive</Badge>}
                  {p.isPopular && <Badge className="bg-orange-100 text-orange-700">Popular</Badge>}
                  {!tierOk && <Badge className="bg-red-100 text-red-700">⚠ name not a known tier — gating may break</Badge>}
                </div>
                <div className="text-xs text-gray-500 mt-1.5 grid sm:grid-cols-2 gap-x-6 gap-y-0.5">
                  <span>Limits — shops: {p.limits?.shops ?? "—"}, users: {p.limits?.users ?? "—"}, managers: {p.limits?.managers ?? "—"}</span>
                  <span>Trial: {p.trialDays ?? 0} days</span>
                  <span className={p.stripePriceIdTest ? "text-gray-600" : "text-amber-600"}>
                    Test price ID: {p.stripePriceIdTest || "— not set —"}
                  </span>
                  <span className={p.stripePriceIdLive ? "text-gray-600" : "text-amber-600"}>
                    Live price ID: {p.stripePriceIdLive || "— not set —"}
                  </span>
                </div>
              </div>
              {canEdit && (
                <div className="flex flex-col gap-1.5">
                  <button onClick={() => openEdit(p)} className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-50">Edit</button>
                  <button onClick={() => remove(p)} className="px-3 py-1.5 text-xs font-semibold rounded-lg text-red-600 hover:bg-red-50">Delete</button>
                </div>
              )}
            </div>
          )
        })}
        {items.length === 0 && <div className="text-sm text-gray-400">No plans yet.</div>}
      </div>

      {/* Edit / create modal */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={close}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900">{editing === "new" ? "New plan" : `Edit ${editing.name}`}</h2>

            <Field label="Name (Compliance / Control / Scale)">
              <input className={inputCls} value={form.name} onChange={e => set("name", e.target.value)} placeholder="Control" />
              {form.name && !KNOWN_TIERS.includes(form.name.trim().toLowerCase()) && (
                <p className="text-xs text-red-600 mt-1">Tier gating resolves from this name — use Compliance, Control, or Scale unless you know what you're doing.</p>
              )}
            </Field>

            <Field label="Description">
              <input className={inputCls} value={form.description} onChange={e => set("description", e.target.value)} />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Price (pence)">
                <input className={inputCls} type="number" min="0" value={form.price} onChange={e => set("price", e.target.value)} />
                <p className="text-xs text-gray-400 mt-1">{form.price !== "" && !isNaN(Number(form.price)) ? `£${(Number(form.price) / 100).toFixed(2)}` : ""}</p>
              </Field>
              <Field label="Billing cycle">
                <select className={inputCls} value={form.billingCycle} onChange={e => set("billingCycle", e.target.value)}>
                  <option value="monthly">monthly</option>
                  <option value="yearly">yearly</option>
                </select>
              </Field>
            </div>

            <div className="grid grid-cols-3 gap-3">
              {["shops", "users", "managers"].map(k => (
                <Field key={k} label={`Limit: ${k} (-1 = ∞)`}>
                  <input className={inputCls} type="number" min="-1" value={form.limits[k]} onChange={e => setLimit(k, e.target.value)} />
                </Field>
              ))}
            </div>

            <Field label="Trial days">
              <input className={inputCls} type="number" min="0" value={form.trialDays} onChange={e => set("trialDays", e.target.value)} />
            </Field>

            {/* The whole reason this page exists */}
            <div className="border border-orange-200 bg-orange-50/50 rounded-xl p-3 space-y-3">
              <p className="text-xs font-bold text-orange-700">Stripe price IDs</p>
              <Field label="Test mode price ID (STRIPE_MODE=test)">
                <input className={inputCls} value={form.stripePriceIdTest} onChange={e => set("stripePriceIdTest", e.target.value)} placeholder="price_1AbcTest..." />
              </Field>
              <Field label="Live mode price ID (STRIPE_MODE=live)">
                <input className={inputCls} value={form.stripePriceIdLive} onChange={e => set("stripePriceIdLive", e.target.value)} placeholder="price_1XyzLive..." />
              </Field>
            </div>

            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isActive} onChange={e => set("isActive", e.target.checked)} className="accent-orange-500" /> Active
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={form.isPopular} onChange={e => set("isPopular", e.target.checked)} className="accent-orange-500" /> Popular
              </label>
            </div>

            {err && <div className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={close} className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={save} disabled={saving} className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const inputCls = "w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-400"
function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}
function Badge({ className = "", children }) {
  return <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full ${className}`}>{children}</span>
}
