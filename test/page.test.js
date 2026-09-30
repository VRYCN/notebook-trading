// Loads trade-chat-notebook.html in jsdom (local scripts only, no network) and drives the UI.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { JSDOM, ResourceLoader } = require('jsdom');

class LocalOnly extends ResourceLoader {
  fetch(url, opts) { return url.startsWith('file:') ? super.fetch(url, opts) : null; }
}
const tick = (ms = 20) => new Promise(r => setTimeout(r, ms));

async function open({ claude } = {}) {
  const dom = await JSDOM.fromFile(path.join(__dirname, '../trade-chat-notebook.html'), {
    runScripts: 'dangerously', resources: new LocalOnly(), pretendToBeVisual: true,
    beforeParse(w) {
      w.confirm = () => true;
      w.matchMedia = () => ({ matches: true });
      w.HTMLElement.prototype.scrollIntoView = () => {};
      if (claude) w.claude = claude;
    }
  });
  const w = dom.window;
  await new Promise(r => w.addEventListener('load', r));
  await tick();
  return w;
}
const file = (name, data) => ({ name, text: async () => JSON.stringify(data) });
const $ = (w, s) => w.document.querySelector(s);
const $$ = (w, s) => [...w.document.querySelectorAll(s)];
const click = (w, el) => el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));

const EXPORT = {
  channel: '#xau-study',
  messages: [
    { id: '1290000000000000001', time: '2026-09-29T02:00:00Z', user: 'Nok', text: 'Gold breakout H1 above 2650' },
    { id: '1290000000000000002', time: '2026-09-29T02:01:00Z', user: '', text: 'SL 2640', imgs: ['data:image/png;base64,iVBORw0KGgo='] },
    { id: '1290000000000000003', time: '2026-09-30T03:00:00Z', user: 'Bee', text: 'M15 pullback to EMA' }
  ]
};

test('collector textarea holds a runnable script', async () => {
  const w = await open();
  const src = $(w, '#collector').value;
  assert.match(src, /^\(function tcnCollector\(\)/);
  assert.doesNotThrow(() => new Function(src));
  w.close();
});

test('loads exports, groups by Bangkok day, searches across days, saves and tags notes', async () => {
  const w = await open();
  await w.loadFiles([file('a.json', EXPORT), file('b.json', { messages: EXPORT.messages.slice(1) })]);
  assert.equal($(w, '#intake').hidden, true);
  assert.match($(w, '#chanName').textContent, /#xau-study · 3 ข้อความ · 2 วัน/);
  assert.deepEqual($$(w, '.day').map(b => b.dataset.d), ['*', '2026-09-29', '2026-09-30']);
  assert.equal($$(w, '#msgs .msg').length, 2);
  assert.equal($$(w, '#msgs .msg .u')[1].textContent, 'Nok'); // continuation filled
  assert.equal($(w, '#health').hidden, true);

  $(w, '#q').value = 'ema';
  $(w, '#q').dispatchEvent(new w.Event('input'));
  assert.equal($$(w, '#msgs .msg').length, 0);
  $(w, '#allDays').checked = true;
  $(w, '#allDays').dispatchEvent(new w.Event('input'));
  assert.equal($$(w, '#msgs .msg').length, 1);
  assert.equal($$(w, '#msgs .dayhdr').length, 1);
  click(w, $(w, '#msgs [data-goto]'));
  assert.equal($(w, '.day[aria-current="true"]').dataset.d, '2026-09-30');

  click(w, $(w, '#msgs .star'));
  await tick();
  assert.equal($(w, '#libCount').textContent, '(1)');
  click(w, $(w, '[data-tab="lib"]'));
  const note = $(w, '#libList .note');
  note.querySelector('.tagin').value = '#M15 ema';
  click(w, note.querySelector('.save'));
  await tick();
  assert.deepEqual($$(w, '#tagBar .chip').map(c => c.textContent.trim()), ['ทั้งหมด', '#ema 1', '#m15 1']);
  w.close();
});

test('warns about exports that look broken', async () => {
  const w = await open();
  await w.loadFiles([file('bad.json', { messages: Array.from({ length: 5 }, (_, i) => ({ id: String(i + 1) })) })]);
  assert.equal($(w, '#health').hidden, false);
  assert.match($(w, '#health').textContent, /bad\.json: .*ไม่มีเวลา/);
  w.close();
});

test('with Claude available: summarizes the backlog day by day, then the range', async () => {
  const calls = [];
  const sample = {
    limits: async () => ({ images: { maxCount: 50 } }),
    json: async (prompt, opts) => {
      calls.push({ prompt, images: (opts.images || []).length });
      return prompt.includes('สรุปรายวัน')
        ? { overview: 'ภาพรวมหลายวัน', methods: [{ name: 'Breakout', detail: 'd', days: ['2026-09-29'] }] }
        : { overview: 'สรุปวัน', keep: [{ id: '#1290000000000000001', why: 'setup ชัด' }] };
    }
  };
  const w = await open({ claude: { use: async n => (n === 'sample' ? sample : null) } });
  await w.loadFiles([file('a.json', EXPORT)]);
  click(w, $(w, '#doBacklog') || $(w, '#doSum'));
  await tick(50);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].images, 1);
  assert.match(calls[0].prompt, /#1290000000000000002 \[09:01\] Nok: SL 2640 \[รูป R1\]/);
  assert.equal($$(w, '.day .done').length, 2);
  assert.match($(w, '#msgs').textContent, /AI แนะนำให้เก็บ: setup ชัด/);

  click(w, $(w, '.day[data-d="*"]'));
  click(w, $(w, '#doRange'));
  await tick(50);
  assert.equal(calls.length, 3);
  assert.match($(w, '#summary').textContent, /ภาพรวมหลายวัน/);
  click(w, $(w, '#summary [data-goday]'));
  assert.equal($(w, '.day[aria-current="true"]').dataset.d, '2026-09-29');
  w.close();
});
