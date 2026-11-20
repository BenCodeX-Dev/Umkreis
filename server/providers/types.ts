import type { EventItem, GeoPoint, SourceStatus } from '../../shared/types.ts';

export interface ProviderQuery {
  scope: 'local' | 'de';
  center?: GeoPoint;
  radiusKm?: number;
  from: Date;
  to: Date;
  text?: string;
}

export interface ProviderResult {
  events: EventItem[];
  /** The source had more results than were fetched. */
  truncated?: boolean;
}

export interface EventProvider {
  id: string;
  name: string;
  kind: SourceStatus['kind'];
  fetchEvents(q: ProviderQuery): Promise<ProviderResult>;
}

export type FetchFn = typeof fetch;

/** An error whose message is safe and helpful to show to users. */
export class ProviderError extends Error {}
