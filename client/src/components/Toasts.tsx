import { Icon } from "../art/icons";
import { dismissToast, useAppState } from "../state/store";

export function Toasts() {
  const toasts = useAppState((s) => s.toasts);
  return (
    <div className="toasts" aria-live="polite" role="status">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          <span>{toast.text}</span>
          <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(toast.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
