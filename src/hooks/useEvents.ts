import { useEffect, useState } from 'react';
import type { EventsRequest, EventsResponse } from '../../shared/types.ts';
import { ApiError, fetchEvents } from '../lib/api.ts';

type Data = EventsResponse & { dropped: number };
interface State { key: string | null; data?: Data; error?: ApiError }

/**
 * Loads events for a request. Loading is derived from the request key, so no state is set
 * synchronously inside the effect; the last good result stays available while refreshing.
 */
export function useEvents(req: EventsRequest | null) {
  const [nonce, setNonce] = useState(0);
  const key = req ? JSON.stringify([req, nonce]) : null;
  const [state, setState] = useState<State>({ key: null });

  useEffect(() => {
    if (!key) return;
    const [params] = JSON.parse(key) as [EventsRequest, number];
    const ctrl = new AbortController();
    fetchEvents(params, ctrl.signal).then(
      (data) => setState({ key, data }),
      (err: unknown) => {
        if (ctrl.signal.aborted) return;
        setState((s) => ({
          key,
          data: s.data,
          error: err instanceof ApiError ? err : new ApiError('Unerwarteter Fehler beim Laden. Bitte erneut versuchen.'),
        }));
      },
    );
    return () => ctrl.abort();
  }, [key]);

  const current = state.key === key;
  return {
    loading: key !== null && !current,
    data: current && !state.error ? state.data : undefined,
    previous: state.data,
    error: current ? state.error : undefined,
    retry: () => setNonce((n) => n + 1),
  };
}
