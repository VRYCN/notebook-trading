// ===== Discord → Google Drive (รูปแชท) =====
const ROOT = 'Discord-Trade';

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('อัปโหลดรูปแชทเข้า Drive')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function folder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function dayFolder_(channel, day) {
  const root = folder_(DriveApp.getRootFolder(), ROOT);
  return folder_(folder_(root, channel || 'chat'), day);
}

// p = {channel, day, name, src, desc}
function saveImage(p) {
  const f = dayFolder_(p.channel, p.day);
  const ex = f.getFilesByName(p.name);
  if (ex.hasNext()) return ex.next().getUrl();          // อัปโหลดซ้ำ = ใช้ไฟล์เดิม

  let blob;
  const m = String(p.src).match(/^data:([^;]+);base64,(.*)$/);
  if (m) {
    blob = Utilities.newBlob(Utilities.base64Decode(m[2]), m[1], p.name);
  } else {
    const r = UrlFetchApp.fetch(p.src, { muteHttpExceptions: true });
    if (r.getResponseCode() !== 200) throw new Error('ลิงก์รูปหมดอายุหรือโหลดไม่ได้');
    blob = r.getBlob().setName(p.name);
  }
  const file = f.createFile(blob);
  if (p.desc) file.setDescription(String(p.desc).slice(0, 4000));
  return file.getUrl();
}

// เก็บไฟล์ .json ที่แทนลิงก์แล้วไว้ใน Drive ด้วย
function saveJson(channel, name, text) {
  const f = folder_(folder_(DriveApp.getRootFolder(), ROOT), channel || 'chat');
  const ex = f.getFilesByName(name);
  if (ex.hasNext()) ex.next().setTrashed(true);
  return f.createFile(name, text, 'application/json').getUrl();
}
