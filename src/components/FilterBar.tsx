import { useId, useState } from 'react';
import { CATEGORIES } from '../../shared/categories.ts';
import type { CategoryId } from '../../shared/types.ts';
import { RANGES, type RangeId } from '../lib/dates.ts';
import type { SortId } from '../lib/filter.ts';
import { Icon } from './Icon.tsx';

export interface Filters { range: RangeId; categories: CategoryId[]; text: string; sort: SortId }

export const RADIUS_PRESETS = [5, 10, 15, 25, 50];

const DIAL_R = 27;
const TICKS = Array.from({ length: 24 }, (_, i) => (i * Math.PI) / 12);

/** The chosen radius drawn to scale against the 50 km maximum – the logo's rings, made live. */
function RadiusDial({ km }: { km: number }) {
  const r = Math.max(2.2, (DIAL_R * km) / 50);
  return (
    <svg className="dial" viewBox="0 0 64 64" aria-hidden="true">
      {TICKS.map((a, i) => {
        const inner = i % 6 === 0 ? 28.5 : 29.6;
        return (
          <line
            key={i}
            className={i % 6 === 0 ? 'dial-tick is-major' : 'dial-tick'}
            x1={32 + inner * Math.sin(a)}
            y1={32 - inner * Math.cos(a)}
            x2={32 + 31.2 * Math.sin(a)}
            y2={32 - 31.2 * Math.cos(a)}
          />
        );
      })}
      <circle className="dial-bezel" cx="32" cy="32" r={DIAL_R} />
      <circle className="dial-area" cx="32" cy="32" r={r} />
      <circle className="dial-dot" cx="32" cy="32" r="1.8" />
    </svg>
  );
}

export function RadiusControl({ value, onChange }: { value: number; onChange: (km: number) => void }) {
  const id = useId();
  return (
    <div className="radius">
      <div className="radius-head">
        <RadiusDial km={value} />
        <div className="radius-readout">
          <label htmlFor={id} className="radius-label">Umkreis</label>
          <output htmlFor={id} className="radius-value">
            {value}
            <span className="radius-unit"> km</span>
          </output>
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={1}
        max={50}
        step={1}
        value={value}
        aria-valuetext={`${value} Kilometer`}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="chips chips-tight" role="group" aria-label="Umkreis schnell wählen">
        {RADIUS_PRESETS.map((km) => (
          <button key={km} type="button" className="chip" aria-pressed={value === km} onClick={() => onChange(km)}>
            {km} km
          </button>
        ))}
      </div>
    </div>
  );
}

interface Props {
  value: Filters;
  onChange: (patch: Partial<Filters>) => void;
  canSortByDistance: boolean;
  hasInterests: boolean;
}

export function FilterBar({ value, onChange, canSortByDistance, hasInterests }: Props) {
  const uid = useId();
  const toggleCat = (id: CategoryId) =>
    onChange({ categories: value.categories.includes(id) ? value.categories.filter((c) => c !== id) : [...value.categories, id] });

  const [open, setOpen] = useState(false);
  const rangeLabel = RANGES.find((r) => r.id === value.range)?.label ?? '';
  const n = value.categories.length;
  const catLabel = n === 0 ? 'alle Kategorien' : n === 1 ? (CATEGORIES.find((c) => c.id === value.categories[0])?.label ?? '1 Kategorie') : `${n} Kategorien`;
  const summary = [rangeLabel, catLabel, value.text.trim() && 'Suche aktiv'].filter(Boolean).join(', ');

  return (
    <div className={open ? 'filters is-open' : 'filters'}>
      <button
        type="button"
        className="filters-toggle"
        aria-expanded={open}
        aria-controls={`filters-${uid}`}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="filters-toggle-text">
          <span className="filters-toggle-label">Filter</span>
          <span className="filters-toggle-summary">{summary}</span>
        </span>
        <Icon name="chevron" />
      </button>
      <div className="filters-body" id={`filters-${uid}`}>
        <fieldset className="filter-group">
          <legend className="label">Wann</legend>
          <div className="chips">
            {RANGES.map((r) => (
              <label key={r.id} className="chip chip-radio">
                <input type="radio" name={`range-${uid}`} checked={value.range === r.id} onChange={() => onChange({ range: r.id })} />
                <span>{r.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="filter-group">
          <legend className="label">
            Was {value.categories.length > 0 && <span className="muted">({value.categories.length} gewählt)</span>}
          </legend>
          <div className="chips">
            <button type="button" className="chip" aria-pressed={value.categories.length === 0} onClick={() => onChange({ categories: [] })}>
              Alles
            </button>
            {CATEGORIES.map((c) => (
              <label key={c.id} className={`chip chip-check cat-${c.id}`}>
                <input type="checkbox" checked={value.categories.includes(c.id)} onChange={() => toggleCat(c.id)} />
                <span>{c.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="filter-row">
          <div className="field grow">
            <label htmlFor={`q-${uid}`} className="label">Suche</label>
            <input
              id={`q-${uid}`}
              type="search"
              value={value.text}
              maxLength={80}
              placeholder="Titel, Ort oder Stichwort"
              onChange={(e) => onChange({ text: e.target.value })}
            />
          </div>
          <div className="field">
            <label htmlFor={`sort-${uid}`} className="label">Sortierung</label>
            <select id={`sort-${uid}`} value={value.sort} onChange={(e) => onChange({ sort: e.target.value as SortId })}>
              <option value="zeit">Nach Uhrzeit</option>
              <option value="entfernung" disabled={!canSortByDistance}>Nach Entfernung</option>
              <option value="interessen" disabled={!hasInterests}>Interessen zuerst</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
