import { CITIES } from '../../shared/cities.ts';
import type { GeocodeResult } from '../../shared/types.ts';
import { Icon } from './Icon.tsx';

interface Props { onChooseLocation: () => void; onPickCity: (c: GeocodeResult) => void }

export function Onboarding({ onChooseLocation, onPickCity }: Props) {
  return (
    <section className="onboarding" aria-labelledby="onb-title">
      <Rings />
      <div className="onboarding-copy">
        <h1 id="onb-title" className="onboarding-title">Was ist heute los in deiner Nähe?</h1>
        <p className="lead">
          Konzerte, Partys, Märkte, Feste und Treffen – heute und in den nächsten Tagen, im Umkreis deiner Wahl.
        </p>
        <div className="actions">
          <button type="button" className="btn btn-primary btn-large" onClick={onChooseLocation}>
            <Icon name="pin" /> Ort festlegen
          </button>
          <a className="btn btn-large" href="#deutschland">Erst mal deutschlandweit stöbern</a>
        </div>
        <div className="stack-sm">
          <span className="label">Oder direkt eine Stadt wählen</span>
          <div className="chips">
            {CITIES.map((c) => (
              <button key={c.label} type="button" className="chip" onClick={() => onPickCity(c)}>{c.label}</button>
            ))}
          </div>
        </div>
        <p className="hint">
          Dein Standort ist freiwillig. Du kannst einen Ort eingeben oder – nur wenn du es auswählst – den Gerätestandort nutzen.
          Er wird auf etwa 1 km gerundet, taucht nicht in Adressen oder Protokollen auf und wird nur gespeichert, wenn du es erlaubst.
        </p>
      </div>
    </section>
  );
}

/** Decorative: concentric radius rings echoing the logo. */
function Rings() {
  return (
    <svg className="onboarding-art" viewBox="0 0 240 240" aria-hidden="true">
      {[112, 84, 56, 28].map((r) => (
        <circle key={r} cx="120" cy="120" r={r} className={r === 56 ? 'ring ring-active' : 'ring'} />
      ))}
      {Array.from({ length: 72 }, (_, i) => {
        const a = (i * Math.PI) / 36;
        const inner = i % 6 === 0 ? 113 : 116;
        return <line key={i} className="ring-tick" x1={120 + inner * Math.sin(a)} y1={120 - inner * Math.cos(a)} x2={120 + 119 * Math.sin(a)} y2={120 - 119 * Math.cos(a)} />;
      })}
      <circle cx="120" cy="120" r="4" className="ring-dot" />
    </svg>
  );
}
