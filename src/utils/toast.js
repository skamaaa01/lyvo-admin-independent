/**
 * LYVO Toast — single unified notification system.
 *
 * Drop-in replacement for react-hot-toast:
 *   import toast from "../utils/toast"
 *   toast.success("Saved!")
 *   toast.error("Something broke")
 *   toast.warn("Check your input")
 *
 * Also exported:
 *   import { showToast } from "../utils/toast"
 *   showToast("message", "error")
 *
 * - Pure DOM — works from React, axios, fetch, anywhere
 * - Built-in deduplication (same message within 2s is ignored)
 * - Max 3 toasts visible (oldest auto-dismissed)
 * - Auto-dismiss with shrinking progress bar
 * - Keyboard accessible (Escape to dismiss all)
 */

const CONTAINER_ID = "lyvo-toast-root"
const MAX_VISIBLE = 3

/* ── Styles (injected once) ── */
let injected = false
function injectCSS() {
  if (injected) return
  injected = true
  const s = document.createElement("style")
  s.textContent = `
#${CONTAINER_ID}{position:fixed;top:16px;right:16px;z-index:99999;display:flex;flex-direction:column;gap:10px;pointer-events:none;max-width:400px;width:100%}
@media(max-width:480px){#${CONTAINER_ID}{right:8px;left:8px;max-width:none;width:auto}}

.lt{pointer-events:auto;display:flex;align-items:flex-start;gap:12px;padding:14px 14px 14px 16px;
background:#fff;border:1px solid #e5e7eb;border-radius:14px;
box-shadow:0 4px 20px rgba(0,0,0,.07),0 1px 3px rgba(0,0,0,.04);
font-family:'Inter',system-ui,-apple-system,sans-serif;
position:relative;overflow:hidden;
animation:lt-in .28s cubic-bezier(.22,1,.36,1) both}
.lt.out{animation:lt-out .22s ease forwards}

.lt-icon{width:32px;height:32px;border-radius:10px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.lt--success .lt-icon{background:#f0fdf4}
.lt--error   .lt-icon{background:#fef2f2}
.lt--warn    .lt-icon{background:#fffbeb}

.lt-body{flex:1;min-width:0;padding-top:2px}
.lt-label{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;line-height:1;margin:0 0 4px}
.lt--success .lt-label{color:#16a34a}
.lt--error   .lt-label{color:#dc2626}
.lt--warn    .lt-label{color:#d97706}

.lt-msg{font-size:13px;font-weight:500;color:#4b5563;line-height:1.4;margin:0;word-break:break-word}

.lt-x{position:absolute;top:8px;right:8px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;
border:none;border-radius:6px;background:transparent;color:#9ca3af;cursor:pointer;font-size:15px;line-height:1;padding:0;transition:all .12s}
.lt-x:hover{background:#f3f4f6;color:#374151}

.lt-bar{position:absolute;bottom:0;left:0;right:0;height:3px}
.lt-bar-fill{height:100%;border-radius:0 0 14px 14px;animation:lt-shrink var(--d) linear forwards}
.lt--success .lt-bar-fill{background:#bbf7d0}
.lt--error   .lt-bar-fill{background:#fecaca}
.lt--warn    .lt-bar-fill{background:#fde68a}

@keyframes lt-in{0%{opacity:0;transform:translateX(30px) scale(.97)}100%{opacity:1;transform:translateX(0) scale(1)}}
@keyframes lt-out{0%{opacity:1;transform:translateX(0) scale(1);max-height:120px;margin-bottom:0}
100%{opacity:0;transform:translateX(40px) scale(.95);max-height:0;margin-bottom:-10px;padding-top:0;padding-bottom:0;border-width:0}}
@keyframes lt-shrink{from{width:100%}to{width:0%}}
  `
  document.head.appendChild(s)
}

/* ── SVG Icons ── */
const ICONS = {
  success: '<svg width="16" height="16" fill="none" stroke="#16a34a" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>',
  error:   '<svg width="16" height="16" fill="none" stroke="#dc2626" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  warn:    '<svg width="16" height="16" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24"><path d="m10.29 3.86-8.6 14.86A2 2 0 0 0 3.4 22h17.2a2 2 0 0 0 1.71-3.28L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
}

const LABELS = { success: "Success", error: "Error", warn: "Warning" }

/* ── State ── */
const queue = []          // currently-visible toast elements
const recent = new Set()  // dedup keys

/* ── Container ── */
function getRoot() {
  let r = document.getElementById(CONTAINER_ID)
  if (!r) {
    r = document.createElement("div")
    r.id = CONTAINER_ID
    document.body.appendChild(r)
  }
  return r
}

/* ── Dismiss ── */
function dismiss(el) {
  if (el._dismissed) return
  el._dismissed = true
  el.classList.add("out")
  setTimeout(() => {
    el.remove()
    const i = queue.indexOf(el)
    if (i > -1) queue.splice(i, 1)
  }, 240)
}

/* ── Keyboard: Escape dismisses all ── */
let kbBound = false
function bindKeyboard() {
  if (kbBound) return
  kbBound = true
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") [...queue].forEach(dismiss)
  })
}

/* ── Core ── */
function escapeHtml(s) {
  const d = document.createElement("div")
  d.textContent = s
  return d.innerHTML
}

/**
 * @param {string} message
 * @param {"success"|"error"|"warn"} type
 * @param {number} duration ms (default 4000)
 */
export function showToast(message, type = "error", duration = 4000) {
  // Dedup
  const key = type + "::" + message
  if (recent.has(key)) return
  recent.add(key)
  setTimeout(() => recent.delete(key), 2000)

  injectCSS()
  bindKeyboard()
  const root = getRoot()

  // Enforce max visible
  while (queue.length >= MAX_VISIBLE) dismiss(queue[0])

  const el = document.createElement("div")
  el.className = `lt lt--${type}`
  el.setAttribute("role", "alert")
  el.innerHTML = `
    <div class="lt-icon">${ICONS[type] || ICONS.error}</div>
    <div class="lt-body">
      <p class="lt-label">${LABELS[type] || "Notice"}</p>
      <p class="lt-msg">${escapeHtml(message)}</p>
    </div>
    <button class="lt-x" aria-label="Dismiss">&times;</button>
    <div class="lt-bar" style="--d:${duration}ms"><div class="lt-bar-fill"></div></div>
  `

  el.querySelector(".lt-x").addEventListener("click", () => dismiss(el))
  root.appendChild(el)
  queue.push(el)

  // Auto-dismiss
  const timer = setTimeout(() => dismiss(el), duration)
  el._timer = timer
}

/* ── Public API (drop-in for react-hot-toast) ── */
const toast = (msg) => showToast(msg, "success")
toast.success = (msg) => showToast(msg, "success")
toast.error   = (msg) => showToast(msg, "error")
toast.warn    = (msg) => showToast(msg, "warn")
toast.warning = (msg) => showToast(msg, "warn")

export default toast
