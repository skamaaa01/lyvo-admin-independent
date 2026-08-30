/**
 * SalesMapping.jsx — Back office › Customer Service › Sales CSV Mapping
 * (spec §6.6.1–§6.6.4, §8.1 steps 1–7; CONVENTIONS §5 `/api/admin/sales-mapping`;
 * doc36 A§1–A§5, A§12, A§13, A§14, A§17 — the AI mapping review screen).
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
 *   GET  /api/admin/sales-mapping/exclusion-rule-options  fields / ops / limits for the rule editor
 *   GET|PUT  /api/admin/sales-mapping/profiles/:id/exclusion-rules        list · replace ordered array
 *   POST     /api/admin/sales-mapping/profiles/:id/exclusion-rules        add (appended last)
 *   POST     /api/admin/sales-mapping/profiles/:id/exclusion-rules/reorder
 *   PUT|DELETE /api/admin/sales-mapping/profiles/:id/exclusion-rules/:ruleId
 *   GET  /api/admin/sales-mapping/shops/:shopId/inbound-address · POST …/regenerate
 *   POST /api/admin/sales-mapping/csv/analyse            multipart "file" — PROPOSES a
 *        mapping + row rules for an unknown format and previews it. Saves NOTHING
 *        (the response says `saved:false`); doc36 A§1/A§2.
 *   POST /api/admin/sales-mapping/profiles/approve       the human's approval → a real
 *        profile. THE only commit point of the AI flow (doc36 A§5/A§14).
 *
 * §6.6.4 — the BUSINESS DATE RULE lives here, because it is a property of how
 * this till's files are read: `defaults.sale_date_from` ("column" |
 * "import_context" | "received") plus `defaults.business_date_offset_days`,
 * an integer number of days BACKWARDS. The six choices the customer asked for
 * ("Use date from CSV", "Email received date = business date", −1 / −2 / −3
 * days, "Custom offset") are presentation over that one rule + one integer —
 * see BUSINESS_DATE_PRESETS. /csv/preview and /profiles/:id/test both answer
 * with `business_date_rule` (rule, offset_days, source, resolved_date,
 * base_date, zone), which is what the control shows the operator.
 *
 * This file is kept byte-identical between frontend/src/pages/backoffice and
 * admin-frontend/src/pages/backoffice except for the axiosConfig import path.
 * Back-office pages are English-only (no i18n) — see Campaigns.jsx.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import {
  FiUpload, FiSearch, FiX, FiCopy, FiRefreshCw, FiCheckCircle, FiAlertTriangle, FiLoader,
  FiPlus, FiMail, FiChevronLeft, FiChevronRight, FiLock, FiFileText, FiPlay, FiSave, FiZap, FiEye,
  FiTrash2, FiEdit2, FiFilter, FiChevronUp, FiChevronDown, FiCpu, FiUser, FiSlash, FiInfo,
  FiShuffle, FiPlusCircle,
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
const DEFAULT_DEFAULTS = { sale_date_from: "column", business_date_offset_days: 0 }

/* ── §6.6.4 Business date rule — the e-mailed till with no date column ───
 * A till that mails last night's sales at 03:00 exports a file with NO date
 * column and nobody to type a business date, so "a column" cannot date it.
 * The rule that CAN is `defaults.sale_date_from: "received"` plus an integer
 * offset in days, and this editor is where it is set.
 *
 * The six choices the customer asked for are PRESENTATION over that one rule
 * + one integer (mirrors SalesMappingProfileModel.BUSINESS_DATE_PRESETS):
 * −1 / −2 / −3 are offsets, not enum values, and "Custom offset" is the same
 * rule with a number the operator types. A seventh choice is never added
 * here; a new preset is a new offset.
 *
 * `import_context` is NOT one of the six. It is the older rule (a business
 * date typed on the upload / read off the e-mail subject) and profiles are
 * still stored on it, so it is offered ONLY to a profile already using it —
 * a new profile sees exactly the six, and no existing rule silently changes
 * meaning because the editor could not express it.
 */
const BUSINESS_DATE_OFFSET_MIN = -31
const BUSINESS_DATE_OFFSET_MAX = 0
const BUSINESS_DATE_PRESETS = [
  { id: "csv_column", sale_date_from: "column", offset: 0, label: "Use date from CSV", needs_date_column: true },
  { id: "received_same_day", sale_date_from: "received", offset: 0, label: "Email received date = business date" },
  { id: "received_minus_1", sale_date_from: "received", offset: -1, label: "Email received date -1 day" },
  { id: "received_minus_2", sale_date_from: "received", offset: -2, label: "Email received date -2 days" },
  { id: "received_minus_3", sale_date_from: "received", offset: -3, label: "Email received date -3 days" },
  { id: "custom_offset", sale_date_from: "received", offset: null, label: "Custom offset" },
]
const BUSINESS_DATE_LEGACY_PRESET = { id: "import_context", sale_date_from: "import_context", offset: 0, label: "Business date supplied with the import (e-mail subject / file name / upload)" }

/** The stored rule, normalised and TOTAL — a malformed one reads as the shipped default. */
function businessDateRuleOf(defaults) {
  const d = defaults || {}
  const rule = ["column", "import_context", "received"].includes(d.sale_date_from) ? d.sale_date_from : "column"
  let offset = Number(d.business_date_offset_days)
  if (!Number.isFinite(offset) || !Number.isInteger(offset)) offset = 0
  if (offset > BUSINESS_DATE_OFFSET_MAX) offset = BUSINESS_DATE_OFFSET_MAX
  if (offset < BUSINESS_DATE_OFFSET_MIN) offset = BUSINESS_DATE_OFFSET_MIN
  if (rule !== "received") offset = 0
  return { sale_date_from: rule, business_date_offset_days: offset }
}

/** Which preset a stored rule reads as — the mirror of the model's businessDatePresetId. */
function businessDatePresetId(defaults) {
  const r = businessDateRuleOf(defaults)
  const hit = BUSINESS_DATE_PRESETS.find((p) => p.sale_date_from === r.sale_date_from && p.offset === r.business_date_offset_days)
  if (hit) return hit.id
  return r.sale_date_from === "received" ? "custom_offset" : r.sale_date_from
}

/** Picking a preset → the rule that is actually stored. Custom keeps the number already typed. */
function applyBusinessDatePreset(defaults, presetId) {
  const cur = businessDateRuleOf(defaults)
  if (presetId === BUSINESS_DATE_LEGACY_PRESET.id) return { sale_date_from: "import_context", business_date_offset_days: 0 }
  const p = BUSINESS_DATE_PRESETS.find((x) => x.id === presetId)
  if (!p) return cur
  if (p.offset === null) {
    // Custom offset: keep whatever is already there, but never 0 — "custom, 0"
    // is the "received same day" preset and would flip the radio back.
    const keep = cur.sale_date_from === "received" && cur.business_date_offset_days < 0 ? cur.business_date_offset_days : -1
    return { sale_date_from: "received", business_date_offset_days: keep }
  }
  return { sale_date_from: p.sale_date_from, business_date_offset_days: p.offset }
}

/** "-1 day" / "-2 days" — the offset in words, empty at 0. */
function businessDateOffsetWords(n) {
  const off = Number(n) || 0
  if (off === 0) return ""
  return `${off} ${off === -1 || off === 1 ? "day" : "days"}`
}

/** The rule in plain words: "e-mail received date -1 day". */
function businessDateRuleWords(defaults) {
  const r = businessDateRuleOf(defaults)
  if (r.sale_date_from === "column") return "the date column in the file"
  if (r.sale_date_from === "import_context") return "the business date supplied with the import"
  const off = businessDateOffsetWords(r.business_date_offset_days)
  return off ? `e-mail received date ${off}` : "e-mail received date"
}

/**
 * The offset the editor refuses to send. The server refuses it too (and its
 * sentence is the one a manager reads), but a number the UI already knows is
 * impossible should never become a request.
 */
function businessDateOffsetError(value) {
  const s = String(value == null ? "" : value).trim()
  if (s === "") return "Enter how many days back from the received date, for example -1."
  const n = Number(s)
  if (!Number.isFinite(n) || !Number.isInteger(n)) return "The business date offset must be a whole number of days, such as 0 or -1."
  if (n > BUSINESS_DATE_OFFSET_MAX) return "The offset counts backwards from the day the file arrived, so it must be 0 or a negative number of days."
  if (n < BUSINESS_DATE_OFFSET_MIN) return `The offset can go back at most ${-BUSINESS_DATE_OFFSET_MIN} days — ${n} is further back than any till export.`
  return ""
}

/* ── Row rules & row classification (spec A§1, A§3, A§4, A§10, A§13) ───── */

/**
 * Fallback catalogue for the rule editor's dropdowns. The live one comes from
 * GET /exclusion-rule-options; this only keeps the editor usable if that call
 * fails, and it is what the field/op labels below are keyed on.
 */
const RULE_OPTIONS_FALLBACK = {
  fields: ["pos_code", "item_name", "price_ex_vat", "menu_category", "vat_rate", "sale_date", "quantity_sold", "net_sales_total", "unit_price_ex_vat", "vat", "discount", "refund", "void", "any", "row"],
  pseudo_fields: ["any", "row"],
  ops: [
    { op: "equals", kind: "text", value: "required" },
    { op: "not_equals", kind: "text", value: "required" },
    { op: "contains", kind: "text", value: "required" },
    { op: "not_contains", kind: "text", value: "required" },
    { op: "starts_with", kind: "text", value: "required" },
    { op: "ends_with", kind: "text", value: "required" },
    { op: "regex", kind: "text", value: "required" },
    { op: "blank", kind: "presence", value: "none" },
    { op: "not_blank", kind: "presence", value: "none" },
    { op: "gt", kind: "numeric", value: "required" },
    { op: "gte", kind: "numeric", value: "required" },
    { op: "lt", kind: "numeric", value: "required" },
    { op: "lte", kind: "numeric", value: "required" },
    { op: "is_blank_row", kind: "structural", value: "none" },
    { op: "is_repeated_header", kind: "structural", value: "none" },
    { op: "is_separator_row", kind: "structural", value: "none" },
  ],
  sources: ["ai", "manual"],
  max_rules: 50,
  max_value_length: 200,
  max_note_length: 500,
}

const RULE_FIELD_LABEL = {
  pos_code: "POS / SKU code", item_name: "Item name", price_ex_vat: "Price (ex VAT)", menu_category: "Category",
  vat_rate: "VAT rate", sale_date: "Sale date", quantity_sold: "Quantity", net_sales_total: "Net sales",
  unit_price_ex_vat: "Unit price (ex VAT)", vat: "VAT amount", discount: "Discount", refund: "Refund", void: "Void",
  any: "Any mapped cell", row: "The whole row",
}
const RULE_OP_LABEL = {
  equals: "is exactly", not_equals: "is not", contains: "contains", not_contains: "does not contain",
  starts_with: "starts with", ends_with: "ends with", regex: "matches regex",
  blank: "is blank", not_blank: "is not blank",
  gt: "is greater than", gte: "is greater than or equal to", lt: "is less than", lte: "is less than or equal to",
  is_blank_row: "is a blank row", is_repeated_header: "is a repeated header row", is_separator_row: "is a separator row",
}
/* §A13 indicator labels — who PROPOSED the rule. */
const RULE_SOURCE_BADGE = { ai: "AI Generated", manual: "Manually Modified" }
const RULE_SOURCE_NOTE = { ai: "Rules generated by LYVO AI", manual: "Rules added manually" }

/* ── AI mapping proposal (spec A§2, A§13, A§14) ────────────────────────── */

/**
 * §A13 indicator labels for the MAPPING as a whole. The four values are the
 * ones the server derives, never a flag the client sets: `labels.mapping` /
 * `labels.rules` on POST /csv/analyse, and `label` on POST /profiles/approve
 * (salesImportController.provenanceLabel).
 */
const MAPPING_LABEL = {
  ai_generated: "AI Generated",
  auto_detected: "Auto-detected",
  manually_modified: "Manually Modified",
  manually_created: "Manually Created",
}
const MAPPING_NOTE = {
  ai_generated: "Mapping generated by LYVO AI",
  auto_detected: "Mapping read by LYVO from the file's own headings — not by AI",
  manually_modified: "Manually Modified — a human changed this mapping",
  manually_created: "Mapping created by hand",
}
const MAPPING_CHIP = {
  ai_generated: "bg-violet-50 text-violet-700 border-violet-200",
  auto_detected: "bg-blue-50 text-blue-700 border-blue-200",
  manually_modified: "bg-amber-50 text-amber-700 border-amber-200",
  manually_created: "bg-gray-100 text-gray-600 border-gray-200",
}

/**
 * Every machine warning code the analyse endpoint can emit → a sentence built
 * HERE from the code and its params. The union of salesMappingAI.WARNING_CODES
 * and the controller's own `proposal_*` coercion warnings; the server ships
 * `{ code, params }` and never a prose warning.
 */
const WARNING_TEXT = {
  ai_not_configured: () => "No AI import analyser is configured on this server — this reading is LYVO's own.",
  ai_failed: () => "The AI import analyser could not be reached — this reading is LYVO's own.",
  header_row_invalid: (p) => `The proposed header row (${p.proposed ?? "?"}) is not a line of this file — LYVO's own header row is used instead.`,
  header_row_unparseable: (p) => `Row ${p.proposed ?? "?"} could not be parsed as a header — LYVO's own header row is used instead.`,
  delimiter_invalid: (p) => `Proposed delimiter "${p.proposed ?? ""}" is not one LYVO can use — the detected one is used instead.`,
  decimal_separator_invalid: (p) => `Proposed decimal separator "${p.proposed ?? ""}" is not valid — the detected one is used instead.`,
  thousands_separator_invalid: (p) => `Proposed thousands separator "${p.proposed ?? ""}" is not valid — the detected one is used instead.`,
  separators_identical: (p) => `Decimal and thousands separator were both "${p.separator ?? ""}" — the thousands separator was dropped.`,
  date_format_unsupported: (p) => `Date format "${p.proposed ?? ""}" is not one LYVO can parse — auto-detection is used instead.`,
  currency_invalid: (p) => `Currency "${p.proposed ?? ""}" is not a 3-letter code — it was left empty.`,
  unknown_field: (p) => `"${p.field ?? ""}" is not a LYVO field — that column was dropped.`,
  field_not_for_import_type: (p) => `"${FIELD_META[p.field]?.label || p.field}" does not belong to ${IMPORT_LABEL[p.import_type] || p.import_type} — that column was dropped.`,
  unknown_header: (p) => `Column "${p.header ?? ""}" (proposed for ${FIELD_META[p.field]?.label || p.field}) is not in this file — it was dropped.`,
  duplicate_field: (p) => `"${FIELD_META[p.field]?.label || p.field}" was proposed twice — the second column ("${p.header ?? ""}") was dropped.`,
  no_columns_proposed: () => "No usable columns were proposed — LYVO fell back to its own reading of the headings.",
  rule_invalid: (p) => `Proposed row rule ${Number(p.index ?? 0) + 1} (${RULE_FIELD_LABEL[p.field] || p.field || "?"} ${RULE_OP_LABEL[p.op] || p.op || "?"}) was refused — ${humanize(p.rule_code || "invalid")}.`,
  rule_duplicate: (p) => `A duplicate row rule on ${RULE_FIELD_LABEL[p.field] || p.field} (${RULE_OP_LABEL[p.op] || p.op}) was dropped.`,
  rule_field_unmapped: (p) => `The row rule on "${RULE_FIELD_LABEL[p.field] || p.field}" can never match — that column is not mapped.`,
  rule_not_previewable: (p) => `The "${RULE_OP_LABEL[p.op] || p.op}" rule is handled by LYVO's own row detection, not by this rule.`,
  rules_truncated: (p) => `Only ${p.kept ?? "?"} of ${p.proposed ?? "?"} proposed row rules were kept.`,
  missing_required_field: (p) => `Required column "${FIELD_META[p.field]?.label || p.field}" is not mapped yet.`,
  sale_date_from_context: (p) => `This file has no date column — every row is dated from the import context${p.business_date ? ` (${p.business_date})` : ""}.`,
  preview_failed: () => "LYVO could not preview this file with the proposed mapping.",
  filename_pattern_invalid: (p) => `No usable file-name pattern could be built from "${p.filename ?? ""}".`,
  sender_email_invalid: (p) => `"${p.sender ?? ""}" is not a valid sender address — it was left empty.`,
  low_confidence: (p) => `Confidence ${pctText(p.confidence)} is below the ${pctText(p.threshold)} required to trust this mapping — review every field.`,
  /* the controller's own coercion warnings */
  proposal_field_unknown: (p) => `"${p.field ?? ""}" is not a LYVO field — that column was dropped.`,
  proposal_date_format_unsupported: (p) => `Date format "${p.proposed ?? ""}" is not supported — auto-detection is used instead.`,
  proposal_currency_invalid: (p) => `Currency "${p.currency ?? ""}" is not a 3-letter code — it was left empty.`,
  proposal_filename_pattern_invalid: (p) => `File-name pattern "${p.pattern ?? ""}" could not be stored — it was left empty.`,
  proposal_sender_email_invalid: (p) => `Sender address "${p.sender ?? ""}" could not be stored — it was left empty.`,
  proposal_rules_too_many: (p) => `More row rules were proposed than a profile can hold (max ${p.max ?? "?"}) — the extra ones were dropped.`,
  proposal_rule_unusable: (p) => `A proposed row rule was refused — ${humanize(p.reason || "invalid")}.`,
  proposal_no_columns: () => "Nothing could be mapped from this file — map the columns by hand below.",
  analyser_note: (p) => String(p.text || ""),
}
/** @param {{code?:string, params?:object}} w */
function warningText(w) {
  if (!w || !w.code) return ""
  const fn = WARNING_TEXT[w.code]
  return fn ? fn(w.params || {}) : humanize(w.code)
}

/**
 * A confidence is a DECIMAL STRING in [0,1] on the wire — "0.92", never a JS
 * float. Shifted two places with string arithmetic so nothing is ever parsed
 * into a binary float just to be printed.
 * @param {string|number|null} v
 * @returns {string} "92%" · "—" when there is no score
 */
function pctText(v) {
  if (v == null || v === "") return "—"
  const s = String(v).trim()
  if (!/^-?\d*(\.\d*)?$/.test(s) || s === "" || s === "-" || s === ".") return "—"
  const neg = s.startsWith("-")
  const [intRaw, fracRaw = ""] = (neg ? s.slice(1) : s).split(".")
  const digits = `${intRaw || "0"}${fracRaw}`
  const point = (intRaw || "0").length + 2                       // × 100
  const padded = digits.padEnd(point, "0")
  const whole = padded.slice(0, point).replace(/^0+(?=\d)/, "")
  const rest = padded.slice(point).replace(/0+$/, "")
  return `${neg ? "-" : ""}${whole}${rest ? `.${rest}` : ""}%`
}
/** A confidence string → the §A13 band the chip is coloured by. */
function confidenceBand(overall, threshold) {
  const n = (x) => { const s = String(x ?? "").trim(); return /^-?\d*(\.\d*)?$/.test(s) && s !== "" ? s : null }
  const a = n(overall); const b = n(threshold)
  if (a == null) return "unknown"
  // String compare is wrong for decimals of different lengths, so pad both.
  const pad = (s) => { const [i, f = ""] = s.split("."); return `${i.padStart(2, "0")}.${f.padEnd(4, "0")}` }
  if (b != null && pad(a) < pad(b)) return "low"
  return pad(a) < pad("0.85") ? "medium" : "high"
}

/**
 * WHICH parts of the proposal the human changed — the mirror of the server's
 * salesImportController.diffProposal, so the §A13 "Manually Modified" flag on
 * screen is the same one the approval will record. Compared, never asserted.
 * @returns {string[]} dotted names, e.g. ["column_map.quantity_sold", "format.date_format"]
 */
function diffProposalLocal(before, after) {
  const changed = []
  const b = before || {}
  const a = after || {}
  const bm = b.column_map || {}
  const am = a.column_map || {}
  for (const f of new Set([...Object.keys(bm), ...Object.keys(am)])) {
    if (String(bm[f] || "") !== String(am[f] || "")) changed.push(`column_map.${f}`)
  }
  const nf = (o) => {
    const f = o || {}
    const hr = parseInt(f.header_row, 10)
    return {
      delimiter: f.delimiter == null || f.delimiter === "" ? "auto" : String(f.delimiter),
      decimal_separator: f.decimal_separator === "," ? "," : ".",
      thousands_separator: f.thousands_separator == null ? "" : String(f.thousands_separator),
      date_format: f.date_format == null || f.date_format === "" ? "auto" : String(f.date_format),
      header_row: Number.isFinite(hr) && hr > 0 ? hr : 1,
      encoding: f.encoding == null || f.encoding === "" ? "auto" : String(f.encoding),
    }
  }
  const bf = nf(b.format); const af = nf(a.format)
  for (const k of ["delimiter", "decimal_separator", "thousands_separator", "date_format", "header_row", "encoding"]) {
    if (String(bf[k]) !== String(af[k])) changed.push(`format.${k}`)
  }
  if (String((b.defaults || {}).sale_date_from || "column") !== String((a.defaults || {}).sale_date_from || "column")) changed.push("defaults.sale_date_from")
  for (const k of ["currency", "filename_pattern", "known_sender_email"]) {
    if (String(b[k] || "").trim().toLowerCase() !== String(a[k] || "").trim().toLowerCase()) changed.push(k)
  }
  return changed
}

/**
 * §A13 for ONE rule: a proposed rule keeps "ai" only while it is byte-for-byte
 * what was proposed. The mirror of salesImportController.attributeRules, so the
 * badge on screen is the source the approval will store.
 */
function ruleSourceLocal(proposedRules, rule) {
  const p = (proposedRules || []).find((x) => String(x.id || "") === String((rule || {}).id || "")) || null
  const r = rule || {}
  const same = p
    && String(p.field || "") === String(r.field || "")
    && String(p.op || "") === String(r.op || "")
    && String(p.value == null ? "" : p.value).trim() === String(r.value == null ? "" : r.value).trim()
    && (p.enabled !== false) === (r.enabled !== false)
    && String(p.note == null ? "" : p.note).trim() === String(r.note == null ? "" : r.note).trim()
  return same ? "ai" : "manual"
}

/* csvMapping.ROW_KINDS — product | excluded | suspicious */
const ROW_KIND_LABEL = { product: "Sale row", excluded: "Excluded", suspicious: "Needs Review" }
const ROW_KIND_CHIP = {
  product: "bg-emerald-50 text-emerald-700 border-emerald-200",
  excluded: "bg-gray-100 text-gray-600 border-gray-200",
  suspicious: "bg-amber-50 text-amber-700 border-amber-200",
}

/**
 * Machine reason_code (csvMapping.REASON_CODES) → sentence, built HERE from the
 * code + its params. The server never sends a prose reason for a row.
 */
const REASON_TEXT = {
  ok: () => "Sale row",
  repeated_header: (p) => `Repeated header row — ${p.matched ?? "?"} of ${p.of ?? "?"} cells repeat the header`,
  total_row: (p) => `Detected as summary row — "${p.label || p.value || ""}"${p.match === "weak" ? " (weak match)" : ""}`,
  blank_row: () => "Blank row",
  separator_row: () => "Separator row",
  report_heading: (p) => `Report heading — "${p.value || ""}"`,
  rule_match: (p) => `Row rule — ${p.label || `${RULE_FIELD_LABEL[p.field] || p.field} ${RULE_OP_LABEL[p.op] || p.op}${p.value ? ` "${p.value}"` : ""}`}`,
  no_item_name: () => "No product name on this row",
  non_numeric_qty: (p) => `Quantity is not a number — "${p.value ?? ""}"`,
  implausible_value: (p) => `Value ${p.value} is over ${p.factor}× the typical row (median ${p.median})`,
}
/** @param {{reason_code?:string, reason_params?:object}} c */
function reasonText(c) {
  if (!c || !c.reason_code) return ""
  const fn = REASON_TEXT[c.reason_code]
  return fn ? fn(c.reason_params || {}) : humanize(c.reason_code)
}

/* ── A§8 / A§9 / A§13 — the FORMAT indicators and the diff ─────────────── */

/**
 * §A13 state labels for a whole FILE, as opposed to a mapping. "Known Format"
 * and "Format Changed" are the two the spec names by hand; the other two are
 * the honest halves of "not known yet".
 */
const FORMAT_STATE_LABEL = {
  known_format: "Known Sales Format — Automatically Processed",
  format_changed: "Sales Format Changed — Review Required",
  partial_match: "Sales Format Partly Matched — Review Required",
  unrecognised: "Sales Format Not Recognised",
}
const FORMAT_STATE_CHIP = {
  known_format: "bg-emerald-50 text-emerald-700 border-emerald-200",
  format_changed: "bg-amber-50 text-amber-700 border-amber-200",
  partial_match: "bg-amber-50 text-amber-700 border-amber-200",
  unrecognised: "bg-gray-100 text-gray-600 border-gray-200",
}

/**
 * formatRecognition.CHANGE_CODES → a sentence, built HERE from the code and
 * its params. The server ships `{ code, params }` and never a prose diff, so
 * A§9's "this report now contains two additional columns and the Net Sales
 * column has moved" is written by the screen, not by the API.
 */
const CHANGE_TEXT = {
  columns_added: (p) => `${p.count ?? 0} new column(s) in this file: ${columnList(p.columns)}.`,
  columns_removed: (p) => `${p.count ?? 0} column(s) the saved format had are gone: ${columnList(p.columns)}.`,
  columns_reordered: (p) => `${p.count ?? 0} column(s) moved: ${columnList(p.columns)}.`,
  column_count_changed: (p) => `The file now has ${p.to ?? "?"} columns instead of ${p.from ?? "?"}.`,
  mapped_column_missing: (p) => `${FIELD_META[p.field]?.label || humanize(p.field)} was read from "${p.column ?? ""}", which is no longer in the file.`,
  delimiter_changed: (p) => `The column separator changed from "${p.from ?? ""}" to "${p.to ?? ""}".`,
  date_format_changed: (p) => `Dates in "${p.column ?? ""}" now look like ${p.to ?? "?"} instead of ${p.from ?? "?"}.`,
  header_row_changed: (p) => `The header row moved from line ${p.from ?? "?"} to line ${p.to ?? "?"}.`,
  column_type_changed: (p) => `Column "${p.column ?? ""}" now holds ${humanize(p.to)} values instead of ${humanize(p.from)} ones.`,
}
/** `params.columns` is a list of names, or of { column, from, to } moves. */
function columnList(v) {
  if (!Array.isArray(v)) return ""
  return v.map((x) => (x && typeof x === "object" ? `${x.column} (${x.from} → ${x.to})` : String(x))).join(", ")
}
/** @param {{code?:string, params?:object}} c */
function changeText(c) {
  if (!c || !c.code) return ""
  const fn = CHANGE_TEXT[c.code]
  return fn ? fn(c.params || {}) : humanize(c.code)
}

/** salesMappingAI.CHANGE_ACTIONS / CHANGE_SEVERITY / CHANGE_REASONS, worded here. */
const CHANGE_ACTION_LABEL = { keep: "Keep this profile as it is", update: "Update this profile", new_profile: "Create a new profile" }
const CHANGE_SEVERITY_LABEL = { none: "No material change", minor: "Minor change", major: "Major change", unknown: "Change of unknown size" }
const CHANGE_REASON_TEXT = {
  no_change: () => "Nothing material changed — the saved profile still fits this file.",
  columns_added: (p) => `The report grew ${p.count ?? "some"} column(s); everything LYVO reads is still there.`,
  columns_moved: (p) => `${p.count ?? "Some"} column(s) moved, but the same information is still in the file.`,
  columns_removed: (p) => `${p.count ?? "Some"} column(s) were dropped from the report.`,
  mapped_columns_missing: (p) => `A column LYVO reads (${FIELD_META[p.field]?.label || humanize(p.field) || "one of the mapped columns"}) is no longer in the file.`,
  format_adjusted: () => "The layout was adjusted — same report, new shape.",
  unrecognisable: () => "This does not look like the same report at all.",
  not_comparable: () => "There is no saved structure to compare this file against yet.",
}
/** @param {{reason_code?:string, reason_params?:object}} r */
function changeReasonText(r) {
  if (!r || !r.reason_code) return ""
  const fn = CHANGE_REASON_TEXT[r.reason_code]
  return fn ? fn(r.reason_params || {}) : humanize(r.reason_code)
}

/* ── A§10 — one flagged row, one recommended rule ──────────────────────── */

/** salesMappingAI.ROW_ADVICE / ROW_REASONS, worded here. */
const ROW_ADVICE_LABEL = {
  exclude: "Rows like this are not sales products — exclude them from future imports",
  review: "LYVO has no safe rule for this row — decide row by row",
}
const ROW_REASON_TEXT = {
  likely_report_total: () => "Likely report total.",
  repeated_header: () => "The till reprints its header inside the report.",
  blank_row: () => "The row is blank.",
  separator_row: () => "The row is a separator between sections.",
  report_heading: () => "The row is a report heading, not a product.",
  missing_item_name: () => "The row has no product name.",
  non_numeric_quantity: () => "The quantity on this row is not a number.",
  implausible_value: () => "The value on this row is far outside the rest of the file.",
  unusual_row: () => "The row is structurally unlike the sales rows around it.",
  no_safe_rule: () => "No rule could be written that would not risk excluding real sales.",
}
function rowReasonText(code) {
  if (!code) return ""
  const fn = ROW_REASON_TEXT[code]
  return fn ? fn() : humanize(code)
}
/** §A13 for the recommended rule itself — "AI Suggested" only when a model wrote it. */
const RULE_LABEL_TEXT = {
  ai_suggested: "AI Suggested",
  ai_generated: "AI Generated",
  auto_detected: "Auto-detected",
  manually_modified: "Manually Modified",
  manually_created: "Manually Created",
  needs_review: "Needs Review",
}
/** One rule as a sentence: "Item name contains \"Tax Total\"". */
function ruleSentence(r) {
  if (!r) return ""
  const field = RULE_FIELD_LABEL[r.field] || humanize(r.field)
  const op = RULE_OP_LABEL[r.op] || humanize(r.op)
  const value = r.value == null || r.value === "" ? "" : ` "${r.value}"`
  return `${field} ${op}${value}`
}

/** "83 rows detected · 80 valid sales rows · 2 excluded · 1 needs review" */
function rowSummaryOf(preview) {
  const s = preview?.stats
  const sum = preview?.summary
  if (!s && !sum) return null
  const rows = s?.row_count ?? sum?.rows ?? 0
  const product = s?.product_rows ?? sum?.product ?? 0
  const excluded = s?.excluded_rows ?? sum?.excluded ?? 0
  const suspicious = s?.suspicious_rows ?? sum?.suspicious ?? 0
  const classified = s?.classified ?? sum?.rows ?? rows
  return { rows, product, excluded, suspicious, classified, partial: !!sum?.partial || classified < rows }
}

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
  // §6.6.4 — the "received" rule dates the file from the day LYVO got it, so
  // like "import_context" it relaxes the SALE DATE COLUMN requirement. The
  // server says the same thing (salesProcessing.csvDefaultsOf maps "received"
  // onto "import_context" before csvMapping.requiredFields sees it); this
  // fallback has to agree, or the editor would demand a column the profile is
  // deliberately without.
  const ctx = defaults?.sale_date_from === "import_context" || defaults?.sale_date_from === "received"
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

/* ── §6.6.4 The Business Date Rule control ─────────────────────────────
 * Six choices over one rule + one offset. "Use date from CSV" is the only one
 * that needs the file to have a date column, so when the mapping has none it
 * is DISABLED with a sentence saying why — offering a choice that cannot work
 * is how a till ends up importing nothing at 6 a.m. with no explanation.
 */
function BusinessDateRule({ defaults, onChange, hasDateColumn, disabled, resolved }) {
  const rule = businessDateRuleOf(defaults)
  const storedPreset = businessDatePresetId(defaults)
  /* "Custom offset" is STICKY while it is being typed into. The stored rule is
   * only a number, so -2 typed by hand reads back as the "-2 days" preset and a
   * half-typed "-" reads back as 0 ("received same day") — a control that chose
   * the radio from the value alone would move it out from under the cursor and
   * unmount the box mid-keystroke. Picking any other choice releases it. */
  const [customPicked, setCustomPicked] = useState(storedPreset === "custom_offset")
  // Derived, never an effect: the stickiness only survives while the rule is
  // still "received", so a profile switched to the CSV column releases it on
  // the very same render rather than one render later.
  const isCustom = (customPicked && rule.sale_date_from === "received") || storedPreset === "custom_offset"
  const presetId = isCustom ? "custom_offset" : storedPreset
  // The RAW value, so a box being cleared stays cleared and its error is the
  // one about an empty box — not a phantom 0 the operator never typed.
  const rawOffset = defaults && defaults.business_date_offset_days != null ? defaults.business_date_offset_days : ""
  const offsetErr = isCustom ? businessDateOffsetError(rawOffset) : ""
  // A profile stored on the older import_context rule keeps its own row; a new
  // profile is never offered it (see BUSINESS_DATE_PRESETS above).
  const options = storedPreset === BUSINESS_DATE_LEGACY_PRESET.id ? [...BUSINESS_DATE_PRESETS, BUSINESS_DATE_LEGACY_PRESET] : BUSINESS_DATE_PRESETS
  const zone = resolved ? (resolved.timezone || resolved.zone || "") : ""
  return (
    <div className="col-span-2 md:col-span-3 rounded-xl border border-gray-200 bg-gray-50/60 p-3">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <span className="text-xs font-semibold text-gray-700">Business date rule</span>
        <span className="text-[11px] text-gray-500">Business date: <strong className="text-gray-700">{businessDateRuleWords(defaults)}</strong></span>
      </div>
      <p className="text-[11px] text-gray-400 mt-0.5">Where the business date of an e-mailed file comes from when the till exports no date column.</p>
      <div className="mt-2 space-y-1">
        {options.map((p) => {
          const blocked = !!p.needs_date_column && !hasDateColumn
          return (
            <label key={p.id} className={`flex items-start gap-2 text-sm ${disabled || blocked ? "opacity-60" : "cursor-pointer"}`}>
              <input
                type="radio"
                name="business_date_preset"
                className="mt-1 accent-orange-500"
                value={p.id}
                checked={presetId === p.id}
                disabled={disabled || blocked}
                onChange={() => { setCustomPicked(p.id === "custom_offset"); onChange(applyBusinessDatePreset(defaults, p.id)) }}
              />
              <span className="text-gray-700">
                {p.label}
                {blocked && <span className="block text-[11px] text-amber-700">This mapping has no Sale Date column, so LYVO cannot read the date from the CSV. Map Sale Date below, or date the file from the e-mail.</span>}
              </span>
            </label>
          )
        })}
      </div>
      {isCustom && (
        <div className="mt-2 max-w-xs">
          <Field label="Days back from the received date" hint={`0 or a negative whole number, no further back than ${-BUSINESS_DATE_OFFSET_MIN} days. -1 = the file that arrives overnight with yesterday's sales.`}>
            <input
              type="number"
              step={1}
              min={BUSINESS_DATE_OFFSET_MIN}
              max={BUSINESS_DATE_OFFSET_MAX}
              value={rawOffset}
              disabled={disabled}
              onChange={(e) => {
                const raw = e.target.value
                const n = raw === "" || raw === "-" ? raw : parseInt(raw, 10)
                onChange({ sale_date_from: "received", business_date_offset_days: Number.isInteger(n) ? n : raw })
              }}
              className={inputCls}
            />
          </Field>
          {offsetErr && <p className="text-[11px] text-red-600 mt-1">{offsetErr}</p>}
        </div>
      )}
      {rule.sale_date_from === "received" && (
        <p className="text-[11px] text-gray-500 mt-2">
          LYVO uses the moment it actually received the file, and falls back to the date on the e-mail only when there is no received time — every import records which of the two was used. The calendar day is this location&apos;s own, never the server&apos;s.
        </p>
      )}
      {resolved && resolved.resolved_date && (
        <p className="text-[11px] text-gray-500 mt-1">
          This sample would be dated <strong className="text-gray-700">{resolved.resolved_date}</strong>
          {resolved.base_date && resolved.base_date !== resolved.resolved_date ? ` (received ${resolved.base_date}${zone ? ` in ${zone}` : ""})` : zone ? ` (${zone})` : ""}.
        </p>
      )}
    </div>
  )
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
          className={`${inputCls} !pl-8`}
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

/* ── Row exclusion rules editor (spec A§3) ─────────────────────────────── */

const BLANK_RULE = { field: "item_name", op: "contains", value: "", enabled: true, note: "" }

/** The op catalogue, keyed by op, from the server's options payload. */
function opMetaOf(options) {
  const list = (options?.ops?.length ? options.ops : RULE_OPTIONS_FALLBACK.ops)
  return Object.fromEntries(list.map((o) => [o.op, o]))
}

/**
 * The combination rules the server enforces at write time (so the editor never
 * offers an illegal pair): structural ops need field "row", field "row" takes
 * only structural ops, numeric ops are refused on "any".
 */
function opsAllowedFor(field, options) {
  const list = options?.ops?.length ? options.ops : RULE_OPTIONS_FALLBACK.ops
  if (field === "row") return list.filter((o) => o.kind === "structural")
  if (field === "any") return list.filter((o) => o.kind !== "structural" && o.kind !== "numeric")
  return list.filter((o) => o.kind !== "structural")
}

/** One row of the rule list, either read-only or in its edit form. */
function RuleForm({ draft, options, onChange, onSubmit, onCancel, busy, submitLabel }) {
  const meta = opMetaOf(options)
  const allowed = opsAllowedFor(draft.field, options)
  const needsValue = (meta[draft.op]?.value || "required") === "required"
  const fields = options?.fields?.length ? options.fields : RULE_OPTIONS_FALLBACK.fields
  const maxValue = options?.max_value_length || RULE_OPTIONS_FALLBACK.max_value_length
  const maxNote = options?.max_note_length || RULE_OPTIONS_FALLBACK.max_note_length

  const setField = (field) => {
    const ok = opsAllowedFor(field, options)
    const op = ok.some((o) => o.op === draft.op) ? draft.op : (ok[0]?.op || "equals")
    onChange({ ...draft, field, op })
  }
  return (
    <div className="rounded-xl border border-orange-200 bg-orange-50/40 p-3 space-y-2">
      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.4fr)] gap-2">
        <Field label="Column / field">
          <select value={draft.field} onChange={(e) => setField(e.target.value)} className={inputCls}>
            {fields.map((f) => <option key={f} value={f}>{RULE_FIELD_LABEL[f] || humanize(f)}</option>)}
          </select>
        </Field>
        <Field label="Condition">
          <select value={draft.op} onChange={(e) => onChange({ ...draft, op: e.target.value })} className={inputCls}>
            {allowed.map((o) => <option key={o.op} value={o.op}>{RULE_OP_LABEL[o.op] || humanize(o.op)}</option>)}
          </select>
        </Field>
        <Field label={needsValue ? "Value" : "Value (not used by this condition)"}>
          <input
            value={draft.value || ""} disabled={!needsValue} maxLength={maxValue}
            onChange={(e) => onChange({ ...draft, value: e.target.value })}
            placeholder={needsValue ? "e.g. Tax Total" : "—"} className={inputCls}
          />
        </Field>
      </div>
      <Field label="Note (internal, optional)" wide>
        <input value={draft.note || ""} maxLength={maxNote} onChange={(e) => onChange({ ...draft, note: e.target.value })} placeholder="Why this row is not a sale…" className={inputCls} />
      </Field>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onSubmit} disabled={busy || (needsValue && !String(draft.value || "").trim())} className={btnPrimary}>
          {busy ? <FiLoader className="animate-spin" size={13} /> : <FiSave size={13} />} {submitLabel}
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className={btnSecondary}>Cancel</button>
        <span className="text-[11px] text-gray-500">Rows matched by an enabled rule are excluded: no sale line, no Menu Item, no stock movement — and they are not errors.</span>
      </div>
    </div>
  )
}

/**
 * Spec A§3 — list / add / edit / delete / enable / disable the profile's row
 * rules, each labelled with the source that PROPOSED it. AI cannot propose
 * rules yet; the label is rendered from the stored `source` field, so it lights
 * up on its own the day it can.
 */
function RowRulesSection({ profileId, canWrite, rules, options, onRules }) {
  const { confirm } = useConfirm()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState({ ...BLANK_RULE })
  const [editingId, setEditingId] = useState("")
  const [busy, setBusy] = useState("")
  const [err, setErr] = useState("")

  const list = Array.isArray(rules) ? rules : []
  const base = profileId ? `${SM}/profiles/${profileId}/exclusion-rules` : ""
  const maxRules = options?.max_rules || RULE_OPTIONS_FALLBACK.max_rules
  const aiCount = list.filter((r) => r.source === "ai").length
  const manualCount = list.length - aiCount

  const apply = (data) => { onRules(Array.isArray(data?.data) ? data.data : list) }
  const fail = (e) => { const m = errMsg(e); setErr(m); toast.error(m) }

  const addRule = async () => {
    if (!base) return
    setBusy("add"); setErr("")
    try {
      const { data } = await axios.post(base, { ...draft, value: String(draft.value || "") }, { _silentToast: true })
      apply(data); setAdding(false); setDraft({ ...BLANK_RULE }); toast.success("Row rule added")
    } catch (e) { fail(e) } finally { setBusy("") }
  }
  const saveRule = async (id) => {
    if (!base) return
    setBusy(id); setErr("")
    try {
      const { data } = await axios.put(`${base}/${id}`, { field: draft.field, op: draft.op, value: String(draft.value || ""), note: draft.note || "" }, { _silentToast: true })
      apply(data); setEditingId(""); toast.success("Row rule saved")
    } catch (e) { fail(e) } finally { setBusy("") }
  }
  const toggleRule = async (r) => {
    if (!base) return
    setBusy(r.id); setErr("")
    try {
      const { data } = await axios.put(`${base}/${r.id}`, { enabled: !r.enabled }, { _silentToast: true })
      apply(data)
    } catch (e) { fail(e) } finally { setBusy("") }
  }
  const removeRule = async (r) => {
    if (!base) return
    const ok = await confirm("Rows this rule used to exclude will be imported as sales again on the next import.", { title: "Delete this row rule?", confirmLabel: "Delete" })
    if (!ok) return
    setBusy(r.id); setErr("")
    try {
      const { data } = await axios.delete(`${base}/${r.id}`, { _silentToast: true })
      apply(data); toast.success("Row rule deleted")
    } catch (e) { fail(e) } finally { setBusy("") }
  }
  const move = async (i, delta) => {
    if (!base) return
    const next = list.slice()
    const j = i + delta
    if (j < 0 || j >= next.length) return
    const tmp = next[i]; next[i] = next[j]; next[j] = tmp
    setBusy("order"); setErr("")
    try {
      const { data } = await axios.post(`${base}/reorder`, { ids: next.map((r) => r.id) }, { _silentToast: true })
      apply(data)
    } catch (e) { fail(e) } finally { setBusy("") }
  }

  const startEdit = (r) => { setEditingId(r.id); setAdding(false); setDraft({ field: r.field, op: r.op, value: r.value || "", note: r.note || "", enabled: r.enabled }) }

  return (
    <Section
      title="4. Row rules"
      subtitle="Rows that are not products — repeated headers, Tax / VAT / Grand Total, blank and separator rows — never create a Menu Item, a sale or a stock movement. LYVO already detects the usual ones; add a rule for anything specific to this till. First match wins."
      right={canWrite && profileId && !adding && list.length < maxRules && (
        <button type="button" onClick={() => { setAdding(true); setEditingId(""); setDraft({ ...BLANK_RULE }) }} className={btnSecondary}><FiPlus size={13} /> Add rule</button>
      )}
    >
      {!profileId && <Notice tone="info"><span className="inline-flex items-center gap-1.5"><FiInfo size={12} /> Save this profile as a draft first — row rules are stored on the saved profile.</span></Notice>}

      {profileId && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            {aiCount > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 font-medium"><FiCpu size={11} /> {RULE_SOURCE_NOTE.ai} · {aiCount}</span>}
            {manualCount > 0 && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-gray-200 bg-gray-50 text-gray-600 font-medium"><FiUser size={11} /> {RULE_SOURCE_NOTE.manual} · {manualCount}</span>}
            <span className="text-gray-400">{list.length} of {maxRules} rules</span>
          </div>

          {err && <Notice tone="error">{err}</Notice>}

          {list.length === 0 && !adding && (
            <p className="text-xs text-gray-400">No extra row rules. LYVO still excludes repeated headers, total / subtotal footers, blank and separator rows on its own.</p>
          )}

          {list.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                  <tr>
                    <th className="text-left px-3 py-2 w-10">#</th>
                    <th className="text-left px-3 py-2">Rule</th>
                    <th className="text-left px-3 py-2">Source</th>
                    <th className="text-left px-3 py-2">Status</th>
                    <th className="text-right px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {list.map((r, i) => (
                    editingId === r.id ? (
                      <tr key={r.id}><td colSpan={5} className="px-1 py-2">
                        <RuleForm draft={draft} options={options} onChange={setDraft} onSubmit={() => saveRule(r.id)} onCancel={() => setEditingId("")} busy={busy === r.id} submitLabel="Save rule" />
                      </td></tr>
                    ) : (
                      <tr key={r.id} className={r.enabled ? "" : "opacity-60"}>
                        <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                        <td className="px-3 py-2">
                          <div className="text-gray-800">
                            <span className="font-medium">{RULE_FIELD_LABEL[r.field] || humanize(r.field)}</span>{" "}
                            <span className="text-gray-500">{RULE_OP_LABEL[r.op] || humanize(r.op)}</span>{" "}
                            {r.value ? <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">{r.value}</span> : null}
                          </div>
                          {r.note && <div className="text-[11px] text-gray-400 mt-0.5">{r.note}</div>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${r.source === "ai" ? "bg-violet-50 text-violet-700" : "bg-gray-100 text-gray-600"}`}>
                            {r.source === "ai" ? <FiCpu size={11} /> : <FiUser size={11} />} {RULE_SOURCE_BADGE[r.source] || humanize(r.source)}
                          </span>
                          <div className="text-[11px] text-gray-400 mt-0.5">{r.created_by?.name ? `by ${r.created_by.name}` : ""}{r.created_at ? ` · ${fmtDT(r.created_at)}` : ""}</div>
                        </td>
                        <td className="px-3 py-2">
                          <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${r.enabled ? "bg-emerald-50 text-emerald-700" : "bg-gray-100 text-gray-500"}`}>{r.enabled ? "Enabled" : "Disabled"}</span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex items-center justify-end gap-1">
                            {canWrite && <>
                              <button type="button" title="Move up" aria-label="Move up" disabled={i === 0 || !!busy} onClick={() => move(i, -1)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"><FiChevronUp size={14} /></button>
                              <button type="button" title="Move down" aria-label="Move down" disabled={i === list.length - 1 || !!busy} onClick={() => move(i, 1)} className="p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100 disabled:opacity-30"><FiChevronDown size={14} /></button>
                              <button type="button" title={r.enabled ? "Disable rule" : "Enable rule"} aria-label={r.enabled ? "Disable rule" : "Enable rule"} disabled={!!busy} onClick={() => toggleRule(r)} className="p-1.5 rounded text-gray-400 hover:text-amber-600 hover:bg-amber-50 disabled:opacity-30">{r.enabled ? <FiSlash size={14} /> : <FiCheckCircle size={14} />}</button>
                              <button type="button" title="Edit rule" aria-label="Edit rule" disabled={!!busy} onClick={() => startEdit(r)} className="p-1.5 rounded text-gray-400 hover:text-orange-600 hover:bg-orange-50 disabled:opacity-30"><FiEdit2 size={14} /></button>
                              <button type="button" title="Delete rule" aria-label="Delete rule" disabled={!!busy} onClick={() => removeRule(r)} className="p-1.5 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"><FiTrash2 size={14} /></button>
                            </>}
                          </div>
                        </td>
                      </tr>
                    )
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {adding && <RuleForm draft={draft} options={options} onChange={setDraft} onSubmit={addRule} onCancel={() => setAdding(false)} busy={busy === "add"} submitLabel="Add rule" />}
          {list.length >= maxRules && <p className="text-[11px] text-gray-400">Maximum of {maxRules} rules reached — delete one before adding another.</p>}
        </div>
      )}
    </Section>
  )
}

/* ── AI Mapping Detected (spec A§2, A§3, A§4, A§13, A§14) ──────────────── */

/**
 * The A§2 review screen: WHAT the analyser proposed, HOW sure it is, and the
 * two things a human may do about it — change any field (which re-uses the
 * mapping editor already on this page, section 3) or approve it, which is the
 * ONLY moment anything is written (A§14).
 *
 * Everything here is rendered from the analyse response:
 *   labels.mapping / labels.rules  §A13 — "AI Generated" only when a MODEL answered
 *   proposal.column_map            the "POS Code → PLU" list
 *   proposal.format / currency     header row · date format · decimal separator
 *   proposal.exclusion_rules[].source   §A13 per rule — ai vs manual
 *   confidence { overall, threshold, needs_review }   decimal STRINGS
 *   warnings [{ code, params }]    machine codes, worded by WARNING_TEXT above
 *   preview.summary / .flagged_rows   §A4 counts and the inspectable rows
 * `saved:false` is the server saying it stored nothing.
 */
function AiMappingPanel({ analysis, appliedFields, currentProposal, canWrite, busy, onModify, onApprove, onDismiss }) {
  const [showRows, setShowRows] = useState(false)
  if (!analysis) return null
  const p = analysis.proposal || {}
  const conf = analysis.confidence || {}
  const preview = analysis.preview || null
  const summary = rowSummaryOf(preview)
  const flagged = preview?.flagged_rows || []
  const modified = appliedFields || []
  const aiConfigured = analysis.ai_configured !== false
  // §A13 — the label the SERVER derived, downgraded to Manually Modified the
  // moment a human touches a field. Never guessed from a client-side flag.
  const baseLabel = (analysis.labels && analysis.labels.mapping) || (p.ai_generated ? "ai_generated" : "auto_detected")
  const mappingLabel = modified.length ? "manually_modified" : baseLabel
  const rulesLabel = (analysis.labels && analysis.labels.rules) || baseLabel
  const rules = Array.isArray(p.exclusion_rules) ? p.exclusion_rules : []
  const proposedRules = rules
  const mapped = Object.entries(currentProposal?.column_map || p.column_map || {})
  const band = confidenceBand(conf.overall, conf.threshold)
  const bandChip = band === "low" ? "bg-red-50 text-red-700 border-red-200" : band === "medium" ? "bg-amber-50 text-amber-700 border-amber-200" : band === "high" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-gray-100 text-gray-600 border-gray-200"
  const fieldConf = conf.fields || null            // per-field scores when the tier sends them
  const resolved = preview?.validation?.resolved || {}
  const unresolved = new Set((preview?.validation?.unresolved || []).map((u) => u.field))

  return (
    <Section
      title="AI Mapping Detected"
      subtitle="Nothing has been saved. Review every field, change anything that is wrong, then press Save Profile — that approval is what creates the profile."
      right={<>
        {analysis.provider && <span className="text-[11px] text-gray-400">{analysis.provider}{analysis.model ? ` · ${analysis.model}` : ""}</span>}
        {onDismiss && <button type="button" onClick={onDismiss} className={btnSecondary}><FiX size={13} /> Dismiss</button>}
      </>}
      className="border-violet-200"
    >
      <div className="space-y-3">
        {/* §A13 indicators */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-semibold ${MAPPING_CHIP[mappingLabel] || MAPPING_CHIP.auto_detected}`}>
            {mappingLabel === "ai_generated" ? <FiCpu size={11} /> : mappingLabel === "manually_modified" ? <FiUser size={11} /> : <FiZap size={11} />}
            {MAPPING_LABEL[mappingLabel] || humanize(mappingLabel)}
          </span>
          <span className="text-gray-500">{MAPPING_NOTE[mappingLabel] || ""}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-semibold ${bandChip}`}>Confidence {pctText(conf.overall)}</span>
          {conf.needs_review && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700 font-semibold"><FiAlertTriangle size={11} /> Needs Review</span>}
          {analysis.saved === false && <span className="inline-flex items-center gap-1 text-gray-400"><FiLock size={11} /> Nothing saved yet</span>}
        </div>

        {/* the one line that keeps a server with no AI key usable (A§14 fall-back) */}
        {!aiConfigured && (
          <Notice tone="info">
            <span className="inline-flex items-center gap-1.5"><FiInfo size={12} /> No AI import analyser is configured for this server, so this mapping is LYVO&apos;s own reading of the file&apos;s headings. Check every field before you approve it.</span>
          </Notice>
        )}
        {aiConfigured && !analysis.available && (
          <Notice tone="warn">
            <span className="inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> The AI import analyser did not answer, so this mapping is LYVO&apos;s own reading of the file&apos;s headings. Check every field before you approve it.</span>
          </Notice>
        )}

        {/* A§2 — the mapping as a readable list */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                <th className="text-left px-3 py-2">LYVO field</th>
                <th className="text-left px-3 py-2">Source column</th>
                <th className="text-left px-3 py-2">Confidence</th>
                <th className="text-left px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mapped.length === 0 && <tr><td colSpan={4} className="px-3 py-3 text-xs text-gray-400">No column could be read from this file — map them by hand in section 3 below.</td></tr>}
              {mapped.map(([field, column]) => {
                const wasModified = modified.includes(`column_map.${field}`)
                const notInFile = unresolved.has(field)
                return (
                  <tr key={field}>
                    <td className="px-3 py-2">
                      <div className="font-medium text-gray-800">{FIELD_META[field]?.label || humanize(field)}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{field}</div>
                    </td>
                    <td className="px-3 py-2 text-gray-700">
                      <span className="text-gray-400">→</span> <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">{String(column)}</span>
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">
                      {fieldConf && fieldConf[field] != null
                        ? pctText(fieldConf[field])
                        : <span title="This analyser scores the mapping as a whole, not field by field.">{pctText(conf.overall)} <span className="text-gray-400">(overall)</span></span>}
                    </td>
                    <td className="px-3 py-2">
                      {wasModified
                        ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-50 text-amber-700"><FiUser size={11} /> {MAPPING_LABEL.manually_modified}</span>
                        : notInFile
                          ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-red-50 text-red-700"><FiAlertTriangle size={11} /> Not in this file</span>
                          : resolved[field]
                            ? <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-emerald-50 text-emerald-700"><FiCheckCircle size={11} /> Found in the file</span>
                            : <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-gray-100 text-gray-600">{MAPPING_LABEL[baseLabel] || humanize(baseLabel)}</span>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* A§1 / A§5 — the rest of what was detected */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
          <Stat label="Header row" value={p.format?.header_row ?? "—"} />
          <Stat label="Date format" value={p.format?.date_format || "auto"} />
          <Stat label="Decimal separator" value={p.format?.decimal_separator === "," ? "Comma ( , )" : "Point ( . )"} />
          <Stat label="Delimiter" value={DELIM_LABEL[p.format?.delimiter] || p.format?.delimiter || "auto"} />
          <Stat label="Currency" value={p.currency || "—"} />
        </div>
        {(p.filename_pattern || p.known_sender_email) && (
          <p className="text-[11px] text-gray-400">
            {p.filename_pattern ? `File-name pattern: ${p.filename_pattern}` : ""}{p.filename_pattern && p.known_sender_email ? " · " : ""}{p.known_sender_email ? `Known sender: ${p.known_sender_email}` : ""}
          </p>
        )}

        {/* A§3 — the proposed row rules, each labelled with who proposed it */}
        <div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] mb-1">
            <span className="font-semibold text-gray-700">Proposed row rules</span>
            {rules.length > 0 && rulesLabel === "ai_generated" && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-violet-200 bg-violet-50 text-violet-700 font-medium"><FiCpu size={11} /> {RULE_SOURCE_NOTE.ai}</span>}
          </div>
          {rules.length === 0
            ? <p className="text-xs text-gray-400">None proposed. LYVO still excludes repeated headers, total / subtotal footers, blank and separator rows on its own.</p>
            : (
              <ul className="space-y-1">
                {rules.map((r, i) => {
                  const src = ruleSourceLocal(proposedRules, r)
                  return (
                    <li key={r.id || i} className="flex flex-wrap items-center gap-2 text-sm text-gray-700">
                      <span className="font-medium">{RULE_FIELD_LABEL[r.field] || humanize(r.field)}</span>
                      <span className="text-gray-500">{RULE_OP_LABEL[r.op] || humanize(r.op)}</span>
                      {r.value ? <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">{r.value}</span> : null}
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium ${src === "ai" ? "bg-violet-50 text-violet-700" : "bg-gray-100 text-gray-600"}`}>
                        {src === "ai" ? <FiCpu size={11} /> : <FiUser size={11} />} {RULE_SOURCE_BADGE[src]}
                      </span>
                      {r.note && <span className="text-[11px] text-gray-400">{r.note}</span>}
                    </li>
                  )
                })}
              </ul>
            )}
        </div>

        {/* A§4 — the preview, computed by LYVO from the proposal that would be stored */}
        {summary && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <Stat label="Rows detected" value={summary.rows} />
              <Stat label="Valid sales rows" value={summary.product} />
              <Stat label="Summary / header rows excluded" value={summary.excluded} tone={summary.excluded ? "warn" : ""} />
              <Stat label="Suspicious rows requiring review" value={summary.suspicious} tone={summary.suspicious ? "danger" : ""} />
            </div>
            <p className="text-[11px] text-gray-400">
              {summary.rows} rows detected · {summary.product} valid sales rows · {summary.excluded} summary/header row(s) excluded · {summary.suspicious} suspicious row(s) requiring review.
              {summary.partial ? ` Only the first ${summary.classified} rows were classified.` : ""}
            </p>
            {(summary.excluded > 0 || summary.suspicious > 0) && (
              <div>
                <button type="button" onClick={() => setShowRows((v) => !v)} className={btnSecondary}>
                  <FiFilter size={13} /> {showRows ? "Hide excluded rows" : `Inspect excluded rows (${flagged.length})`}
                </button>
                {showRows && (
                  <div className="mt-2 overflow-auto max-h-72 border border-gray-100 rounded-lg">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-500">#</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Item</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Qty</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Net sales</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Verdict</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Why</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flagged.map((r) => {
                          const c = r.classification || {}
                          const cells = Array.isArray(r.raw) ? r.raw : Object.values(r.raw || {})
                          const name = r.fields?.item_name || r.fields?.pos_code || cells.find((v) => String(v || "").trim() !== "") || "—"
                          return (
                            <tr key={r.row_no} className="border-t border-gray-50">
                              <td className="px-2 py-1 text-gray-400">{r.row_no}</td>
                              <td className="px-2 py-1 text-gray-700 max-w-[220px] truncate" title={String(name)}>{String(name)}</td>
                              {/* decimal STRINGS straight from the API — never parsed into a float to be shown */}
                              <td className="px-2 py-1 font-mono text-gray-700">{r.fields?.quantity_sold ?? "—"}</td>
                              <td className="px-2 py-1 font-mono text-gray-700">{r.fields?.net_sales_total ?? "—"}</td>
                              <td className="px-2 py-1"><span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${ROW_KIND_CHIP[c.kind] || ROW_KIND_CHIP.excluded}`}>{ROW_KIND_LABEL[c.kind] || humanize(c.kind)}</span></td>
                              <td className="px-2 py-1 text-gray-600">{reasonText(c)}</td>
                            </tr>
                          )
                        })}
                        {flagged.length === 0 && <tr><td colSpan={6} className="px-2 py-3 text-gray-400">Nothing to inspect.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
            {summary.product === 0 && summary.rows > 0 && (
              <Notice tone="error"><span className="inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> No sale rows in this file — every row was excluded or parked for review. Change the mapping before approving it.</span></Notice>
            )}
          </div>
        )}

        {/* Machine warning codes, worded here */}
        {(analysis.warnings || []).length > 0 && (
          <Notice tone="warn">
            <div className="font-semibold inline-flex items-center gap-1.5"><FiInfo size={12} /> What LYVO changed or could not use</div>
            <ul className="list-disc ml-5 mt-1 space-y-0.5">
              {(analysis.warnings || []).map((w, i) => <li key={`${w.code}-${i}`}>{warningText(w)}</li>)}
            </ul>
          </Notice>
        )}

        {/* A§2 "Modify Mapping" + A§14 the single commit point */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={onModify} disabled={!!busy} className={btnPrimary}><FiEdit2 size={13} /> Modify Mapping</button>
            <button type="button" onClick={onApprove} disabled={!!busy || mapped.length === 0} className={btnSecondary}><FiSave size={13} /> {busy === "approve" ? "Saving…" : "Save Profile"}</button>
            <span className="text-[11px] text-gray-500">Modify Mapping loads this proposal into the mapping editor below, where any field can be changed. Nothing is stored until Save Profile.</span>
          </div>
        )}
      </div>
    </Section>
  )
}

/* ── Sales Format Changed — Review Required (spec A§9, A§13, A§17) ─────── */

/**
 * The A§9 review screen. POST /profiles/:id/analyse-change compares the till's
 * NEW export against the saved profile and proposes an UPDATE or a NEW
 * profile; it writes nothing (`saved:false`). Both buttons are always offered
 * — the recommendation is advice, and the approval is the only commit (A§14).
 *
 * Everything is rendered from the payload:
 *   change.changes[].code + params    the diff, worded by CHANGE_TEXT above
 *   recommendation.action/reason_code update | new_profile, and why
 *   previous_profile                  what it is being compared against
 *   proposal / preview                the new mapping and its A§4 counts
 *   approve.update / approve.new_profile / approve.fingerprint
 */
function FormatChangePanel({ analysis, canWrite, busy, onApprove, onDismiss }) {
  if (!analysis) return null
  const change = analysis.change || { changes: [], severity: "unknown", breaking: false, comparable: false }
  const rec = analysis.recommendation || null
  const prev = analysis.previous_profile || null
  const p = analysis.proposal || {}
  const summary = rowSummaryOf(analysis.preview)
  const mapped = Object.entries(p.column_map || {})
  const aiConfigured = analysis.ai_configured !== false
  const stateLabel = FORMAT_STATE_LABEL[analysis.labels?.state] || FORMAT_STATE_LABEL.format_changed
  const stateChip = FORMAT_STATE_CHIP[analysis.labels?.state] || FORMAT_STATE_CHIP.format_changed
  const mappingLabel = analysis.labels?.mapping || "auto_detected"
  const canGoLive = analysis.preview?.validation?.ok === true

  return (
    <Section
      title="Sales Format Changed — Review Required"
      subtitle="Nothing has been saved. Read what moved, then either update this profile in place or keep it and start a second one for the new report."
      right={<>
        {analysis.provider && <span className="text-[11px] text-gray-400">{analysis.provider}{analysis.model ? ` · ${analysis.model}` : ""}</span>}
        {onDismiss && <button type="button" onClick={onDismiss} className={btnSecondary}><FiX size={13} /> Dismiss</button>}
      </>}
      className="border-amber-200"
    >
      <div className="space-y-3">
        {/* §A13 indicators */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-semibold ${stateChip}`}><FiShuffle size={11} /> {stateLabel}</span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-semibold ${MAPPING_CHIP[mappingLabel] || MAPPING_CHIP.auto_detected}`}>
            {mappingLabel === "ai_generated" ? <FiCpu size={11} /> : <FiZap size={11} />} {MAPPING_LABEL[mappingLabel] || humanize(mappingLabel)}
          </span>
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-semibold ${change.severity === "major" ? "bg-red-50 text-red-700 border-red-200" : change.severity === "minor" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}>
            {CHANGE_SEVERITY_LABEL[change.severity] || humanize(change.severity)}
          </span>
          {analysis.saved === false && <span className="inline-flex items-center gap-1 text-gray-400"><FiLock size={11} /> Nothing saved yet</span>}
        </div>

        {!aiConfigured && (
          <Notice tone="info"><span className="inline-flex items-center gap-1.5"><FiInfo size={12} /> No AI import analyser is configured for this server, so this reading of the new layout is LYVO&apos;s own. Check every field before you approve it.</span></Notice>
        )}
        {aiConfigured && analysis.available === false && (
          <Notice tone="warn"><span className="inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> The AI import analyser did not answer, so this reading of the new layout is LYVO&apos;s own. Check every field before you approve it.</span></Notice>
        )}

        {/* A§9 step 1 — WHAT changed */}
        <div>
          <div className="text-xs font-semibold text-gray-700">What changed since the saved format</div>
          {prev && <div className="text-[11px] text-gray-400">Compared against &quot;{prev.name}&quot; ({IMPORT_LABEL[prev.import_type] || prev.import_type}).</div>}
          {change.changes.length > 0
            ? <ul className="list-disc ml-5 mt-1 space-y-0.5 text-sm text-gray-700">{change.changes.map((c, i) => <li key={`${c.code}-${i}`}>{changeText(c)}</li>)}</ul>
            : <p className="text-xs text-gray-400 mt-1">{change.comparable ? "Nothing measurable changed since the saved structure." : "There is no saved structure to compare this file against yet."}</p>}
          {change.breaking && (
            <Notice tone="error"><span className="inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> A column LYVO relies on is missing from this file — the old rules would silently read the wrong values, which is why nothing was imported.</span></Notice>
          )}
        </div>

        {/* A§9 step 3 — the recommendation, never a decision */}
        {rec && (
          <div className="rounded-xl border border-violet-200 bg-violet-50/50 px-3 py-2">
            <div className="text-xs font-semibold text-violet-800 inline-flex items-center gap-1.5"><FiCpu size={12} /> LYVO recommends: {CHANGE_ACTION_LABEL[rec.action] || humanize(rec.action)}</div>
            <p className="text-[11px] text-violet-700 mt-0.5">{changeReasonText(rec)}</p>
            <p className="text-[11px] text-gray-500 mt-0.5">Both options stay open — nothing happens until you press one of the buttons below.</p>
          </div>
        )}

        {/* the NEW mapping */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr><th className="text-left px-3 py-2">LYVO field</th><th className="text-left px-3 py-2">Source column</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {mapped.length === 0 && <tr><td colSpan={2} className="px-3 py-3 text-xs text-gray-400">No column could be read from this file — map the new columns by hand in section 3 below.</td></tr>}
              {mapped.map(([field, column]) => (
                <tr key={field}>
                  <td className="px-3 py-2"><div className="font-medium text-gray-800">{FIELD_META[field]?.label || humanize(field)}</div><div className="text-[11px] text-gray-400 font-mono">{field}</div></td>
                  <td className="px-3 py-2 text-gray-700"><span className="text-gray-400">→</span> <span className="font-mono text-xs bg-gray-100 rounded px-1.5 py-0.5">{String(column)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {summary && (
          <p className="text-[11px] text-gray-400">
            {summary.rows} rows detected · {summary.product} valid sales rows · {summary.excluded} summary/header row(s) excluded · {summary.suspicious} suspicious row(s) requiring review.
          </p>
        )}
        {analysis.rules_carried_over > 0 && (
          <p className="text-[11px] text-gray-500">{analysis.rules_carried_over} row rule(s) this customer already taught the profile travel with the update.</p>
        )}
        {!canGoLive && <Notice tone="warn">Some required columns are still unmapped, so approving this saves a draft. Map them in section 3 and activate the profile when it is complete.</Notice>}

        {(analysis.warnings || []).length > 0 && (
          <Notice tone="warn">
            <div className="font-semibold inline-flex items-center gap-1.5"><FiInfo size={12} /> What LYVO changed or could not use</div>
            <ul className="list-disc ml-5 mt-1 space-y-0.5">{(analysis.warnings || []).map((w, i) => <li key={`${w.code}-${i}`}>{warningText(w)}</li>)}</ul>
          </Notice>
        )}

        {/* A§14 — the single commit point, reached two ways */}
        {canWrite && (
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button type="button" onClick={() => onApprove("update")} disabled={!!busy || mapped.length === 0 || !prev} className={btnPrimary}>
              <FiCheckCircle size={13} /> {busy === "approve_update" ? "Updating…" : "Update this profile"}
            </button>
            <button type="button" onClick={() => onApprove("new_profile")} disabled={!!busy || mapped.length === 0} className={btnSecondary}>
              <FiPlusCircle size={13} /> {busy === "approve_new" ? "Saving…" : "Save as a new profile"}
            </button>
            <span className="text-[11px] text-gray-500">Updating teaches this profile the new structure, so the same till is not parked again tomorrow. A new profile leaves the old report working.</span>
          </div>
        )}
      </div>
    </Section>
  )
}

/* ── Suspicious Row — Needs Review (spec A§10, A§13) ───────────────────── */

/**
 * A§10 — LYVO reads ONE flagged row and may recommend ONE exclusion rule
 * ("Likely report total — exclude from future imports"). Suggesting saves
 * nothing; agreeing adds the rule through the ordinary rule-add endpoint, so
 * it is validated exactly like a hand-written one and its provenance is
 * computed, not claimed.
 */
function RowRuleCard({ suggestion, canWrite, busy, onAccept, onDismiss, accepted }) {
  if (!suggestion) return null
  const s = suggestion.suggestion || {}
  const rule = s.rule || null
  const impact = s.impact || {}
  const aiConfigured = suggestion.ai_configured !== false
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3 space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-semibold ${ROW_KIND_CHIP.suspicious}`}><FiAlertTriangle size={11} /> Suspicious Row — Needs Review</span>
        <span className="text-gray-600">Row {suggestion.row?.row_no}</span>
        {suggestion.row?.reason_code && <span className="text-gray-500">· {reasonText(suggestion.row)}</span>}
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border font-semibold ${s.label === "ai_suggested" ? "bg-violet-50 text-violet-700 border-violet-200" : "bg-gray-100 text-gray-600 border-gray-200"}`}>
          <FiCpu size={11} /> {RULE_LABEL_TEXT[s.label] || humanize(s.label)}
        </span>
        {s.confidence != null && <span className="text-gray-500">Confidence {pctText(s.confidence)}</span>}
        {suggestion.saved === false && <span className="inline-flex items-center gap-1 text-gray-400"><FiLock size={11} /> Nothing saved yet</span>}
        {onDismiss && <button type="button" onClick={onDismiss} className="ml-auto text-gray-400 hover:text-gray-700"><FiX size={13} /></button>}
      </div>

      {!aiConfigured && <p className="text-[11px] text-gray-500">No AI import analyser is configured for this server, so this is LYVO&apos;s own reading of the row.</p>}
      {aiConfigured && suggestion.available === false && <p className="text-[11px] text-amber-700">The AI import analyser did not answer, so this is LYVO&apos;s own reading of the row.</p>}

      <p className="text-sm font-medium text-gray-800">{ROW_ADVICE_LABEL[s.action] || ROW_ADVICE_LABEL.review}</p>
      <p className="text-[11px] text-gray-600">{rowReasonText(s.reason_code)}</p>

      {rule ? (
        <p className="text-sm text-gray-800">Proposed rule: <span className="font-mono text-xs bg-white border border-gray-200 rounded px-1.5 py-0.5">{ruleSentence(rule)}</span></p>
      ) : (
        <p className="text-xs text-gray-600">LYVO could not work out a rule that is safe to apply to every future import. Write one yourself in section 4 if you disagree.</p>
      )}
      {rule && (
        <p className="text-[11px] text-gray-500">
          In this file the rule would exclude {impact.rows_excluded ?? 0} row(s){impact.row_numbers?.length ? ` (rows ${impact.row_numbers.join(", ")})` : ""}.
          {impact.verified === false ? " LYVO could not replay it over the whole file." : ""}
        </p>
      )}

      {(suggestion.warnings || []).length > 0 && (
        <ul className="list-disc ml-5 text-[11px] text-amber-800 space-y-0.5">{(suggestion.warnings || []).map((w, i) => <li key={`${w.code}-${i}`}>{warningText(w)}</li>)}</ul>
      )}

      {accepted ? (
        <p className="text-xs text-emerald-700 inline-flex items-center gap-1.5"><FiCheckCircle size={13} /> Added to the profile as {RULE_LABEL_TEXT[accepted.label] || humanize(accepted.label)} — rows like this are excluded from every future import. It is now in section 4 with the other row rules.</p>
      ) : canWrite && rule ? (
        <button type="button" onClick={onAccept} disabled={!!busy} className={btnPrimary}>
          {busy === "accept_rule" ? <FiLoader className="animate-spin" size={13} /> : <FiPlusCircle size={13} />} Add this rule to the profile
        </button>
      ) : null}
    </div>
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
  // Row rules (spec A§3) — stored on the profile, edited through their own endpoints.
  const [rules, setRules] = useState([])
  const [ruleOptions, setRuleOptions] = useState(null)
  // Preview: "inspect the excluded rows" (spec A§4).
  const [showFlagged, setShowFlagged] = useState(false)
  // Which run produced `preview`: the inline /csv/preview (no saved row rules)
  // or /profiles/:id/test (the profile itself, rules included).
  const [previewSource, setPreviewSource] = useState("inline")
  // A§2 — the AI's proposal for this sample. It lives in state ONLY: analysing
  // saves nothing (the server answers `saved:false`), and the profile is
  // written by Save Profile alone (A§14).
  const [analysis, setAnalysis] = useState(null)
  // Has the human pressed "Modify Mapping"? Until then the editor is untouched
  // and approval sends the proposal exactly as proposed.
  const [proposalApplied, setProposalApplied] = useState(false)
  const [approved, setApproved] = useState(null)   // { label, activated, modified_fields } from the approval
  // A§9 — the till's NEW export against THIS profile. Proposal only: the
  // response says `saved:false` and the commit is the approve call below.
  const [changeAnalysis, setChangeAnalysis] = useState(null)
  const [changeApproved, setChangeApproved] = useState(null)  // { label, activated, mode }
  // A§10 — the recommendation for ONE flagged row, and the rule that came of it.
  const [rowSuggestion, setRowSuggestion] = useState(null)
  const [acceptedRule, setAcceptedRule] = useState(null)
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
          defaults: businessDateRuleOf({ ...DEFAULT_DEFAULTS, ...(p.defaults || {}) }),
          sample_headers: Array.isArray(p.sample_headers) ? p.sample_headers : [],
        }
        if (f.format.thousands_separator == null) f.format.thousands_separator = ""
        setProfile(p)
        setRules(Array.isArray(p.exclusion_rules) ? p.exclusion_rules : [])
        setCustomer(p.customer ? { _id: p.customer._id, email: p.customer.email, name: p.customer.username } : { _id: p.adminId })
        setForm(f)
        setSnapshot(JSON.parse(JSON.stringify(f)))
        setDirty(false)
      })
      .catch((e) => { if (alive) setLoadErr(isDenied(e) ? "You do not have permission to view this profile." : errMsg(e, "Profile could not be loaded")) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [profileId])

  /* rule editor dropdown catalogue (fields / ops / limits) — no profile needed */
  useEffect(() => {
    let alive = true
    axios.get(`${SM}/exclusion-rule-options`, { _silentToast: true })
      .then(({ data }) => { if (alive && data?.data) setRuleOptions(data.data) })
      .catch(() => { if (alive) setRuleOptions(null) })   // the editor falls back to its own catalogue
    return () => { alive = false }
  }, [])

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
        setPreview(data.data); setPreviewSource("inline")
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
  // Spec A§4 — "83 rows detected / 80 valid sales rows / 2 excluded / 1 suspicious".
  const rowSummary = useMemo(() => rowSummaryOf(preview), [preview])
  const flaggedRows = preview?.flagged_rows || []
  // The live preview is an inline mapping run: the saved row rules are only
  // applied by "Test with sample", which runs the profile itself.
  const rulesPending = rules.some((r) => r.enabled) && previewSource === "inline"
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
    setAnalysis(null); setProposalApplied(false); setApproved(null)
    setChangeAnalysis(null); setChangeApproved(null); setRowSuggestion(null); setAcceptedRule(null)
  }
  const autoMap = () => {
    const sug = suggestMap(headers, form.import_type)
    if (!Object.keys(sug).length) { toast.warn("No obvious matches in the header row"); return }
    update({ column_map: { ...form.column_map, ...sug } })
  }
  const clearMap = () => update({ column_map: {} })

  /* ── A§1/A§2/A§14 — analyse, review, approve ─────────────────────────── */

  /** What the human is signing off: the proposal, or the editor once it was loaded into it. */
  const editorProposal = useMemo(() => ({
    name: form.name,
    import_type: form.import_type,
    column_map: form.column_map,
    format: form.format,
    defaults: form.defaults,
    currency: analysis?.proposal?.currency || "",
    filename_pattern: analysis?.proposal?.filename_pattern || "",
    known_sender_email: analysis?.proposal?.known_sender_email || "",
    exclusion_rules: analysis?.proposal?.exclusion_rules || [],
  }), [form, analysis])
  const approvedProposal = proposalApplied ? editorProposal : (analysis?.proposal || null)
  // §A13 — which fields a human changed, by the same comparison the approval
  // will make server-side. An untouched proposal changes nothing, so the label
  // stays "AI Generated"; touch one field and it becomes "Manually Modified".
  const modifiedFields = useMemo(
    () => (proposalApplied && analysis?.proposal ? diffProposalLocal(analysis.proposal, editorProposal) : []),
    [proposalApplied, analysis, editorProposal],
  )

  /**
   * POST /csv/analyse — PROPOSES a mapping for this sample. Saves nothing: no
   * profile, no import, no stock movement. A server with no AI key answers
   * `ai_configured:false` with LYVO's own deterministic reading, which is a
   * perfectly usable starting point, not an error.
   */
  const analyse = async () => {
    if (!file) { setErr("Upload a sample CSV first, then analyse it"); return }
    setBusy("analyse"); setErr("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("import_type", form.import_type)
      fd.append("rows", "20")
      if (customer?._id) fd.append("customer_id", String(customer._id))
      if (form.shop_id) fd.append("shop_id", form.shop_id)
      if (businessDate) fd.append("business_date", businessDate)
      const { data } = await axios.post(`${SM}/csv/analyse`, fd, { _silentToast: true })
      setAnalysis(data.data || null)
      setProposalApplied(false)
      setApproved(null)
      if (data.data?.available === false) toast.warn("This reading is LYVO's own, not an AI one — check every field before approving")
      else toast.success("Mapping proposed — nothing has been saved yet")
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  /** A§2 "Modify Mapping" — load the proposal into the mapping editor below. */
  const applyProposal = () => {
    const p = analysis?.proposal
    if (!p) return
    autoMappedRef.current = true          // the proposal wins over the header heuristic
    update({
      column_map: { ...(p.column_map || {}) },
      format: { ...DEFAULT_FORMAT, ...(p.format || {}) },
      defaults: businessDateRuleOf({ ...DEFAULT_DEFAULTS, ...(p.defaults || {}) }),
      name: form.name.trim() || p.name || "",
    })
    setProposalApplied(true)
    toast.success("Proposal loaded into the mapping editor — change any field, then Save Profile")
  }

  /**
   * POST /profiles/approve — THE commit point (A§5, A§14). Sends what the AI
   * proposed AND what the human approved, so the server can record which
   * fields were changed and label the profile truthfully.
   */
  const approveProposal = async () => {
    if (!analysis?.proposal || !approvedProposal) return
    if (!customer?._id) { setErr("Select a customer first"); return }
    const canGoLive = validation.ok && missingToActivate.length === 0
    setBusy("approve"); setErr("")
    try {
      const { data } = await axios.post(`${SM}/profiles/approve`, {
        customer_id: String(customer._id),
        shop_id: form.shop_id || null,
        import_type: form.import_type,
        source: form.source,
        name: form.name.trim() || analysis.proposal.name || "",
        proposal: analysis.proposal,
        approved: approvedProposal,
        profile_id: profile?._id ? String(profile._id) : undefined,
        sample_headers: headers.slice(0, 200),
        activate: canGoLive,
      }, { _silentToast: true })
      const row = data.data
      setProfile((prev) => ({ ...(prev || {}), ...row }))
      if (Array.isArray(row.exclusion_rules)) setRules(row.exclusion_rules)
      setApproved({ label: row.label, activated: row.activated, modified_fields: row.modified_fields || [], approved_by: row.approved_by, approved_at: row.approved_at })
      setSnapshot(JSON.parse(JSON.stringify({ ...form, name: (form.name.trim() || row.name || ""), sample_headers: headers.slice(0, 200) })))
      setForm((f) => ({ ...f, name: f.name.trim() || row.name || "" }))
      setDirty(false)
      onChanged?.()
      toast.success(row.activated ? "Profile saved and activated — sales can be processed with it now" : "Profile saved as a draft — map every required column, then activate it")
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  /* ── A§9 — the till changed its CSV format ────────────────────────────── */

  /**
   * POST /profiles/:id/analyse-change — compares the sample against THIS saved
   * profile and proposes an update or a new profile. Saves nothing.
   */
  const analyseChange = async () => {
    if (!file) { setErr("Upload the till's new export first, then analyse the change"); return }
    if (!profile?._id) { setErr("Save this profile first — a format change is measured against a saved profile"); return }
    setBusy("analyse_change"); setErr("")
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("rows", "20")
      if (businessDate) fd.append("business_date", businessDate)
      const { data } = await axios.post(`${SM}/profiles/${profile._id}/analyse-change`, fd, { _silentToast: true })
      setChangeAnalysis(data.data || null)
      setChangeApproved(null)
      if (data.data?.available === false) toast.warn("This reading of the new layout is LYVO's own, not an AI one — check it before approving")
      else toast.success("New layout read — nothing has been saved yet")
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  /**
   * A§14 — the SAME commit point as the first import. `update` carries the
   * profile id (edit in place), `new_profile` omits it, and the approved
   * fingerprint teaches the profile the structure just signed off so the same
   * till is not parked again tomorrow.
   */
  const approveChange = async (mode) => {
    const a = changeAnalysis
    if (!a?.proposal || !customer?._id) { setErr("Select a customer first"); return }
    setBusy(mode === "update" ? "approve_update" : "approve_new"); setErr("")
    try {
      const body = {
        customer_id: String(customer._id),
        shop_id: form.shop_id || null,
        import_type: a.approve?.import_type || form.import_type,
        source: form.source,
        proposal: a.proposal,
        approved: a.proposal,
        sample_headers: (a.approve?.sample_headers || headers).slice(0, 200),
        fingerprint: a.approve?.fingerprint || null,
        activate: a.preview?.validation?.ok === true,
      }
      if (mode === "update") body.profile_id = a.approve?.update?.profile_id || String(profile._id)
      else body.name = `${a.previous_profile?.name || form.name || "Sales import profile"} (new format)`
      const { data } = await axios.post(`${SM}/profiles/approve`, body, { _silentToast: true })
      const row = data.data
      setChangeApproved({ label: row.label, activated: row.activated, mode, name: row.name, id: String(row._id) })
      if (mode === "update") {
        setProfile((prev) => ({ ...(prev || {}), ...row }))
        if (Array.isArray(row.exclusion_rules)) setRules(row.exclusion_rules)
        setForm((f) => ({
          ...f,
          column_map: { ...(row.column_map || {}) },
          format: { ...DEFAULT_FORMAT, ...(row.format || {}) },
          defaults: businessDateRuleOf({ ...DEFAULT_DEFAULTS, ...(row.defaults || {}) }),
        }))
        setSnapshot(null)
        setDirty(false)
      }
      onChanged?.()
      toast.success(mode === "update" ? "Profile updated — this layout is the known format now" : "New profile saved — the old report keeps working")
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  /* ── A§10 — one suspicious row, one recommended rule ──────────────────── */

  /** POST /profiles/:id/suggest-row-rule — recommends at most one rule. Saves nothing. */
  const suggestRowRule = async (rowNo) => {
    if (!file) { setErr("Upload the sales file holding that row first"); return }
    if (!profile?._id) { setErr("Save this profile first — a row rule is stored on a saved profile"); return }
    setBusy("suggest_rule"); setErr(""); setAcceptedRule(null)
    try {
      const fd = new FormData()
      fd.append("file", file)
      fd.append("row_no", String(rowNo))
      if (businessDate) fd.append("business_date", businessDate)
      const { data } = await axios.post(`${SM}/profiles/${profile._id}/suggest-row-rule`, fd, { _silentToast: true })
      setRowSuggestion(data.data || null)
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

  /**
   * The onboarder agrees → the rule joins the profile through the ordinary
   * rule-add path (`suggested` rides along so provenance is COMPUTED). The
   * rules list refreshes from the answer, so section 4 shows it immediately.
   */
  const acceptRowRule = async () => {
    const rule = rowSuggestion?.suggestion?.rule
    if (!rule || !profile?._id) return
    setBusy("accept_rule"); setErr("")
    try {
      const { data } = await axios.post(`${SM}/profiles/${profile._id}/exclusion-rules`, { rule, suggested: rule }, { _silentToast: true })
      if (Array.isArray(data?.data)) setRules(data.data)
      setAcceptedRule({ label: data?.label || "", learned: !!data?.learned, rule: data?.rule || rule })
      onChanged?.()
      toast.success("Rule added — rows like this are excluded from every future import")
    } catch (e) { const m = errMsg(e); setErr(m); toast.error(m) } finally { setBusy("") }
  }

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
    // §6.6.4 — an offset the editor already knows is impossible never becomes a
    // request. The server refuses it too (SALE_DATE / BUSINESS_DATE_OFFSET_*),
    // and its sentence is the one a customer would read; this just stops the
    // round trip.
    if (form.defaults.sale_date_from === "received") {
      const bdErr = businessDateOffsetError(form.defaults.business_date_offset_days)
      if (bdErr) { setErr(bdErr); return null }
    }
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
      if (Array.isArray(row.exclusion_rules)) setRules(row.exclusion_rules)
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
      // stats/summary now come from the PROFILE run (row rules included); the
      // inspect list still holds the last inline scan — said so on screen.
      setPreview((prev) => ({ ...(prev || {}), headers: r.preview.headers, mapped_rows: r.preview.mapped_rows, stats: r.preview.stats, summary: r.preview.summary || null, validation: r.validation, format: r.preview.format }))
      setPreviewSource("test")
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
              {/* A§12 "Run AI mapping" — proposes only; nothing is saved by pressing it. */}
              {canWrite && (
                <button type="button" onClick={analyse} disabled={!!busy || !file} title={!file ? "Upload a sample CSV first" : "Propose a mapping for this file — nothing is saved"} className={btnSecondary}>
                  {busy === "analyse" ? <FiLoader className="animate-spin" size={13} /> : <FiCpu size={13} />} {busy === "analyse" ? "Analysing…" : analysis ? "Analyse again" : "Analyse with LYVO AI"}
                </button>
              )}
              {/* A§9 — the till redecorated its report: compare THIS file with the saved profile. */}
              {canWrite && profile?._id && (
                <button type="button" onClick={analyseChange} disabled={!!busy || !file} title={!file ? "Upload the till's new export first" : "Compare this file with the saved profile — nothing is saved"} className={btnSecondary}>
                  {busy === "analyse_change" ? <FiLoader className="animate-spin" size={13} /> : <FiShuffle size={13} />} {busy === "analyse_change" ? "Comparing…" : "Review format change"}
                </button>
              )}
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
                  <BusinessDateRule
                    defaults={form.defaults}
                    onChange={(d) => update({ defaults: { ...form.defaults, ...d } })}
                    hasDateColumn={resolves(form.column_map.sale_date, headers)}
                    disabled={readOnly}
                    resolved={preview?.business_date_rule || testResult?.business_date_rule || null}
                  />
                )}
                {isDaily && form.defaults.sale_date_from !== "column" && (
                  <Field label="Business date for this preview / test" hint="A date typed here beats the rule, exactly as a business date typed on a real upload does.">
                    <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} className={inputCls} />
                  </Field>
                )}
              </div>
            </div>
          </Section>

          {/* ── 2b. AI Mapping Detected (spec A§2 / A§4 / A§13 / A§17) ── */}
          {busy === "analyse" && !analysis && (
            <Notice tone="info"><span className="inline-flex items-center gap-1.5"><FiLoader className="animate-spin" size={12} /> Analysing this file… nothing is being saved.</span></Notice>
          )}
          <AiMappingPanel
            analysis={analysis}
            appliedFields={modifiedFields}
            currentProposal={proposalApplied ? editorProposal : null}
            canWrite={canWrite}
            busy={busy}
            onModify={applyProposal}
            onApprove={approveProposal}
            onDismiss={() => { setAnalysis(null); setProposalApplied(false) }}
          />
          {/* ── 2c. Sales Format Changed — Review Required (spec A§9 / A§13 / A§17) ── */}
          {busy === "analyse_change" && !changeAnalysis && (
            <Notice tone="info"><span className="inline-flex items-center gap-1.5"><FiLoader className="animate-spin" size={12} /> Comparing this file with the saved format… nothing is being saved.</span></Notice>
          )}
          <FormatChangePanel
            analysis={changeAnalysis}
            canWrite={canWrite}
            busy={busy}
            onApprove={approveChange}
            onDismiss={() => { setChangeAnalysis(null); setChangeApproved(null) }}
          />
          {changeApproved && (
            <Notice tone="success">
              <span className="inline-flex items-center gap-1.5">
                <FiCheckCircle size={13} />
                {changeApproved.mode === "update"
                  ? <>Profile updated — this layout is the <strong>Known Format</strong> now, so the next file like it is processed automatically.</>
                  : <>Saved as a new profile <strong>{changeApproved.name}</strong> — the old report keeps working with the original profile.</>}
                {changeApproved.activated ? " It is live now." : " It is saved as a draft until every required column is mapped."}
              </span>
            </Notice>
          )}

          {approved && (
            <Notice tone="success">
              <span className="inline-flex items-center gap-1.5">
                <FiCheckCircle size={13} /> Profile saved as <strong>{MAPPING_LABEL[approved.label] || humanize(approved.label)}</strong>
                {approved.modified_fields?.length ? ` — you changed ${approved.modified_fields.length} field(s): ${approved.modified_fields.join(", ")}` : " — approved exactly as proposed"}
                {approved.activated ? " · live now, sales can be processed with it" : " · saved as a draft until every required column is mapped"}
                {approved.approved_by?.name ? ` · approved by ${approved.approved_by.name}` : ""}
              </span>
            </Notice>
          )}

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

          {/* ── 4. Row rules (spec A§3) ── */}
          <RowRulesSection profileId={profile?._id ? String(profile._id) : ""} canWrite={canWrite} rules={rules} options={ruleOptions} onRules={setRules} />

          {/* ── 5. Preview ── */}
          <Section
            title="5. Import preview"
            subtitle={preview?.stats ? `${preview.stats.previewed} of ${preview.stats.row_count} rows shown · ${preview.stats.ok_rows} OK · ${preview.stats.error_rows} with errors` : "Upload a sample CSV to preview the first 20 mapped rows."}
          >
            {/* Spec A§4 — the four counts, before anything is imported. */}
            {rowSummary && (
              <div className="mb-3 space-y-2">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  <Stat label="Rows detected" value={rowSummary.rows} />
                  <Stat label="Valid sales rows" value={rowSummary.product} />
                  <Stat label="Summary / header rows excluded" value={rowSummary.excluded} tone={rowSummary.excluded ? "warn" : ""} />
                  <Stat label="Suspicious rows requiring review" value={rowSummary.suspicious} tone={rowSummary.suspicious ? "danger" : ""} />
                </div>
                <p className="text-[11px] text-gray-400">
                  {rowSummary.rows} rows detected · {rowSummary.product} valid sales rows · {rowSummary.excluded} summary/header row(s) excluded · {rowSummary.suspicious} suspicious row(s) requiring review.
                  {rowSummary.partial ? ` Only the first ${rowSummary.classified} rows were classified.` : ""}
                </p>
                {rulesPending && (
                  <Notice tone="info"><span className="inline-flex items-center gap-1.5"><FiInfo size={12} /> These counts come from LYVO&apos;s automatic detection only. Press <strong>Test with sample</strong> to run the saved row rules over the same file.</span></Notice>
                )}
                {rowSummary.product === 0 && rowSummary.rows > 0 && (
                  <Notice tone="error"><span className="inline-flex items-center gap-1.5"><FiAlertTriangle size={13} /> No sale rows in this file — every row was excluded or parked for review. Check the column mapping and the row rules above.</span></Notice>
                )}
              </div>
            )}

            {/* Spec A§4 — "the user should be able to inspect excluded rows". */}
            {(rowSummary?.excluded || rowSummary?.suspicious) ? (
              <div className="mb-3">
                <button type="button" onClick={() => setShowFlagged((v) => !v)} className={btnSecondary}>
                  <FiFilter size={13} /> {showFlagged ? "Hide excluded rows" : `Inspect excluded rows (${flaggedRows.length})`}
                </button>
                {showFlagged && (
                  <div className="mt-2 overflow-auto max-h-80 border border-gray-100 rounded-lg">
                    <table className="w-full text-xs min-w-[720px]">
                      <thead className="bg-gray-50 sticky top-0">
                        <tr>
                          <th className="text-left px-2 py-1.5 text-gray-500">#</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Item</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Qty</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Net sales</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Verdict</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Why</th>
                          <th className="text-left px-2 py-1.5 text-gray-500">Teach LYVO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {flaggedRows.map((r) => {
                          const c = r.classification || {}
                          const cells = Array.isArray(r.raw) ? r.raw : Object.values(r.raw || {})
                          const name = r.fields?.item_name || r.fields?.pos_code || cells.find((v) => String(v || "").trim() !== "") || "—"
                          // A§10 — only a SUSPICIOUS row is worth a new rule; an
                          // excluded one is already handled deterministically.
                          const canTeach = canWrite && !!profile?._id && !!file && c.kind === "suspicious"
                          const taught = acceptedRule && rowSuggestion?.row?.row_no === r.row_no
                          return (
                            <tr key={r.row_no} className="border-t border-gray-50">
                              <td className="px-2 py-1 text-gray-400">{r.row_no}</td>
                              <td className="px-2 py-1 text-gray-700 max-w-[220px] truncate" title={String(name)}>{String(name)}</td>
                              <td className="px-2 py-1 font-mono text-gray-700">{r.fields?.quantity_sold ?? "—"}</td>
                              <td className="px-2 py-1 font-mono text-gray-700">{r.fields?.net_sales_total ?? "—"}</td>
                              <td className="px-2 py-1"><span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold ${ROW_KIND_CHIP[c.kind] || ROW_KIND_CHIP.excluded}`}>{ROW_KIND_LABEL[c.kind] || humanize(c.kind)}</span></td>
                              <td className="px-2 py-1 text-gray-600">{reasonText(c)}</td>
                              <td className="px-2 py-1">
                                {taught
                                  ? <span className="inline-flex items-center gap-1 text-emerald-700"><FiCheckCircle size={12} /> Rule added</span>
                                  : canTeach
                                    ? <button type="button" onClick={() => suggestRowRule(r.row_no)} disabled={!!busy} className="inline-flex items-center gap-1 text-orange-600 hover:underline disabled:opacity-40"><FiCpu size={12} /> Suggest a rule</button>
                                    : <span className="text-gray-300">—</span>}
                              </td>
                            </tr>
                          )
                        })}
                        {flaggedRows.length === 0 && <tr><td colSpan={7} className="px-2 py-3 text-gray-400">Nothing to inspect from the last scan.</td></tr>}
                      </tbody>
                    </table>
                    {previewSource === "test" && <p className="text-[11px] text-gray-400 px-2 py-1.5">This list is from the last automatic scan of the file; the counts above are from the test run of the saved profile.</p>}
                  </div>
                )}
                {/* A§10 — the recommendation for the row that was asked about. */}
                {(busy === "suggest_rule" || rowSuggestion) && (
                  <div className="mt-2">
                    {busy === "suggest_rule" && !rowSuggestion
                      ? <Notice tone="info"><span className="inline-flex items-center gap-1.5"><FiLoader className="animate-spin" size={12} /> Reading that row… nothing is being saved.</span></Notice>
                      : <RowRuleCard suggestion={rowSuggestion} canWrite={canWrite} busy={busy} accepted={acceptedRule} onAccept={acceptRowRule} onDismiss={() => { setRowSuggestion(null); setAcceptedRule(null) }} />}
                  </div>
                )}
              </div>
            ) : null}

            {!preview?.mapped_rows?.length && <p className="text-xs text-gray-400">{file ? (previewBusy ? "Parsing…" : "No rows to show.") : "No sample file loaded."}</p>}
            {preview?.mapped_rows?.length > 0 && (
              <div className="overflow-auto max-h-80 border border-gray-100 rounded-lg">
                <table className="w-full text-xs min-w-[720px]">
                  <thead className="bg-gray-50 sticky top-0">
                    <tr>
                      <th className="text-left px-2 py-1.5 text-gray-500">#</th>
                      <th className="text-left px-2 py-1.5 text-gray-500">OK</th>
                      <th className="text-left px-2 py-1.5 text-gray-500">Row</th>
                      {fields.filter((f) => form.column_map[f] || preview.mapped_rows.some((r) => r.fields?.[f] != null)).map((f) => <th key={f} className="text-left px-2 py-1.5 text-gray-500 whitespace-nowrap">{FIELD_META[f]?.label || f}</th>)}
                      <th className="text-left px-2 py-1.5 text-gray-500">Errors</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.mapped_rows.map((r) => (
                      <tr key={r.row_no} className={`border-t border-gray-50 ${(r.classification?.kind || "product") !== "product" ? "bg-gray-50/60" : r.ok ? "" : "bg-red-50/40"}`}>
                        <td className="px-2 py-1 text-gray-400">{r.row_no}</td>
                        <td className="px-2 py-1">{(r.classification?.kind || "product") !== "product" ? <span className="text-gray-300">—</span> : r.ok ? <FiCheckCircle className="text-emerald-500" size={13} /> : <FiAlertTriangle className="text-red-500" size={13} />}</td>
                        <td className="px-2 py-1" title={reasonText(r.classification)}>
                          <span className={`px-2 py-0.5 rounded-full border text-[11px] font-semibold whitespace-nowrap ${ROW_KIND_CHIP[r.classification?.kind] || ROW_KIND_CHIP.product}`}>{ROW_KIND_LABEL[r.classification?.kind] || ROW_KIND_LABEL.product}</span>
                        </td>
                        {fields.filter((f) => form.column_map[f] || preview.mapped_rows.some((x) => x.fields?.[f] != null)).map((f) => {
                          const v = r.fields?.[f]
                          const s = v == null ? "" : typeof v === "object" ? (v.iso_date || v.datetime || "") : String(v)
                          return <td key={f} className="px-2 py-1 font-mono text-gray-700 whitespace-nowrap max-w-[220px] truncate" title={s}>{s || <span className="text-gray-300">—</span>}</td>
                        })}
                        {/* an excluded row is not an error, however badly its cells parse */}
                        <td className={`px-2 py-1 ${(r.classification?.kind || "product") === "product" ? "text-red-600" : "text-gray-500"}`}>{(r.classification?.kind || "product") === "product" ? (r.errors || []).join("; ") : reasonText(r.classification)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          {/* ── 6. Test result ── */}
          {testResult && (
            <Section title="6. Test result" subtitle={`Last tested ${fmtDT(testResult.profile?.last_tested_at)}`}>
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

          {/* ── 7. Inbound e-mail (daily sales, per location) ── */}
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
      <div className={`text-sm font-semibold ${tone === "danger" ? "text-red-600" : tone === "warn" ? "text-amber-600" : "text-gray-900"}`}>{value}</div>
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
              <input value={filters.search} onChange={(e) => setFilter("search", e.target.value)} placeholder="Search profile name…" className={`${inputCls} !pl-8`} />
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
                      <td className="px-4 py-2.5 font-medium text-gray-900">
                        {p.name}
                        {/* §6.6.4 — the business date rule at a glance, so an
                            onboarder does not have to open a profile to see
                            which day tomorrow's e-mailed file will get. */}
                        {p.import_type === "daily_sales" && <div className="text-[11px] text-gray-400 font-normal">Business date: {businessDateRuleWords(p.defaults)}</div>}
                      </td>
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
