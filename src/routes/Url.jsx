// API URL constants for the back office. The customer-app URLs live in
// the customer frontend's own copy; this file only carries what the admin
// app actually calls.
const ENV = import.meta.env
const BASE_URL = ENV.VITE_BACKEND_URL

const backOfficeURL        = BASE_URL + "/api/admin"
const boLoginURL           = backOfficeURL + "/auth/login"
const boSetup2FAURL        = backOfficeURL + "/auth/2fa/setup"
const boVerifyEnrollURL    = backOfficeURL + "/auth/2fa/verify-enroll"
const boVerify2FAURL       = backOfficeURL + "/auth/2fa/verify"
const boLogoutURL          = backOfficeURL + "/auth/logout"
const boMeURL              = backOfficeURL + "/auth/me"
const boChangePasswordURL  = backOfficeURL + "/auth/change-password"
const boReset2FAURL        = backOfficeURL + "/auth/reset-2fa"
const boUsersURL           = backOfficeURL + "/bo-users"
const boSystemHealthURL    = backOfficeURL + "/system/health"
const boAuditLogURL        = backOfficeURL + "/audit-log"
const boInvoiceQueueURL    = backOfficeURL + "/invoice-queue"
const boCustomersURL       = backOfficeURL + "/customers"
const boCampaignsURL       = backOfficeURL + "/campaigns"
const boAnalyticsURL       = backOfficeURL + "/analytics"
const boTicketsURL         = backOfficeURL + "/tickets"
const boTicketsDashboardURL = backOfficeURL + "/tickets/dashboard"
const boPlansURL           = backOfficeURL + "/plans"
const boPlansCatalogURL    = backOfficeURL + "/plans/feature-catalog"

export {
  backOfficeURL,
  boLoginURL,
  boSetup2FAURL,
  boVerifyEnrollURL,
  boVerify2FAURL,
  boLogoutURL,
  boMeURL,
  boChangePasswordURL,
  boReset2FAURL,
  boUsersURL,
  boSystemHealthURL,
  boAuditLogURL,
  boInvoiceQueueURL,
  boCustomersURL,
  boCampaignsURL,
  boAnalyticsURL,
  boTicketsURL,
  boTicketsDashboardURL,
  boPlansURL,
  boPlansCatalogURL,
}
