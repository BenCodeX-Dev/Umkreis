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
  /** true when the source named a position that does not fit its area (or Germany); it is not used. */
  locationRejected?: boolean;
  category: CategoryId;
  price?: PriceInfo;
  description?: string;
  /** Link to the original listing (http/https only). */
  url?: string;
  /** Label for `url`, e.g. "Originalanzeige" or "Veranstaltungskalender". */
  urlLabel?: string;
  status?: EventStatus;
  /** Licence terms the source attaches to this entry when they require credit (e.g. CC BY). */
  rights?: EventRights;
  /**
   * When Umkreis last downloaded this entry from its source (ISO). It says nothing about when the
   * organiser last changed it.
   */
  checkedAt?: string;
}

export interface EventRights {
  /** Short licence name as the source gives it, e.g. "CC BY-SA". */
  license: string;
  licenseUrl: string;
  /** Rights holder or origin the source names (author, organisation or delivering system). */
  by?: string;
  /** Changed versions must be shared under the same licence. */
  shareAlike?: boolean;
}

export interface SourceStatus {
  id: string;
  name: string;
  kind: 'ticketmaster' | 'ics' | 'opendata';
  ok: boolean;
  count: number;
  message?: string;
  /** When this source was last downloaded successfully (ISO). */
  checkedAt?: string;
}

/** `unconfigured`: no source is switched on (no open data, Ticketmaster key or iCal feed), so there is nothing to show. */
export type SourceMode = 'live' | 'unconfigured';

export interface EventsResponse {
  mode: SourceMode;
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
