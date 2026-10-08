import { useEffect, useRef, useState, type ReactNode } from "react";

interface ConfirmButtonProps {
  children: ReactNode;
  /** The question shown on the confirm step. */
  prompt: string;
  confirmLabel: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}

/** A button that asks "Are you sure?" inline before doing something destructive. */
export function ConfirmButton({ children, prompt, confirmLabel, onConfirm, className, disabled }: ConfirmButtonProps) {
  const [asking, setAsking] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asking) confirmRef.current?.focus();
  }, [asking]);

  if (!asking) {
    return (
      <button type="button" className={className ?? "btn"} disabled={disabled} onClick={() => setAsking(true)}>
        {children}
      </button>
    );
  }
  return (
    <div className="confirm" role="group" aria-label={prompt}>
      <p className="confirm-prompt">{prompt}</p>
      <div className="button-row">
        <button
          ref={confirmRef}
          type="button"
          className="btn btn-danger"
          disabled={disabled}
          onClick={() => {
            setAsking(false);
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setAsking(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
