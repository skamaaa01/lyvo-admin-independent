// Path helper retained for compatibility with the back-office components,
// which also live in the customer-app codebase under /back-office/* for dev
// testing. In this standalone admin build the app always lives at the site
// root, so boPath() is the identity function — kept so the same component
// source compiles in both projects without diverging.
export function isAdminHost() {
  return true
}

export function boPath(p = "/") {
  return p.startsWith("/") ? p : "/" + p
}
