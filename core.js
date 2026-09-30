/* Pure logic shared by the notebook page and the tests.
   Browser: exposes window.TCN. Node: module.exports. No DOM access here. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TCN = api;
})(typeof self !== 'undefined' ? self : this, function () {
  const TZ = 'Asia/Bangkok';
  const UNKNOWN_DAY = 'ไม่ทราบวัน';

  const partsFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
  function parts(iso) {
    if (!iso) return null;
    const d = new Date(iso);
    if (isNaN(d)) return null;
    const p = {};
    for (const x of partsFmt.formatToParts(d)) p[x.type] = x.value;
    return p;
  }
  // YYYY-MM-DD in Bangkok time, whatever the viewer's clock says
  const dayKey = iso => { const p = parts(iso); return p ? `${p.year}-${p.month}-${p.day}` : UNKNOWN_DAY; };
  const hhmm = iso => { const p = parts(iso); return p ? `${p.hour}:${p.minute}` : ''; };

  // Discord snowflakes exceed 2^53, so compare as BigInt; fall back to string order for junk ids
  const isSnowflake = id => /^\d{1,25}$/.test(String(id));
  function cmpId(a, b) {
    a = String(a); b = String(b);
    if (isSnowflake(a) && isSnowflake(b)) { const x = BigInt(a), y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; }
    return a < b ? -1 : a > b ? 1 : 0;
  }

  const isData = s => typeof s === 'string' && s.startsWith('data:image');
  const str = v => (v == null ? '' : String(v));

  function normalize(m) {
    if (!m || m.id == null || m.id === '') return null;
    const imgs = (Array.isArray(m.imgs) ? m.imgs : Array.isArray(m.images) ? m.images : []).map(str);
    const drive = (Array.isArray(m.drive) ? m.drive : []).map(str);
    return { id: str(m.id), time: str(m.time), user: str(m.user), text: str(m.text), reply: str(m.reply), imgs, drive };
  }

  // Same message seen in two exports: keep the best of each field instead of letting the
  // later file wipe out Drive links or data-URL images the earlier one had.
  function mergeMessage(old, neu) {
    if (!old) return neu;
    const pick = k => neu[k] || old[k];
    const n = Math.max(old.imgs.length, neu.imgs.length, old.drive.length, neu.drive.length);
    const imgs = [], drive = [];
    for (let i = 0; i < n; i++) {
      const a = old.imgs[i] || '', b = neu.imgs[i] || '';
      imgs.push(isData(b) ? b : isData(a) ? a : b || a);
      drive.push(neu.drive[i] || old.drive[i] || '');
    }
    while (imgs.length && !imgs[imgs.length - 1] && !drive[imgs.length - 1]) { imgs.pop(); drive.pop(); }
    while (drive.length > imgs.length) imgs.push('');
    return { id: old.id, time: pick('time'), user: pick('user'), text: pick('text'), reply: pick('reply'), imgs, drive };
  }

  // Parse one export (object or bare array) into `store` (Map id → message).
  function mergeExport(store, data) {
    const list = Array.isArray(data) ? data : data && data.messages;
    if (!Array.isArray(list)) throw new Error('not a chat export');
    let added = 0, updated = 0;
    for (const raw of list) {
      const m = normalize(raw);
      if (!m) continue;
      const old = store.get(m.id);
      if (!old) added++; else updated++;
      store.set(m.id, mergeMessage(old, m));
    }
    return { added, updated, channel: (!Array.isArray(data) && data.channel) ? str(data.channel) : '' };
  }

  // Grouped Discord messages carry no username; inherit it from the previous message.
  function fillUsers(sorted) {
    let last = '';
    for (const m of sorted) { if (m.user) last = m.user; else m.user = last; }
    return sorted;
  }

  function groupByDay(msgs) {
    const all = fillUsers([...msgs].sort((a, b) => cmpId(a.id, b.id)));
    const byDay = {};
    for (const m of all) (byDay[dayKey(m.time)] ||= []).push(m);
    const days = Object.keys(byDay).sort((a, b) => (a === UNKNOWN_DAY) - (b === UNKNOWN_DAY) || (a < b ? -1 : a > b ? 1 : 0));
    return { days, byDay };
  }

  // Warn when an export looks like the collector's selectors stopped matching Discord's DOM.
  function healthCheck(list) {
    const w = [];
    if (!list.length) return ['ไฟล์นี้ไม่มีข้อความ ตัวเก็บแชทอาจหาข้อความในหน้า Discord ไม่เจอ'];
    const miss = k => list.filter(m => !m[k]).length / list.length;
    if (miss('time') > 0.2) w.push('ข้อความส่วนใหญ่ไม่มีเวลา ตัวเก็บแชทอาจต้องปรับตามหน้า Discord รุ่นใหม่');
    if (miss('user') > 0.5) w.push('ข้อความส่วนใหญ่ไม่มีชื่อผู้ส่ง');
    if (list.filter(m => !m.text && !m.imgs.length).length / list.length > 0.5) w.push('ข้อความส่วนใหญ่ว่างเปล่า (ไม่มีทั้งข้อความและรูป)');
    return w;
  }

  function matches(m, q) {
    if (!q) return true;
    const hay = (m.text + ' ' + m.user + ' ' + m.reply).toLowerCase();
    return q.toLowerCase().split(/\s+/).filter(Boolean).every(t => hay.includes(t));
  }

  // Drive file naming, mirrored in apps-script/Index.html (a test keeps the two in sync).
  const pad = n => String(n).padStart(2, '0');
  const cleanName = s => String(s || '').replace(/[\\/:*?"<>|#]/g, '_').trim().slice(0, 60) || 'chat';
  const imgExt = src => {
    const d = String(src).match(/^data:image\/(\w+)/);
    if (d) return d[1] === 'jpeg' ? 'jpg' : d[1];
    const u = String(src).split('?')[0].match(/\.(png|jpe?g|gif|webp)$/i);
    return u ? u[1].toLowerCase().replace('jpeg', 'jpg') : 'jpg';
  };
  function driveName(m, i, src) {
    const p = parts(m.time);
    const hm = p ? p.hour + p.minute : '0000';
    return `${hm}_${cleanName(m.user)}_${m.id}_${i + 1}.${imgExt(src)}`;
  }
  const driveDay = m => { const k = dayKey(m.time); return k === UNKNOWN_DAY ? 'unknown' : k; };

  const hash = s => { let h = 5381; for (const c of s) h = ((h << 5) + h + c.codePointAt(0)) >>> 0; return h.toString(36); };
  const sumKey = (channel, day) => 's_' + hash(channel || 'chat') + '_' + String(day).replace(/[^\w-]/g, '_');

  const byteLen = s => (typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(s).length : s.length * 3);

  // One line per message for the AI, with data-URL images attached up to imgLimit.
  function digest(list, { imgLimit = 0, maxBytes = 200000 } = {}) {
    const pics = [], lines = [];
    let bytes = 0, truncated = false;
    for (const m of list) {
      let tag = '';
      const mine = [];
      for (const u of m.imgs) if (isData(u) && pics.length + mine.length < imgLimit) { mine.push(u); tag += ` [รูป R${pics.length + mine.length}]`; }
      const line = `#${m.id} [${hhmm(m.time)}] ${m.user}: ${m.reply ? '(ตอบ: ' + m.reply.slice(0, 80) + ') ' : ''}${m.text}${tag}`;
      bytes += byteLen(line) + 1;
      if (bytes > maxBytes) { truncated = true; break; }
      pics.push(...mine);
      lines.push(line);
    }
    return { lines, pics, truncated };
  }

  function dayPrompt({ lines, pics, truncated }) {
    return `คุณช่วยสรุปห้องแชท Discord ที่สมาชิกคุยเรื่องวิธีเทรดและการเรียนเทรด ผู้อ่านไม่มีเวลาอ่านทุกข้อความ
${pics.length ? `แนบรูปมา ${pics.length} รูป เรียงตามลำดับ R1..R${pics.length} ตามป้าย [รูป Rn] ในข้อความ อ่านรายละเอียดในรูป (กราฟ ระดับราคา อินดิเคเตอร์ จุดเข้า-ออก) แล้วนำมาใช้ในสรุปด้วย` : ''}
ตอบเป็นภาษาไทย เป็น JSON เท่านั้น ตามรูปแบบนี้:
{"overview":"ภาพรวม 2-3 ประโยค",
 "topics":[{"title":"หัวข้อ","points":["ประเด็นสั้นๆ"]}],
 "methods":[{"name":"ชื่อวิธี/setup","detail":"เงื่อนไขเข้า ออก ตัดขาดทุน timeframe อินดิเคเตอร์ ตามที่มีในแชท","ids":["id ข้อความต้นทาง"]}],
 "keep":[{"id":"id ข้อความ","why":"เหตุผลสั้นๆ ที่ควรเก็บ"}],
 "questions":["คำถามสำคัญที่ยังไม่มีคำตอบ"]}
กติกา: topics ไม่เกิน 6 หัวข้อ, methods เฉพาะที่มีรายละเอียดจริงในแชท, keep ไม่เกิน 20 ข้อความที่มีความรู้หรือวิธีที่นำไปใช้ได้ (ไม่รวมคำทักทายหรือแชทเล่น), อย่าแต่งข้อมูลที่ไม่มีในแชท, id ต้องคัดลอกจากเลขหลัง # เท่านั้น

ข้อความ (${lines.length} ข้อความ${truncated ? ' ตัดท้ายเพราะยาวเกิน' : ''}):
${lines.join('\n')}`;
  }

  // Backlog overview built from per-day summaries (text only, so it stays cheap).
  function rangePrompt(daySums) {
    const body = daySums.map(({ day, sum }) => [
      `== ${day} ==`, sum.overview,
      ...(sum.topics || []).map(t => `- ${t.title}: ${(t.points || []).join('; ')}`),
      ...(sum.methods || []).map(m => `* วิธี ${m.name}: ${m.detail}`),
      ...(sum.questions || []).map(q => `? ${q}`)
    ].join('\n')).join('\n\n');
    return `ด้านล่างคือสรุปรายวันของห้องแชท Discord เรื่องการเทรด ${daySums.length} วัน ผู้อ่านอ่านค้างหลายวัน อยากรู้ภาพรวม
ตอบเป็นภาษาไทย เป็น JSON เท่านั้น ตามรูปแบบนี้:
{"overview":"ภาพรวมทั้งช่วง 3-4 ประโยค",
 "topics":[{"title":"ประเด็นที่คุยต่อเนื่องหลายวัน","points":["ประเด็นสั้นๆ พร้อมวันที่ถ้าสำคัญ"]}],
 "methods":[{"name":"ชื่อวิธี/setup","detail":"รวมรายละเอียดจากทุกวันที่พูดถึง","days":["YYYY-MM-DD"]}],
 "questions":["คำถามที่ยังค้างอยู่"]}
กติกา: topics ไม่เกิน 8 หัวข้อ, รวมวิธีที่ซ้ำกันเป็นอันเดียว, อย่าแต่งข้อมูลที่ไม่มีในสรุป, days ใช้รูปแบบวันที่ตามหัวข้อ ==

${body}`;
  }

  const arr = v => (Array.isArray(v) ? v : []);
  function cleanSummary(res) {
    res = res || {};
    return {
      overview: str(res.overview),
      topics: arr(res.topics).map(t => ({ title: str(t && t.title), points: arr(t && t.points).map(str) })),
      methods: arr(res.methods).map(m => ({ name: str(m && m.name), detail: str(m && m.detail), ids: arr(m && m.ids).map(x => str(x).replace('#', '')), days: arr(m && m.days).map(str) })),
      keep: arr(res.keep).map(k => ({ id: str(k && k.id).replace('#', ''), why: str(k && k.why) })),
      questions: arr(res.questions).map(str)
    };
  }

  // "#H1, m15  breakout" → ["h1","m15","breakout"]
  const parseTags = s => [...new Set(String(s || '').split(/[\s,]+/).map(t => t.replace(/^#+/, '').trim().toLowerCase()).filter(Boolean))];

  function notesMarkdown(notes, fmtTime) {
    return '# สมุดบันทึกห้องเทรด\n\n' + [...notes].sort((a, b) => str(a.time).localeCompare(str(b.time))).map(n => {
      const tags = arr(n.tags).length ? n.tags.map(t => '#' + t).join(' ') + '\n\n' : '';
      const pics = arr(n.drive).length ? n.drive.map((u, i) => `[รูป ${i + 1}](${u})`).join(' ') + '\n\n'
        : arr(n.imgs).length ? '_มีรูป ' + n.imgs.length + ' รูป (ดูในสมุดบันทึก)_\n\n' : '';
      return `## ${n.user} · ${n.time ? fmtTime(n.time) : ''}\n\n${tags}${n.text}\n\n${n.memo ? '> โน้ต: ' + n.memo + '\n\n' : ''}${pics}`;
    }).join('---\n\n');
  }

  return { TZ, UNKNOWN_DAY, dayKey, hhmm, cmpId, isData, normalize, mergeMessage, mergeExport, fillUsers, groupByDay,
    healthCheck, matches, cleanName, imgExt, driveName, driveDay, hash, sumKey, digest, dayPrompt, rangePrompt,
    cleanSummary, parseTags, notesMarkdown };
});
