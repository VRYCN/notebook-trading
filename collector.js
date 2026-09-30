/* Discord chat collector. The notebook page shows this function's source for the user to paste
   into the Discord tab's console, so it must stay self-contained (no references to outside names).
   Passive only: it never scrolls or calls Discord's API; it records messages as the user scrolls. */
function tcnCollector() {
  if (window.__tcn) { console.log('สคริปต์ทำงานอยู่แล้ว'); return; }
  const seen = new Map(), cache = new Map();
  const IMG_OK = /(cdn|media)\.discordapp\.(com|net)\/(attachments|ephemeral-attachments)\//;
  const shrink = url => {
    if (cache.has(url)) return cache.get(url);
    const p = (async () => {
      try {
        const b = await (await fetch(url)).blob();
        const bm = await createImageBitmap(b);
        const s = Math.min(1, 1400 / Math.max(bm.width, bm.height));
        const c = document.createElement('canvas');
        c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
        c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.78);
      } catch (e) { return url; }
    })();
    cache.set(url, p); return p;
  };
  const q = (root, ...sels) => { for (const s of sels) { const e = root.querySelector(s); if (e) return e; } return null; };
  const txt = e => (e ? (e.innerText ?? e.textContent ?? '').trim() : '');
  const rows = () => document.querySelectorAll('li[id^="chat-messages-"], li[data-list-item-id^="chat-messages___"]');
  const msgId = li => (li.id || li.dataset.listItemId || '').split('-').pop();
  // Look up parts by the message's own id: the reply preview above a message
  // reuses message-content-<repliedId>, so a prefix match would grab the quoted text.
  const read = li => {
    const id = msgId(li);
    const acc = q(li, `#message-accessories-${id}`, '[id^="message-accessories-"]');
    const imgs = [...(acc || li).querySelectorAll('img')]
      .filter(i => !i.closest('[id^="message-reply-context-"]'))
      .map(i => i.currentSrc || i.src)
      .filter(s => IMG_OK.test(s));
    return {
      id,
      time: q(li, `#message-timestamp-${id}`, 'time[id^="message-timestamp-"]', 'time[datetime]')?.getAttribute('datetime') || '',
      user: txt(q(li, `#message-username-${id} [class*="username"]`, `#message-username-${id}`, 'h3 [class*="username_"]')),
      text: txt(q(li, `#message-content-${id}`)),
      reply: txt(q(li, '[id^="message-reply-context-"] [class*="repliedTextContent"]', '[id^="message-reply-context-"] [id^="message-content-"]')),
      imgs: [...new Set(imgs)]
    };
  };
  const stats = { rows: 0, lastRows: 0, started: Date.now() };
  const badge = document.createElement('button');
  const style = bad => 'position:fixed;right:18px;bottom:18px;z-index:99999;padding:10px 16px;border:0;border-radius:10px;color:#fff;font:600 14px sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.3);cursor:pointer;background:' + (bad ? '#B23A33' : '#A87B1E');
  document.body.appendChild(badge);
  const grab = () => {
    const found = rows();
    stats.lastRows = found.length;
    found.forEach(li => {
      const r = read(li);
      if (!/^\d+$/.test(r.id)) return;
      let m = seen.get(r.id);
      if (!m) { m = { id: r.id, time: '', user: '', text: '', reply: '', src: [], imgs: [] }; seen.set(r.id, m); }
      // Discord renders parts lazily and edits change text; fill in whatever is present now
      for (const k of ['time', 'user', 'text', 'reply']) if (r[k]) m[k] = r[k];
      r.imgs.forEach(s => { if (!m.src.includes(s)) { m.src.push(s); m.imgs.push(shrink(s)); } });
    });
    stats.rows = Math.max(stats.rows, found.length);
    const vals = [...seen.values()];
    const noTime = vals.filter(m => !m.time).length;
    if (!seen.size) {
      badge.style.cssText = style(true);
      badge.textContent = 'ยังไม่พบข้อความ · เปิดห้องแชทแล้วเลื่อนดู (ถ้ายังเป็น 0 แปลว่า Discord เปลี่ยนหน้า)';
    } else if (seen.size >= 10 && noTime / seen.size > 0.2) {
      badge.style.cssText = style(true);
      badge.textContent = 'เก็บแล้ว ' + seen.size + ' ข้อความ แต่ ' + noTime + ' ข้อความไม่มีเวลา · คลิกเพื่อดาวน์โหลด';
    } else {
      badge.style.cssText = style(false);
      badge.textContent = 'เก็บแล้ว ' + seen.size + ' ข้อความ · คลิกเพื่อดาวน์โหลด';
    }
  };
  const channel = () => {
    const parts = document.title.replace(/^\(\d+\)\s*/, '').replace(/\s*[-|]\s*Discord$/, '').split(' | ')
      .map(s => s.trim()).filter(s => s && s !== 'Discord');
    return parts.join(' | ') || 'chat';
  };
  const cmp = (a, b) => { const x = BigInt(a.id), y = BigInt(b.id); return x < y ? -1 : x > y ? 1 : 0; };
  const data = async () => {
    const out = [];
    let last = '';
    for (const r of [...seen.values()].sort(cmp)) {
      if (r.user) last = r.user;
      out.push({ id: r.id, time: r.time, user: r.user || last, text: r.text, reply: r.reply, imgs: await Promise.all(r.imgs) });
    }
    return { channel: channel(), exportedAt: new Date().toISOString(), messages: out };
  };
  let timer = 0;
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(grab, 150); });
  obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  grab();
  badge.onclick = async () => {
    if (!seen.size) { grab(); return; }
    badge.textContent = 'กำลังเตรียมรูป...';
    const d = await data();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(d)], { type: 'application/json' }));
    const slug = d.channel.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);
    a.download = 'discord-' + (slug ? slug + '-' : '') + new Date().toISOString().slice(0, 16).replace(':', '') + '.json';
    a.click();
    grab();
  };
  window.__tcn = {
    data, grab,
    diag: () => {
      const vals = [...seen.values()];
      const d = { rowsNow: stats.lastRows, messages: seen.size, noTime: vals.filter(m => !m.time).length,
        noUser: vals.filter(m => !m.user).length, noText: vals.filter(m => !m.text && !m.src.length).length,
        images: vals.reduce((a, m) => a + m.src.length, 0) };
      console.table(d); return d;
    },
    stop: () => { obs.disconnect(); clearTimeout(timer); badge.remove(); delete window.__tcn; }
  };
  console.log('เริ่มเก็บแล้ว: เลื่อนแชทเอง แล้วคลิกป้ายมุมขวาล่างเพื่อดาวน์โหลด  (ตรวจ: __tcn.diag()  หยุด: __tcn.stop())');
}
if (typeof module === 'object' && module.exports) module.exports = tcnCollector;
