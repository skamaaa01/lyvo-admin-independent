import PlanChangePanel from "./PlanChangePanel"

export default function TabBilling({ data, customerId, role, onChange }) {
  if (!data) {
    // No subscription record means we can't reliably mutate anything, but
    // operators should still see why — they may need to create one manually
    // (rare). Showing a friendlier message than the silent dash.
    return (
      <div className="space-y-4">
        <div className="text-sm text-gray-400">No subscription record on file.</div>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Subscription</h3>
        <Row label="Plan" value={data.plan || "—"} />
        <Row label="Price" value={data.price ? `£${data.price}` : "—"} />
        <Row label="Status" value={data.status} />
        <Row label="Started" value={data.subscriptionStart ? new Date(data.subscriptionStart).toLocaleDateString() : "—"} />
        <Row label="Next billing" value={data.nextBillingDate ? new Date(data.nextBillingDate).toLocaleDateString() : "—"} />
        <Row label="Cancels at period end" value={data.cancelAtPeriodEnd ? "Yes" : "No"} />
      </div>
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-700 mb-3">Stripe</h3>
        {data.stripeCustomerId ? (
          <>
            <Row label="Customer ID" value={
              <a className="text-blue-600 hover:underline font-mono text-xs" target="_blank" rel="noreferrer" href={`https://dashboard.stripe.com/customers/${data.stripeCustomerId}`}>{data.stripeCustomerId}</a>
            } />
            <Row label="Subscription ID" value={
              data.stripeSubscriptionId ? <a className="text-blue-600 hover:underline font-mono text-xs" target="_blank" rel="noreferrer" href={`https://dashboard.stripe.com/subscriptions/${data.stripeSubscriptionId}`}>{data.stripeSubscriptionId}</a> : "—"
            } />
            <Row label="Price ID" value={data.stripePriceId || "—"} />
            <p className="mt-3 text-xs text-gray-400">Payment-method, invoices, refunds and lifetime-value sync via Stripe webhooks (see Stripe dashboard for full history).</p>
          </>
        ) : (
          <p className="text-xs text-gray-400">No Stripe link — customer is on a non-paid plan or hasn't checked out yet.</p>
        )}
      </div>
      <PlanChangePanel customerId={customerId} role={role} billing={data} onChange={onChange} />
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex py-1.5 text-sm">
      <span className="w-36 text-gray-500">{label}</span>
      <span className="text-gray-900 break-all">{value}</span>
    </div>
  )
}
