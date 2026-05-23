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
import { useEffect, useMemo, useState } from "react"
import axios from "../../axiosConfig"
import { boPlansURL, boPlansCatalogURL } from "../../routes/Url"
import { useConfirm } from "../../components/ConfirmDialog"

const KNOWN_TIERS = ["compliance", "control", "scale"]
// `features` is the WHITELIST of feature flags enabled for this plan;
// `history_days` is the per-plan retention cap (null = inherit from the
// code-map default for the plan's tier). Backend route-gate reads both
// from this row with a per-field fallback to config/planCapabilities.js.
const EMPTY = {
  name: "", description: "", price: 0, billingCycle: "monthly",
  features: [], limits: { shops: 1, users: 0, managers: 0 },
  history_days: null,
  isActive: true, isFree: false, trialDays: 30, color: "#6366f1",
  isPopular: false, stripePriceIdTest: "", stripePriceIdLive: "",
}

// Visual grouping for the feature checklist — purely a UI hint based on
// the code-map default tier; the operator can grant any combination per
// plan regardless of group.
const GROUP_META = {
  compliance: { label: "Compliance baseline (every tier by default)", dot: "bg-slate-400" },
  control:    { label: "Control & up",                                  dot: "bg-orange-400" },
  scale:      { label: "Scale-only",                                    dot: "bg-violet-400" },
}

export default function Plans({ user }) {
  const canEdit = user?.role === "admin"
  // useConfirm() returns { confirm, prompt } — destructure to get the
  // function. (Previously this was `const confirm = useConfirm()` which
  // made `confirm` the whole context object and would throw "confirm is
  // not a function" on the delete button too — latent bug, surfaced when
  // we added the empty-features confirm to the save flow.)
  const { confirm } = useConfirm()

  const [items, setItems]   = useState([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(null)   // plan object or "new" or null
  const [form, setForm]     = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)
  // Feature catalogue from /api/admin/plans/feature-catalog — { features: [{key,label,group,defaultTiers}], limits, hints }
  const [catalog, setCatalog] = useState(null)

  const reload = () =>
    axios.get(boPlansURL, { _silentToast: true })
      .then(({ data }) => { setItems(data.items || []); setLoading(false) })
      .catch(() => setLoading(false))

  useEffect(() => { reload() }, [])
  // Catalogue is static between deploys; fetch once and reuse for every
  // open of the editor. Failure leaves the checklist hidden with a hint,
  // not a hard error — the rest of the form still works.
  useEffect(() => {
    axios.get(boPlansCatalogURL, { _silentToast: true })
      .then(({ data }) => setCatalog(data))
      .catch(() => { /* non-fatal */ })
  }, [])

  // Pre-group features for the checklist so we can render Compliance /
  // Control / Scale sections without re-computing on every keystroke.
  const grouped = useMemo(() => {
    const out = { compliance: [], control: [], scale: [] }
    for (const f of (catalog?.features || [])) (out[f.group] || out.compliance).push(f)
    return out
  }, [catalog])

  const openNew  = () => { setForm(EMPTY); setEditing("new"); setErr(null) }
  const openEdit = (p) => {
    setForm({
      ...EMPTY, ...p,
      features: Array.isArray(p.features) ? p.features : [],
      limits: { shops: p.limits?.shops ?? 1, users: p.limits?.users ?? 0, managers: p.limits?.managers ?? 0 },
      history_days: p.history_days ?? null,
    })
    setEditing(p)
    setErr(null)
  }
  const close = () => { setEditing(null); setForm(EMPTY); setErr(null) }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const setLimit = (k, v) => setForm(f => ({ ...f, limits: { ...f.limits, [k]: v === "" ? "" : Number(v) } }))
  const toggleFeature = (key) => setForm(f => {
    const has = f.features.includes(key)
    return { ...f, features: has ? f.features.filter(x => x !== key) : [...f.features, key] }
  })

  const save = async () => {
    setErr(null)
    if (!form.name.trim()) return setErr("Name is required")
    if (form.price === "" || isNaN(Number(form.price))) return setErr("Price must be a number in pence (e.g. 2900 = £29.00)")

    // Empty features list now means STRICT zero (operator intent) — the
    // gate no longer silently inherits code-map defaults. Guard against
    // an accidental "unticked everything" save that would lock every
    // customer on this plan out of every module.
    if (Array.isArray(form.features) && form.features.length === 0) {
      const goAhead = await confirm(
        `You're about to save the "${form.name || "this"}" plan with ZERO features ticked. Every customer on this plan will lose access to ALL modules until features are added back. Continue?`,
        { title: "Save plan with no features?", confirmLabel: "Yes — save empty" },
      )
      if (!goAhead) return
    }

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
        // Blank string → null so the backend stores "inherit from code map"
        // rather than NaN. Numbers (incl. -1 = unlimited) pass through.
        history_days: form.history_days === null || form.history_days === ""
          ? null : Number(form.history_days),
        features: Array.isArray(form.features) ? form.features : [],
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

            <div className="grid grid-cols-2 gap-3">
              <Field label="Trial days">
                <input className={inputCls} type="number" min="0" value={form.trialDays} onChange={e => set("trialDays", e.target.value)} />
              </Field>
              <Field label="History retention (days) — blank = inherit, -1 = unlimited">
                <input
                  className={inputCls}
                  type="number"
                  min="-1"
                  value={form.history_days ?? ""}
                  onChange={e => set("history_days", e.target.value === "" ? null : Number(e.target.value))}
                  placeholder="inherit"
                />
              </Field>
            </div>

            {/* ── Feature checklist (DB-driven entitlements) ──────────
                Every feature flag enforceable on the route gate is listed
                here. Operator picks which ones THIS plan grants. If the
                list is empty the backend falls back to the code-map
                defaults for the plan's tier (safety floor — clearing the
                list will NOT lock customers out). */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-700">Plan features</p>
                <span className="text-[11px] text-gray-400">
                  {form.features.length === 0
                    ? "empty — inheriting code-map defaults"
                    : `${form.features.length} selected`}
                </span>
              </div>

              {!catalog && (
                <p className="text-xs text-gray-400 py-3">Loading feature catalogue…</p>
              )}

              {catalog && ["compliance", "control", "scale"].map(group => {
                if (!grouped[group]?.length) return null
                const m = GROUP_META[group]
                const onCount = grouped[group].filter(f => form.features.includes(f.key)).length
                return (
                  <div key={group} className="mb-3 border border-gray-100 rounded-xl overflow-hidden">
                    <div className="px-3 py-2 flex items-center gap-2 bg-gray-50 border-b border-gray-100">
                      <span className={`inline-block w-2 h-2 rounded-full ${m.dot}`} />
                      <span className="text-[11px] font-bold uppercase tracking-wider text-gray-600">{m.label}</span>
                      <span className="text-[10px] text-gray-400 ml-auto">{onCount} / {grouped[group].length}</span>
                    </div>
                    <div className="grid sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
                      {grouped[group].map(f => {
                        const checked = form.features.includes(f.key)
                        return (
                          <label key={f.key} className="flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50 transition-colors">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleFeature(f.key)}
                              className="mt-0.5 h-4 w-4 accent-orange-500"
                            />
                            <div className="min-w-0">
                              <p className="text-sm text-gray-800 leading-tight">{f.label}</p>
                              <p className="text-[10px] text-gray-400 font-mono mt-0.5 truncate">{f.key}</p>
                            </div>
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}

              <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
                <strong>Strict semantics:</strong> an empty list means <strong>zero features</strong> — every customer on this plan loses access to every module. Only the legacy case of a Plan row whose <code>features</code> field was never set falls back to code-map defaults. The editor will ask you to confirm before saving an empty list. Edits take effect on the very next request.
              </p>
            </div>

            {/* The whole reason this page originally existed */}
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
