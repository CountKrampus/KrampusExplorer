import { useToastStore } from "../stores/useToastStore";
import "./ToastContainer.css";

function ToastContainer() {
  const toasts = useToastStore((state) => state.toasts);
  const dismissToast = useToastStore((state) => state.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span className="toast__message">{toast.message}</span>
          <button
            className="toast__dismiss"
            onClick={() => dismissToast(toast.id)}
            aria-label="Dismiss notification"
            title="Dismiss"
          >
            &#x2715;
          </button>
        </div>
      ))}
    </div>
  );
}

export default ToastContainer;
