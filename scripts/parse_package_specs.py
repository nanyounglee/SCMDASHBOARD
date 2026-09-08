"""커스텀 패키지 제작사양 CSV → 견적 엑셀용 제품표(scripts/quote_products.json).

입력: Airtable parts export "4. parts-패키지사양.csv" (53행)
      파츠명 · 굿즈 · 산출물 대분류 · 장폭고 · 지류/소재 · 발주 세부사항 · 수량별 표준원가

  python scripts/parse_package_specs.py "C:\\...\\4. parts-패키지사양.csv"

지류 매핑은 사용자 지정(2026-09-08):
  SC마닐라 220g   → sc240g + 골판지 SK K 3합
  뉴에코블랙 400g → 뉴에코블랙350g 단가 × 1.2
  B 400g          → riv400g 단가
  BV 350/400g     → riv350g / riv400g 단가
  AB플러스        → riv 단가(무게 근접)
"""
import csv
import io
import json
import re
import sys
from collections import Counter
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ROOT = Path(__file__).resolve().parent.parent
SRC = Path(sys.argv[1]) if len(sys.argv) > 1 else Path.home() / "Downloads" / "4. parts-패키지사양.csv"

# ── 지류: CSV 원문 → 계산기 지종 (사용자 지정 매핑) ─────────────────────────
# (정규식, 지종, 비고)  — 위에서부터 먼저 맞는 것을 쓴다
PAPER_RULES = [
    (r"AB\s*라이트\s*295",      "ab라이트295g",  "단가표에 그대로 있음"),
    (r"뉴에코블랙\s*350",       "뉴에코블랙350g", "단가표에 그대로 있음"),
    (r"뉴에코블랙\s*400",       "뉴에코블랙400g", "사용자 지정: 350g 단가 × 1.2"),
    (r"랑데뷰.*310",            "riv300g",       "랑데뷰=riv, 310g→300g 근사"),
    (r"^\s*B\s*400",            "B400g",         "사용자 지정: riv400g 단가"),
    (r"BV.*?350|BV350",         "BV350g",        "사용자 지정: riv350g 단가"),
    (r"BV.*?400|BV400",         "BV400g",        "사용자 지정: riv400g 단가"),
    (r"AB\s*플러스\s*400",      "AB플러스400g",  "사용자 지정: riv400g 단가"),
    (r"AB\s*플러스\s*240",      "AB플러스270g",  "사용자 지정: riv 단가(240-280g→riv300g)"),
    (r"SC\s*마닐라.*220",       "sc240g",        "사용자 지정: sc240g + 골판지 SK K 3합"),
]
# 위 규칙으로 안 잡히는 소재 — 단가 근거가 없어 견적 산출 불가
UNMAPPED_NOTE = "단가표에 대응 지종 없음 — 지류 단가를 받아야 산출 가능"

# ── 박스 형태: 산출물 대분류 → 계산기 4형태 ────────────────────────────────
FORM_RULES = [
    (r"Open\s*페이퍼박스|오픈박스|페이퍼G형박스", "open페이퍼박스/motion박스"),
    (r"Solid\s*커스텀\s*G형|SolidG",              "SolidG형 커스텀"),
    (r"스트랩",                                    "테일러드 스트랩 박스 커스텀"),
    (r"단품박스",                                  "단박스"),
]

PROC = {
    "print":  r"인쇄|옵셋",
    "coat":   r"라미네이팅|코팅",
    "adh":    r"접착",
    "tomson": r"톰슨|목형",
    "foil":   r"금박|은박|박압|박\s*후가공",
    "emboss": r"형압|엠보|디보싱|공박",
    "epoxy":  r"에폭시",
}

rows = list(csv.DictReader(io.open(SRC, encoding="utf-8-sig")))
TIERS = [100, 300, 500, 1000, 3000, 5000, 10000, 30000]

out, report = [], Counter()
for r in rows:
    spec = (r["발주 세부사항(임가공 포함)"] or "")
    dim = (r["파츠: 가로x세로x높이(장폭고)"] or "").strip()
    m = re.search(r"(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)\s*[xX×]\s*(\d+(?:\.\d+)?)", dim)
    paper_raw = re.sub(r"\s+", " ", (r["파츠: 지류/소재"] or "").replace("\t", " ")).strip()

    paper, paper_note = "", UNMAPPED_NOTE
    for pat, name, note in PAPER_RULES:
        if re.search(pat, paper_raw, re.I):
            paper, paper_note = name, note
            break

    cat = (r["산출물_대분류_임시"] or "").strip()
    form = ""
    for pat, name in FORM_RULES:
        if re.search(pat, cat, re.I):
            form = name
            break

    colors = 0
    cm = re.search(r"(\d)\s*도", spec)
    if cm:
        colors = int(cm.group(1))
    elif re.search(PROC["print"], spec):
        colors = 4  # 도수 표기가 없으면 원색 4도로 본다

    costs = {}
    for t in TIERS:
        v = (r.get(f"{t}개_표준원가") or "").replace(",", "").strip()
        if v:
            try:
                costs[str(t)] = float(v)
            except ValueError:
                pass

    item = {
        "파츠코드": (r.get("파츠 코드 (PK)") or "").strip(),
        "파츠명": (r["파츠명 (Long ver)"] or "").strip(),
        "굿즈": (r["1. goods"] or "").strip(),
        "대분류": cat,
        "박스형태": form,
        "W": float(m.group(1)) if m else 0,
        "D": float(m.group(2)) if m else 0,
        "H": float(m.group(3)) if m else 0,
        "지류원문": paper_raw,
        "지종": paper,
        "지류비고": paper_note if paper else UNMAPPED_NOTE,
        "인쇄도수": colors,
        "코팅": bool(re.search(PROC["coat"], spec)),
        "코팅면": "양면" if re.search(r"양면\s*(무광|유광)?\s*라미|양면\s*코팅", spec) else "단면",
        "접착": bool(re.search(PROC["adh"], spec)),
        "톰슨": bool(re.search(PROC["tomson"], spec)),
        "금은박": bool(re.search(PROC["foil"], spec)),
        "형압": bool(re.search(PROC["emboss"], spec)),
        "에폭시": bool(re.search(PROC["epoxy"], spec)),
        # SC마닐라 건은 사용자 지정대로 골판지 3합(SK K)을 기본으로 켠다
        "골판지": "3합" if re.search(r"SC\s*마닐라.*220", paper_raw, re.I) else
                  ("2합" if re.search(r"합지|골", spec) else "해당없음"),
        "골판지재질": "SK K",
        "표준원가": costs,
        "세부사항": re.sub(r"\s+", " ", spec).strip()[:300],
    }
    out.append(item)
    report["지종 매핑됨" if paper else "지종 미매핑"] += 1
    report["박스형태 매핑됨" if form else "박스형태 미매핑"] += 1
    report["치수 파싱됨" if m else "치수 파싱실패"] += 1
    report["표준원가 있음" if costs else "표준원가 없음"] += 1

(ROOT / "scripts" / "quote_products.json").write_text(
    json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")

print(f"제품 {len(out)}건 → scripts/quote_products.json")
for k in sorted(report):
    print(f"  {k:16s} {report[k]:2d}")
print("\n── 견적 산출이 막히는 건 ──")
for it in out:
    miss = [x for x, ok in (("지종", it["지종"]), ("박스형태", it["박스형태"]), ("치수", it["W"])) if not ok]
    if miss:
        print(f"  [{'·'.join(miss)}] {it['대분류']} | {it['지류원문'][:44]} | {it['파츠명'][:40]}")
