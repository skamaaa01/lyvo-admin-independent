import { useEffect, useState } from "react"
import axios from "../../axiosConfig"
import { boCampaignsURL } from "../../routes/Url"

const TYPE_LABEL = {
  discount_pct: "% off",
  discount_fixed: "Fixed £ off",
  trial_extension: "Trial extension",
  free_months: "Free months",
  first_month_special: "First-month special",
}

export default function Campaigns({ user }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState(null)
  const [abuse, setAbuse] = useState(null)

  const reload = () =>
    axios.get(boCampaignsURL, { _silentToast: true })
      .then(({ data }) => { setItems(data.items); setLoading(false) })

  useEffect(() => { reload() }, [])

  const openDeepDive = async (id) => {
    const { data } = await axios.get(`${boCampaignsURL}/${id}`, { _silentToast: true })
    setSelected(data)
  }

  const showAbuse = async () => {
    const { data } = await axios.get(`${boCampaignsURL}/abuse`, { _silentToast: true })
    setAbuse(data)
  }

  const canEdit = user?.role === "admin"

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Campaigns</h1>
        <div className="flex gap-2">
          <button onClick={showAbuse} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Anti-abuse</button>
          {canEdit && <button onClick={() => setCreating(true)} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600">+ New campaign</button>}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="text-left px-4 py-2.5">Name</th><th className="text-left px-4 py-2.5">Type</th>
              <th className="text-left px-4 py-2.5">Codes</th><th className="text-left px-4 py-2.5">Used</th>
              <th className="text-left px-4 py-2.5">Conv %</th><th className="text-left px-4 py-2.5">Revenue</th>
              <th className="text-left px-4 py-2.5">ROAS</th><th className="text-left px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {items.map(c => (
              <tr key={c._id} className="hover:bg-orange-50/30 cursor-pointer" onClick={() => openDeepDive(c._id)}>
                <td className="px-4 py-2.5 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-2.5 text-gray-700 text-xs">{TYPE_LABEL[c.type] || c.type} · {c.value}{c.type === "discount_pct" ? "%" : ""}</td>
                <td className="px-4 py-2.5">{c.codes || 0}</td>
                <td className="px-4 py-2.5">{c.used || 0}</td>
                <td className="px-4 py-2.5">{c.conversionPct || 0}%</td>
                <td className="px-4 py-2.5">£{c.revenue || 0}</td>
                <td className="px-4 py-2.5">{c.roas != null ? `${c.roas}×` : "—"}</td>
                <td className="px-4 py-2.5"><span className={`px-2 py-0.5 rounded text-xs font-medium ${c.status === "active" ? "bg-emerald-50 text-emerald-700" : c.status === "paused" ? "bg-amber-50 text-amber-700" : "bg-gray-100 text-gray-600"}`}>{c.status}</span></td>
              </tr>
            ))}
            {items.length === 0 && <tr><td colSpan="8" className="px-4 py-10 text-center text-gray-400 text-sm">No campaigns yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {creating && <CreateCampaignModal onClose={() => setCreating(false)} onCreated={() => { setCreating(false); reload() }} />}
      {selected && <CampaignDeepDive data={selected} onClose={() => setSelected(null)} onChange={() => { reload(); openDeepDive(selected.campaign._id) }} canEdit={canEdit} />}
      {abuse && <AbuseModal data={abuse} onClose={() => setAbuse(null)} />}
    </div>
  )
}

function CreateCampaignModal({ onClose, onCreated }) {
  const [form, setForm] = useState({
    name: "",
    type: "discount_pct",
    value: 20,
    codeMode: "bulk",
    codeCount: 100,
    codePrefix: "",
    namedCode: "",
    durationMonths: 1,
    totalCost: 0,
    maxUsesPerCustomer: 1,
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")

  const submit = async () => {
    setBusy(true); setErr("")
    try {
      await axios.post(boCampaignsURL, form)
      onCreated()
    } catch (e) { setErr(e.response?.data?.message || "Failed") }
    finally { setBusy(false) }
  }

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  return (
    <Modal onClose={onClose} title="New campaign">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Name"><input value={form.name} onChange={(e) => set("name", e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" /></Field>
        <Field label="Type">
          <select value={form.type} onChange={(e) => set("type", e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm">
            <option value="discount_pct">% discount</option>
            <option value="discount_fixed">Fixed £ off (pence)</option>
            <option value="trial_extension">Trial extension (days)</option>
            <option value="free_months">Free months</option>
            <option value="first_month_special">First-month special (pence)</option>
          </select>
        </Field>
        <Field label="Value"><input type="number" value={form.value} onChange={(e) => set("value", +e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" /></Field>
        <Field label="Duration (months)"><input type="number" value={form.durationMonths} onChange={(e) => set("durationMonths", +e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" /></Field>
        <Field label="Code mode">
          <select value={form.codeMode} onChange={(e) => set("codeMode", e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm">
            <option value="bulk">Bulk (auto-generated)</option>
            <option value="single_use_named">Single-use named</option>
            <option value="multi_use_named">Multi-use named</option>
          </select>
        </Field>
        {form.codeMode === "bulk" && (
          <>
            <Field label="Code count"><input type="number" value={form.codeCount} onChange={(e) => set("codeCount", +e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" /></Field>
            <Field label="Prefix (optional)"><input value={form.codePrefix} onChange={(e) => set("codePrefix", e.target.value.toUpperCase())} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" placeholder="LETTER" /></Field>
          </>
        )}
        {(form.codeMode === "single_use_named" || form.codeMode === "multi_use_named") && (
          <Field label="Named code" wide><input value={form.namedCode} onChange={(e) => set("namedCode", e.target.value.toUpperCase())} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" placeholder="PARTNER-SAGE" /></Field>
        )}
        <Field label="Max uses per customer"><input type="number" value={form.maxUsesPerCustomer} onChange={(e) => set("maxUsesPerCustomer", +e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" /></Field>
        <Field label="Total cost (£)"><input type="number" value={form.totalCost} onChange={(e) => set("totalCost", +e.target.value)} className="w-full px-2.5 py-1.5 border border-gray-200 rounded text-sm" /></Field>
      </div>
      {err && <div className="mt-3 text-red-600 text-xs">{err}</div>}
      <div className="mt-4 flex justify-end gap-2">
        <button onClick={onClose} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm">Cancel</button>
        <button onClick={submit} disabled={busy} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-sm font-medium disabled:opacity-50">{busy ? "Creating…" : "Create"}</button>
      </div>
    </Modal>
  )
}

function CampaignDeepDive({ data, onClose, onChange, canEdit }) {
  const c = data.campaign
  const exportUrl = `${boCampaignsURL}/${c._id}/export.csv`
  const setStatus = async (status) => {
    await axios.patch(`${boCampaignsURL}/${c._id}`, { status })
    onChange()
  }
  const remove = async () => {
    if (!confirm(`Delete "${c.name}" and all ${data.codes.length}+ codes?`)) return
    await axios.delete(`${boCampaignsURL}/${c._id}`)
    onClose()
    onChange()
  }
  return (
    <Modal onClose={onClose} title={c.name} wide>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 text-sm">
        <Stat label="Type" value={TYPE_LABEL[c.type] || c.type} />
        <Stat label="Value" value={`${c.value}${c.type === "discount_pct" ? "%" : ""}`} />
        <Stat label="Status" value={c.status} />
        <Stat label="Total cost" value={`£${c.totalCost || 0}`} />
        <Stat label="Generated" value={data.funnel.generated} />
        <Stat label="Entered" value={data.funnel.entered} />
        <Stat label="Converted" value={data.funnel.converted} />
        <Stat label="Revenue" value={`£${data.funnel.revenue}`} />
      </div>

      <div className="flex gap-2 mb-3">
        <a href={exportUrl} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Download codes CSV</a>
        {canEdit && c.status === "active" && <button onClick={() => setStatus("paused")} className="px-3 py-1.5 rounded-lg border border-amber-200 text-amber-700 text-sm hover:bg-amber-50">Pause</button>}
        {canEdit && c.status !== "active" && <button onClick={() => setStatus("active")} className="px-3 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 text-sm hover:bg-emerald-50">Activate</button>}
        {canEdit && <button onClick={() => setStatus("ended")} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">End</button>}
        {canEdit && <button onClick={remove} className="ml-auto px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50">Delete</button>}
      </div>

      <h4 className="text-sm font-semibold text-gray-700 mb-2">Codes (showing first 500)</h4>
      <div className="max-h-72 overflow-auto border border-gray-100 rounded-lg">
        <table className="w-full text-xs">
          <thead className="bg-gray-50">
            <tr><th className="text-left px-2 py-1">Code</th><th className="text-left px-2 py-1">Status</th><th className="text-left px-2 py-1">Uses</th><th className="text-left px-2 py-1">First redeemed</th></tr>
          </thead>
          <tbody>
            {data.codes.map(co => (
              <tr key={co._id} className="border-t border-gray-50">
                <td className="px-2 py-1 font-mono">{co.code}</td>
                <td className="px-2 py-1">{co.redemptions.length > 0 ? "used" : "unused"}</td>
                <td className="px-2 py-1">{co.redemptions.length}</td>
                <td className="px-2 py-1 text-gray-500">{co.redemptions[0]?.redeemedAt ? new Date(co.redemptions[0].redeemedAt).toLocaleString() : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  )
}

function AbuseModal({ data, onClose }) {
  return (
    <Modal onClose={onClose} title="Anti-abuse signals" wide>
      <p className="text-xs text-gray-500 mb-4">Surfaced for manual review only — never auto-blocked.</p>
      <h4 className="text-sm font-semibold mb-2">Same IP, multiple redemptions</h4>
      <ul className="text-xs space-y-1 mb-4 max-h-40 overflow-auto">
        {data.multiUseSameIp.length === 0 && <li className="text-gray-400">None.</li>}
        {data.multiUseSameIp.map(b => (<li key={b.ip}><span className="font-mono">{b.ip}</span> — {b.count} redemptions</li>))}
      </ul>
      <h4 className="text-sm font-semibold mb-2">Same payment card, multiple redemptions</h4>
      <ul className="text-xs space-y-1">
        {data.multiUseSameCard.length === 0 && <li className="text-gray-400">None (Stripe fingerprint linkage not yet wired).</li>}
        {data.multiUseSameCard.map(b => (<li key={b.fingerprint}><span className="font-mono">{b.fingerprint}</span> — {b.count} redemptions</li>))}
      </ul>
    </Modal>
  )
}

function Modal({ onClose, title, children, wide }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className={`bg-white rounded-2xl p-5 ${wide ? "max-w-4xl" : "max-w-xl"} w-full max-h-[90vh] overflow-auto`} onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-lg font-bold text-gray-900">{title}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children, wide }) {
  return (
    <label className={`block text-sm ${wide ? "col-span-2" : ""}`}>
      <span className="text-xs text-gray-500">{label}</span>
      <div className="mt-0.5">{children}</div>
    </label>
  )
}

function Stat({ label, value }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-[11px] uppercase text-gray-500">{label}</div>
      <div className="text-sm font-semibold text-gray-900">{value}</div>
    </div>
  )
}
