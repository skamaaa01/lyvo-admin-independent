/**
 * Operator-only panel for changing a customer's plan, subscription status,
 * or trial end date. All three actions optionally mirror the change to
 * Stripe (controlled per-action via a checkbox) — DB-only by default so a
 * comped or manually-billed customer can be moved around without touching
 * their Stripe subscription.
 *
 * Permissioning: rendered only for back-office `admin` role; the three
 * backend endpoints (change-plan, set-status, extend-trial) match.
 *
 * Why a single panel instead of three menu items in ActionsMenu:
 *   - Plan changes carry a money-movement risk (proration) and benefit
 *     from showing the current plan inline so the operator can compare
 *     before committing. A dropdown menu hides that context.
 *   - Status changes are rare but blast-radius wide; surfacing them on the
 *     Billing tab co-locates "what the customer pays for" with "the lever
 *     that controls it".
 *   - Trial extension lives here too so all subscription-shape changes
 *     are in one place; the legacy "Extend trial 14d" item in ActionsMenu
 *     stays as a one-click shortcut for the common case.
 */
import { useEffect, useState } from "react"
import axios from "../../../axiosConfig"
import { boCustomersURL, boPlansURL } from "../../../routes/Url"
import { useConfirm } from "../../../components/ConfirmDialog"
import toast from "../../../utils/toast"

const STATUS_OPTIONS = [
  { value: "trial",     label: "Trial",     hint: "Re-arms a 14-day trial if expired" },
  { value: "active",    label: "Active",    hint: "Clears cancel-at-period-end" },
  { value: "past_due",  label: "Past due",  hint: "DB-only — Stripe controls this normally" },
  { value: "expired",   label: "Expired",   hint: "DB-only — Stripe controls this normally" },
  { value: "cancelled", label: "Cancelled", hint: "Stripe sync cancels immediately, no proration" },
  { value: "suspended", label: "Suspended", hint: "Stripe sync sets cancel-at-period-end" },
]

export default function PlanChangePanel({ customerId, role, billing, onChange }) {
  // Backend requires admin; hiding for everyone else avoids confusing 403s.
  if (role !== "admin") return null

  const { confirm } = useConfirm()
  const [plans, setPlans] = useState([])
  const [loadingPlans, setLoadingPlans] = useState(true)

  // Plan-change form
  const [selectedPlanId, setSelectedPlanId] = useState("")
  const [planSyncStripe, setPlanSyncStripe] = useState(false)
  const [planBusy, setPlanBusy] = useState(false)

  // Status-change form
  const [selectedStatus, setSelectedStatus] = useState(billing?.status || "active")
  const [statusReason, setStatusReason] = useState("")
  const [statusSyncStripe, setStatusSyncStripe] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)

  // Extend-trial form
  const [trialDays, setTrialDays] = useState(14)
  const [trialSyncStripe, setTrialSyncStripe] = useState(false)
  const [trialBusy, setTrialBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    axios.get(boPlansURL, { _silentToast: true })
      .then(({ data }) => {
        if (cancelled) return
        const items = (data?.items || []).filter(p => p.isActive !== false)
        setPlans(items)
      })
      .catch(() => toast.error("Couldn't load plans"))
      .finally(() => !cancelled && setLoadingPlans(false))
    return () => { cancelled = true }
  }, [])

  // Sync the status dropdown when the parent reloads new billing data
  useEffect(() => { if (billing?.status) setSelectedStatus(billing.status) }, [billing?.status])

  const hasStripeSub = !!billing?.stripeSubscriptionId

  const submitPlan = async () => {
    if (!selectedPlanId) return toast.warn("Pick a plan first")
    const newPlan = plans.find(p => String(p._id) === String(selectedPlanId))
    const currentPlanName = billing?.plan || "—"
    const stripeNote = planSyncStripe
      ? "\n\nStripe will be charged/credited a prorated amount on the next invoice."
      : "\n\nDB-only — Stripe subscription is NOT touched."
    const confirmed = await confirm(
      `Change plan from "${currentPlanName}" to "${newPlan?.name}"?${stripeNote}`,
      { title: "Change plan", confirmLabel: "Change plan", danger: planSyncStripe }
    )
    if (!confirmed) return

    setPlanBusy(true)
    try {
      const { data, status } = await axios.post(
        `${boCustomersURL}/${customerId}/actions/change-plan`,
        { planId: selectedPlanId, syncStripe: planSyncStripe },
        { _silentToast: true }
      )
      if (status === 207 || data?.stripeError) {
        toast.warn(data?.message || `Saved locally, Stripe sync failed`)
      } else {
        toast.success(`Plan changed to ${newPlan?.name}${planSyncStripe ? " (Stripe synced)" : " (DB-only)"}`)
      }
      onChange?.()
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to change plan")
    } finally {
      setPlanBusy(false)
    }
  }

  const submitStatus = async () => {
    if (!selectedStatus) return
    if (selectedStatus === billing?.status && !statusReason) return toast.warn("Nothing to change")
    const stripeNote = statusSyncStripe ? "\nStripe will also be updated where supported." : "\nDB-only."
    const confirmed = await confirm(
      `Set subscription status to "${selectedStatus}"?${stripeNote}`,
      { title: "Set status", confirmLabel: `Set ${selectedStatus}`, danger: selectedStatus === "cancelled" || selectedStatus === "suspended" }
    )
    if (!confirmed) return

    setStatusBusy(true)
    try {
      const { data, status: httpStatus } = await axios.post(
        `${boCustomersURL}/${customerId}/actions/set-status`,
        { status: selectedStatus, syncStripe: statusSyncStripe, reason: statusReason },
        { _silentToast: true }
      )
      if (httpStatus === 207 || data?.stripeError) {
        toast.warn(data?.message || "Saved locally, Stripe sync skipped/failed")
      } else {
        toast.success(`Status set to ${selectedStatus}`)
      }
      setStatusReason("")
      onChange?.()
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to set status")
    } finally {
      setStatusBusy(false)
    }
  }

  const submitTrial = async () => {
    const n = parseInt(trialDays)
    if (!Number.isFinite(n) || n < 1 || n > 365) return toast.warn("Enter 1–365 days")
    const confirmed = await confirm(
      `Extend trial by ${n} day(s)?${trialSyncStripe ? "\nStripe trial_end will be updated to match." : "\nDB-only."}`,
      { title: "Extend trial", confirmLabel: `Extend ${n}d`, danger: false }
    )
    if (!confirmed) return

    setTrialBusy(true)
    try {
      const { data, status: httpStatus } = await axios.post(
        `${boCustomersURL}/${customerId}/actions/extend-trial`,
        { days: n, syncStripe: trialSyncStripe },
        { _silentToast: true }
      )
      if (httpStatus === 207 || data?.stripeError) {
        toast.warn(data?.message || "Saved locally, Stripe sync failed")
      } else {
        toast.success(`Trial extended by ${n} day(s)${data?.trialEndsAt ? ` — now ends ${new Date(data.trialEndsAt).toLocaleDateString()}` : ""}`)
      }
      onChange?.()
    } catch (e) {
      toast.error(e.response?.data?.message || "Failed to extend trial")
    } finally {
      setTrialBusy(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 lg:col-span-2">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-sm font-semibold text-gray-700">Operator controls</h3>
        <span className="text-[11px] uppercase tracking-wide text-gray-400">admin only</span>
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Changes save to the local database first. Tick &ldquo;Also update Stripe&rdquo; when the customer pays through Stripe and you want their billing to match.
        {!hasStripeSub && <span className="ml-1 text-amber-600">No Stripe subscription on file — Stripe sync will be skipped.</span>}
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* ── Change plan ────────────────────────────────────────────────── */}
        <section className="space-y-2 border-r-0 md:border-r md:pr-5 border-gray-100">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Change plan</h4>
          <div className="text-xs text-gray-500">
            Current: <span className="text-gray-900 font-medium">{billing?.plan || "—"}</span>
          </div>
          <select
            value={selectedPlanId}
            onChange={(e) => setSelectedPlanId(e.target.value)}
            disabled={loadingPlans || planBusy}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200"
          >
            <option value="">{loadingPlans ? "Loading plans…" : "Select a plan…"}</option>
            {plans.map(p => (
              <option key={p._id} value={p._id}>
                {p.name} — £{((p.price ?? 0) / 100).toFixed(2)}/{p.billingCycle?.slice(0, 2) || "mo"}
              </option>
            ))}
          </select>
          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={planSyncStripe}
              onChange={(e) => setPlanSyncStripe(e.target.checked)}
              disabled={planBusy || !hasStripeSub}
              className="mt-0.5"
            />
            <span>
              Also update Stripe <span className="text-gray-400">(prorates the next invoice)</span>
            </span>
          </label>
          <button
            onClick={submitPlan}
            disabled={planBusy || !selectedPlanId}
            className="w-full mt-1 px-3 py-1.5 text-sm font-medium rounded-md bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-50"
          >
            {planBusy ? "Changing…" : "Change plan"}
          </button>
        </section>

        {/* ── Set status ─────────────────────────────────────────────────── */}
        <section className="space-y-2 border-r-0 md:border-r md:pr-5 border-gray-100">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Set status</h4>
          <div className="text-xs text-gray-500">
            Current: <span className="text-gray-900 font-medium">{billing?.status || "—"}</span>
          </div>
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value)}
            disabled={statusBusy}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200"
          >
            {STATUS_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <p className="text-[11px] text-gray-400 min-h-[14px]">
            {STATUS_OPTIONS.find(o => o.value === selectedStatus)?.hint || ""}
          </p>
          <textarea
            value={statusReason}
            onChange={(e) => setStatusReason(e.target.value)}
            disabled={statusBusy}
            placeholder="Reason (audit log, optional)"
            rows={2}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200 resize-none"
          />
          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={statusSyncStripe}
              onChange={(e) => setStatusSyncStripe(e.target.checked)}
              disabled={statusBusy || !hasStripeSub}
              className="mt-0.5"
            />
            <span>Also update Stripe <span className="text-gray-400">(where supported)</span></span>
          </label>
          <button
            onClick={submitStatus}
            disabled={statusBusy}
            className="w-full mt-1 px-3 py-1.5 text-sm font-medium rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {statusBusy ? "Saving…" : "Set status"}
          </button>
        </section>

        {/* ── Extend trial ───────────────────────────────────────────────── */}
        <section className="space-y-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-gray-500">Extend trial</h4>
          <div className="text-xs text-gray-500">
            Adds N days to the trial. If the trial has already expired, the
            extension counts from today.
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="365"
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
              disabled={trialBusy}
              className="w-20 px-2.5 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-orange-200"
            />
            <span className="text-xs text-gray-500">day(s)</span>
          </div>
          <label className="flex items-start gap-2 text-xs text-gray-600 cursor-pointer">
            <input
              type="checkbox"
              checked={trialSyncStripe}
              onChange={(e) => setTrialSyncStripe(e.target.checked)}
              disabled={trialBusy || !hasStripeSub}
              className="mt-0.5"
            />
            <span>Also push new trial_end to Stripe</span>
          </label>
          <button
            onClick={submitTrial}
            disabled={trialBusy}
            className="w-full mt-1 px-3 py-1.5 text-sm font-medium rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            {trialBusy ? "Extending…" : "Extend trial"}
          </button>
        </section>
      </div>
    </div>
  )
}
