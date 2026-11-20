import type { EventStatus, PriceInfo } from '../../shared/types.ts';

export const STATUS_LABEL: Record<EventStatus, string> = {
  cancelled: 'Abgesagt',
  postponed: 'Verschoben',
  rescheduled: 'Neuer Termin',
};

export function formatDistance(km: number | undefined, approx?: boolean): string {
  if (km === undefined) return 'Entfernung unbekannt';
  const base = km < 1 ? 'unter 1 km' : `ca. ${km < 10 ? km.toFixed(1).replace('.', ',') : Math.round(km)} km`;
  return approx ? `${base} (Ortsmitte)` : base;
}

export function formatPrice(price: PriceInfo | undefined): string {
  if (!price) return 'Preis unbekannt';
  if (price.free) return price.fromText ? 'Kostenlos (laut Beschreibung)' : 'Kostenlos';
  const { min, max, currency } = price;
  // Whole amounts without decimals ("25 €"), others with two ("49,50 €").
  const money = (v: number) =>
    new Intl.NumberFormat('de-DE', { style: 'currency', currency, minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 }).format(v);
  try {
    if (min !== undefined && max !== undefined) return min === max ? money(min) : `${money(min)} – ${money(max)}`;
    if (min !== undefined) return `ab ${money(min)}`;
    if (max !== undefined) return `bis ${money(max)}`;
  } catch {
    /* invalid currency code */
  }
  return 'Preis unbekannt';
}
