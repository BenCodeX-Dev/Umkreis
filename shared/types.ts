export type CategoryId =
  | 'konzert'
  | 'party'
  | 'markt'
  | 'festival'
  | 'community'
  | 'kultur'
  | 'sport'
  | 'familie'
  | 'sonstiges';

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface PriceInfo {
  currency: string;
  min?: number;
  max?: number;
  free?: boolean;
  /** true when the price was derived from the listing's text (e.g. "Eintritt frei"). */
  fromText?: boolean;
}

export type EventStatus = 'cancelled' | 'postponed' | 'rescheduled';

/** A normalised event. Optional fields are genuinely unknown — never filled with guesses. */
export interface EventItem {
  id: string;
  source: string;
  sourceName: string;
  isDemo: boolean;
  title: string;
  /** ISO-8601 instant (UTC). */
  start: string;
  end?: string;
  /** false when only the date is known. */
  timeKnown: boolean;
  allDay?: boolean;
  venue?: string;
  area?: string;
  address?: string;
  location?: GeoPoint;
  /** true when `location` is only the feed's area centre, not the venue. */
  locationApprox?: boolean;
  category: CategoryId;
  price?: PriceInfo;
  description?: string;
  /** Link to the original listing (http/https only). */
  url?: string;
  /** Label for `url`, e.g. "Originalanzeige" or "Veranstaltungskalender". */
  urlLabel?: string;
  status?: EventStatus;
}

export interface SourceStatus {
  id: string;
  name: string;
  kind: 'ticketmaster' | 'ics' | 'demo';
  ok: boolean;
  count: number;
  message?: string;
}

export interface EventsResponse {
  mode: 'live' | 'demo';
  events: EventItem[];
  sources: SourceStatus[];
  truncated: boolean;
}

export interface EventsRequest {
  scope: 'local' | 'de';
  lat?: number;
  lon?: number;
  radiusKm?: number;
  from: string;
  to: string;
  q?: string;
}

export interface GeocodeResult {
  label: string;
  lat: number;
  lon: number;
}

export interface GeocodeResponse {
  results: GeocodeResult[];
  fallback: boolean;
}
