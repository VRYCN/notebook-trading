// apps-script/Index.html runs inside Google Apps Script and can't import core.js,
// so it carries its own copy of the naming code. Keep the two identical in behavior.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const T = require('../core.js');

const html = fs.readFileSync(path.join(__dirname, '../apps-script/Index.html'), 'utf8');
const block = html.slice(html.indexOf('// --- naming'), html.indexOf('// --- end naming ---'));
const ctx = vm.createContext({ Intl, Date, String, isNaN });
vm.runInContext(block + '\nthis.api = { driveName, driveDay };', ctx);

const cases = [
  [{ id: '1290000000000000001', time: '2026-09-29T17:05:00Z', user: 'Nok / Gold#1' }, 0, 'data:image/jpeg;base64,AA'],
  [{ id: '2', time: '2026-09-30T08:00:00+07:00', user: '' }, 2, 'https://media.discordapp.net/attachments/1/2/chart.PNG?width=400'],
  [{ id: '3', time: '', user: 'x' }, 0, 'https://cdn.discordapp.com/attachments/1/2/file'],
  [{ id: '4', time: '2026-09-30T01:00:00Z', user: 'a'.repeat(80) }, 1, 'data:image/webp;base64,AA']
];

test('Apps Script naming matches core.js', () => {
  for (const [m, i, src] of cases) {
    assert.equal(ctx.api.driveName(m, i, src), T.driveName(m, i, src));
    assert.equal(ctx.api.driveDay(m), T.driveDay(m));
  }
});

test('Drive names and folders use Bangkok time', () => {
  const [m, i, src] = cases[0];
  assert.equal(T.driveName(m, i, src), '0005_Nok _ Gold_1_1290000000000000001_1.jpg');
  assert.equal(T.driveDay(m), '2026-09-30');
  assert.equal(T.driveName(...cases[1]), '0800_chat_2_3.png');
  assert.equal(T.driveDay(cases[2][0]), 'unknown');
});
