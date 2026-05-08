import { useState } from "react"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"

export default function TabAccount({ data, customerId, role, onChange, notes }) {
  const [tagsDraft, setTagsDraft] = useState((data.tags || []).join(", "))
  const [noteDraft, setNoteDraft] = useState("")
  const canEdit = ["admin", "support"].includes(role)
  const isAdmin = role === "admin"

  const exportData = () => window.open(`${boCustomersURL}/${customerId}/gdpr-export`, "_blank")
  const deleteCustomer = async () => {
    const c1 = prompt("This soft-deletes the customer (PII redacted, hardware unlinked). Type DELETE to confirm:")
    if (c1 !== "DELETE") return
    if (!confirm("Final confirmation: delete this customer's data?")) return
    await axios.delete(`${boCustomersURL}/${customerId}/gdpr-delete`, { data: { confirm: "DELETE" } })
    alert("Customer soft-deleted.")
    onChange()
  }

  const saveTags = async () => {
    const tags = tagsDraft.split(",").map(s => s.trim()).filter(Boolean)
    await axios.put(`${boCustomersURL}/${customerId}/tags`, { tags })
    onChange()
  }

  const addNote = async () => {
    if (!noteDraft.trim()) return
    await axios.post(`${boCustomersURL}/${customerId}/notes`, { body: noteDraft })
    setNoteDraft("")
    onChange()
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Profile</h3>
        <Field label="Name" value={data.name} />
        <Field label="Email" value={data.email} />
        <Field label="Role" value={data.role} />
        <Field label="Created" value={new Date(data.createdAt).toLocaleString()} />
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Tags</h3>
        <input
          value={tagsDraft}
          onChange={(e) => setTagsDraft(e.target.value)}
          disabled={!canEdit}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm"
          placeholder="VIP, early adopter, at risk"
        />
        {canEdit && (
          <button onClick={saveTags} className="mt-2 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium hover:bg-gray-700">Save tags</button>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Members ({data.seats || 0})</h3>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-gray-400">
            <tr><th className="text-left py-1.5">Email</th><th className="text-left">Role</th><th className="text-left">Last login</th></tr>
          </thead>
          <tbody>
            {(data.members || []).map(m => (
              <tr key={m._id} className="border-t border-gray-50">
                <td className="py-2 text-gray-700">{m.email || m.username}</td>
                <td className="py-2 text-gray-500 capitalize">{m.role}</td>
                <td className="py-2 text-gray-400 text-xs">{m.lastLoginAt ? new Date(m.lastLoginAt).toLocaleString() : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div className="bg-white rounded-xl border border-gray-100 p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">GDPR</h3>
          <div className="flex gap-2 flex-wrap">
            <button onClick={exportData} className="px-3 py-1.5 rounded-lg border border-gray-200 text-sm hover:bg-gray-50">Export customer data (GDPR)</button>
            {isAdmin && <button onClick={deleteCustomer} className="px-3 py-1.5 rounded-lg border border-red-200 text-red-700 text-sm hover:bg-red-50">Delete customer data (GDPR)</button>}
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 p-5 lg:col-span-2">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Internal notes</h3>
        {canEdit && (
          <div className="flex gap-2 mb-4">
            <input
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm"
              placeholder="Add a note about this customer…"
              onKeyDown={(e) => { if (e.key === "Enter") addNote() }}
            />
            <button onClick={addNote} className="px-3 py-1.5 rounded-lg bg-orange-500 text-white text-xs font-medium hover:bg-orange-600">Add note</button>
          </div>
        )}
        <ul className="space-y-2 max-h-80 overflow-auto">
          {(notes || []).map(n => (
            <li key={n._id} className="border border-gray-50 rounded-lg p-2.5">
              <div className="text-xs text-gray-400 flex justify-between">
                <span>{n.authorEmail}</span>
                <span>{new Date(n.createdAt).toLocaleString()}</span>
              </div>
              <div className="text-sm text-gray-800 mt-1 whitespace-pre-wrap">{n.body}</div>
            </li>
          ))}
          {(notes || []).length === 0 && <li className="text-xs text-gray-400">No notes yet.</li>}
        </ul>
      </div>
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div className="flex py-1.5 text-sm">
      <span className="w-32 text-gray-500">{label}</span>
      <span className="text-gray-900 break-all">{value || "—"}</span>
    </div>
  )
}
