import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Icon } from './Icon.tsx';

interface Props { open: boolean; title: string; onClose: () => void; children: ReactNode }

/** Native <dialog>: focus trapping, Esc and inert background come from the browser. */
export function Modal({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={id}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="modal-body">
          <div className="modal-head">
            <h2 id={id}>{title}</h2>
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
              <Icon name="close" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
