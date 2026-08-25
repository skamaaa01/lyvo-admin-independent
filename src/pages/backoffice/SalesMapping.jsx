/**
 * SalesMapping.jsx — Back office › Customer Service › Sales CSV Mapping
 * (spec §6.6.1–§6.6.4, §8.1 steps 1–7; CONVENTIONS §5 `/api/admin/sales-mapping`).
 * ─────────────────────────────────────────────────────────────────────────
 * Onboarder tool: teach LYVO how a customer's POS / report CSV columns map
 * to the canonical Menu Catalogue / Daily Sales fields, test the mapping on
 * a sample file, activate it, and hand the customer the location's unique
 * inbound sales e-mail address.
 *
 * Endpoints (all back-office, requireRole admin|support):
 *   GET  /api/admin/customers?q=                         customer (tenant admin) search
 *   GET  /api/admin/sales-mapping/customers/:id/shops    shops of a customer (+ inbound / active-profile state)
 *   GET  /api/admin/sales-mapping/profiles?customer_id&shop_id&import_type&status&search&page&limit
 *   GET|PUT /api/admin/sales-mapping/profiles/:id · POST /profiles
 *   POST /api/admin/sales-mapping/profiles/:id/test      multipart "file"
 *   POST /api/admin/sales-mapping/profiles/:id/activate | /disable
 *   POST /api/admin/sales-mapping/csv/preview            multipart "file" + import_type/column_map/format/defaults
 *   GET  /api/admin/sales-mapping/shops/:shopId/inbound-address · POST …/regenerate
 *
 * This file is kept byte-identical between frontend/src/pages/backoffice and
 * admin-frontend/src/pages/backoffice except for the axiosConfig import path.
 * Back-office pages are English-only (no i18n) — see Campaigns.jsx.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import {
  FiUpload, FiSearch, FiX, FiCopy, FiRefreshCw, FiCheckCircle, FiAlertTriangle, FiLoader,
  FiPlus, FiMail, FiChevronLeft, FiChevronRight, FiLock, FiFileText, FiPlay, FiSave, FiZap, FiEye,
} from "react-icons/fi"
import axios from "../../axiosConfig"
import { boCustomersURL } from "../../routes/Url"
import { useConfirm } from "../../components/ConfirmDialog"
import toast from "../../utils/toast"

/* ── Constants ─────────────────────────────────────────────────────────── */

const SALES_MAPPING_URL = import.meta.env.VITE_BACKEND_URL + "/api/admin/sales-mapping"
const SM = SALES_MAPPING_URL
const PAGE_SIZE = 50

const IMPORT_TYPES = [
  { value: "menu_catalogue", label: "Menu Catalogue" },
  { value: "daily_sales", label: "Daily Sales" },
]
const IMPORT_LABEL = Object.fromEntries(IMPORT_TYPES.map((t) => [t.value, t.label]))

const SOURCES = [
  { value: "manual", label: "Manual upload" },
  { value: "email", label: "Inbound email" },
  { value: "both", label: "Manual + email" },
]
const SOURCE_LABEL = Object.fromEntries(SOURCES.map((s) => [s.value, s.label]))

const STATUSES = ["draft", "tested", "active", "disabled"]

// Canonical fields per import type — mirrors backend services/csvMapping.js FIELDS_BY_TYPE.
// The server's /csv/preview response carries `canonical_fields` + `required`; these are the fallback.
const FIELDS_BY_TYPE = {
  menu_catalogue: ["pos_code", "item_name", "price_ex_vat", "menu_category", "vat_rate"],
  daily_sales: ["pos_code", "item_name", "sale_date", "quantity_sold", "net_sales_total", "unit_price_ex_vat", "vat", "menu_category", "discount", "refund", "void"],
}

// Label + example transform hint per canonical field (spec §6.6.3 table).
const FIELD_META = {
  pos_code: { label: "POS Item Code", hint: "Trim whitespace." },
  item_name: { label: "Item Name", hint: "None." },
  price_ex_vat: { label: "Price ex VAT", hint: "Currency parse (£, €, thousands)." },
  menu_category: { label: "Menu Category", hint: "None." },
  vat_rate: { label: "VAT Rate", hint: "Percent parse (\"20%\" → 20)." },
  sale_date: { label: "Sale Date", hint: "Date format, e.g. DD/MM/YYYY." },
  quantity_sold: { label: "Quantity Sold", hint: "Decimal / negative handling." },
  net_sales_total: { label: "Net Sales Total", hint: "Currency parse." },
  unit_price_ex_vat: { label: "Unit Price ex VAT", hint: "Currency parse." },
  vat: { label: "VAT Amount", hint: "Currency parse." },
  discount: { label: "Discount", hint: "Currency parse." },
  refund: { label: "Refund", hint: "Currency parse; negatives / (12.50) supported." },
  void: { label: "Void flag", hint: "Text; non-empty = voided line." },
}

const DELIMITERS = [
  { value: "auto", label: "Auto-detect" },
  { value: ",", label: "Comma ( , )" },
  { value: ";", label: "Semicolon ( ; )" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "Pipe ( | )" },
]
const DELIM_LABEL = { ",": "Comma", ";": "Semicolon", "\t": "Tab", "|": "Pipe" }
const DECIMALS = [
  { value: ".", label: "Point ( . )  — 12.50" },
  { value: ",", label: "Comma ( , ) — 12,50" },
]
const THOUSANDS = [
  { value: "", label: "None" },
  { value: ",", label: "Comma ( , ) — 1,250" },
  { value: ".", label: "Point ( . ) — 1.250" },
  { value: " ", label: "Space — 1 250" },
  { value: "'", label: "Apostrophe — 1'250" },
]
const DATE_FORMATS = ["auto", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "DD-MM-YYYY", "DD.MM.YYYY", "YYYY/MM/DD", "ISO"]
const ENCODINGS = [
  { value: "auto", label: "Auto-detect" },
  { value: "utf-8", label: "UTF-8" },
  { value: "utf-16le", label: "UTF-16 LE" },
  { value: "windows-1252", label: "Windows-1252" },
  { value: "iso-8859-1", label: "ISO-8859-1 (Latin-1)" },
]

const DEFAULT_FORMAT = { delimiter: "auto", decimal_separator: ".", thousands_separator: "", date_format: "auto", header_row: 1, encoding: "auto" }
const DEFAULT_DEFAULTS = { sale_date_from: "column" }

// Header-name heuristics for the "Auto-map" helper (onboarder convenience only; nothing is saved without review).
const AUTO_MAP_RX = {
  pos_code: /^(pos[\s_-]*)?(item[\s_-]*)?(no|number|code|id|sku|plu)$|^(product|item)[\s_-]*(code|no|id|number|sku)$|^plu$|^sku$/i,
  item_name: /^(item[\s_-]*)?(name|description|desc|title|product)$|^product[\s_-]*(name|description)$|^menu[\s_-]*item$/i,
  price_ex_vat: /^(net[\s_-]*)?(price|unit[\s_-]*price)([\s_-]*(ex|excl|excluding)[\s_-]*(vat|tax))?$|^price[\s_-]*ex[\s_-]*vat$/i,
  unit_price_ex_vat: /^(net[\s_-]*)?unit[\s_-]*price([\s_-]*(ex|excl)[\s_-]*(vat|tax))?$|^net[\s_-]*price$/i,
  menu_category: /^(menu[\s_-]*)?(category|department|dept|group|section|family)$/i,
  vat_rate: /^(vat|tax)[\s_-]*(rate|%|pct|percent)$/i,
  sale_date: /^(business|sale|sales|trading|transaction|trans|order)?[\s_-]*(date|day|datetime|time)$/i,
  quantity_sold: /^(qty|quantity|quantity[\s_-]*sold|qty[\s_-]*sold|units|units[\s_-]*sold|sold|count)$/i,
  net_sales_total: /^(net[\s_-]*)?(sales|total|amount|revenue|net|value)([\s_-]*(ex|excl)[\s_-]*(vat|tax))?$|^net[\s_-]*(sales|total|amount)$|^line[\s_-]*total$/i,
  vat: /^(vat|tax)([\s_-]*(amount|amt|total))?$/i,
  discount: /^(discount|disc|discounts)([\s_-]*(amount|amt|total))?$/i,
  refund: /^(refund|refunds|returns?)([\s_-]*(amount|amt|total))?$/i,
  void: /^(void|voided|cancelled|canceled|is[\s_-]*void)$/i,
}

/* ── Tiny helpers (kept local so the same file works in both apps) ─────── */

/**
 * Human sentence for an axios error. The API sends `{ message }` in plain
 * words; everything else (network drop, proxy 502 with an HTML body, timeout,
 * body-parser 413) must never surface as "Network Error" / "Request failed
 * with status code 502" / "request entity too large" to the CS agent.
 */
const errMsg = (e, fallback = "Something went wrong — please try again") => {
  const server = e?.response?.data?.message
  if (server && typeof server === "string") {
    if (/request entity too large|payload too large/i.test(server)) return "That file or request is too large — try a smaller sample file (max 15 MB)."
    return server
  }
  const status = e?.response?.status
  if (!e?.response) {
    if (e?.code === "ECONNABORTED" || /timeout/i.test(String(e?.message || ""))) return "The server took too long to answer — check the connection and try again."
    if (typeof navigator !== "undefined" && navigator.onLine === false) return "You are offline — reconnect and try again."
    if (e?.code === "ERR_NETWORK" || /network/i.test(String(e?.message || ""))) return "Cannot reach the server right now — check the connection and try again."
  }
  switch (status) {
    case 400: return "Some of the details are not valid — check the form and try again."
    case 401: return "Your session has expired — please sign in again."
    case 402: case 403: return "You do not have permission to do this."
    case 404: return "That record no longer exists — refresh the page."
    case 409: return "That conflicts with something already saved — refresh and try again."
    case 413: return "That file is too large (max 15 MB)."
    case 429: return "Too many requests in a short time — wait a moment and try again."
    case 500: case 502: case 503: case 504: return "Something went wrong on the server and nothing was changed — try again in a moment."
    default: return (e?.message && !/status code|network error/i.test(e.message) ? e.message : null) || fallback
  }
}
const isDenied = (e) => e?.response?.status === 403 || e?.response?.status === 402
const humanize = (s) => { if (!s) return ""; const t = String(s).replace(/_/g, " "); return t.charAt(0).toUpperCase() + t.slice(1) }
const fmtDT = (v) => { if (!v) return "—"; const d = new Date(v); return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString(undefined, { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) }
const fmtBytes = (n) => (n == null ? "" : n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`)

const STATUS_CHIP = {
  draft: "bg-blue-50 text-blue-700 border-blue-200",
  tested: "bg-amber-50 text-amber-700 border-amber-200",
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  disabled: "bg-gray-100 text-gray-600 border-gray-200",
}
function StatusChip({ status }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold border whitespace-nowrap ${STATUS_CHIP[status] || STATUS_CHIP.disabled}`}>{humanize(status)}</span>
}
const REQ_CHIP = {
  required: "bg-red-50 text-red-700",
  required_to_activate: "bg-red-50 text-red-700",
  one_of: "bg-orange-50 text-orange-700",
  preferred: "bg-amber-50 text-amber-700",
  optional: "bg-gray-100 text-gray-500",
}
const REQ_LABEL = { required: "Required", required_to_activate: "Required to go live", one_of: "One of code / name", preferred: "Preferred", optional: "Optional" }

/** Requirement bucket per field — same rules as backend csvMapping.requiredFields(). */
function localRequired(importType, defaults) {
  if (importType === "menu_catalogue") return { required: ["item_name", "price_ex_vat"], one_of: [], required_to_activate: [], preferred: ["pos_code"], optional: ["menu_category", "vat_rate"] }
  const ctx = defaults?.sale_date_from === "import_context"
  return {
    required: ctx ? ["quantity_sold"] : ["quantity_sold", "sale_date"],
    one_of: [["pos_code", "item_name"]],
    // §6.6.3 Mapping-UI matrix "Description | Item Name | Yes": a LIVE profile must map it.
    // A single row without it still imports when it carries a POS code, hence not in `required`.
    required_to_activate: ["item_name"],
    preferred: ["item_name", "pos_code", "net_sales_total"],
    optional: ["unit_price_ex_vat", "vat", "menu_category", "discount", "refund", "void", ...(ctx ? ["sale_date"] : [])],
  }
}
function requirementOf(field, req) {
  if (req.required.includes(field)) return "required"
  if ((req.required_to_activate || []).includes(field)) return "required_to_activate"
  if ((req.one_of || []).some((g) => g.includes(field))) return "one_of"
  if ((req.preferred || []).includes(field)) return "preferred"
  return "optional"
}
/** Does the column reference resolve against the known headers (case-insensitive name or 1-based index)? */
function resolves(ref, headers) {
  if (ref == null || String(ref).trim() === "") return false
  if (!headers.length) return true
  const r = String(ref).trim().toLowerCase()
  if (headers.some((h) => h.trim().toLowerCase() === r)) return true
  if (/^\d+$/.test(r)) { const i = parseInt(r, 10) - 1; return i >= 0 && i < headers.length }
  return false
}
/** Client-side validation used when no sample file has been previewed yet. */
function localValidation(columnMap, headers, req) {
  const mapped = (f) => resolves(columnMap[f], headers)
  const missing_required = req.required.filter((f) => !mapped(f))
  for (const g of req.one_of || []) if (!g.some(mapped)) missing_required.push(g.join("|"))
  const missing_preferred = (req.preferred || []).filter((f) => !mapped(f))
  const unresolved = Object.entries(columnMap).filter(([, v]) => v && headers.length && !resolves(v, headers)).map(([field, column]) => ({ field, column }))
  const errors = [
    ...unresolved.map((u) => `Column "${u.column}" for ${u.field} was not found in the file`),
    ...missing_required.map((f) => `Required field ${f} is not mapped`),
  ]
  return { ok: errors.length === 0, missing_required, missing_preferred, unresolved, errors, local: true }
}
function suggestMap(headers, importType) {
  const out = {}
  const used = new Set()
  for (const field of FIELDS_BY_TYPE[importType] || []) {
    const rx = AUTO_MAP_RX[field]
    if (!rx) continue
    const h = headers.find((x) => !used.has(x) && rx.test(String(x).trim()))
    if (h) { out[field] = h; used.add(h) }
  }
  return out
}
function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text)
  return new Promise((resolve, reject) => {
    try {
      const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"
      document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); resolve()
    } catch (e) { reject(e) }
  })
}

/* ── Local UI primitives (Campaigns.jsx style) ─────────────────────────── */

const inputCls = "w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 disabled:bg-gray-50 disabled:text-gray-400"
const btnBase = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
const btnPrimary = `${btnBase} bg-orange-500 text-white hover:bg-orange-600`
const btnSecondary = `${btnBase} border border-gray-200 text-gray-700 hover:bg-gray-50 bg-white`
const btnDanger = `${btnBase} border border-red-200 text-red-700 hover:bg-red-50 bg-white`

function Field({ label, children, hint, wide, className = "" }) {
  return (
    <label className={`block text-sm ${wide ? "col-span-2" : ""} ${className}`}>
      <span className="text-xs text-gray-500">{label}</span>
      <div className="mt-0.5">{children}</div>
      {hint && <span className="block text-[11px] text-gray-400 mt-1">{hint}</span>}
    </label>
  )
}

function Modal({ onClose, title, subtitle, right, children, footer }) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="bg-white rounded-2xl max-w-6xl w-full max-h-[92vh] flex flex-col shadow-xl" role="dialog" aria-modal="true">
        <div className="flex justify-between items-start gap-3 px-5 py-4 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="text-lg font-bold text-gray-900 truncate">{title}</h3>
            {subtitle && <p className="text-xs text-gray-400 mt-0.5">{subtitle}</p>}
          </div>
          <div className="flex items-center gap-2">
            {right}
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 p-1 rounded-lg hover:bg-gray-50" aria-label="Close"><FiX size={18} /></button>
          </div>
        </div>
        <div className="p-5 overflow-y-auto flex-1">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2 flex-wrap bg-gray-50/60 rounded-b-2xl">{footer}</div>}
      </div>
    </div>
  )
}

function Section({ title, subtitle, right, children, className = "" }) {
  return (
    <div className={`bg-white rounded-xl border border-gray-100 ${className}`}>
      <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h4 className="text-sm font-semibold text-gray-800">{title}</h4>
          {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
        </div>
        {right && <div className="flex items-center gap-2 flex-wrap">{right}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function Notice({ tone = "info", children }) {
  const cls = tone === "error" ? "border-red-200 bg-red-50 text-red-700" : tone === "warn" ? "border-amber-200 bg-amber-50 text-amber-800" : tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-blue-200 bg-blue-50 text-blue-700"
  return <div className={`rounded-lg border text-xs px-3 py-2 ${cls}`}>{children}</div>
}

function DeniedState({ message }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-full bg-gray-100 text-gray-300 flex items-center justify-center mx-auto mb-3"><FiLock size={24} /></div>
      <p className="text-sm font-semibold text-gray-600">Access restricted</p>
      <p className="text-xs text-gray-400 mt-1 max-w-md mx-auto">{message || "Your back-office role cannot view Sales CSV Mapping profiles. Only admin and support roles have access."}</p>
    </div>
  )
}

/* ── Customer picker (search → pick a tenant admin) ────────────────────── */

function CustomerPicker({ value, onChange, disabled, placeholder = "Search customer by email, name or shop…" }) {
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const boxRef = useRef(null)

  useEffect(() => {
    if (!open) return
    let alive = true
    const t = setTimeout(() => {
      setBusy(true); setErr("")
      axios.get(`${boCustomersURL}?q=${encodeURIComponent(q.trim())}&limit=20`, { _silentToast: true })
        .then(({ data }) => { if (alive) setItems((data.items || []).filter((i) => i.kind !== "member")) })
        .catch((e) => { if (alive) { setItems([]); setErr(errMsg(e, "Search failed")) } })
        .finally(() => { if (alive) setBusy(false) })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, open])

  useEffect(() => {
    if (!open) return
    const h = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener("mousedown", h)
    return () => document.removeEventListener("mousedown", h)
  }, [open])

  if (value) {
    return (
      <div className="flex items-center gap-2 px-2.5 py-1.5 border border-orange-200 bg-orange-50/50 rounded-lg text-sm min-w-0">
        <span className="font-medium text-gray-800 truncate">{value.email || value.username}</span>
        {value.name && value.name !== value.email && <span className="text-xs text-gray-500 truncate">· {value.name}</span>}
        {!disabled && <button type="button" onClick={() => onChange(null)} className="ml-auto text-gray-400 hover:text-gray-700" aria-label="Clear customer"><FiX size={14} /></button>}
      </div>
    )
  }
  return (
    <div ref={boxRef} className="relative">
      <div className="relative">
        <FiSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
        <input
          value={q}
          disabled={disabled}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder={placeholder}
          className={`${inputCls} pl-8`}
        />
      </div>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-72 overflow-auto">
          {busy && <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-2"><FiLoader className="animate-spin" size={12} /> Searching…</div>}
          {!busy && err && <div className="px-3 py-2 text-xs text-red-600">{err}</div>}
          {!busy && !err && items.length === 0 && <div className="px-3 py-2 text-xs text-gray-400">No customers found.</div>}
          {!busy && items.map((c) => (
            <button
              key={String(c._id)}
              type="button"
              onClick={() => { onChange({ _id: c._id, email: c.email, name: c.name, plan: c.plan, status: c.status }); setOpen(false); setQ("") }}
              className="w-full text-left px-3 py-2 hover:bg-orange-50/50 border-b border-gray-50 last:border-0"
            >
              <div className="text-sm text-gray-800 truncate">{c.email}</div>
              <div className="text-[11px] text-gray-400 truncate">{c.name}{c.plan ? ` · ${c.plan}` : ""}{c.status && c.status !== "—" ? ` · ${c.status}` : ""}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ── Inbound sales e-mail card (§6.6.4) ────────────────────────────────── */

function InboundAddressCard({ shopId, canWrite }) {
  const { confirm } = useConfirm()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState("")
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)          // Retry re-runs the load

  useEffect(() => {
    if (!shopId) return
    let alive = true
    axios.get(`${SM}/shops/${shopId}/inbound-address`, { _silentToast: true })
      .then(({ data: r }) => {
        if (!alive) return
        // A 200 without an address is still a failure for the agent — say so
        // instead of rendering an empty card.
        if (r?.data?.address) { setData(r.data); setErr("") }
        else { setData(null); setErr("The server did not return an inbound address for this location — try again or regenerate it.") }
      })
      .catch((e) => { if (alive) { setData(null); setErr(errMsg(e, "Could not load the inbound address")) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [shopId, attempt])
  const retry = () => { setLoading(true); setErr(""); setAttempt((n) => n + 1) }

  const copy = async () => {
    if (!data?.address) return
    try { await copyText(data.address); toast.success("Address copied") } catch { toast.error("Copy failed — select and copy manually") }
  }
  const regenerate = async () => {
    const ok = await confirm("Regenerating invalidates the current address. Any POS / report system e-mailing the old address will stop being processed until it is updated.", { title: "Regenerate inbound address?", confirmLabel: "Regenerate" })
    if (!ok) return
    setBusy(true)
    try {
      const { data: r } = await axios.post(`${SM}/shops/${shopId}/inbound-address/regenerate`, {}, { _silentToast: true })
      setData(r.data); toast.success("New inbound address generated")
    } catch (e) { toast.error(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <Section
      title={<span className="inline-flex items-center gap-1.5"><FiMail size={14} className="text-orange-500" /> Unique inbound sales e-mail</span>}
      subtitle="Give this address to the customer. CSV attachments e-mailed here are processed with the location's Active Daily Sales profile."
      right={canWrite && (data || err) && !loading && <button type="button" onClick={data ? regenerate : retry} disabled={busy} className={btnSecondary}><FiRefreshCw size={13} className={busy ? "animate-spin" : ""} /> {data ? "Regenerate" : "Retry"}</button>}
    >
      {loading && <div className="text-xs text-gray-400 flex items-center gap-2"><FiLoader className="animate-spin" size={12} /> Loading address…</div>}
      {!loading && err && (
        <div className="flex items-start gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]"><Notice tone="error">{err}</Notice></div>
          {!canWrite && <button type="button" onClick={retry} className={btnSecondary}><FiRefreshCw size={13} /> Retry</button>}
        </div>
      )}
      {!loading && !err && !data && <Notice tone="warn">No inbound address is available for this location yet.</Notice>}
      {!loading && data && (
        <div className="flex items-center gap-2 flex-wrap">
          <code className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-sm font-mono text-gray-800 break-all select-all">{data.address}</code>
          <button type="button" onClick={copy} className={btnSecondary}><FiCopy size={13} /> Copy</button>
          {data.minted && <span className="text-[11px] text-emerald-600">Newly generated</span>}
          {data.shop_name && <span className="text-[11px] text-gray-400">for {data.shop_name}</span>}
        </div>
      )}
    </Section>
  )
}

/* ── Profile editor (§6.6.2 + §6.6.3) ──────────────────────────────────── */

function ProfileEditor({ canWrite, profileId, initialCustomer, initialShopId, onClose, onChanged }) {
  const { confirm } = useConfirm()
  const isNew = !profileId
  const [loading, setLoading] = useState(!isNew)
  const [loadErr, setLoadErr] = useState("")
  const [profile, setProfile] = useState(null)              // saved server row
  const [customer, setCustomer] = useState(initialCustomer || null)
  const [shops, setShops] = useState([])
  const [shopsErr, setShopsErr] = useState("")
  const [form, setForm] = useState({
    shop_id: initialShopId || "", name: "", import_type: "daily_sales", source: "both", notes: "",
    column_map: {}, format: { ...DEFAULT_FORMAT }, defaults: { ...DEFAULT_DEFAULTS }, sample_headers: [],
  })
  const [snapshot, setSnapshot] = useState(null)             // form as loaded from server (for diffing PUT)
  const [dirty, setDirty] = useState(false)
  const [file, setFile] = useState(null)
  const [preview, setPreview] = useState(null)
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewErr, setPreviewErr] = useState("")
  const [businessDate, setBusinessDate] = useState("")
  const [testResult, setTestResult] = useState(null)
  const [busy, setBusy] = useState("")
  const [err, setErr] = useState("")
  const [otherActive, setOtherActive] = useState([])
  // PUT answered `deactivated: true` — the edit took a LIVE profile out of service (§6.6.2).
  const [deactivated, setDeactivated] = useState(false)
  const fileInputRef = useRef(null)
  const autoMappedRef = useRef(false)

  const readOnly = !canWrite

  /* load existing profile */
  useEffect(() => {
    if (!profileId) return
    let alive = true
    axios.get(`${SM}/profiles/${profileId}`, { _silentToast: true })
      .then(({ data }) => {
        if (!alive) return
        const p = data.data
        const f = {
          shop_id: p.shop_id ? String(p.shop_id) : "",
          name: p.name || "", import_type: p.import_type || "daily_sales", source: p.source || "both", notes: p.notes || "",
          column_map: { ...(p.column_map || {}) },
          format: { ...DEFAULT_FORMAT, ...(p.format || {}) },
          defaults: { ...DEFAULT_DEFAULTS, ...(p.defaults || {}) },
          sample_headers: Array.isArray(p.sample_headers) ? p.sample_headers : [],
        }
        if (f.format.thousands_separator == null) f.format.thousands_separator = ""
        setProfile(p)
        setCustomer(p.customer ? { _id: p.customer._id, email: p.customer.email, name: p.customer.username } : { _id: p.adminId })
        setForm(f)
        setSnapshot(JSON.parse(JSON.stringify(f)))
        setDirty(false)
      })
      .catch((e) => { if (alive) setLoadErr(isDenied(e) ? "You do not have permission to view this profile." : errMsg(e, "Profile could not be loaded")) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [profileId])

  /* shops of the selected customer */
  const customerId = customer?._id ? String(customer._id) : ""
  useEffect(() => {
    if (!customerId) return
    let alive = true
    axios.get(`${SM}/customers/${customerId}/shops`, { _silentToast: true })
      .then(({ data }) => { if (alive) { setShops(data.data || []); setShopsErr("") } })
      .catch((e) => { if (alive) { setShops([]); setShopsErr(errMsg(e, "Could not load locations")) } })
    return () => { alive = false }
  }, [customerId])

  /* server preview whenever the sample file / mapping / format changes */
  useEffect(() => {
    if (!file) return
    let alive = true
    const t = setTimeout(async () => {
      setPreviewBusy(true); setPreviewErr("")
      try {
        const fd = new FormData()
        fd.append("file", file)
        fd.append("import_type", form.import_type)
        fd.append("column_map", JSON.stringify(form.column_map))
        fd.append("format", JSON.stringify(form.format))
        fd.append("defaults", JSON.stringify(form.defaults))
        fd.append("rows", "20")
        if (businessDate) fd.append("business_date", businessDate)
        const { data } = await axios.post(`${SM}/csv/preview`, fd, { _silentToast: true })
        if (!alive) return
        setPreview(data.data)
        // First preview of a file with an empty map → offer a heuristic auto-map (reviewable, nothing is saved).
        if (!autoMappedRef.current && data.data?.headers?.length && Object.keys(form.column_map).length === 0) {
          autoMappedRef.current = true
          const sug = suggestMap(data.data.headers, form.import_type)
          if (Object.keys(sug).length) { setForm((f) => ({ ...f, column_map: sug })); setDirty(true); toast.success("Columns auto-suggested from headers — please review") }
        }
      } catch (e) {
        if (!alive) return
        setPreview(null)
        setPreviewErr(errMsg(e, "Preview failed"))
      } finally { if (alive) setPreviewBusy(false) }
    }, 350)
    return () => { alive = false; clearTimeout(t) }
  }, [file, form.import_type, form.column_map, form.format, form.defaults, businessDate])

  /* derived */
  const headers = useMemo(() => (preview?.headers?.length ? preview.headers : form.sample_headers) || [], [preview, form.sample_headers])
  const fields = preview?.canonical_fields || FIELDS_BY_TYPE[form.import_type] || []
  const req = preview?.required || localRequired(form.import_type, form.defaults)
  const validation = preview?.validation || localValidation(form.column_map, headers, req)
  // Columns the server refuses to activate without (PROFILE_INCOMPLETE.missing_required).
  const missingToActivate = useMemo(
    () => (req.required_to_activate || []).filter((f) => !resolves(form.column_map[f], headers)),
    [req.required_to_activate, form.column_map, headers],
  )
  // Don't say "preferred but unmapped" about a column we just called required to go live.
  const missingPreferred = useMemo(
    () => (validation.missing_preferred || []).filter((f) => !missingToActivate.includes(f)),
    [validation.missing_preferred, missingToActivate],
  )
  const firstRow = preview?.sample_rows?.[0] || null
  const status = profile?.status || "draft"
  const isDaily = form.import_type === "daily_sales"
  const scopeLabel = form.shop_id ? (shops.find((s) => String(s._id) === form.shop_id)?.shop_name || "Location") : "Account-wide (shared)"

  const update = (patch) => { setForm((f) => ({ ...f, ...patch })); setDirty(true) }
  const setMap = (field, col) => {
    setForm((f) => { const cm = { ...f.column_map }; if (col) cm[field] = col; else delete cm[field]; return { ...f, column_map: cm } })
    setDirty(true)
  }
  const setFormat = (k, v) => update({ format: { ...form.format, [k]: v } })
  const setImportType = (t) => {
    const allowed = new Set(FIELDS_BY_TYPE[t] || [])
    const cm = Object.fromEntries(Object.entries(form.column_map).filter(([k]) => allowed.has(k)))
    update({ import_type: t, column_map: cm })
    setTestResult(null)
  }
  const onFile = (f) => {
    setFile(f || null); setPreview(null); setPreviewErr(""); setTestResult(null); autoMappedRef.current = false
  }
  const autoMap = () => {
    const sug = suggestMap(headers, form.import_type)
    if (!Object.keys(sug).length) { toast.warn("No obvious matches in the header row"); return }
    update({ column_map: { ...form.column_map, ...sug } })
  }
  const clearMap = () => update({ column_map: {} })

  /* body for POST/PUT: on update only send changed keys so a Tested profile is not needlessly demoted */
  const buildBody = () => {
    const full = {
      customer_id: customer?._id, shop_id: form.shop_id || null, name: form.name.trim(), import_type: form.import_type, source: form.source,
      column_map: form.column_map, format: form.format, defaults: form.defaults, sample_headers: headers.slice(0, 200), notes: form.notes,
    }
    if (!profile?._id || !snapshot) return full
    const body = {}
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    if ((form.shop_id || "") !== (snapshot.shop_id || "")) body.shop_id = full.shop_id
    if (form.name.trim() !== snapshot.name) body.name = full.name
    if (form.import_type !== snapshot.import_type) body.import_type = full.import_type
    if (form.source !== snapshot.source) body.source = full.source
    if (!same(form.column_map, snapshot.column_map)) body.column_map = full.column_map
    if (!same(form.format, snapshot.format)) body.format = full.format
    if (!same(form.defaults, snapshot.defaults)) body.defaults = full.defaults
    if (!same(headers, snapshot.sample_headers) && headers.length) body.sample_headers = full.sample_headers
    if (form.notes !== snapshot.notes) body.notes = full.notes
    return body
  }

  const save = async ({ silent = false } = {}) => {
    if (!customer?._id) { setErr("Select a customer first"); return null }
    if (!form.name.trim()) { setErr("Profile name is required"); return null }
    setBusy("save"); setErr("")
    try {
      const body = buildBody()
      let row
      // The server answers `deactivated: true` when a mapping / format edit sent a
      // LIVE profile back to Draft — the till feed stops until it is re-activated.
      let tookOffline = false
      if (profile?._id) {
        if (Object.keys(body).length === 0) row = profile
        else { const r = await axios.put(`${SM}/profiles/${profile._id}`, body, { _silentToast: true }); row = r.data.data; tookOffline = r.data.deactivated === true }
      } else {
        const r = await axios.post(`${SM}/profiles`, body, { _silentToast: true }); row = r.data.data
      }
      setProfile((p) => ({ ...(p || {}), ...row }))
      setSnapshot(JSON.parse(JSON.stringify({ ...form, name: form.name.trim(), sample_headers: headers.slice(0, 200) })))
      setDirty(false)
      // last_tested_at was cleared server-side — an older "Tested" panel would lie.
      if (tookOffline) { setDeactivated(true); setTestResult(null) }
      onChanged?.()
      if (tookOffline) { if (!silent) toast.warn("Saved — this profile is out of service until you test it and activate it again") }
      else if (!silent) toast.success(profile?._id ? "Profile saved" : "Profile created as Draft")
      return row
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m); return null } finally { setBusy("") }
  }

  const test = async () => {
    if (!file) { setErr("Upload a sample CSV first, then test"); return }
    let row = profile
    if (!row?._id || dirty) { row = await save({ silent: true }); if (!row) return }
    setBusy("test"); setErr("")
    try {
      const fd = new FormData(); fd.append("file", file); fd.append("rows", "20"); if (businessDate) fd.append("business_date", businessDate)
      const { data } = await axios.post(`${SM}/profiles/${row._id}/test`, fd, { _silentToast: true })
      const r = data.data
      setTestResult(r)
      setProfile((p) => ({ ...(p || {}), ...r.profile }))
      setPreview((prev) => ({ ...(prev || {}), headers: r.preview.headers, mapped_rows: r.preview.mapped_rows, stats: r.preview.stats, validation: r.validation, format: r.preview.format }))
      onChanged?.()
      if (r.ok) toast.success("Test passed — profile is now Tested"); else toast.warn("Test found problems — see the results panel")
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  const activate = async () => {
    let row = profile
    if (!row?._id || dirty) { row = await save({ silent: true }); if (!row) return }
    if (row.status !== "tested") {
      const ok = await confirm("This profile has not been tested with a sample file since its last change. Activate anyway?", { title: "Activate untested profile?", confirmLabel: "Activate" })
      if (!ok) return
    }
    setBusy("activate"); setErr("")
    try {
      const { data } = await axios.post(`${SM}/profiles/${row._id}/activate`, {}, { _silentToast: true })
      setProfile((p) => ({ ...(p || {}), ...data.data }))
      setOtherActive(data.other_active || [])
      setDeactivated(false)
      onChanged?.()
      toast.success("Profile activated")
      if ((data.other_active || []).length) toast.warn(`${data.other_active.length} other active profile(s) exist for the same scope and import type — the newest is used`)
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  const disable = async () => {
    if (!profile?._id) return
    const ok = await confirm("Uploads and inbound e-mails will no longer use this mapping until it is re-activated.", { title: `Disable "${profile.name}"?`, confirmLabel: "Disable" })
    if (!ok) return
    setBusy("disable"); setErr("")
    try {
      const { data } = await axios.post(`${SM}/profiles/${profile._id}/disable`, {}, { _silentToast: true })
      setProfile((p) => ({ ...(p || {}), ...data.data }))
      setDeactivated(false)
      onChanged?.()
      toast.success("Profile disabled")
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  const close = async () => {
    if (dirty && canWrite) {
      const ok = await confirm("You have unsaved changes to this mapping profile.", { title: "Discard changes?", confirmLabel: "Discard" })
      if (!ok) return
    }
    onClose()
  }

  const title = isNew ? "New mapping profile" : (profile?.name || "Mapping profile")
  const subtitle = customer ? `${customer.email || customer.name || "Customer"} · ${scopeLabel} · ${IMPORT_LABEL[form.import_type]}` : "Select a customer and location, upload a sample CSV, map the columns, test, then activate."

  const footer = (
    <>
      {err && <span className="text-xs text-red-600 mr-auto">{err}</span>}
      <button type="button" onClick={close} className={btnSecondary}>{canWrite ? "Cancel" : "Close"}</button>
      {canWrite && profile?._id && status !== "disabled" && <button type="button" onClick={disable} disabled={!!busy} className={btnDanger}>Disable</button>}
      {canWrite && <button type="button" onClick={() => save()} disabled={!!busy} className={btnSecondary}><FiSave size={13} /> {busy === "save" ? "Saving…" : profile?._id ? "Save" : "Save as Draft"}</button>}
      {canWrite && <button type="button" onClick={test} disabled={!!busy || !file} title={!file ? "Upload a sample CSV first" : ""} className={btnSecondary}><FiPlay size={13} /> {busy === "test" ? "Testing…" : "Test with sample"}</button>}
      {canWrite && status !== "active" && <button type="button" onClick={activate} disabled={!!busy || !validation.ok || missingToActivate.length > 0} title={!validation.ok || missingToActivate.length ? "Map all required fields first" : ""} className={btnPrimary}><FiZap size={13} /> {busy === "activate" ? "Activating…" : "Activate"}</button>}
    </>
  )

  return (
    <Modal onClose={close} title={title} subtitle={subtitle} right={<StatusChip status={status} />} footer={footer}>
      {loading && <div className="py-10 text-center text-sm text-gray-400 flex items-center justify-center gap-2"><FiLoader className="animate-spin" /> Loading profile…</div>}
      {!loading && loadErr && <DeniedState message={loadErr} />}
      {!loading && !loadErr && (
        <div className="space-y-4">
          {readOnly && <Notice tone="warn"><span className="inline-flex items-center gap-1.5"><FiEye size={12} /> Read-only — your role can view profiles but not change them.</span></Notice>}
          {otherActive.length > 0 && <Notice tone="warn">Other active profiles for the same customer / location / import type: {otherActive.map((o) => o.name).join(", ")}. The most recently updated one wins for uploads and inbound e-mail.</Notice>}
          {/* §6.6.2 — a mapping change on a live profile sends it back to Draft; say so until it is live again. */}
          {deactivated && status !== "active" && (
            <Notice tone="warn">
              <div className="font-semibold inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> Saved — this profile is no longer live</div>
              <p className="mt-1">Changing the mapping of an active profile takes it out of service, so it is back to <strong>{humanize(status)}</strong>. Uploads and inbound sales e-mails for this location are not being imported with it right now. {status === "tested" ? "Press Activate to put it back in service." : "Test it with a sample file, then press Activate to put it back in service."}</p>
            </Notice>
          )}

          {/* ── 1. Account & profile ── */}
          <Section title="1. Account, location & profile" subtitle={'Profiles can be tied to one location or shared across all locations of the account ("account-wide").'}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Customer / account" wide>
                <CustomerPicker value={customer} disabled={readOnly || !!profile?._id} onChange={(c) => { setCustomer(c); setShops([]); update({ shop_id: "" }) }} />
                {!customer && <span className="block text-[11px] text-gray-400 mt-1">Search by e-mail, username, shop name, Stripe id or gateway MAC.</span>}
              </Field>
              <Field label="Location" hint={shopsErr || undefined}>
                <select value={form.shop_id} disabled={readOnly || !customer} onChange={(e) => update({ shop_id: e.target.value })} className={inputCls}>
                  <option value="">Account-wide (shared across locations)</option>
                  {shops.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.shop_name}{s.active_daily_sales_profile ? " · has active sales profile" : ""}</option>)}
                </select>
              </Field>
              <Field label="Profile name">
                <input value={form.name} disabled={readOnly} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. EPOS Daily Sales – London" className={inputCls} />
              </Field>
              <Field label="Import type">
                <select value={form.import_type} disabled={readOnly} onChange={(e) => setImportType(e.target.value)} className={inputCls}>
                  {IMPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </Field>
              <Field label="Source">
                <select value={form.source} disabled={readOnly} onChange={(e) => update({ source: e.target.value })} className={inputCls}>
                  {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </Field>
              <Field label="Notes (internal)" wide>
                <input value={form.notes} disabled={readOnly} onChange={(e) => update({ notes: e.target.value })} placeholder="POS vendor, export report name, contact…" className={inputCls} />
              </Field>
            </div>
          </Section>

          {/* ── 2. Sample CSV + format ── */}
          <Section
            title="2. Sample CSV & format options"
            subtitle="LYVO reads the header row and shows the source columns. Adjust format options if the preview looks wrong."
            right={<>
              {previewBusy && <span className="text-xs text-gray-400 inline-flex items-center gap-1"><FiLoader className="animate-spin" size={12} /> Parsing…</span>}
              {preview?.format && !previewBusy && <span className="text-[11px] text-gray-400">Detected: {DELIM_LABEL[preview.format.delimiter] || preview.format.delimiter} · {preview.format.encoding} · header row {preview.format.header_row}</span>}
            </>}
          >
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <div className="lg:col-span-1">
                <input ref={fileInputRef} type="file" accept=".csv,.txt,text/csv,text/plain" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
                <div
                  className={`rounded-xl border-2 border-dashed p-4 text-center transition-colors ${file ? "border-orange-300 bg-orange-50/40" : "border-gray-200 hover:border-orange-300"} ${readOnly ? "opacity-60" : "cursor-pointer"}`}
                  onClick={() => !readOnly && fileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault() }}
                  onDrop={(e) => { e.preventDefault(); if (readOnly) return; const f = e.dataTransfer.files?.[0]; if (f) onFile(f) }}
                >
                  <FiUpload className="mx-auto text-orange-500 mb-1.5" size={20} />
                  {file ? (
                    <>
                      <p className="text-sm font-medium text-gray-800 truncate">{file.name}</p>
                      <p className="text-[11px] text-gray-400">{fmtBytes(file.size)}{preview?.stats ? ` · ${preview.stats.row_count} data rows · ${headers.length} columns` : ""}</p>
                      {!readOnly && <button type="button" onClick={(e) => { e.stopPropagation(); onFile(null); if (fileInputRef.current) fileInputRef.current.value = "" }} className="text-[11px] text-gray-500 underline mt-1">Remove</button>}
                    </>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-gray-700">{readOnly ? "No sample file" : "Upload sample CSV"}</p>
                      <p className="text-[11px] text-gray-400">Click or drop a .csv here (max 10 MB)</p>
                    </>
                  )}
                </div>
                {!file && form.sample_headers.length > 0 && <p className="text-[11px] text-gray-400 mt-2">Using {form.sample_headers.length} saved header(s) from the last sample. Upload a file to preview real rows.</p>}
                {previewErr && <div className="mt-2"><Notice tone="error">{previewErr}</Notice></div>}
              </div>
              <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3">
                <Field label="Delimiter">
                  <select value={form.format.delimiter} disabled={readOnly} onChange={(e) => setFormat("delimiter", e.target.value)} className={inputCls}>
                    {DELIMITERS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </Field>
                <Field label="Decimal separator">
                  <select value={form.format.decimal_separator} disabled={readOnly} onChange={(e) => setFormat("decimal_separator", e.target.value)} className={inputCls}>
                    {DECIMALS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </Field>
                <Field label="Thousands separator">
                  <select value={form.format.thousands_separator ?? ""} disabled={readOnly} onChange={(e) => setFormat("thousands_separator", e.target.value)} className={inputCls}>
                    {THOUSANDS.map((d) => <option key={d.value || "none"} value={d.value}>{d.label}</option>)}
                  </select>
                </Field>
                <Field label="Date format">
                  <select value={form.format.date_format} disabled={readOnly} onChange={(e) => setFormat("date_format", e.target.value)} className={inputCls}>
                    {(preview?.date_formats ? ["auto", ...preview.date_formats] : DATE_FORMATS).map((d) => <option key={d} value={d}>{d === "auto" ? "Auto-detect (day-first)" : d}</option>)}
                  </select>
                </Field>
                <Field label="Header row (1-based)">
                  <input type="number" min={1} max={50} value={form.format.header_row} disabled={readOnly} onChange={(e) => setFormat("header_row", Math.max(1, parseInt(e.target.value, 10) || 1))} className={inputCls} />
                </Field>
                <Field label="Encoding">
                  <select value={form.format.encoding} disabled={readOnly} onChange={(e) => setFormat("encoding", e.target.value)} className={inputCls}>
                    {ENCODINGS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
                  </select>
                </Field>
                {isDaily && (
                  <Field label="Sale date comes from" wide>
                    <select value={form.defaults.sale_date_from} disabled={readOnly} onChange={(e) => update({ defaults: { ...form.defaults, sale_date_from: e.target.value } })} className={inputCls}>
                      <option value="column">A column in the file (map "Sale Date" below)</option>
                      <option value="import_context">Import context (e-mail subject / file name / upload date)</option>
                    </select>
                  </Field>
                )}
                {isDaily && form.defaults.sale_date_from === "import_context" && (
                  <Field label="Business date for this preview / test" hint="Simulates the date LYVO would derive from the e-mail or file name.">
                    <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className={inputCls} />
                  </Field>
                )}
              </div>
            </div>
          </Section>

          {/* ── 3. Mapping table ── */}
          <Section
            title="3. Column mapping"
            subtitle={`Assign each LYVO field for ${IMPORT_LABEL[form.import_type]} to a source column. ${headers.length ? `${headers.length} source column(s) available.` : "Upload a sample CSV to see source columns."}`}
            right={!readOnly && <>
              <button type="button" onClick={autoMap} disabled={!headers.length} className={btnSecondary}><FiZap size={13} /> Auto-map</button>
              <button type="button" onClick={clearMap} disabled={!Object.keys(form.column_map).length} className={btnSecondary}>Clear</button>
            </>}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2">LYVO field</th>
                    <th className="text-left px-3 py-2">Requirement</th>
                    <th className="text-left px-3 py-2">Source CSV column</th>
                    <th className="text-left px-3 py-2">Example value</th>
                    <th className="text-left px-3 py-2">Example transform</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {fields.map((field) => {
                    const meta = FIELD_META[field] || { label: humanize(field), hint: "" }
                    const r = requirementOf(field, req)
                    const cur = form.column_map[field] || ""
                    const known = headers.some((h) => h === cur)
                    const missing = cur && headers.length > 0 && !resolves(cur, headers)
                    const example = firstRow && cur ? (firstRow[cur] ?? firstRow[headers.find((h) => h.toLowerCase() === cur.toLowerCase())] ?? "") : ""
                    return (
                      <tr key={field} className={missing ? "bg-red-50/40" : ""}>
                        <td className="px-3 py-2">
                          <div className="font-medium text-gray-800">{meta.label}</div>
                          <div className="text-[11px] text-gray-400 font-mono">{field}</div>
                        </td>
                        <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded text-[11px] font-medium ${REQ_CHIP[r]}`}>{REQ_LABEL[r]}</span></td>
                        <td className="px-3 py-2">
                          <select value={cur} disabled={readOnly} onChange={(e) => setMap(field, e.target.value)} className={`${inputCls} ${missing ? "border-red-300" : ""}`}>
                            <option value="">— not mapped —</option>
                            {cur && !known && <option value={cur}>{cur}{missing ? " (not in file)" : ""}</option>}
                            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                          </select>
                        </td>
                        <td className="px-3 py-2 text-xs text-gray-600 font-mono max-w-[200px] truncate" title={String(example)}>{example === "" ? <span className="text-gray-300">—</span> : String(example)}</td>
                        <td className="px-3 py-2 text-xs text-gray-500">{meta.hint}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* validation summary */}
            <div className="mt-3 space-y-2">
              {validation.ok
                ? <Notice tone="success"><span className="inline-flex items-center gap-1.5"><FiCheckCircle size={13} /> All required fields are mapped{validation.local ? " (checked against saved headers — upload a sample to validate against a real file)" : ""}.</span></Notice>
                : <Notice tone="error">
                  <div className="font-semibold inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> Mapping incomplete</div>
                  <ul className="list-disc ml-5 mt-1 space-y-0.5">{(validation.errors || []).map((e, i) => <li key={i}>{e}</li>)}</ul>
                </Notice>}
              {missingToActivate.length > 0 && (
                <Notice tone="error">
                  <div className="font-semibold inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> Cannot go live yet</div>
                  <p className="mt-1">{missingToActivate.map((f) => FIELD_META[f]?.label || f).join(", ")} must be mapped before this profile can be activated. Without it every sale from this feed lands in Needs Mapping as &quot;POS &lt;code&gt;&quot; with no product name to match on.</p>
                </Notice>
              )}
              {missingPreferred.length > 0 && <Notice tone="warn">Preferred but unmapped: {missingPreferred.map((f) => FIELD_META[f]?.label || f).join(", ")}. Imports will work, but matching / reporting is weaker without them.</Notice>}
            </div>
          </Section>

          {/* ── 4. Preview ── */}
          <Section
            title="4. Preview mapped rows"
            subtitle={preview?.stats ? `${preview.stats.previewed} of ${preview.stats.row_count} rows shown · ${preview.stats.ok_rows} OK · ${preview.stats.error_rows} with errors` : "Upload a sample CSV to preview the first 20 mapped rows."}
          >
            {!preview?.mapped_rows?.length && <p className="text-xs text-gray-400">{file ? (previewBusy ? "Parsing…" : "No rows to show.") : "No sample file loaded."}</p>}
            {preview?.mapped_rows?.length > 0 && (
              <div className="overflow-auto max-h-80 border border-gray-100 rounded-lg">
                <table className="w-full text-xs min-w-[720px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 text-gray-500">#</th>
                      <th className="text-left px-2 py-1.5 text-gray-500">OK</th>
                      {fields.filter((f) => form.column_map[f] || preview.mapped_rows.some((r) => r.fields?.[f] != null)).map((f) => <th key={f} className="text-left px-2 py-1.5 text-gray-500 whitespace-nowrap">{FIELD_META[f]?.label || f}</th>)}
                      <th className="text-left px-2 py-1.5 text-gray-500">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.mapped_rows.map((r) => (
                      <tr key={r.row_no} className={`border-t border-gray-50 ${r.ok ? "" : "bg-red-50/40"}`}>
                        <td className="px-2 py-1 text-gray-400">{r.row_no}</td>
                        <td className="px-2 py-1">{r.ok ? <FiCheckCircle className="text-emerald-500" size={13} /> : <FiAlertTriangle className="text-red-500" size={13} />}</td>
                        {fields.filter((f) => form.column_map[f] || preview.mapped_rows.some((x) => x.fields?.[f] != null)).map((f) => {
                          const v = r.fields?.[f]
                          const s = v == null ? "" : typeof v === "object" ? (v.iso_date || v.datetime || "") : String(v)
                          return <td key={f} className="px-2 py-1 font-mono text-gray-700 whitespace-nowrap max-w-[220px] truncate" title={s}>{s || <span className="text-gray-300">—</span>}</td>
                        })}
                        <td className="px-2 py-1 text-red-600">{(r.errors || []).join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 5. Test result ── */}
          {testResult && (
            <Section title="5. Test result" subtitle={`Last tested ${fmtDT(testResult.profile?.last_tested_at)}`}>
              <div className="flex flex-wrap items-center gap-2 mb-2">
                {testResult.ok
                  ? <span className="inline-flex items-center gap-1.5 text-sm text-emerald-700 font-medium"><FiCheckCircle /> Sample parsed cleanly — profile marked as Tested</span>
                  : <span className="inline-flex items-center gap-1.5 text-sm text-red-700 font-medium"><FiAlertTriangle /> Sample has problems — fix the mapping and test again</span>}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                <Stat label="Rows in file" value={testResult.preview?.stats?.row_count ?? "—"} />
                <Stat label="Previewed" value={testResult.preview?.stats?.previewed ?? "—"} />
                <Stat label="OK rows" value={testResult.preview?.stats?.ok_rows ?? "—"} />
                <Stat label="Error rows" value={testResult.preview?.stats?.error_rows ?? "—"} tone={testResult.preview?.stats?.error_rows ? "danger" : ""} />
              </div>
              {testResult.errors?.length > 0 && (
                <div className="max-h-40 overflow-auto border border-red-100 rounded-lg bg-red-50/40 p-2">
                  <ul className="text-xs text-red-700 space-y-0.5 list-disc ml-4">{testResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
            </Section>
          )}

          {/* ── 6. Inbound e-mail (daily sales, per location) ── */}
          {isDaily && form.shop_id && <InboundAddressCard shopId={form.shop_id} canWrite={canWrite} />}
          {isDaily && !form.shop_id && (
            <Notice tone="info">
              <span className="inline-flex items-center gap-1.5"><FiMail size={12} /> The unique inbound sales e-mail is per location. Select a location above (or open the location from the list) to show / generate its address. Account-wide profiles are used by every location that has no location-specific active profile.</span>
            </Notice>
          )}

          {profile && (
            <p className="text-[11px] text-gray-400">
              Created {fmtDT(profile.createdAt)}{profile.created_by?.name ? ` by ${profile.created_by.name}` : ""} · Updated {fmtDT(profile.updatedAt)} · Last tested {fmtDT(profile.last_tested_at)} · Last used {fmtDT(profile.last_used_at)}
            </p>
          )}
        </div>
      )}
    </Modal>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <div className="text-[11px] uppercase text-gray-500">{label}</div>
      <div className={`text-sm font-semibold ${tone === "danger" ? "text-red-600" : "text-gray-900"}`}>{value}</div>
    </div>
  )
}

/* ── Page: profiles list (§6.6.1) ──────────────────────────────────────── */

export default function SalesMapping({ user }) {
  const canWrite = user?.role === "admin" || user?.role === "support"
  const [customer, setCustomer] = useState(null)
  const [shops, setShops] = useState([])
  const [shopsLoading, setShopsLoading] = useState(false)
  const [filters, setFilters] = useState({ shop_id: "", import_type: "", status: "", search: "" })
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState({ total: 0, pages: 1 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [denied, setDenied] = useState(false)
  const [shopsErr, setShopsErr] = useState("")
  const [editor, setEditor] = useState(null)   // { profileId } | { create: true, shop_id }
  const [refreshKey, setRefreshKey] = useState(0)

  const customerId = customer?._id ? String(customer._id) : ""

  const selectCustomer = (c) => {
    setCustomer(c); setShops([]); setPage(1)
    setFilters((f) => ({ ...f, shop_id: "" }))
  }
  const setFilter = (k, v) => { setFilters((f) => ({ ...f, [k]: v })); setPage(1) }
  const bump = () => setRefreshKey((k) => k + 1)

  /* shops of the selected customer (with inbound + active-profile state) */
  useEffect(() => {
    if (!customerId) return
    let alive = true
    const t = setTimeout(() => {
      setShopsLoading(true); setShopsErr("")
      axios.get(`${SM}/customers/${customerId}/shops`, { _silentToast: true })
        .then(({ data }) => { if (alive) setShops(data.data || []) })
        // Not-denied failures used to fall through to "This customer has no
        // locations yet" — a lie when the request simply failed. Keep the message.
        .catch((e) => { if (alive) { setShops([]); if (isDenied(e)) setDenied(true); else setShopsErr(errMsg(e, "Could not load this customer's locations")) } })
        .finally(() => { if (alive) setShopsLoading(false) })
    }, 0)
    return () => { alive = false; clearTimeout(t) }
  }, [customerId, refreshKey])

  /* profiles list */
  useEffect(() => {
    let alive = true
    const params = new URLSearchParams()
    if (customerId) params.set("customer_id", customerId)
    if (filters.shop_id) params.set("shop_id", filters.shop_id)
    if (filters.import_type) params.set("import_type", filters.import_type)
    if (filters.status) params.set("status", filters.status)
    if (filters.search.trim()) params.set("search", filters.search.trim())
    params.set("page", String(page)); params.set("limit", String(PAGE_SIZE))
    const t = setTimeout(() => {
      setLoading(true); setError("")
      axios.get(`${SM}/profiles?${params}`, { _silentToast: true })
        .then(({ data }) => {
          if (!alive) return
          setRows(data.data || []); setMeta({ total: data.total || 0, pages: data.pages || 1 }); setDenied(false)
        })
        .catch((e) => {
          if (!alive) return
          setRows([])
          if (isDenied(e)) setDenied(true); else setError(errMsg(e, "Could not load mapping profiles"))
        })
        .finally(() => { if (alive) setLoading(false) })
    }, filters.search ? 250 : 0)
    return () => { alive = false; clearTimeout(t) }
  }, [customerId, filters, page, refreshKey])

  const openNew = (shop_id = "") => setEditor({ create: true, shop_id: shop_id || "" })
  const openProfile = (id) => setEditor({ profileId: String(id) })

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center text-orange-500"><FiUpload size={18} /></div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Sales CSV Mapping</h1>
            <p className="text-sm text-gray-400">Configure how each customer's POS / report CSV columns map to LYVO Menu Catalogue and Daily Sales fields.</p>
          </div>
        </div>
        <div className="flex gap-2 items-center">
          {loading && <FiLoader className="animate-spin text-gray-300" size={16} />}
          {canWrite && !denied && <button onClick={() => openNew()} className={btnPrimary}><FiPlus size={14} /> New profile</button>}
        </div>
      </div>

      {denied ? <DeniedState /> : (
        <>
          {/* Filters */}
          <div className="bg-white rounded-xl border border-gray-100 p-3 flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-80"><CustomerPicker value={customer} onChange={selectCustomer} /></div>
            <select value={filters.shop_id} onChange={(e) => setFilter("shop_id", e.target.value)} disabled={!customer} className={`${inputCls} w-auto min-w-[180px]`} title={!customer ? "Select a customer to filter by location" : ""}>
              <option value="">All locations</option>
              <option value="account">Account-wide only</option>
              {shops.map((s) => <option key={String(s._id)} value={String(s._id)}>{s.shop_name}</option>)}
            </select>
            <select value={filters.import_type} onChange={(e) => setFilter("import_type", e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All import types</option>
              {IMPORT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <select value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className={`${inputCls} w-auto`}>
              <option value="">All statuses</option>
              {STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
            <div className="relative flex-1 min-w-[180px]">
              <FiSearch size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={filters.search} onChange={(e) => setFilter("search", e.target.value)} placeholder="Search profile name…" className={`${inputCls} pl-8`} />
            </div>
          </div>

          {/* Locations of the selected customer (§8.1 step 1 helper) */}
          {customer && (
            <div className="bg-white rounded-xl border border-gray-100">
              <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
                <div>
                  <h2 className="text-sm font-semibold text-gray-800">Locations of {customer.email || customer.name}</h2>
                  <p className="text-[11px] text-gray-400">Inbound e-mail and active-profile status per location. Click a location to create a profile for it.</p>
                </div>
                {shopsLoading && <FiLoader className="animate-spin text-gray-300" size={14} />}
              </div>
              <div className="p-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
                {!shopsLoading && shopsErr && <div className="col-span-full flex items-center gap-2 flex-wrap"><div className="flex-1 min-w-[200px]"><Notice tone="error">{shopsErr}</Notice></div><button type="button" onClick={bump} className={btnSecondary}><FiRefreshCw size={13} /> Retry</button></div>}
                {!shopsLoading && !shopsErr && shops.length === 0 && <p className="text-xs text-gray-400 px-1 py-2">This customer has no locations yet.</p>}
                {shops.map((s) => (
                  <div key={String(s._id)} className="rounded-lg border border-gray-100 p-3 hover:border-orange-200 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{s.shop_name}</p>
                        <p className="text-[11px] text-gray-400">{s.profile_count} location profile(s){s.timezone ? ` · ${s.timezone}` : ""}</p>
                      </div>
                      {canWrite && <button onClick={() => openNew(String(s._id))} className="text-orange-500 hover:text-orange-600 text-xs font-medium whitespace-nowrap" title="New profile for this location"><FiPlus size={12} className="inline" /> Profile</button>}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${s.active_daily_sales_profile ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>Daily Sales {s.active_daily_sales_profile ? "active" : "not active"}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${s.active_menu_catalogue_profile ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>Catalogue {s.active_menu_catalogue_profile ? "active" : "not active"}</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium ${s.inbound_token_set ? "bg-blue-50 text-blue-700" : "bg-gray-100 text-gray-500"}`}><FiMail size={10} className="inline mr-0.5" />{s.inbound_token_set ? "Inbound e-mail set" : "No inbound e-mail yet"}</span>
                    </div>
                    {s.inbound_address && (
                      <div className="mt-2 flex items-center gap-1.5">
                        <code className="text-[11px] font-mono text-gray-600 truncate flex-1" title={s.inbound_address}>{s.inbound_address}</code>
                        <button onClick={() => copyText(s.inbound_address).then(() => toast.success("Address copied")).catch(() => toast.error("Copy failed"))} className="text-gray-400 hover:text-gray-700" title="Copy"><FiCopy size={12} /></button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left px-4 py-2.5">Customer / account</th>
                    <th className="text-left px-4 py-2.5">Location</th>
                    <th className="text-left px-4 py-2.5">Profile name</th>
                    <th className="text-left px-4 py-2.5">Import type</th>
                    <th className="text-left px-4 py-2.5">Source</th>
                    <th className="text-left px-4 py-2.5">Status</th>
                    <th className="text-left px-4 py-2.5">Last used</th>
                    <th className="text-left px-4 py-2.5">Last tested</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((p) => (
                    <tr key={String(p._id)} className="hover:bg-orange-50/30 cursor-pointer" onClick={() => openProfile(p._id)}>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-900 truncate max-w-[220px]">{p.customer?.email || p.customer?.username || String(p.customer?._id || "")}</div>
                        {p.customer?.username && p.customer.username !== p.customer.email && <div className="text-[11px] text-gray-400 truncate max-w-[220px]">{p.customer.username}</div>}
                      </td>
                      <td className="px-4 py-2.5 text-gray-700">{p.shop?.shop_name || <span className="text-gray-400 italic">Account-wide (shared)</span>}</td>
                      <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs">{IMPORT_LABEL[p.import_type] || humanize(p.import_type)}</td>
                      <td className="px-4 py-2.5 text-gray-700 text-xs">{SOURCE_LABEL[p.source] || humanize(p.source)}</td>
                      <td className="px-4 py-2.5"><StatusChip status={p.status} /></td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDT(p.last_used_at)}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">{fmtDT(p.last_tested_at)}</td>
                    </tr>
                  ))}
                  {!loading && !error && rows.length === 0 && (
                    <tr>
                      <td colSpan="8" className="px-4 py-12 text-center text-gray-400 text-sm">
                        <FiFileText className="mx-auto mb-2 text-gray-300" size={26} />
                        {customer || filters.search || filters.import_type || filters.status || filters.shop_id ? "No mapping profiles match these filters." : "No mapping profiles yet."}
                        {canWrite && <div className="mt-3"><button onClick={() => openNew()} className={btnPrimary}><FiPlus size={14} /> New profile</button></div>}
                      </td>
                    </tr>
                  )}
                  {loading && rows.length === 0 && <tr><td colSpan="8" className="px-4 py-10 text-center text-gray-400 text-sm">Loading…</td></tr>}
                  {error && <tr><td colSpan="8" className="px-4 py-6 text-center text-red-600 text-sm">{error} <button onClick={bump} className="underline ml-1">Retry</button></td></tr>}
                </tbody>
              </table>
            </div>
            {meta.pages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 text-xs text-gray-500 border-t border-gray-100">
                <span>Page {page} of {meta.pages} · {meta.total} profile(s)</span>
                <div className="flex items-center gap-1">
                  <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><FiChevronLeft size={14} /></button>
                  <button disabled={page >= meta.pages} onClick={() => setPage((p) => p + 1)} className="p-1.5 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"><FiChevronRight size={14} /></button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {editor && (
        <ProfileEditor
          canWrite={canWrite}
          profileId={editor.profileId || null}
          initialCustomer={editor.create ? customer : null}
          initialShopId={editor.create ? editor.shop_id : ""}
          onClose={() => setEditor(null)}
          onChanged={bump}
        />
      )}
    </div>
  )
}
