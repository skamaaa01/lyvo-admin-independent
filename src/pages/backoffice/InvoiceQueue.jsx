/**
 * InvoiceQueue.jsx — Back office › Invoice reading queue.
 * ─────────────────────────────────────────────────────────────────────────
 * Invoices the AI read but could not clear wait here for a person. The list
 * shows only what is printed on the invoice (no customer, no shop). Opening
 * one claims it; the screen shows the photos on the left and the pre-read
 * lines on the right with the flagged ones highlighted. The reviewer fixes
 * quantities, prices, packs and missing lines against the paper, confirms
 * each flagged line and the document, and completes it: it posts itself on
 * the client's side, or goes back to the client for product mapping only.
 *
 *   GET    /api/admin/invoice-queue?status=waiting|claimed|mine|done
 *   GET    /api/admin/invoice-queue/:id          · /:id/files/:fileId (blob)
 *   POST   /api/admin/invoice-queue/:id/claim    · /:id/release · /:id/complete
 *   PUT    /api/admin/invoice-queue/:id          header · { verify_reading, reading_fingerprint, reading_note }
 *   POST   /api/admin/invoice-queue/:id/lines    · PUT /:id/lines/:lineId · DELETE /:id/lines/:lineId
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Routes, Route, Link, useNavigate, useParams } from "react-router-dom"
import { FiInbox, FiRefreshCw, FiArrowLeft, FiCheck, FiAlertTriangle, FiHelpCircle, FiZoomIn, FiZoomOut, FiPlus, FiTrash2, FiSave, FiCheckCircle, FiUnlock, FiClock } from "react-icons/fi"
import axios from "../../axiosConfig"
import { boInvoiceQueueURL } from "../../routes/Url"
import { boPath } from "./boPath"
import toast from "../../utils/toast"

const fmtMoney = (v) => (v == null || v === "" ? "—" : `£${Number(v).toFixed(2)}`)
const fmtDate = (v) => (v ? String(v).slice(0, 10) : "—")
const errMsg = (e, fb = "Something went wrong") => e?.response?.data?.message || e?.message || fb
const inputCls = "w-full px-2 py-1.5 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 bg-white"
const btn = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
const btnPrimary = `${btn} bg-orange-500 text-white hover:bg-orange-600`
const btnSecondary = `${btn} bg-white border border-gray-200 text-gray-700 hover:bg-gray-50`

export default function InvoiceQueue({ user }) {
  return (
    <Routes>
      <Route index element={<QueueList user={user} />} />
      <Route path=":id" element={<QueueReview user={user} />} />
    </Routes>
  )
}

/* ── List ─────────────────────────────────────────────────────────────────── */

function QueueList() {
  const navigate = useNavigate()
  const [status, setStatus] = useState("waiting")
  const [rows, setRows] = useState([])
  const [summary, setSummary] = useState({ waiting: 0, claimed: 0 })
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await axios.get(boInvoiceQueueURL, { params: { status } })
      setRows(r.data?.data || []); setSummary(r.data?.summary || { waiting: 0, claimed: 0 })
    } catch (e) { toast.error(errMsg(e)) } finally { setLoading(false) }
  }, [status])
  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect
  useEffect(() => { const id = setInterval(load, 30000); return () => clearInterval(id) }, [load])

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2"><FiInbox /> Invoice reading queue</h1>
          <p className="text-sm text-gray-500">Invoices the reader could not clear. Waiting {summary.waiting} · being reviewed {summary.claimed}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 overflow-hidden text-xs">
            {[["waiting", "Waiting"], ["mine", "Mine"], ["claimed", "Being reviewed"], ["done", "Done"]].map(([k, label]) => (
              <button key={k} type="button" onClick={() => setStatus(k)} className={`px-3 py-1.5 cursor-pointer ${status === k ? "bg-orange-500 text-white font-semibold" : "bg-white text-gray-600 hover:bg-gray-50"}`}>{label}</button>
            ))}
          </div>
          <button type="button" onClick={load} className="p-2 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 cursor-pointer"><FiRefreshCw size={14} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-gray-400">{loading ? "Loading…" : "Nothing here"}</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-gray-50/60 text-[11px] uppercase tracking-wider text-gray-500">
              <tr>
                <th className="text-left px-4 py-2.5">Supplier (as printed)</th>
                <th className="text-left px-4 py-2.5">Invoice no.</th>
                <th className="text-left px-4 py-2.5">Date</th>
                <th className="text-right px-4 py-2.5">Net</th>
                <th className="text-right px-4 py-2.5">Pages</th>
                <th className="text-right px-4 py-2.5">Lines</th>
                <th className="text-right px-4 py-2.5">Flagged</th>
                <th className="text-left px-4 py-2.5">Waiting</th>
                <th className="text-left px-4 py-2.5">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r._id} onClick={() => navigate(boPath(`/invoice-queue/${r._id}`))} className="border-t border-gray-50 hover:bg-orange-50/40 cursor-pointer">
                  <td className="px-4 py-3 font-medium text-gray-800">{r.supplier_name || "—"}</td>
                  <td className="px-4 py-3 font-mono text-xs">{r.invoice_number || "—"}</td>
                  <td className="px-4 py-3">{fmtDate(r.invoice_date)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{fmtMoney(r.net_total)}</td>
                  <td className="px-4 py-3 text-right">{r.pages}</td>
                  <td className="px-4 py-3 text-right">{r.lines}</td>
                  <td className="px-4 py-3 text-right">{r.flagged_lines > 0 ? <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold">{r.flagged_lines}</span> : <span className="text-gray-300">0</span>}</td>
                  <td className="px-4 py-3 text-xs text-gray-500"><FiClock className="inline mr-1" size={11} />{r.waiting_minutes == null ? "—" : r.waiting_minutes < 60 ? `${r.waiting_minutes} min` : `${Math.round(r.waiting_minutes / 60)} h`}</td>
                  <td className="px-4 py-3 text-xs">{r.queue?.status === "claimed" ? <span className="text-blue-700">{r.queue.claimed_by_name || "claimed"}</span> : r.queue?.status === "done" ? <span className="text-green-700">{r.queue.outcome}</span> : <span className="text-gray-500">{r.queue?.status || "—"}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

/* ── Review ───────────────────────────────────────────────────────────────── */

function QueueReview({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [view, setView] = useState(null)
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState(null)
  const base = `${boInvoiceQueueURL}/${id}`
  const mine = !!view && view.queue?.status === "claimed" && String(view.queue.claimed_by) === String(user?._id || user?.id)
  const active = !!view && ["waiting", "claimed"].includes(view.queue?.status)

  const load = useCallback(async () => {
    try { const r = await axios.get(base); setView(r.data?.data || null); setError(null) }
    catch (e) { setError(errMsg(e)) }
  }, [base])
  useEffect(() => { load() }, [load]) // eslint-disable-line react-hooks/set-state-in-effect

  const call = async (label, fn, okMsg) => {
    setBusy(label)
    try { const r = await fn(); if (r?.data?.data) setView(r.data.data); if (okMsg) toast.success(okMsg); return r }
    catch (e) { toast.error(errMsg(e)); if (e?.response?.status === 409 && /left the queue|not in the queue/i.test(errMsg(e))) load(); throw e }
    finally { setBusy(null) }
  }
  const claim = () => call("claim", () => axios.post(`${base}/claim`, {}), "Claimed").catch(() => {})
  const release = () => call("release", () => axios.post(`${base}/release`, {})).catch(() => {})
  const complete = () => call("complete", () => axios.post(`${base}/complete`, {})).then((r) => {
    const o = r?.data?.outcome
    toast.success(o === "posted" ? "Posted on the client's side" : "Returned to the client for product mapping")
    navigate(boPath("/invoice-queue"))
  }).catch(() => {})

  if (error) return <div className="p-6"><Link to={boPath("/invoice-queue")} className="text-sm text-gray-500"><FiArrowLeft className="inline" /> Back</Link><div className="mt-4 p-4 rounded-xl bg-red-50 text-red-700 text-sm">{error}</div></div>
  if (!view) return <div className="p-6 text-sm text-gray-400">Loading…</div>

  const rr = view.extraction?.reading_review || {}
  const issues = rr.issues || []
  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1700px] mx-auto">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <Link to={boPath("/invoice-queue")} className="text-sm text-gray-500 hover:text-orange-600"><FiArrowLeft className="inline" /> Queue</Link>
          <h1 className="text-lg font-bold text-gray-800">{view.supplier_name || "Invoice"} <span className="font-mono text-gray-400">#{view.invoice_number || "?"}</span></h1>
          <StatusPill view={view} />
        </div>
        <div className="flex items-center gap-2">
          {active && !mine && <button type="button" className={btnPrimary} disabled={busy} onClick={claim}><FiCheck /> {view.queue?.status === "claimed" ? `Take over from ${view.queue.claimed_by_name}` : "Claim"}</button>}
          {mine && <button type="button" className={btnSecondary} disabled={busy} onClick={release}><FiUnlock /> Release</button>}
          {mine && <button type="button" className={btnPrimary} disabled={busy || view.blocked_lines > 0 || rr.required} title={view.blocked_lines > 0 ? "Confirm the flagged lines first" : rr.required ? "Confirm the document first" : undefined} onClick={complete}><FiCheckCircle /> Complete</button>}
        </div>
      </div>

      {!active && <div className="rounded-xl bg-gray-50 border border-gray-200 px-4 py-2 text-sm text-gray-600">This invoice is no longer in the queue ({view.queue?.outcome === "client_took_over" ? "the client continued it themselves" : view.queue?.outcome || view.queue?.status}).</div>}
      {active && !mine && <div className="rounded-xl bg-blue-50 border border-blue-100 px-4 py-2 text-sm text-blue-800">Claim the invoice to edit and confirm lines.</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(380px,44%)_1fr] gap-4 items-start">
        <PhotoPane base={base} files={view.files || []} />

        <div className="space-y-4">
          <HeaderCard view={view} mine={mine} busy={busy} call={call} base={base} />
          <LinesCard view={view} mine={mine} busy={busy} call={call} base={base} />
          <DocumentCard view={view} issues={issues} rr={rr} mine={mine} busy={busy} call={call} base={base} />
          {view.extraction?.transcript && (
            <details className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 text-xs">
              <summary className="cursor-pointer font-semibold text-gray-700">What the reader transcribed</summary>
              <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] text-gray-600 max-h-96 overflow-auto">{view.extraction.transcript}</pre>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}

function StatusPill({ view }) {
  const q = view.queue || {}
  const cls = q.status === "claimed" ? "bg-blue-100 text-blue-700" : q.status === "waiting" ? "bg-amber-100 text-amber-800" : "bg-gray-100 text-gray-600"
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold ${cls}`}>{q.status === "claimed" ? `Reviewing · ${q.claimed_by_name}` : q.status || view.status}</span>
}

/* ── Photos ───────────────────────────────────────────────────────────────── */

function PhotoPane({ base, files }) {
  const [active, setActive] = useState(0)
  const [urls, setUrls] = useState({})
  const [zoom, setZoom] = useState(1)
  const ref = useRef({})
  useEffect(() => {
    let cancelled = false
    files.forEach((f) => {
      if (ref.current[f._id]) return
      axios.get(`${base}/files/${f._id}`, { responseType: "blob" }).then((r) => {
        if (cancelled) return
        const u = URL.createObjectURL(r.data); ref.current[f._id] = u; setUrls((m) => ({ ...m, [f._id]: u }))
      }).catch(() => {})
    })
    return () => { cancelled = true }
  }, [base, files])
  useEffect(() => () => { Object.values(ref.current).forEach((u) => URL.revokeObjectURL(u)); ref.current = {} }, [])
  const f = files[active]
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden xl:sticky xl:top-4">
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-100">
        <div className="flex gap-1 overflow-x-auto">
          {files.map((x, i) => <button key={x._id} type="button" onClick={() => setActive(i)} className={`px-2.5 py-1 rounded-lg text-xs whitespace-nowrap cursor-pointer ${i === active ? "bg-orange-500 text-white font-semibold" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>Page {i + 1}</button>)}
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setZoom((z) => Math.max(1, z - 0.5))} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer"><FiZoomOut size={14} /></button>
          <span className="text-xs text-gray-500 w-10 text-center">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={() => setZoom((z) => Math.min(4, z + 0.5))} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 cursor-pointer"><FiZoomIn size={14} /></button>
        </div>
      </div>
      <div className="overflow-auto max-h-[85vh] bg-gray-100">
        {f && (f.file_type === "application/pdf"
          ? (urls[f._id] ? <iframe title={f.file_name} src={urls[f._id]} className="w-full h-[85vh]" /> : <div className="p-6 text-xs text-gray-400">Loading…</div>)
          : (urls[f._id] ? <img src={urls[f._id]} alt={f.file_name} style={{ width: `${zoom * 100}%`, maxWidth: "none" }} className="block" /> : <div className="p-6 text-xs text-gray-400">Loading…</div>))}
      </div>
    </div>
  )
}

/* ── Header ───────────────────────────────────────────────────────────────── */

function HeaderCard({ view, mine, busy, call, base }) {
  const initial = useMemo(() => ({ invoice_number: view.invoice_number || "", invoice_date: fmtDate(view.invoice_date) === "—" ? "" : fmtDate(view.invoice_date), net_total: view.net_total ?? "", vat_total: view.vat_total ?? "", gross_total: view.gross_total ?? "" }), [view])
  const [d, setD] = useState(initial)
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) { setSeen(initial); setD(initial) }
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const save = () => call("header", () => axios.put(base, d), "Header saved").catch(() => {})
  const t = view.totals || {}
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-800">Invoice header</h2>
        {mine && dirty && <button type="button" className={btnPrimary} disabled={busy} onClick={save}><FiSave /> Save header</button>}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[["invoice_number", "Invoice no.", "text"], ["invoice_date", "Date", "date"], ["net_total", "Net", "text"], ["vat_total", "VAT", "text"], ["gross_total", "Total", "text"]].map(([k, label, type]) => (
          <label key={k} className="text-xs text-gray-500">{label}
            <input type={type} className={`${inputCls} mt-1`} value={d[k]} disabled={!mine} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} />
          </label>
        ))}
      </div>
      <div className="mt-2 text-xs text-gray-500">Lines net: <span className="font-semibold tabular-nums">{fmtMoney(t.lines_net)}</span>
        {view.totals_mismatch && <span className="ml-2 text-amber-700"><FiAlertTriangle className="inline" size={11} /> does not match the printed net — check the lines or the header</span>}
      </div>
    </div>
  )
}

/* ── Lines ────────────────────────────────────────────────────────────────── */

function LinesCard({ view, mine, busy, call, base }) {
  const [adding, setAdding] = useState(false)
  const [add, setAdd] = useState({ original_description: "", supplier_sku: "", invoice_qty: "1", purchase_unit: "", net_unit_price: "", net_line_total: "" })
  const submitAdd = () => call("add", () => axios.post(`${base}/lines`, add), "Line added").then(() => { setAdding(false); setAdd({ original_description: "", supplier_sku: "", invoice_qty: "1", purchase_unit: "", net_unit_price: "", net_line_total: "" }) }).catch(() => {})
  const flagged = view.lines.filter((l) => l.reading_blocked).length
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div>
          <h2 className="font-semibold text-gray-800">Lines</h2>
          <p className="text-xs text-gray-500">{view.lines.length} read · {flagged > 0 ? <span className="text-amber-700 font-semibold">{flagged} to confirm</span> : <span className="text-green-700">all confirmed</span>}{view.unknown_products > 0 && <span> · {view.unknown_products} product{view.unknown_products === 1 ? "" : "s"} the client will need to map</span>}</p>
        </div>
        {mine && <button type="button" className={btnSecondary} onClick={() => setAdding((a) => !a)}><FiPlus /> Missing line</button>}
      </div>
      {adding && (
        <div className="p-3 border-b border-gray-100 bg-orange-50/40 grid grid-cols-2 md:grid-cols-6 gap-2 items-end text-xs">
          <label className="md:col-span-2">Description as printed<input className={`${inputCls} mt-1`} value={add.original_description} onChange={(e) => setAdd((a) => ({ ...a, original_description: e.target.value }))} autoFocus /></label>
          <label>Code<input className={`${inputCls} mt-1`} value={add.supplier_sku} onChange={(e) => setAdd((a) => ({ ...a, supplier_sku: e.target.value }))} /></label>
          <label>Qty<input className={`${inputCls} mt-1`} value={add.invoice_qty} onChange={(e) => setAdd((a) => ({ ...a, invoice_qty: e.target.value }))} /></label>
          <label>Unit price<input className={`${inputCls} mt-1`} value={add.net_unit_price} onChange={(e) => setAdd((a) => ({ ...a, net_unit_price: e.target.value }))} /></label>
          <div className="flex gap-2"><button type="button" className={btnPrimary} disabled={busy || !add.original_description.trim()} onClick={submitAdd}>Add</button><button type="button" className={btnSecondary} onClick={() => setAdding(false)}>Cancel</button></div>
        </div>
      )}
      <table className="w-full text-sm">
        <thead className="bg-gray-50/60 text-[11px] uppercase tracking-wider text-gray-500">
          <tr>
            <th className="text-left px-3 py-2">#</th>
            <th className="text-left px-3 py-2">Description · code</th>
            <th className="text-right px-3 py-2">Qty</th>
            <th className="text-left px-3 py-2">Pack</th>
            <th className="text-right px-3 py-2">Unit price</th>
            <th className="text-right px-3 py-2">Line total</th>
            <th className="text-left px-3 py-2">Check</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {view.lines.map((l) => <LineRow key={l._id} line={l} mine={mine} busy={busy} call={call} base={base} />)}
        </tbody>
      </table>
    </div>
  )
}

function LineRow({ line, mine, busy, call, base }) {
  const initial = useMemo(() => ({
    original_description: line.original_description || "", supplier_sku: line.supplier_sku || "",
    invoice_qty: line.invoice_qty ?? "", purchase_unit: line.purchase_unit || "",
    pack_qty: line.pack?.pack_qty ?? "", unit_size: line.pack?.unit_size ?? "", unit_size_uom: line.pack?.unit_size_uom || "",
    net_unit_price: line.net_unit_price ?? "", net_line_total: line.net_line_total ?? "",
  }), [line])
  const [d, setD] = useState(initial)
  const [note, setNote] = useState("")
  const [seen, setSeen] = useState(initial)
  if (seen !== initial) { setSeen(initial); setD(initial) }
  const dirty = JSON.stringify(d) !== JSON.stringify(initial)
  const flagged = !!line.reading_blocked
  const save = () => {
    const body = {}
    for (const k of Object.keys(d)) if (d[k] !== initial[k]) body[k] = d[k] === "" ? null : d[k]
    return call(`line-${line._id}`, () => axios.put(`${base}/lines/${line._id}`, body), "Line saved").catch(() => {})
  }
  const confirm = () => call(`verify-${line._id}`, () => axios.put(`${base}/lines/${line._id}`, { verify_reading: true, reading_fingerprint: line.reading_fingerprint, reading_note: note }), "Line confirmed").then(() => setNote("")).catch(() => {})
  const remove = () => { if (window.confirm("Remove this line? Only do this if it is not printed on the invoice.")) call(`delete-${line._id}`, () => axios.delete(`${base}/lines/${line._id}`), "Line removed").catch(() => {}) }
  const rowCls = flagged ? "bg-amber-50/70" : line.reading_verified ? "bg-green-50/40" : ""
  const cell = (k, cls = "w-20 text-right") => <input className={`${inputCls} ${cls}`} value={d[k]} disabled={!mine} onChange={(e) => setD((x) => ({ ...x, [k]: e.target.value }))} />
  return (
    <>
      <tr className={`border-t border-gray-100 align-top ${rowCls}`}>
        <td className="px-3 py-2 text-gray-400">{line.line_no}</td>
        <td className="px-3 py-2 min-w-[220px]">
          {cell("original_description", "w-full font-mono text-xs")}
          <div className="flex gap-1 mt-1 items-center">{cell("supplier_sku", "w-28 text-xs")}<span className="text-[11px] text-gray-400">{line.known_product ? "known product" : "new product"}{line.line_kind && line.line_kind !== "product" ? ` · ${line.line_kind}` : ""}</span></div>
        </td>
        <td className="px-3 py-2"><div className="flex gap-1 justify-end">{cell("invoice_qty")}{cell("purchase_unit", "w-16 text-xs")}</div></td>
        <td className="px-3 py-2"><div className="flex gap-1 items-center text-xs">{cell("pack_qty", "w-14 text-right")}<span>×</span>{cell("unit_size", "w-16 text-right")}<select className={`${inputCls} w-16`} value={d.unit_size_uom} disabled={!mine} onChange={(e) => setD((x) => ({ ...x, unit_size_uom: e.target.value }))}><option value="">—</option>{["each", "g", "kg", "ml", "l"].map((u) => <option key={u} value={u}>{u}</option>)}</select></div>{line.pack_text && <div className="text-[11px] text-gray-400 mt-1">printed: {line.pack_text}</div>}</td>
        <td className="px-3 py-2">{cell("net_unit_price")}</td>
        <td className="px-3 py-2">{cell("net_line_total", "w-24 text-right font-semibold")}</td>
        <td className="px-3 py-2 text-xs max-w-[260px]">
          {line.check_status === "failed" && <div className="text-red-700 flex items-start gap-1"><FiAlertTriangle size={11} className="mt-0.5 shrink-0" /> <span>{line.check_reason}</span></div>}
          {line.read_agreement === "disagree" && <div className="text-amber-700 flex items-start gap-1 mt-1"><FiHelpCircle size={11} className="mt-0.5 shrink-0" /> <span>{line.read_note}</span></div>}
          {!flagged && line.reading_verified && <div className="text-green-700"><FiCheck className="inline" size={11} /> confirmed</div>}
          {!flagged && !line.reading_verified && line.check_status !== "failed" && line.read_agreement !== "disagree" && <span className="text-gray-400">ok</span>}
        </td>
        <td className="px-2 py-2 whitespace-nowrap">
          {mine && dirty && <button type="button" className={`${btnPrimary} px-2 py-1 text-xs`} disabled={busy} onClick={save}><FiSave size={12} /> Save</button>}
          {mine && !dirty && line.status !== "posted" && <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 cursor-pointer" title="Remove line" onClick={remove}><FiTrash2 size={13} /></button>}
        </td>
      </tr>
      {(flagged || line.source_rows?.length > 0) && (
        <tr className={rowCls}>
          <td></td>
          <td colSpan={7} className="px-3 pb-3">
            {line.source_rows?.length > 0 && (
              <div className="text-[11px] text-gray-500 mb-2"><span className="text-gray-400">Printed rows the reader used:</span>{line.source_rows.map((r, i) => <code key={i} className="block font-mono text-gray-700 whitespace-pre-wrap">{r}</code>)}</div>
            )}
            {flagged && mine && (
              <div className="flex items-center gap-2 flex-wrap">
                <input className={`${inputCls} max-w-md`} placeholder="What did you check or correct? (e.g. page 2: 4 × 9.71 as printed)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
                <button type="button" className={btnPrimary} disabled={busy || dirty || note.trim().length < 5} title={dirty ? "Save the corrections first" : undefined} onClick={confirm}><FiCheck /> Confirm line</button>
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}

/* ── Document sign-off ───────────────────────────────────────────────────── */

function DocumentCard({ view, issues, rr, mine, busy, call, base }) {
  const [note, setNote] = useState("")
  const verify = () => call("verify-doc", () => axios.put(base, { verify_reading: true, reading_fingerprint: rr.fingerprint, reading_note: note }), "Document confirmed").then(() => setNote("")).catch(() => {})
  return (
    <div className={`rounded-2xl border shadow-sm p-4 ${rr.required ? "bg-amber-50/50 border-amber-200" : "bg-white border-gray-100"}`}>
      <h2 className="font-semibold text-gray-800 flex items-center gap-2">{rr.verified ? <FiCheckCircle className="text-green-600" /> : <FiAlertTriangle className="text-amber-600" />} Whole document {rr.verified ? "confirmed" : rr.required ? "— needs confirming" : ""}</h2>
      {issues.length > 0 && <ul className="list-disc pl-5 mt-2 text-xs text-gray-700 space-y-0.5">{issues.map((x, i) => <li key={i}>{x}</li>)}</ul>}
      {rr.required && mine && (
        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <input className={`${inputCls} max-w-md`} placeholder="What did you check? (e.g. all 3 pages, 22 lines, totals agree)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} />
          <button type="button" className={btnPrimary} disabled={busy || view.blocked_lines > 0 || note.trim().length < 5} title={view.blocked_lines > 0 ? "Confirm the flagged lines first" : undefined} onClick={verify}><FiCheck /> Confirm document</button>
        </div>
      )}
    </div>
  )
}
