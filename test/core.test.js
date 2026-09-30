const test = require('node:test');
const assert = require('node:assert/strict');
const T = require('../core.js');

// Two snowflakes that collide as JS numbers (differ only past 2^53)
const A = '1290000000000000001', B = '1290000000000000002';

test('dayKey and hhmm use Bangkok time regardless of machine TZ', () => {
  assert.equal(T.dayKey('2026-09-29T17:30:00Z'), '2026-09-30');
  assert.equal(T.hhmm('2026-09-29T17:30:00Z'), '00:30');
  assert.equal(T.dayKey('2026-09-29T16:59:00Z'), '2026-09-29');
  assert.equal(T.hhmm('2026-09-29T16:59:00Z'), '23:59');
  assert.equal(T.dayKey(''), T.UNKNOWN_DAY);
  assert.equal(T.dayKey('garbage'), T.UNKNOWN_DAY);
  assert.equal(T.hhmm(''), '');
});

test('cmpId orders snowflakes beyond Number precision', () => {
  assert.equal(Number(A), Number(B));
  assert.equal(T.cmpId(A, B), -1);
  assert.equal(T.cmpId(B, A), 1);
  assert.equal(T.cmpId(A, A), 0);
  assert.equal(T.cmpId('99', '100'), -1);
  assert.doesNotThrow(() => T.cmpId('abc', '12'));
});

test('mergeExport dedupes by id and counts added vs updated', () => {
  const store = new Map();
  const r1 = T.mergeExport(store, { channel: 'gold-room', messages: [{ id: A, text: 'a' }, { id: B, text: 'b' }, { text: 'no id' }] });
  assert.deepEqual([r1.added, r1.updated, r1.channel], [2, 0, 'gold-room']);
  const r2 = T.mergeExport(store, [{ id: B, text: 'b' }, { id: '5', text: 'c' }]);
  assert.deepEqual([r2.added, r2.updated, r2.channel], [1, 1, '']);
  assert.equal(store.size, 3);
  assert.throws(() => T.mergeExport(store, { foo: 1 }));
});

test('merging a raw export after a -drive export keeps Drive links and data images', () => {
  const store = new Map();
  T.mergeExport(store, [{ id: A, user: 'Nok', text: 'XAU H1 setup', imgs: ['data:image/jpeg;base64,AAA', 'https://cdn.discordapp.com/x.png'], drive: ['https://drive.google.com/file/d/1', ''] }]);
  T.mergeExport(store, [{ id: A, user: '', text: 'XAU H1 setup (edited)', imgs: ['https://cdn.discordapp.com/a.png', 'data:image/png;base64,BBB'] }]);
  const m = store.get(A);
  assert.equal(m.user, 'Nok');
  assert.equal(m.text, 'XAU H1 setup (edited)');
  assert.deepEqual(m.imgs, ['data:image/jpeg;base64,AAA', 'data:image/png;base64,BBB']);
  assert.deepEqual(m.drive, ['https://drive.google.com/file/d/1', '']);
});

test('groupByDay sorts by snowflake, fills continuation users, puts unknown day last', () => {
  const msgs = [
    { id: B, time: '2026-09-30T02:00:00Z', user: '', text: 'cont', imgs: [], drive: [] },
    { id: A, time: '2026-09-30T01:59:00Z', user: 'Nok', text: 'first', imgs: [], drive: [] },
    { id: '1', time: '', user: 'X', text: '?', imgs: [], drive: [] },
    { id: '1280000000000000000', time: '2026-09-28T20:00:00Z', user: 'Bee', text: 'late night', imgs: [], drive: [] }
  ];
  const g = T.groupByDay(msgs);
  assert.deepEqual(g.days, ['2026-09-29', '2026-09-30', T.UNKNOWN_DAY]);
  assert.deepEqual(g.byDay['2026-09-30'].map(m => m.text), ['first', 'cont']);
  assert.equal(g.byDay['2026-09-30'][1].user, 'Nok');
  assert.equal(g.byDay['2026-09-29'][0].text, 'late night'); // 03:00 Bangkok on the 29th
});

test('healthCheck flags exports that look like broken selectors', () => {
  assert.equal(T.healthCheck([]).length, 1);
  const good = Array.from({ length: 10 }, (_, i) => T.normalize({ id: i + 1, time: '2026-09-30T01:00:00Z', user: 'u', text: 't' }));
  assert.deepEqual(T.healthCheck(good), []);
  const bad = Array.from({ length: 10 }, (_, i) => T.normalize({ id: i + 1 }));
  assert.equal(T.healthCheck(bad).length, 3);
});

test('matches requires every search term, across text, user and reply', () => {
  const m = T.normalize({ id: 1, user: 'Nok', text: 'Buy XAU at 2650 on M15', reply: 'where is support?' });
  assert.ok(T.matches(m, 'xau m15'));
  assert.ok(T.matches(m, 'nok support'));
  assert.ok(!T.matches(m, 'xau h4'));
  assert.ok(T.matches(m, ''));
});

test('digest caps images, numbers them, and truncates by bytes', () => {
  const list = [
    T.normalize({ id: 1, time: '2026-09-30T01:00:00Z', user: 'a', text: 'x', imgs: ['data:image/png;base64,1', 'data:image/png;base64,2'] }),
    T.normalize({ id: 2, time: '2026-09-30T01:01:00Z', user: 'b', text: 'y', imgs: ['data:image/png;base64,3', 'https://cdn/raw.png'] })
  ];
  const d = T.digest(list, { imgLimit: 2 });
  assert.equal(d.pics.length, 2);
  assert.match(d.lines[0], /^#1 \[08:00\] a: x \[รูป R1\] \[รูป R2\]$/);
  assert.doesNotMatch(d.lines[1], /รูป/);
  const t = T.digest(list, { imgLimit: 5, maxBytes: 60 });
  assert.equal(t.truncated, true);
  assert.equal(t.lines.length, 1);
  assert.equal(t.pics.length, 2); // images of the dropped line are not sent
  assert.match(T.dayPrompt(d), /R1\.\.R2/);
});

test('cleanSummary tolerates junk and strips # from ids', () => {
  const s = T.cleanSummary({ overview: 1, topics: [{ title: 'a' }, null], methods: [{ name: 'x', ids: ['#12', 3] }], keep: [{ id: '#9' }] });
  assert.equal(s.overview, '1');
  assert.deepEqual(s.topics[0], { title: 'a', points: [] });
  assert.deepEqual(s.methods[0].ids, ['12', '3']);
  assert.deepEqual(s.keep, [{ id: '9', why: '' }]);
  assert.deepEqual(T.cleanSummary(null).questions, []);
});

test('rangePrompt includes each day and its methods', () => {
  const p = T.rangePrompt([{ day: '2026-09-29', sum: { overview: 'o1', methods: [{ name: 'BOS', detail: 'd' }] } }, { day: '2026-09-30', sum: { overview: 'o2' } }]);
  assert.match(p, /== 2026-09-29 ==\no1\n\* วิธี BOS: d/);
  assert.match(p, /== 2026-09-30 ==/);
});

test('sumKey is stable and filesystem-safe', () => {
  assert.equal(T.sumKey('gold', '2026-09-30'), T.sumKey('gold', '2026-09-30'));
  assert.notEqual(T.sumKey('gold', '2026-09-30'), T.sumKey('silver', '2026-09-30'));
  assert.match(T.sumKey('ห้อง', '*'), /^s_[a-z0-9]+__$/);
});

test('parseTags normalizes', () => {
  assert.deepEqual(T.parseTags('#H1, m15  ##Breakout #h1'), ['h1', 'm15', 'breakout']);
  assert.deepEqual(T.parseTags(''), []);
});

test('notesMarkdown sorts oldest first and includes tags, memo and Drive links', () => {
  const md = T.notesMarkdown([
    { user: 'b', time: '2026-09-30T02:00:00Z', text: 'second', tags: [], imgs: [{}], drive: [] },
    { user: 'a', time: '2026-09-30T01:00:00Z', text: 'first', memo: 'try on M5', tags: ['m5'], drive: ['https://drive/x'] }
  ], iso => iso);
  assert.ok(md.indexOf('first') < md.indexOf('second'));
  assert.match(md, /#m5\n\nfirst\n\n> โน้ต: try on M5\n\n\[รูป 1\]\(https:\/\/drive\/x\)/);
  assert.match(md, /_มีรูป 1 รูป/);
});
