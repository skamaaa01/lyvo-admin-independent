import { useEffect, useState } from "react"
import { useParams, useNavigate } from "react-router-dom"
import axios from "../../../axiosConfig"
import { boCustomersURL } from "../../../routes/Url"
import { boPath } from "../boPath"
import CustomerHeader from "./CustomerHeader"
import TabAccount from "./TabAccount"
import TabBilling from "./TabBilling"
import TabHardware from "./TabHardware"
import TabActivity from "./TabActivity"
import TabCompliance from "./TabCompliance"
import TabAlerts from "./TabAlerts"
import TabTimeline from "./TabTimeline"
import TabCommunications from "./TabCommunications"
import TabAudit from "./TabAudit"
import ActionsMenu from "./ActionsMenu"

const TABS = [
  { key: "account", label: "Account" },
  { key: "billing", label: "Billing" },
  { key: "hardware", label: "Hardware" },
  { key: "activity", label: "Activity" },
  { key: "compliance", label: "Compliance" },
  { key: "alerts", label: "Alerts" },
  { key: "timeline", label: "Timeline" },
  { key: "communications", label: "Communications" },
  { key: "audit", label: "Audit log" },
]

export default function CustomerDetail({ user }) {
  const { id } = useParams()
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [tab, setTab] = useState("account")
  const [error, setError] = useState("")

  const reload = () => axios.get(`${boCustomersURL}/${id}`, { _silentToast: true })
    .then(({ data }) => setData(data))
    .catch((err) => setError(err.response?.data?.message || "Failed"))

  useEffect(() => { reload() /* eslint-disable-next-line */ }, [id])

  if (error) return <div className="p-8 text-red-600 text-sm">{error} <button onClick={() => navigate(-1)} className="ml-2 underline">Back</button></div>
  if (!data) return <div className="p-8 text-gray-400 text-sm">Loading…</div>

  return (
    <div>
      <div className="px-8 pt-6">
        <button onClick={() => navigate(boPath("/customers"))} className="text-xs text-gray-500 hover:text-gray-800 mb-3">← Back to search</button>
        <CustomerHeader header={data.header} />

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-1 border-b border-gray-200">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-2 text-sm font-medium -mb-px border-b-2 ${
                  tab === t.key ? "border-orange-500 text-orange-600" : "border-transparent text-gray-500 hover:text-gray-800"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <ActionsMenu customer={data.header} role={user.role} onChange={reload} />
        </div>
      </div>

      <div className="px-8 pt-6 pb-12">
        {tab === "account" && <TabAccount data={data.account} customerId={id} role={user.role} onChange={reload} notes={data.notes} />}
        {tab === "billing" && <TabBilling data={data.billing} />}
        {tab === "hardware" && <TabHardware data={data.hardware} customerId={id} role={user.role} onChange={reload} />}
        {tab === "activity" && <TabActivity data={data.activity} />}
        {tab === "compliance" && <TabCompliance data={data.compliance} />}
        {tab === "alerts" && <TabAlerts data={data.alerts} />}
        {tab === "timeline" && <TabTimeline timeline={data.timeline} />}
        {tab === "communications" && <TabCommunications notes={data.notes} customerId={id} role={user.role} onChange={reload} />}
        {tab === "audit" && <TabAudit customerId={id} />}
      </div>
    </div>
  )
}
