import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

interface DialogOptions {
  title: string
  /** Paragraphs, separated by blank lines. */
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  /** A destructive action: red confirm button, and Cancel has the focus so Enter does not delete. */
  danger?: boolean
}

interface OpenDialog extends DialogOptions {
  /** A notice has one button and no cancel. */
  notice: boolean
  resolve: (ok: boolean) => void
}

interface DialogApi {
  /** Asks a yes/no question in the app's own style; resolves true when confirmed. */
  confirm: (options: DialogOptions) => Promise<boolean>
  /** Shows a message with one button; resolves when it is closed. */
  notice: (options: DialogOptions) => Promise<void>
}

const DialogContext = createContext<DialogApi | null>(null)

export function DialogProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState<OpenDialog | null>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const api: DialogApi = {
    confirm: (options) => new Promise((resolve) => setOpen({ ...options, notice: false, resolve })),
    notice: (options) => new Promise((resolve) => setOpen({ ...options, notice: true, resolve: () => resolve() }))
  }

  const close = (ok: boolean): void => {
    open?.resolve(ok)
    setOpen(null)
  }

  useEffect(() => {
    if (!open) return
    ;(open.danger && !open.notice ? cancelRef : confirmRef).current?.focus()
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close(open.notice)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  return (
    <DialogContext.Provider value={api}>
      {children}
      {open ? (
        <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && close(open.notice)}>
          <div className="dialog" role={open.notice ? 'dialog' : 'alertdialog'} aria-modal="true" aria-labelledby="dialog-title">
            <h2 id="dialog-title">{open.title}</h2>
            {open.message
              ?.split(/\n\s*\n/)
              .map((paragraph, index) => <p key={index}>{paragraph}</p>)}
            <div className="dialog-actions">
              {open.notice ? null : (
                <button ref={cancelRef} type="button" className="button" onClick={() => close(false)}>
                  {open.cancelLabel ?? 'Cancel'}
                </button>
              )}
              <button
                ref={confirmRef}
                type="button"
                className={open.danger ? 'button danger-solid' : 'button primary'}
                onClick={() => close(true)}
              >
                {open.confirmLabel ?? (open.notice ? 'OK' : 'Confirm')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DialogContext.Provider>
  )
}

export function useDialog(): DialogApi {
  const context = useContext(DialogContext)
  if (!context) throw new Error('useDialog must be used inside DialogProvider')
  return context
}
