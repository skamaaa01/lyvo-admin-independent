/**
 * Back-office ticket detail.
 * ─────────────────────────────────────────────────────────────────────────
 * Endpoint: GET /api/admin/tickets/:id  — returns the ticket, full message
 * thread (including internal notes), file list, status history, customer
 * account info, and current assignee.
 *
 * Actions the support agent can take from here (all admin/support roles):
 *   • Reply publicly      → POST :id/reply
 *   • Add an internal note → POST :id/reply with is_internal_note=true
 *   • Change status        → PUT  :id/status
 *   • Assign / unassign    → PUT  :id/assign
 *   • Download attachments → GET  :id/files/:fileId
 *
 * Read-only agents see the page but the action buttons are disabled.
 */
import { useEffect, useState, useRef } from "react"
import { useParams, NavLink, useNavigate } from "react-router-dom"
import axios from "../../axiosConfig"
import { boTicketsURL, boUsersURL } from "../../routes/Url"
import { boPath } from "./boPath"
import {
  FiArrowLeft, FiSend, FiLock, FiUserCheck, FiPaperclip,
  FiX, FiAlertCircle, FiCheckCircle, FiRefreshCw, FiClock, FiDownload, FiInfo,
} from "react-icons/fi"

const STATUS_OPTS = [
  { value: "open",        label: "Open",        css: "bg-blue-100 text-blue-800" },
  { value: "in_progress", label: "In progress", css: "bg-amber-100 text-amber-800" },
  { value: "solved",      label: "Solved",      css: "bg-green-100 text-green-800" },
  { value: "closed",      label: "Closed",      css: "bg-gray-200 text-gray-700" },
]

export default function TicketDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const canAct = user?.role === "admin" || user?.role === "support"

  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)

  // Reply state
  const [replyText, setReplyText] = useState("")
  const [isInternal, setIsInternal] = useState(false)
  const [sending, setSending] = useState(false)
  const threadEndRef = useRef(null)

  // Assignment state
  const [boUsers, setBoUsers] = useState([])
  const [assignDirty, setAssignDirty] = useState(false)
  const [assigneeDraft, setAssigneeDraft] = useState("")

  // Status transition note
  const [statusNote, setStatusNote] = useState("")

  const load = async () => {
    setLoading(true)
    try {
      const { data } = await axios.get(`${boTicketsURL}/${id}`, { _silentToast: true })
      setData(data)
      setAssigneeDraft(data.ticket?.assigned_admin_id ? String(data.ticket.assigned_admin_id) : "")
    } catch (err) {
      if (err?.response?.status === 404) navigate(boPath("/tickets"), { replace: true })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load back-office user list once (for assign dropdown)
  useEffect(() => {
    axios.get(boUsersURL, { _silentToast: true })
      .then(({ data }) => setBoUsers(data.items || data || []))
      .catch(() => setBoUsers([]))
  }, [])

  useEffect(() => {
    if (threadEndRef.current) threadEndRef.current.scrollIntoView({ behavior: "smooth" })
  }, [data?.messages?.length])

  const handleReply = async () => {
    if (!replyText.trim()) return
    setSending(true)
    try {
      await axios.post(`${boTicketsURL}/${id}/reply`, {
        message: replyText.trim(),
        is_internal_note: isInternal,
      }, { _silentToast: true })
      setReplyText(""); setIsInternal(false)
      await load()
    } finally {
      setSending(false)
    }
  }

  const handleStatusChange = async (newStatus) => {
    if (!canAct) return
    try {
      await axios.put(`${boTicketsURL}/${id}/status`, { status: newStatus, note: statusNote }, { _silentToast: true })
      setStatusNote("")
      await load()
    } catch (err) { /* axios interceptor will toast */ }
  }

  const handleAssignSave = async () => {
    try {
      await axios.put(`${boTicketsURL}/${id}/assign`, {
        assignee_id: assigneeDraft || null,
      }, { _silentToast: true })
      setAssignDirty(false)
      await load()
    } catch (err) { /* toast */ }
  }

  if (loading) return <div className="p-8 text-gray-400 text-sm">Loading…</div>
  if (!data)   return (
    <div className="p-8 text-center">
      <FiAlertCircle size={28} className="text-gray-300 mx-auto mb-3" />
      <p className="text-gray-500 text-sm">Ticket not found.</p>
    </div>
  )

  const { ticket, messages, files, history, account, assignee } = data
  const statusOpt = STATUS_OPTS.find(s => s.value === ticket.status) || STATUS_OPTS[0]
  const filesByMessage = new Map()
  files.forEach(f => {
    const key = f.message_id ? String(f.message_id) : "__initial"
    if (!filesByMessage.has(key)) filesByMessage.set(key, [])
    filesByMessage.get(key).push(f)
  })

  return (
    <div className="p-8 space-y-5 max-w-5xl mx-auto">
      <NavLink to={boPath("/tickets")} className="inline-flex items-center gap-1 text-xs font-semibold text-gray-500 hover:text-orange-600">
        <FiArrowLeft size={12} /> Back to tickets
      </NavLink>

      {/* Header */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold text-orange-600 font-mono">{ticket.ticket_id}</span>
              <span className={`inline-flex px-2 py-0.5 text-[11px] font-semibold rounded-full ${statusOpt.css}`}>
                {statusOpt.label}
              </span>
              <span className={`text-[11px] font-semibold ${ticket.priority === "urgent" ? "text-red-600" : "text-gray-500"}`}>
                {ticket.priority.toUpperCase()}
              </span>
            </div>
            <h1 className="text-lg font-bold text-gray-800">{ticket.title}</h1>
            <div className="text-xs text-gray-400 mt-1 space-x-2">
              <span>{ticket.category.replace("_", " ")}</span>
              <span>·</span>
              <span>created {new Date(ticket.createdAt).toLocaleString()}</span>
              {ticket.first_actioned_at && (
                <>
                  <span>·</span>
                  <span>first response in {fmtDuration(new Date(ticket.first_actioned_at) - new Date(ticket.createdAt))}</span>
                </>
              )}
            </div>
            <div className="text-xs text-gray-600 mt-2">
              <span className="font-semibold">Account:</span> {account?.username || "—"} <span className="text-gray-400">&lt;{account?.email}&gt;</span>
            </div>
          </div>

          {canAct && (
            <div className="space-y-2 min-w-[200px]">
              {/* Status transitions */}
              <div className="flex flex-wrap gap-1">
                {STATUS_OPTS.filter(s => s.value !== ticket.status).map(s => (
                  <button key={s.value}
                    onClick={() => handleStatusChange(s.value)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-md ${s.css} hover:opacity-80`}>
                    → {s.label}
                  </button>
                ))}
              </div>

              {/* Assignment */}
              <div className="flex items-center gap-2">
                <select
                  value={assigneeDraft}
                  onChange={e => { setAssigneeDraft(e.target.value); setAssignDirty(true) }}
                  className="flex-1 px-2 py-1.5 text-xs bg-white border border-gray-200 rounded-md">
                  <option value="">— Unassigned —</option>
                  {boUsers.map(u => <option key={u._id} value={u._id}>{u.name || u.email}</option>)}
                </select>
                {assignDirty && (
                  <button onClick={handleAssignSave}
                    className="px-2.5 py-1.5 text-[11px] font-bold bg-orange-500 hover:bg-orange-600 text-white rounded-md">
                    Save
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Thread */}
      <div className="space-y-3">
        {messages.map(m => {
          const fromCustomer = m.sender_role.startsWith("customer_")
          const isNote = m.is_internal_note
          return (
            <div key={m._id} className={`flex ${fromCustomer ? "justify-start" : "justify-end"}`}>
              <div className={`max-w-[75%] rounded-2xl p-4 shadow-sm ${
                isNote
                  ? "bg-yellow-50 border-2 border-dashed border-yellow-300"
                  : fromCustomer
                    ? "bg-white border border-gray-100"
                    : "bg-blue-50 border border-blue-100"
              }`}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs font-bold text-gray-700">
                    {m.sender_name || m.sender_role}
                    {isNote && <span className="ml-2 text-[10px] uppercase tracking-wider text-yellow-700">Internal note</span>}
                  </span>
                  <span className="text-[10px] text-gray-400">{new Date(m.createdAt).toLocaleString()}</span>
                </div>
                <div className="whitespace-pre-wrap text-sm text-gray-800">{m.message}</div>

                {(filesByMessage.get(String(m._id)) || []).map(f => (
                  <a key={f._id} href={`${boTicketsURL}/${id}/files/${f._id}`}
                    className="mt-2 inline-flex items-center gap-2 text-xs text-orange-600 hover:underline">
                    <FiDownload size={11} /> {f.file_name} <span className="text-gray-400">({Math.round((f.file_size||0)/1024)} KB)</span>
                  </a>
                ))}
              </div>
            </div>
          )
        })}

        {(filesByMessage.get("__initial") || []).length > 0 && (
          <div className="text-[10px] text-gray-400 px-2">
            Attached to original message:
            {(filesByMessage.get("__initial") || []).map(f => (
              <a key={f._id} href={`${boTicketsURL}/${id}/files/${f._id}`}
                className="ml-2 text-orange-600 hover:underline inline-flex items-center gap-1">
                <FiDownload size={10} /> {f.file_name}
              </a>
            ))}
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Reply box */}
      {canAct && (
        <div className="bg-white border border-gray-100 rounded-2xl p-4 space-y-3">
          <textarea rows={4} value={replyText} onChange={e => setReplyText(e.target.value)}
            placeholder={isInternal ? "Internal note (only visible to LYVO staff)…" : "Reply to customer…"}
            className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 ${
              isInternal
                ? "bg-yellow-50 border-yellow-300 focus:ring-yellow-400"
                : "bg-white border-gray-200 focus:ring-orange-400"
            }`} />

          <div className="flex items-center justify-between flex-wrap gap-2">
            <label className="inline-flex items-center gap-2 text-xs text-gray-700 cursor-pointer select-none">
              <input type="checkbox" checked={isInternal} onChange={e => setIsInternal(e.target.checked)}
                className="accent-yellow-500" />
              <FiLock size={11} /> Internal note (not sent to customer)
            </label>
            <button disabled={sending || !replyText.trim()} onClick={handleReply}
              className="inline-flex items-center gap-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold rounded-lg">
              {sending ? "Sending…" : <><FiSend size={12} /> Send</>}
            </button>
          </div>
        </div>
      )}

      {/* Status history */}
      {history && history.length > 0 && (
        <details className="bg-white border border-gray-100 rounded-2xl p-4">
          <summary className="text-xs font-semibold text-gray-600 cursor-pointer">
            <FiClock className="inline mr-1 -mt-0.5" size={12} /> Status history ({history.length})
          </summary>
          <ul className="mt-3 space-y-1.5 text-xs text-gray-500">
            {history.map(h => (
              <li key={h._id}>
                <span className="text-gray-400">{new Date(h.createdAt).toLocaleString()}</span>
                {" · "}
                <span className="font-semibold">{h.old_status ? `${h.old_status} → ` : ""}{h.new_status}</span>
                {" · by "}{h.changed_by_role}
                {h.note && <span className="text-gray-400"> — {h.note}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}

function fmtDuration(ms) {
  if (!ms || ms < 0) return "—"
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m`
  const h = Math.round(min / 60)
  if (h < 48)   return `${h}h`
  return `${Math.round(h / 24)}d`
}
