import type { EventItem } from '../../shared/types.ts';

export type MapProvider = 'apple' | 'google' | 'here' | 'osm';
export interface MapLink { provider: MapProvider; label: string; href: string }
export interface MapTarget {
  /** 'coordinates' when the source gave the venue's position, 'address' when we can only search for its text. */
  by: 'coordinates' | 'address';
  links: MapLink[];
}

const q = encodeURIComponent;
/** 5 decimals ≈ 1 m – plenty for a venue, and no long float tails in the URL. */
const fix = (n: number) => String(Math.round(n * 1e5) / 1e5);

/**
 * Deep links that open the event's place in a map app. Only the destination goes into the URL –
 * never the user's home. Demo events get none: their places are invented. Formats:
 * Apple https://developer.apple.com/documentation/mapkit/unified-map-urls,
 * Google https://developers.google.com/maps/documentation/urls/get-started,
 * HERE https://docs.here.com/wego-pro/docs/share-location-dl.
 */
export function mapTarget(e: EventItem): MapTarget | null {
  if (e.isDemo) return null;
  const place = e.address?.trim() || e.area?.trim();

  if (e.location && !e.locationApprox) {
    const lat = fix(e.location.lat);
    const lon = fix(e.location.lon);
    const name = e.venue?.trim() || e.title.trim();
    return {
      by: 'coordinates',
      links: [
        { provider: 'apple', label: 'Apple Karten', href: `https://maps.apple.com/place?coordinate=${lat},${lon}&name=${q(name)}` },
        { provider: 'google', label: 'Google Maps', href: `https://www.google.com/maps/search/?api=1&query=${q(`${lat},${lon}`)}` },
        { provider: 'here', label: 'HERE WeGo', href: `https://share.here.com/l/${lat},${lon},${q(name)}?z=17&p=yes` },
        { provider: 'osm', label: 'OpenStreetMap', href: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}` },
      ],
    };
  }

  // A venue name alone ("Stadthalle") is too ambiguous to search for.
  if (!place) return null;
  const text = [e.venue?.trim(), place].filter(Boolean).join(', ');
  return {
    by: 'address',
    links: [
      { provider: 'apple', label: 'Apple Karten', href: `https://maps.apple.com/search?query=${q(text)}` },
      { provider: 'google', label: 'Google Maps', href: `https://www.google.com/maps/search/?api=1&query=${q(text)}` },
      { provider: 'osm', label: 'OpenStreetMap', href: `https://www.openstreetmap.org/search?query=${q(text)}` },
    ],
  };
}

/** Puts the preferred app first. When it has no link for this place (HERE needs coordinates), the order stays. */
export function preferLink(target: MapTarget, preferred: MapProvider): { primary: MapLink; others: MapLink[] } {
  const primary = target.links.find((l) => l.provider === preferred) ?? target.links[0];
  return { primary, others: target.links.filter((l) => l !== primary) };
}
