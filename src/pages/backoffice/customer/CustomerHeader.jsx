const HEALTH = { green: "bg-emerald-500", amber: "bg-amber-500", red: "bg-red-500" }

export default function CustomerHeader({ header }) {
  const copy = (v) => { try { navigator.clipboard.writeText(v) } catch (_) {} }
  return (
    <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Customer</div>
          <div className="text-lg font-bold text-gray-900">{header.name || "—"}</div>
          <div className="text-sm text-gray-500">{header.company || "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Email</div>
          <div className="text-sm font-medium text-gray-700">{header.email || "—"}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Plan</div>
          <div className="px-2 py-0.5 inline-block rounded text-xs font-medium bg-orange-50 text-orange-700">{header.plan}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Status</div>
          <div className="px-2 py-0.5 inline-block rounded text-xs font-medium bg-gray-100 text-gray-700">{header.status}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Hardware</div>
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${HEALTH[header.health] || "bg-gray-300"}`} />
            <span className="text-sm capitalize text-gray-700">{header.health || "—"}</span>
          </div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Compliance</div>
          <div className="text-sm font-medium text-gray-700">{header.compliance == null ? "—" : `${header.compliance}%`}</div>
        </div>
        <div>
          <div className="text-xs uppercase tracking-wide text-gray-400">Customer ID</div>
          <button onClick={() => copy(header._id)} title="Copy" className="text-xs font-mono text-gray-600 hover:text-gray-900">{String(header._id).slice(-12)}</button>
        </div>
        {header.stripeCustomerId && (
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-400">Stripe</div>
            <a href={`https://dashboard.stripe.com/customers/${header.stripeCustomerId}`} target="_blank" rel="noreferrer" className="text-xs font-mono text-blue-600 hover:underline">{header.stripeCustomerId.slice(0, 16)}…</a>
          </div>
        )}
      </div>
      {header.tags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {header.tags.map(t => <span key={t} className="px-2 py-0.5 rounded text-[11px] bg-blue-50 text-blue-700">{t}</span>)}
        </div>
      )}
    </div>
  )
}
