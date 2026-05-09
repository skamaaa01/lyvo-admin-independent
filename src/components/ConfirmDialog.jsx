import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { FiAlertTriangle } from "react-icons/fi"

// Drop-in replacement for window.confirm() and window.prompt(). Both return
// promises that resolve with the user's choice (a boolean for confirm, a
// string-or-null for prompt). Modal sits at z-[10000] so it's above any
// portalled popover (DatePicker / RoleSelect at z-9999) and any other modal
// (z-[100]).
//
// Usage:
//   const { confirm, prompt: ask } = useConfirm()
//   if (!(await confirm("Delete this gateway?"))) return
//   const reason = await ask("Reason for cancellation:")

const ConfirmContext = createContext(null)

export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null) // { kind, message, ... }
  const resolveRef = useRef(null)

  const confirm = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({
        kind: "confirm",
        message,
        title: opts.title || "Are you sure?",
        confirmLabel: opts.confirmLabel || "Confirm",
        cancelLabel: opts.cancelLabel || "Cancel",
        danger: opts.danger !== false, // default to dangerous styling
      })
    })
  }, [])

  const prompt = useCallback((message, opts = {}) => {
    return new Promise((resolve) => {
      resolveRef.current = resolve
      setState({
        kind: "prompt",
        message,
        title: opts.title || "Input required",
        defaultValue: opts.defaultValue || "",
        placeholder: opts.placeholder || "",
        confirmLabel: opts.confirmLabel || "OK",
        cancelLabel: opts.cancelLabel || "Cancel",
        // Optional verifier — must return true for the OK button to enable.
        // Useful for "type DELETE to confirm" patterns.
        validate: opts.validate || null,
        danger: !!opts.danger,
        readOnly: !!opts.readOnly,        // for showing copy-paste content (e.g. reset link)
        multiline: !!opts.multiline,
      })
    })
  }, [])

  const handle = (result) => {
    setState(null)
    resolveRef.current?.(result)
    resolveRef.current = null
  }

  return (
    <ConfirmContext.Provider value={{ confirm, prompt }}>
      {children}
      {state && <Dialog state={state} onResult={handle} />}
      <style>{`
        @keyframes confirmPop {
          from { opacity: 0; transform: scale(0.92) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </ConfirmContext.Provider>
  )
}

function Dialog({ state, onResult }) {
  const [value, setValue] = useState(state.defaultValue || "")
  const inputRef = useRef(null)

  // Focus the input on mount for prompt; cancel on Escape.
  useEffect(() => {
    if (state.kind === "prompt" && inputRef.current) {
      inputRef.current.focus()
      // Select-all so a "Type DELETE" or pre-filled value is easy to overwrite
      inputRef.current.select?.()
    }
    const onKey = (e) => { if (e.key === "Escape") onResult(state.kind === "prompt" ? null : false) }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [state.kind, onResult])

  const ok = state.kind === "prompt"
    ? () => onResult(value)
    : () => onResult(true)
  const cancel = () => onResult(state.kind === "prompt" ? null : false)

  const validateOk = state.validate ? state.validate(value) : (state.kind !== "prompt" || value.length > 0 || state.readOnly)

  return (
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center px-4"
      style={{ background: "rgba(0,0,0,0.45)", backdropFilter: "blur(2px)" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) cancel() }}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4"
        style={{ animation: "confirmPop 0.18s cubic-bezier(.34,1.56,.64,1)" }}
      >
        <div className="flex items-start gap-3">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${state.danger ? "bg-red-100" : "bg-orange-100"}`}>
            <FiAlertTriangle size={18} className={state.danger ? "text-red-500" : "text-orange-500"} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-gray-900 text-base leading-tight">{state.title}</p>
            <p className="text-sm text-gray-500 mt-1 leading-relaxed whitespace-pre-wrap break-words">{state.message}</p>
          </div>
        </div>

        {state.kind === "prompt" && (
          state.multiline ? (
            <textarea
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={state.placeholder}
              readOnly={state.readOnly}
              rows={4}
              className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${state.readOnly ? "bg-gray-50 font-mono text-xs" : ""}`}
            />
          ) : (
            <input
              ref={inputRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder={state.placeholder}
              readOnly={state.readOnly}
              onKeyDown={(e) => { if (e.key === "Enter" && validateOk) { e.preventDefault(); ok() } }}
              className={`w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 ${state.readOnly ? "bg-gray-50 font-mono text-xs" : ""}`}
            />
          )
        )}

        <div className="flex gap-2 justify-end pt-1">
          <button
            type="button"
            onClick={cancel}
            className="px-4 py-2 rounded-xl text-sm font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 transition-colors"
          >
            {state.cancelLabel}
          </button>
          {!state.readOnly && (
            <button
              type="button"
              onClick={ok}
              disabled={!validateOk}
              className={`px-4 py-2 rounded-xl text-sm font-bold text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                state.danger ? "bg-red-500 hover:bg-red-600" : "bg-orange-500 hover:bg-orange-600"
              }`}
            >
              {state.confirmLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider")
  return ctx
}
