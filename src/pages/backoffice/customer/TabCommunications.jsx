import { useState } from "react"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"

export default function TabCommunications({ notes, customerId, role, onChange }) {
  const [callNote, setCallNote] = useState("")
  const canEdit = ["admin", "support"].includes(role)
  const calls = (notes || []).filter(n => n.kind === "call")

  const addCall = async () => {
    if (!callNote.trim()) return
    await axios.post(`${boCustomersURL}/${customerId}/notes`, { body: callNote, kind: "call" })
    setCallNote("")
    onChange()
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Phone calls</h3>
        {canEdit && (
          <div className="flex gap-2 mb-4">
            <textarea
              value={callNote}
              onChange={(e) => setCallNote(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              rows={2}
              placeholder="Summary of phone call…"
            />
            <button onClick={addCall} className="px-3 py-1.5 self-start rounded-lg bg-orange-500 text-white text-xs font-medium hover:bg-orange-600">Log call</button>
          </div>
        )}
        <ul className="space-y-2">
          {calls.map(n => (
            <li key={n._id} className="border border-gray-50 rounded-lg p-2.5">
              <div className="text-xs text-gray-400 flex justify-between">
                <span>{n.authorEmail}</span><span>{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{n.body}</div>
            </li>
          ))}
          {calls.length === 0 && <li className="text-xs text-gray-400">No phone-call records.</li>}
        </ul>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Email & chat history</h3>
        <p className="text-xs text-gray-400">
          Hook up your help-desk integration (Crisp / Intercom / Help Scout / SendGrid event webhook)
          to populate this tab. Until then, email transactional history lives in your provider's dashboard.
        </p>
      </div>
    </div>
  )
}
