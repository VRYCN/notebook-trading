// Runs the collector against a hand-built DOM shaped like Discord's message list.
// The markup is a best guess at the live build; if Discord changes it, update the fixture
// together with the selectors in collector.js.
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const tcnCollector = require('../collector.js');

const CH = '1111';
const A = '1290000000000000001', B = '1290000000000000002', C = '1290000000000000003', OLD = '1280000000000000000';

const li = (id, { user, time, text, reply, imgs = [] } = {}) => `
<li id="chat-messages-${CH}-${id}" class="messageListItem__5126c">
  <div role="article" class="message__5126c">
    ${reply ? `<div id="message-reply-context-${id}" class="repliedMessage_c19a55">
      <img class="avatar_c19a55" src="https://cdn.discordapp.com/avatars/1/a.webp">
      <span class="username_c19a55">Old</span>
      <div id="message-content-${OLD}" class="repliedTextContent_c19a55">${reply}</div>
      <img src="https://media.discordapp.net/attachments/9/9/quoted.png"></div>` : ''}
    ${user ? `<img class="avatar_c19a55" src="https://cdn.discordapp.com/avatars/2/b.webp">
    <h3 class="header_c19a55"><span id="message-username-${id}" class="headerText_c19a55"><span class="username_c19a55">${user}</span></span>
      <span class="timestamp_c19a55"><time id="message-timestamp-${id}" datetime="${time}">08:00</time></span></h3>`
    : `<span class="timestamp_c19a55"><time id="message-timestamp-${id}" datetime="${time}"></time></span>`}
    <div id="message-content-${id}" class="messageContent_c19a55">${text || ''}<img class="emoji" src="https://cdn.discordapp.com/emojis/123.webp"></div>
    <div id="message-accessories-${id}" class="container_b558d0">
      ${imgs.map(s => `<div class="imageWrapper_af017a"><a href="${s}"><img src="${s}"></a></div>`).join('')}
    </div>
  </div>
</li>`;

function page(body, title = 'Discord | #xau-study | Gold Traders') {
  const dom = new JSDOM(`<!doctype html><title>${title}</title><body><ol data-list-id="chat-messages">${body}</ol></body>`, { runScripts: 'outside-only' });
  const w = dom.window;
  w.console.log = () => {}; w.console.table = () => {};
  w.eval(`(${tcnCollector.toString()})()`);
  open.push(w);
  return w;
}
const open = [];
// A failed assertion must not leave observers and timers keeping the test process alive
test.afterEach(() => { for (const w of open.splice(0)) { w.__tcn?.stop(); w.close(); } });
// Plain objects from the jsdom realm, so deepStrictEqual compares values, not prototypes
const exported = async w => JSON.parse(JSON.stringify(await w.__tcn.data()));
const tick = ms => new Promise(r => setTimeout(r, ms));
const badge = w => [...w.document.body.children].find(e => e.tagName === 'BUTTON');

test('reads message parts by the message id, not the reply preview', async () => {
  const w = page(
    li(A, { user: 'Nok', time: '2026-09-30T01:00:00.000Z', text: 'Buy XAU 2650', reply: 'where to buy?', imgs: ['https://media.discordapp.net/attachments/1/2/chart.png?width=400'] }) +
    li(B, { time: '2026-09-30T01:01:00.000Z', text: 'SL 2640' }));
  const d = await exported(w);
  assert.equal(d.channel, '#xau-study | Gold Traders');
  assert.equal(d.messages.length, 2);
  const [a, b] = d.messages;
  assert.deepEqual([a.id, a.user, a.time, a.text, a.reply], [A, 'Nok', '2026-09-30T01:00:00.000Z', 'Buy XAU 2650', 'where to buy?']);
  // emoji, avatars and the quoted message's image are not attachments
  assert.deepEqual(a.imgs, ['https://media.discordapp.net/attachments/1/2/chart.png?width=400']);
  // continuation message inherits the author
  assert.deepEqual([b.user, b.text, b.imgs], ['Nok', 'SL 2640', []]);
  assert.match(badge(w).textContent, /เก็บแล้ว 2 ข้อความ/);
  w.__tcn.stop();
  assert.equal(badge(w), undefined);
});

test('keeps messages after Discord unmounts them and picks up new ones', async () => {
  const w = page(li(A, { user: 'Nok', time: '2026-09-30T01:00:00Z', text: 'one' }));
  const ol = w.document.querySelector('ol');
  ol.insertAdjacentHTML('beforeend', li(C, { user: 'Bee', time: '2026-09-30T01:05:00Z', text: 'three' }));
  ol.querySelector(`#chat-messages-${CH}-${A}`).remove();
  ol.insertAdjacentHTML('afterbegin', li(B, { time: '2026-09-30T01:02:00Z', text: 'two' }));
  await tick(250);
  const d = await exported(w);
  assert.deepEqual(d.messages.map(m => m.text), ['one', 'two', 'three']);
  assert.deepEqual(d.messages.map(m => m.user), ['Nok', 'Nok', 'Bee']);
  w.__tcn.stop();
});

test('fills in parts that render late', async () => {
  const w = page(`<li id="chat-messages-${CH}-${A}"><div id="message-content-${A}"></div></li>`);
  const el = w.document.querySelector(`#chat-messages-${CH}-${A}`);
  el.outerHTML = li(A, { user: 'Nok', time: '2026-09-30T01:00:00Z', text: 'loaded' });
  await tick(250);
  const [m] = (await exported(w)).messages;
  assert.deepEqual([m.user, m.text, m.time], ['Nok', 'loaded', '2026-09-30T01:00:00Z']);
  w.__tcn.stop();
});

test('supports the data-list-item-id row format', async () => {
  const w = page(li(A, { user: 'Nok', time: '2026-09-30T01:00:00Z', text: 'x' })
    .replace(`id="chat-messages-${CH}-${A}"`, `data-list-item-id="chat-messages___chat-messages-${CH}-${A}"`));
  assert.equal((await exported(w)).messages[0].id, A);
  w.__tcn.stop();
});

test('warns in red when no messages are found', () => {
  const w = page('', '(3) #general | Server - Discord');
  const b = badge(w);
  assert.match(b.textContent, /ยังไม่พบข้อความ/);
  assert.match(b.style.cssText, /rgb\(178, 58, 51\)|#B23A33/i);
  assert.equal(w.__tcn.diag().messages, 0);
  w.__tcn.stop();
});

test('warns when most messages lack timestamps', async () => {
  const rows = Array.from({ length: 12 }, (_, i) => `<li id="chat-messages-${CH}-${1000 + i}"><div id="message-content-${1000 + i}">m${i}</div></li>`).join('');
  const w = page(rows);
  assert.match(badge(w).textContent, /12 ข้อความไม่มีเวลา/);
  assert.equal(w.__tcn.diag().noTime, 12);
  w.__tcn.stop();
});

test('running twice does not start a second collector', () => {
  const w = page('');
  w.eval(`(${tcnCollector.toString()})()`);
  assert.equal([...w.document.body.children].filter(e => e.tagName === 'BUTTON').length, 1);
  w.__tcn.stop();
});
