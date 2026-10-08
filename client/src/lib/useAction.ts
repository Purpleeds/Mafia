import { useCallback, useEffect, useRef, useState } from "react";
import type { CallResult } from "../net/socket";
import { friendlyError } from "./errors";

export interface ActionState {
  pending: boolean;
  error: string | null;
  run: <T>(fn: () => Promise<CallResult<T>>) => Promise<CallResult<T>>;
  clearError: () => void;
}

/** Tracks one server request at a time: pending flag and a friendly error. */
export function useAction(): ActionState {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(fn: () => Promise<CallResult<T>>): Promise<CallResult<T>> => {
    setPending(true);
    setError(null);
    const result = await fn();
    if (mounted.current) {
      setPending(false);
      if (!result.ok) setError(friendlyError(result.error));
    }
    return result;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { pending, error, run, clearError };
}
