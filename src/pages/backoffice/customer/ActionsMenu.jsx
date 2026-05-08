import { useState } from "react"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"

export default function ActionsMenu({ customer, role, onChange }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState("")
  const isReadonly = role === "readonly"

  const post = async (action, body = {}) => {
    setBusy(action)
    try {
      const { data } = await axios.post(`${boCustomersURL}/${customer._id}/actions/${action}`, body)
      if (data?.url) window.open(data.url, "_blank")
      else if (data?.resetLinkPreview) prompt("Reset link (also sent by email):", data.resetLinkPreview)
      onChange()
    } catch (e) { alert(e.response?.data?.message || "Failed") }
    finally { setBusy(""); setOpen(false) }
  }

  if (isReadonly) return null

  const actions = [
    { key: "reset-password", label: "Reset password", roles: ["admin", "support"] },
    { key: "extend-trial", label: "Extend trial 14d", roles: ["admin", "support"], body: { days: 14 } },
    { key: "shadow-login", label: "Shadow login", roles: ["admin", "support"] },
    { key: "pause-subscription", label: "Pause 30d", roles: ["admin", "support"], body: { days: 30 } },
    { key: "reactivate-subscription", label: "Reactivate", roles: ["admin", "support"] },
    { key: "cancel-subscription", label: "Cancel subscription", roles: ["admin", "support"], danger: true, prompt: "Reason for cancelling?" },
    { key: customer.suspended ? "unsuspend" : "suspend", label: customer.suspended ? "Unsuspend account" : "Suspend account", roles: ["admin"], danger: !customer.suspended, prompt: customer.suspended ? null : "Reason for suspension?" },
  ].filter(a => a.roles.includes(role))

  return (
    <div className="relative">
      <button onClick={() => setOpen(o => !o)} className="px-4 py-2 rounded-lg bg-gray-900 text-white text-sm font-medium hover:bg-gray-700">
        Actions ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-56 bg-white rounded-lg border border-gray-200 shadow-lg z-10 py-1">
          {actions.map(a => (
            <button
              key={a.key}
              disabled={!!busy}
              onClick={() => {
                let body = a.body || {}
                if (a.prompt) {
                  const reason = prompt(a.prompt)
                  if (reason == null) return
                  body = { ...body, reason }
                }
                post(a.key, body)
              }}
              className={`w-full text-left px-3 py-2 text-sm ${a.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"}`}
            >
              {busy === a.key ? "Working…" : a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
