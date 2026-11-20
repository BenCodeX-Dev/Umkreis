import { useState, type FormEvent } from 'react';
import { CITIES } from '../../shared/cities.ts';
import type { GeocodeResult } from '../../shared/types.ts';
import { ApiError, geocodePlace } from '../lib/api.ts';
import { requestDeviceLocation, type HomeLocation } from '../lib/location.ts';
import { Icon } from './Icon.tsx';
import { Modal } from './Modal.tsx';

interface Props {
  open: boolean;
  home?: HomeLocation;
  remember: boolean;
  onClose: () => void;
  onSave: (home: HomeLocation, remember: boolean) => void;
  onClear: () => void;
}

export function LocationDialog(props: Props) {
  return (
    <Modal open={props.open} title="Standort festlegen" onClose={props.onClose}>
      <LocationForm {...props} />
    </Modal>
  );
}

function LocationForm({ home, remember: initialRemember, onSave, onClear }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [fallback, setFallback] = useState(false);
  const [busy, setBusy] = useState<'search' | 'device' | null>(null);
  const [error, setError] = useState('');
  const [remember, setRemember] = useState(initialRemember);

  const pick = (r: GeocodeResult) => onSave({ lat: r.lat, lon: r.lon, label: r.label, source: 'manual' }, remember);

  async function search(e: FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (q.length < 2) {
      setError('Bitte mindestens zwei Zeichen eingeben.');
      return;
    }
    setBusy('search');
    setError('');
    try {
      const res = await geocodePlace(q);
      setResults(res.results);
      setFallback(res.fallback);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die Ortssuche ist fehlgeschlagen.');
    } finally {
      setBusy(null);
    }
  }

  async function useDevice() {
    setBusy('device');
    setError('');
    try {
      onSave(await requestDeviceLocation(), remember);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Der Standort konnte nicht ermittelt werden.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack">
      <form onSubmit={search} className="stack-sm" role="search" aria-label="Ort suchen">
        <label htmlFor="loc-q" className="label">Ort oder Postleitzahl</label>
        <div className="input-row">
          <input
            id="loc-q"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="z. B. Darmstadt oder 64283"
            autoComplete="address-level2"
            maxLength={80}
          />
          <button type="submit" className="btn btn-primary" disabled={busy !== null}>
            {busy === 'search' ? 'Suche …' : 'Suchen'}
          </button>
        </div>
      </form>

      {error && <p className="alert alert-error" role="alert">{error}</p>}

      {results && (
        <div className="stack-sm" aria-live="polite">
          {fallback && (
            <p className="hint">Die Ortssuche ist gerade nicht erreichbar. Treffer aus der Liste großer Städte:</p>
          )}
          {results.length === 0 ? (
            <p className="hint">Kein Ort in Deutschland gefunden. Versuche es mit einem anderen Namen oder einer PLZ.</p>
          ) : (
            <ul className="choice-list">
              {results.map((r) => (
                <li key={`${r.label}-${r.lat}-${r.lon}`}>
                  <button type="button" className="choice" onClick={() => pick(r)}>
                    <Icon name="pin" /> {r.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="divider"><span>oder</span></div>

      <div className="stack-sm">
        <button type="button" className="btn" onClick={useDevice} disabled={busy !== null}>
          <Icon name="locate" /> {busy === 'device' ? 'Standort wird ermittelt …' : 'Meinen aktuellen Standort verwenden'}
        </button>
        <p className="hint">
          Dein Browser fragt dich vorher um Erlaubnis. Der Standort wird auf etwa 1 km gerundet und nur für die Suche verwendet.
        </p>
      </div>

      <div className="stack-sm">
        <span className="label">Schnellauswahl</span>
        <div className="chips">
          {CITIES.slice(0, 8).map((c) => (
            <button key={c.label} type="button" className="chip" onClick={() => pick(c)}>{c.label}</button>
          ))}
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        <span>
          Standort auf diesem Gerät merken
          <small>Wird nur lokal in deinem Browser gespeichert (gerundet). Ohne Haken gilt er nur, bis du die Seite neu lädst oder schließt.</small>
        </span>
      </label>

      {home && (
        <div className="modal-foot">
          <span className="hint">Aktuell: {home.label}</span>
          <button type="button" className="btn btn-quiet" onClick={onClear}>Standort entfernen</button>
        </div>
      )}
    </div>
  );
}
