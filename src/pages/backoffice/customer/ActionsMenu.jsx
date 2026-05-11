import { useState } from "react"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"
import { useConfirm } from "../../../components/ConfirmDialog"
import toast from "../../../utils/toast"

export default function ActionsMenu({ customer, role, onChange }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState("")
  const isReadonly = role === "readonly"
  const { confirm, prompt: ask } = useConfirm()

  const post = async (action, body = {}) => {
    setBusy(action)
    try {
      const { data } = await axios.post(`${boCustomersURL}/${customer._id}/actions/${action}`, body)
      if (action === "shadow-login" && data?.sessionId) {
        // Build the redirect URL on the frontend using VITE_APP_BASE_URL —
        // the customer-app origin is a frontend deploy concern, not
        // something the backend should know about. Falls back to the
        // current window's origin in dev so a fresh checkout "just works"
        // (assuming admin-frontend on :3100 and customer-app on :3000 share
        // localhost). For production set VITE_APP_BASE_URL=https://lyvo.app
        // in admin-frontend/.env before building.
        const customerAppOrigin = (
          import.meta.env.VITE_APP_BASE_URL ||
          // Best-effort dev fallback: same hostname on the customer-app port
          (typeof window !== "undefined"
            ? `${window.location.protocol}//${window.location.hostname}:3000`
            : "")
        ).replace(/\/+$/, "")
        const url = `${customerAppOrigin}/?shadow_session=${data.sessionId}`
        window.open(url, "_blank")
        toast.success("Shadow session opened — check the new tab")
      } else if (data?.resetLinkPreview) {
        // Show the reset link in a copyable read-only prompt. The link is
        // also emailed to the customer; this is just so the agent can paste
        // it to them on a call if email is delayed.
        await ask(data.resetLinkPreview, {
          title: "Password reset link",
          confirmLabel: "Done",
          readOnly: true,
        })
      } else {
        toast.success(`${actionLabel(action)} done.`)
      }
      onChange()
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed")
    } finally {
      setBusy("")
      setOpen(false)
    }
  }

  if (isReadonly) return null

  const actions = [
    { key: "reset-password", label: "Reset password", roles: ["admin", "support"] },
    { key: "extend-trial", label: "Extend trial 14d", roles: ["admin", "support"], body: { days: 14 } },
    { key: "shadow-login", label: "Shadow login", roles: ["admin", "support"] },
    { key: "pause-subscription", label: "Pause 30d", roles: ["admin", "support"], body: { days: 30 } },
    { key: "reactivate-subscription", label: "Reactivate", roles: ["admin", "support"] },
    { key: "cancel-subscription", label: "Cancel subscription", roles: ["admin", "support"], danger: true, promptText: "Why is this customer cancelling?" },
    { key: "apply-credit", label: "Apply credit (£)", roles: ["admin"], isCreditPrompt: true },
    { key: customer.suspended ? "unsuspend" : "suspend", label: customer.suspended ? "Unsuspend account" : "Suspend account", roles: ["admin"], danger: !customer.suspended, promptText: customer.suspended ? null : "Reason for suspension?" },
  ].filter(a => a.roles.includes(role))

  const trigger = async (a) => {
    let body = a.body || {}
    if (a.isCreditPrompt) {
      // Two prompts: amount, then reason. Amount is in £ (we convert to pence
      // server-side). Positive number = credit applied to customer's account.
      const amountStr = await ask("Amount in £ (positive credits the customer, negative charges them):", {
        title: "Apply credit",
        placeholder: "e.g. 25.00",
        validate: (v) => /^-?\d+(\.\d{1,2})?$/.test(v.trim()) && Number(v) !== 0,
      })
      if (amountStr == null) return
      const reason = await ask("Reason (visible in the audit log):", {
        title: "Apply credit",
        multiline: true,
        validate: (v) => v.trim().length > 0,
      })
      if (reason == null) return
      body = { amountPence: Math.round(parseFloat(amountStr) * 100), reason }
    } else if (a.promptText) {
      const reason = await ask(a.promptText, {
        title: a.label,
        confirmLabel: a.label,
        placeholder: "Notes for the audit log",
        multiline: true,
        danger: a.danger,
      })
      if (reason == null) return
      body = { ...body, reason }
    } else if (a.danger) {
      // Dangerous actions without a reason field still need a yes/no
      if (!(await confirm(`This will ${a.label.toLowerCase()} for ${customer.email}.`, {
        title: a.label,
        confirmLabel: a.label,
        danger: true,
      }))) return
    }
    post(a.key, body)
  }

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
              onClick={() => trigger(a)}
              className={`w-full text-left px-3 py-2 text-sm disabled:opacity-50 ${a.danger ? "text-red-600 hover:bg-red-50" : "text-gray-700 hover:bg-gray-50"}`}
            >
              {busy === a.key ? "Working…" : a.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function actionLabel(action) {
  return action.replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase())
}
