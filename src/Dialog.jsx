import { useCallback, useEffect, useRef, useState } from 'react'

// A centered modal built on <dialog> (focus trapping, Esc and the backdrop come
// from the browser). `useDialog` returns [element, ask]: render the element
// once, and `await ask({...})` resolves true on confirm, false otherwise.
export function useDialog() {
  const [request, setRequest] = useState(null)

  const ask = useCallback(
    (options) =>
      new Promise((resolve) => {
        setRequest({ ...options, resolve })
      }),
    [],
  )

  function close(result) {
    request?.resolve(result)
    setRequest(null)
  }

  return [request ? <Dialog {...request} onClose={close} /> : null, ask]
}

function Dialog({ title, message, children, confirmLabel = 'OK', cancelLabel = 'Cancel', danger, onClose }) {
  const ref = useRef(null)

  useEffect(() => {
    ref.current?.showModal()
  }, [])

  return (
    <dialog
      ref={ref}
      className="dialog"
      onCancel={(e) => {
        e.preventDefault()
        onClose(false)
      }}
      // A click on the backdrop lands on the <dialog> itself.
      onClick={(e) => e.target === ref.current && onClose(false)}
    >
      <div className="dialog-card">
        <h2>{title}</h2>
        {message && <p>{message}</p>}
        {children}
        <div className="dialog-actions">
          {cancelLabel && (
            <button className="ghost" onClick={() => onClose(false)}>
              {cancelLabel}
            </button>
          )}
          <button className={danger ? 'danger' : undefined} onClick={() => onClose(true)} autoFocus>
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  )
}
