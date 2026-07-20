// ============================================================================
// Airtable 스키마 탐색 스크립트 (읽기 전용) — GitHub Actions 수동 실행용
// 접근 가능한 모든 Base/Table/View의 이름과 ID를 로그로 출력한다.
// AIRTABLE_SOURCES 변수(scripts/fetch_airtable_sources.mjs)를 채우기 위해
// 정확한 base/table/view 식별자를 알아낼 때 사용한다 — 아무것도 쓰거나
// 바꾸지 않는다(메타데이터 조회만).
//
// 필요 스코프: AIRTABLE_TOKEN 에 data.records:read 외에 schema.bases:read 도
// 포함되어 있어야 한다(Airtable PAT 생성 시 스코프 체크박스 2개 모두 선택).
// ============================================================================
const TOKEN = process.env.AIRTABLE_TOKEN;
if (!TOKEN) { console.error('AIRTABLE_TOKEN 환경변수가 필요합니다.'); process.exit(1); }

async function api(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`${url} → ${r.status}: ${await r.text()}`);
  return r.json();
}

console.log('='.repeat(78));
console.log('접근 가능한 Airtable Base 목록');
console.log('='.repeat(78));
const { bases } = await api('https://api.airtable.com/v0/meta/bases');
if (!bases.length) {
  console.log('접근 가능한 base가 없습니다 — 토큰에 원하는 base가 공유(스코프)되어 있는지 확인하세요.');
}
for (const base of bases) {
  console.log(`\n[BASE] ${base.name}`);
  console.log(`  base_id = ${base.id}`);
  try {
    const { tables } = await api(`https://api.airtable.com/v0/meta/bases/${base.id}/tables`);
    for (const t of tables) {
      console.log(`  └─ [TABLE] ${t.name}   (table_id = ${t.id})`);
      for (const v of t.views || []) {
        console.log(`       └─ [VIEW] ${v.name}   (view_id = ${v.id}, type = ${v.type})`);
      }
    }
  } catch (e) {
    console.log(`  (테이블 조회 실패: ${e.message})`);
  }
  await new Promise(res => setTimeout(res, 250)); // rate limit 여유
}
console.log('\n' + '='.repeat(78));
console.log('사용법: 위 목록에서 원하는 base_id / table 이름(또는 table_id) /');
console.log('view 이름(또는 view_id)을 scripts/fetch_airtable_sources.mjs 의');
console.log('AIRTABLE_SOURCES 변수(JSON)에 채워 넣으세요. 이름은 공백/한글 포함');
console.log('그대로 사용 가능하지만, table_id/view_id(문자열 "tbl…"/"viw…")를');
console.log('쓰면 나중에 이름이 바뀌어도 깨지지 않아 더 안전합니다.');
console.log('='.repeat(78));
