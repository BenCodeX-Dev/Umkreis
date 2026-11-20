export interface Suggestion { label: string; onClick: () => void }

export function LoadingState() {
  return (
    <div className="results" aria-busy="true">
      <p className="visually-hidden" role="status">Veranstaltungen werden geladen …</p>
      <ul className="cards" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <li key={i}>
            <div className="card skeleton">
              <span className="sk sk-tag" />
              <span className="sk sk-title" />
              <span className="sk sk-line" />
              <span className="sk sk-line sk-short" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Suggestions({ items }: { items: Suggestion[] }) {
  if (items.length === 0) return null;
  return (
    <div className="suggestions">
      <span className="label">Vorschläge:</span>
      <div className="chips">
        {items.map((s) => (
          <button key={s.label} type="button" className="chip chip-action" onClick={s.onClick}>{s.label}</button>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({ title, text, suggestions }: { title: string; text?: string; suggestions: Suggestion[] }) {
  return (
    <div className="state" role="status">
      <h2 className="state-title">{title}</h2>
      {text && <p>{text}</p>}
      <Suggestions items={suggestions} />
    </div>
  );
}

export function ErrorState({ message, onRetry, suggestions }: { message: string; onRetry: () => void; suggestions: Suggestion[] }) {
  return (
    <div className="state state-error" role="alert">
      <h2 className="state-title">Veranstaltungen konnten nicht geladen werden</h2>
      <p>{message}</p>
      <button type="button" className="btn btn-primary" onClick={onRetry}>Erneut versuchen</button>
      <Suggestions items={suggestions} />
    </div>
  );
}
