import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadServerConfig } from './config.ts';
import { createSourceStore, type ConnectedSource } from './connect.ts';

/**
 * Operator tool for connected calendars: `npm run sources -- list | approve <id> | remove <id> | block <id>`.
 * The running server notices the changes on its next search; no restart needed.
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cfg = loadServerConfig(process.env, root);
const file = cfg.connect?.file ?? path.resolve(root, process.env.SOURCES_FILE || 'data/sources.json');
const store = createSourceStore(file);
const [cmd = 'list', id] = process.argv.slice(2);

function change(fn: (s: ConnectedSource, list: ConnectedSource[], i: number) => string): void {
  if (!id) {
    console.error('Bitte die ID angeben (siehe "npm run sources -- list").');
    process.exitCode = 1;
    return;
  }
  const msg = store.mutate((list) => {
    const i = list.findIndex((s) => s.id === id);
    return i < 0 ? `Keine Quelle mit der ID ${id}.` : fn(list[i], list, i);
  });
  console.log(msg);
}

if (cmd === 'list') {
  const list = store.reload();
  console.log(`${file}: ${list.length} Einträge${cfg.connect ? `, Freischaltung: ${cfg.connect.approval === 'auto' ? 'automatisch' : 'von Hand'}` : ', Kalender verbinden ist ausgeschaltet'}`);
  for (const s of list) {
    console.log(`${s.id}  ${s.status.padEnd(9)} ${(s.format ?? '-').padEnd(3)}  ${s.name} · ${s.area.label} · ${s.url}  (angemeldet ${s.createdAt.slice(0, 16)}${s.checkedAt ? `, geprüft ${s.checkedAt.slice(0, 16)}` : ''})`);
  }
} else if (cmd === 'approve') {
  change((s, list, i) => {
    if (s.status !== 'waiting' && s.status !== 'withdrawn') return `${s.name}: Status ${s.status} – freischalten geht erst, wenn der Veranstalter seinen Code bestätigt hat.`;
    const now = new Date().toISOString();
    // A withdrawn source stays off until its organiser checks again; approval just remembers the decision.
    list[i] = { ...s, approvedAt: now, status: s.status === 'waiting' ? 'active' : s.status };
    return `${s.name}: freigeschaltet${s.status === 'withdrawn' ? ' (wird aktiv, sobald der Veranstalter erneut prüft)' : ''}.`;
  });
} else if (cmd === 'remove') {
  change((s, list, i) => {
    list.splice(i, 1);
    return `${s.name}: entfernt.`;
  });
} else if (cmd === 'block') {
  change((s, list) => {
    let n = 0;
    for (let j = 0; j < list.length; j++) {
      if (list[j].site !== s.site) continue;
      list[j] = { ...list[j], status: 'blocked' };
      n++;
    }
    return `${s.site}: gesperrt (${n} ${n === 1 ? 'Eintrag' : 'Einträge'}). Keine Termine und keine neuen Anmeldungen mehr von dieser Website.`;
  });
} else {
  console.error('Befehle: list | approve <id> | remove <id> | block <id>');
  process.exitCode = 1;
}
