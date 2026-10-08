import type { Notice } from "../state/store";
import { clearNotice } from "../state/store";

export function NoticeBanner({ notice }: { notice: Notice | null }) {
  if (!notice) return null;
  return (
    <div className="notice" role="alert">
      <span className="notice-text">
        <span aria-hidden="true">ℹ️ </span>
        {notice.message}
      </span>
      <button type="button" className="btn btn-icon" aria-label="Dismiss message" onClick={clearNotice}>
        ✕
      </button>
    </div>
  );
}
