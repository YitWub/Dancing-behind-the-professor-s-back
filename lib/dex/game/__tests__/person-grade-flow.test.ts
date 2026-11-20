import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { IndexedDbDexRepository } from '../../storage/indexeddb.ts';
import { personScore } from '../exp.ts';
import type { Result } from '../../core/types.ts';
import type { BoardManagementCommand } from '../../people/multi-board.ts';
import type { PersonEntry } from '../../people/view.ts';

const val = <T>(r: Result<T>): T => { if (!r.ok) throw Error(r.error.code + ': ' + r.error.message); return r.value; };
const NOTE = '도서관에서 같이 공부한 날';

/** The repository calls the people screens make: register, add memory, board initialize/migrate/place, connect-objects. */
async function people(...names: string[]) {
  const repo = new IndexedDbDexRepository({ factory: new IDBFactory() }), { ownerId } = val(await repo.open());
  const dex = val(await repo.snapshot()).dexes.find(d => d.kind === 'people')!, ids: Record<string, string> = {};
  for (const name of names) ids[name] = val(await repo.collect({ ownerId, dexId: dex.id, requestId: name, subject: { kind: 'person', displayName: name }, experience: { kind: 'person', event: 'first-met', experiencedOn: '2026-09-01', note: NOTE } })).entry.id;
  const root = async () => val(await repo.snapshot()).dexes.find(d => d.id === dex.id)!;
  const manage = async (command: BoardManagementCommand) => { const d = await root(); val(await repo.managePeopleBoards(ownerId, d.id, d.revision, command)); };
  await manage({ type: 'initialize' });
  await manage({ type: 'migrate-connections' });
  const placement = async (name: string) => {
    const board = () => root().then(d => d.peopleBoards!.boards.find(b => b.id === d.peopleBoards!.activeBoardId)!);
    if (!(await board()).layout.positions.some(p => p.entryId === ids[name])) await manage({ type: 'place', boardId: (await board()).id, entryId: ids[name] });
    const b = await board();
    return { boardId: b.id, objectId: b.layout.positions.find(p => p.entryId === ids[name])!.placementId! };
  };
  return {
    memory: async (name: string, day: string, note = NOTE) => { const d = await root(); val(await repo.collect({ ownerId, dexId: d.id, entryId: ids[name], requestId: crypto.randomUUID(), subject: { kind: 'person', displayName: name }, experience: { kind: 'person', event: 'memory', experiencedOn: day, note } })); },
    connect: async (a: string, b: string | { type: 'note'; objectId: string }) => {
      const from = await placement(a), to = typeof b === 'string' ? { type: 'person' as const, objectId: (await placement(b)).objectId } : b, d = await root();
      if (typeof b !== 'string') val(await repo.updatePeopleBoard(ownerId, d.id, d.revision, { type: 'add-note', id: b.objectId, text: '메모', color: 'yellow' }, from.boardId));
      const now = await root();
      val(await repo.updatePeopleBoard(ownerId, now.id, now.revision, { type: 'connect-objects', connection: { id: crypto.randomUUID(), boardId: from.boardId, from: { type: 'person', objectId: from.objectId }, to, style: 'red', label: '', createdAt: new Date().toISOString() } }, from.boardId));
    },
    score: async (name: string) => { const d = val(await repo.snapshot()); const { days, linked, score, grade } = personScore(d.entries.find(e => e.id === ids[name]) as PersonEntry, d); return { days, linked, score, grade: grade.label }; },
  };
}

test('real save paths: 5 memory days + 3 threaded people is 전설; same-day memories count once', async () => {
  const days = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'];
  const full = await people('P', 'A', 'B', 'C');
  for (const day of days) await full.memory('P', day);
  for (const other of ['A', 'B', 'C']) await full.connect('P', other);
  assert.deepEqual(await full.score('P'), { days: 5, linked: 3, score: 13, grade: '전설' });

  const sameDay = await people('P', 'A', 'B', 'C');
  for (let i = 0; i < 5; i++) await sameDay.memory('P', '2026-11-20');
  for (const other of ['A', 'B', 'C']) await sameDay.connect('P', other);
  assert.deepEqual(await sameDay.score('P'), { days: 1, linked: 3, score: 5, grade: '희귀' }, 'five memories left on the form default date are one day');
});

test('real save paths: repeated threads, note threads and short notes do not add points', async () => {
  const w = await people('P', 'A');
  await w.memory('P', '2026-10-01');
  await w.memory('P', '2026-10-02', '같이 밥 먹음');
  await w.connect('P', 'A');
  await w.connect('A', 'P');
  await w.connect('P', { type: 'note', objectId: 'n1' });
  assert.deepEqual(await w.score('P'), { days: 1, linked: 1, score: 3, grade: '고급' });
});
