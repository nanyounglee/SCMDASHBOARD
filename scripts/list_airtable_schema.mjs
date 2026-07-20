// ============================================================================
// Airtable 스키마 탐색 스크립트 (읽기 전용) — GitHub Actions 수동 실행용
// 접근 가능한 모든 Base/Table/View의 이름과 ID를 로그로 출력한다.
// AIRTABLE_SOURCES 변수(scripts/fetch_airtable_sources.mjs)를 채우기 위해
// 정확한 base/table/view 식별자를 알아낼 때 사용한다 — 아무것도 쓰거나
// 바꾸지 않는다(메타데이터 조회만).
//
// 스코프별 동작:
//   schema.bases:read 있음 → 전체 Base/Table/View 목록 출력 (§A)
//   schema.bases:read 없음 → §A는 안내만 남기고 건너뛴 뒤, data.records:read 만으로
//     가능한 §B(검수 데이터 프로브)를 계속 진행한다 — exit 1로 죽지 않는다.
//
// §B 검수 데이터 프로브: AIRTABLE_SOURCES의 issue 항목이 있으면, 그 테이블을
//   "뷰 지정 없이" 직접 조회한다. 이슈_RAW 뷰는 이슈 발생 건만 필터한 뷰일
//   가능성이 높고, 뷰를 빼면 테이블 원본(모든 입하/이동 레코드)이 나오므로 —
//   이슈가 아닌 레코드에도 검수수량이 기록되어 있는지(= IQC 전수 데이터가 이미
//   존재하는지, docs/AIRTABLE_품질필드_추가명세.md §⑤)를 스키마 스코프 없이 판정한다.
// ============================================================================
const TOKEN = process.env.AIRTABLE_TOKEN;
if (!TOKEN) { console.error('AIRTABLE_TOKEN 환경변수가 필요합니다.'); process.exit(1); }

async function api(url) {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) { const e = new Error(`${url} → ${r.status}: ${await r.text()}`); e.status = r.status; throw e; }
  return r.json();
}

// ---- §A. 스키마 목록 (schema.bases:read 필요) ----
console.log('='.repeat(78));
console.log('§A. 접근 가능한 Airtable Base 목록 (schema.bases:read 스코프 필요)');
console.log('='.repeat(78));
try {
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
} catch (e) {
  if (e.status === 403 || e.status === 401) {
    console.log('');
    console.log('⚠ 스키마 목록을 조회할 수 없습니다 — 토큰에 schema.bases:read 스코프가 없습니다.');
    console.log('  (주간 자동 커밋에 쓰는 data.records:read 만으로는 이 목록을 볼 수 없음)');
    console.log('');
    console.log('  해결: https://airtable.com/create/tokens 에서 기존 토큰을 "편집"해');
    console.log('  Scopes에 schema.bases:read 를 추가하면 됩니다 — 토큰 재발급·시크릿 교체 불필요,');
    console.log('  base 접근 권한도 그대로 유지됩니다. 추가 후 이 워크플로를 다시 실행하세요.');
    console.log('');
    console.log('  아래 §B(검수 데이터 프로브)는 스코프 추가 없이도 계속 진행됩니다.');
  } else {
    console.log(`⚠ 스키마 조회 실패: ${e.message}`);
  }
}

// ---- §B. 검수 데이터 프로브 (data.records:read 만으로 동작) ----
console.log('\n' + '='.repeat(78));
console.log('§B. 검수 데이터 프로브 — 이슈 테이블을 뷰 없이 직접 조회');
console.log('='.repeat(78));
const SRC_RAW = process.env.AIRTABLE_SOURCES;
let issueSrc = null;
if (SRC_RAW && SRC_RAW.trim()) {
  try { issueSrc = (JSON.parse(SRC_RAW) || []).find(s => s.key === 'issue'); } catch (e) {
    console.log(`AIRTABLE_SOURCES 파싱 실패: ${e.message}`);
  }
}
if (!issueSrc || !issueSrc.base || !issueSrc.table) {
  console.log('AIRTABLE_SOURCES에 issue 항목이 없어 프로브를 건너뜁니다.');
} else {
  try {
    // 뷰 없이 테이블 원본을 조회 — 이슈 뷰 밖의 레코드(일반 입하 건)에도 검수수량이
    // 기록돼 있는지 본다. 뷰 없는 조회는 순서가 임의라 오래된 레코드만 뽑힐 수 있어,
    // 실제입하일 내림차순 정렬로 "최근 입하 100건"을 표본으로 삼는다(정렬 필드가 없어
    // 에러가 나면 정렬 없이 재시도).
    const mk = (sorted) => {
      const u = new URL(`https://api.airtable.com/v0/${issueSrc.base}/${encodeURIComponent(issueSrc.table)}`);
      u.searchParams.set('pageSize', '100');
      u.searchParams.set('cellFormat', 'string');
      u.searchParams.set('timeZone', 'Asia/Seoul');
      u.searchParams.set('userLocale', 'ko');
      if (sorted) { u.searchParams.set('sort[0][field]', '실제입하일'); u.searchParams.set('sort[0][direction]', 'desc'); }
      return u.toString();
    };
    let records, sortNote;
    try { ({ records } = await api(mk(true))); sortNote = '실제입하일 내림차순(최근 입하 우선)'; }
    catch (e) { ({ records } = await api(mk(false))); sortNote = '정렬 없음(임의 순서 — 실제입하일 필드로 정렬 실패: ' + e.message.slice(0, 120) + ')'; }
    const dates = records.map(r => String(r.fields['실제입하일'] ?? '').trim()).filter(Boolean);
    console.log(`표본: ${sortNote} · 실제입하일 범위 ${dates.length ? dates[dates.length - 1] + ' ~ ' + dates[0] : '(날짜 값 없음)'}`);
    const total = records.length;
    const has = (r, f) => String(r.fields[f] ?? '').trim() !== '';
    const nonIssue = records.filter(r => !has(r, '이슈카테고리'));
    const nonIssueWithInspect = nonIssue.filter(r => has(r, '검수수량'));
    const issueRows = total - nonIssue.length;
    console.log(`테이블 "${issueSrc.table}" (base ${issueSrc.base}) — 뷰 없이 샘플 ${total}건 조회:`);
    console.log(`  · 이슈카테고리 있음(이슈 건): ${issueRows}건`);
    console.log(`  · 이슈카테고리 없음(이슈 아닌 입하/이동 건): ${nonIssue.length}건`);
    console.log(`  · 이슈 아닌 건 중 검수수량 기록: ${nonIssueWithInspect.length}건`);
    console.log('');
    if (nonIssue.length === 0) {
      console.log('→ 이 테이블에는 이슈 건만 있습니다 — 전수 검수(IQC) 데이터는 별도 movement 테이블에');
      console.log('  있거나 존재하지 않습니다. §A 스키마 목록(스코프 추가 후)에서 movement/산출이동');
      console.log('  테이블을 찾아보세요.');
    } else if (nonIssueWithInspect.length > 0) {
      console.log('→ ✅ 이슈가 아닌 입하 건에도 검수수량이 기록되어 있습니다 — IQC 전수 데이터가 이미');
      console.log('  이 테이블에 존재합니다. "전체 레코드 + 검수 필드" 뷰 하나만 추가하고 AIRTABLE_SOURCES에');
      console.log('  항목 1개를 등록하면 검수합격률을 전수 기준으로 산출할 수 있습니다 (새 입력 프로세스 불필요).');
      const sample = nonIssueWithInspect[0];
      console.log(`  샘플 필드: ${Object.keys(sample.fields).slice(0, 15).join(', ')}`);
    } else {
      console.log('→ 이슈가 아닌 건은 있으나 검수수량 기록이 없습니다 — 전수 검수는 현재 입력되지 않는');
      console.log('  것으로 보입니다. 협력사 자가검사(Google Forms) 또는 물류 검수 입력 프로세스 신설이');
      console.log('  필요합니다 (docs/AIRTABLE_품질필드_추가명세.md §⑤ 참고).');
    }
  } catch (e) {
    console.log(`프로브 실패: ${e.message}`);
    if (e.status === 403) console.log('→ 이 테이블은 뷰 단위로만 공유되어 테이블 직접 조회가 막혀 있을 수 있습니다.');
  }
}

console.log('\n' + '='.repeat(78));
console.log('사용법: §A 목록에서 원하는 base_id / table 이름(또는 table_id) /');
console.log('view 이름(또는 view_id)을 AIRTABLE_SOURCES 변수(JSON)에 채워 넣으세요.');
console.log('table_id/view_id("tbl…"/"viw…")를 쓰면 이름이 바뀌어도 깨지지 않아 안전합니다.');
console.log('='.repeat(78));
