import { TtlCache } from '../cache.ts';
import { ProviderError, type FetchFn } from './types.ts';

class TooLarge extends Error {}

/** Reads the body as UTF-8 text and stops (cancelling the download) as soon as it exceeds `limit` bytes. */
export async function readTextCapped(res: Response, limit: number): Promise<string> {
  if (Number(res.headers.get('content-length') ?? 0) > limit) throw new TooLarge();
  if (!res.body) return '';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new TooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

export interface DownloadOptions<T> {
  /** Shown in error messages. */
  name: string;
  url: string;
  fetchFn: FetchFn;
  accept: string;
  maxBytes: number;
  /** Turns the text into data; throws a ProviderError for unusable content. */
  parse: (text: string) => T;
  ttlMs: number;
  /** After a failed download the source is not asked again for this long, so a dead server does not hold up every search. */
  failurePauseMs: number;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

export type Loaded<T> = { data: T; checkedAt: string };

/** One cached download of a file: parallel callers share it, failures pause further attempts for a while. */
export function createCachedDownload<T>(o: DownloadOptions<T>): () => Promise<Loaded<T>> {
  const cache = new TtlCache<Loaded<T>>(o.ttlMs, 1);
  let pending: Promise<Loaded<T>> | undefined;
  let failed: { error: ProviderError; until: number } | undefined;

  async function download(): Promise<Loaded<T>> {
    let res: Response;
    try {
      res = await o.fetchFn(o.url, { signal: AbortSignal.timeout(o.timeoutMs ?? 20_000), headers: { Accept: o.accept, ...o.headers } });
    } catch {
      throw new ProviderError(`${o.name} ist gerade nicht erreichbar.`);
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      throw new ProviderError(`${o.name} antwortet mit Fehler ${res.status}.`);
    }
    let text: string;
    try {
      text = await readTextCapped(res, o.maxBytes);
    } catch (err) {
      throw new ProviderError(err instanceof TooLarge ? `${o.name}: Datei ist zu groß.` : `${o.name} ist gerade nicht erreichbar.`);
    }
    const loaded = { data: o.parse(text), checkedAt: new Date().toISOString() };
    cache.set('file', loaded);
    return loaded;
  }

  return function load(): Promise<Loaded<T>> {
    const hit = cache.get('file');
    if (hit) return Promise.resolve(hit);
    if (failed && Date.now() < failed.until) return Promise.reject(failed.error);
    pending ??= download()
      .then(
        (loaded) => {
          failed = undefined;
          return loaded;
        },
        (err: unknown) => {
          if (err instanceof ProviderError) failed = { error: err, until: Date.now() + o.failurePauseMs };
          throw err;
        },
      )
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
