// Airtable '회의자료' 테이블 → CSV/meeting_agenda.json
// 대시보드 '회의록 초안 생성' 버튼용 이번 주 안건 캐싱
// weekly-airtable.yml 에서 실행
import fs from 'node:fs';

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE  = 'apptlAu30Lnc1jL7F';
const TABLE = 'tblMOUOQEubCbb7uN';
const VIEW  = 'viw0YCs3A1oU0yp4a';
const FIELDS = ['Name', 'Notes', '안건 유형', '순서', '파트회의용'];

if (!TOKEN) { console.error('AIRTABLE_TOKEN 환경변수가 필요합니다.'); process.exit(1); }

async function fetchAll() {
  const records = [];
  let offset = null;
  do {
    const u = new URL(`https://api.airtable.com/v0/${BASE}/${TABLE}`);
    u.searchParams.set('view', VIEW);
    FIELDS.forEach(f => u.searchParams.append('fields[]', f));
    u.searchParams.set('pageSize', '100');
    if (offset) u.searchParams.set('offset', offset);
    const r = await fetch(u, { headers: { Authorization: `Bearer ${TOKEN}` } });
    if (!r.ok) throw new Error(`Airtable API ${r.status}: ${await r.text()}`);
    const j = await r.json();
    records.push(...j.records);
    offset = j.offset || null;
    if (offset) await new Promise(res => setTimeout(res, 250));
  } while (offset);
  return records;
}

const records = await fetchAll();
const data = {
  fetched_at: new Date().toISOString(),
  base_id: BASE,
  table_id: TABLE,
  records: records.map(r => ({
    id:            r.id,
    name:          r.fields['Name']        || '',
    notes:         r.fields['Notes']       || '',
    agenda_type:   r.fields['안건 유형']   || '',
    order:         r.fields['순서']        || '',
    party_meeting: r.fields['파트회의용']  || '',
  })),
};

fs.mkdirSync('CSV', { recursive: true });
const out = JSON.stringify(data, null, 2);
fs.writeFileSync('CSV/meeting_agenda.json', out, 'utf8');
console.log(`회의자료 ${records.length}건 → CSV/meeting_agenda.json (${(out.length / 1024).toFixed(1)} KB)`);
