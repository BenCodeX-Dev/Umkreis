import { useState } from 'react';
import { CATEGORIES } from '../../shared/categories.ts';
import type { CategoryId } from '../../shared/types.ts';
import { Modal } from './Modal.tsx';

interface Props { open: boolean; interests: CategoryId[]; onClose: () => void; onSave: (v: CategoryId[]) => void }

export function InterestsDialog(props: Props) {
  return (
    <Modal open={props.open} title="Deine Interessen" onClose={props.onClose}>
      <InterestsForm {...props} />
    </Modal>
  );
}

function InterestsForm({ interests, onSave }: Props) {
  const [sel, setSel] = useState<CategoryId[]>(interests);
  const toggle = (id: CategoryId) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <form
      className="stack"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(sel);
      }}
    >
      <p className="hint">
        Passende Veranstaltungen werden hervorgehoben – mit Begründung auf der Karte. Es wird nichts ausgeblendet.
        Deine Auswahl bleibt nur in diesem Browser.
      </p>
      <fieldset className="chips">
        <legend className="visually-hidden">Kategorien</legend>
        {CATEGORIES.map((c) => (
          <label key={c.id} className={`chip chip-check cat-${c.id}`}>
            <input type="checkbox" checked={sel.includes(c.id)} onChange={() => toggle(c.id)} />
            <span>{c.label}</span>
          </label>
        ))}
      </fieldset>
      <div className="modal-foot">
        <button type="button" className="btn btn-quiet" onClick={() => setSel([])}>Alle abwählen</button>
        <button type="submit" className="btn btn-primary">Speichern</button>
      </div>
    </form>
  );
}
