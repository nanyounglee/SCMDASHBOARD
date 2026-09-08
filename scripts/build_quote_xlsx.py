"""패키지 견적 계산기 — 수식 엑셀(.xlsx) 생성기.

대시보드(index.html)의 견적 계산기와 같은 산식을 매크로 없이 엑셀 수식만으로 옮긴다.
단가표·구간표는 index.html에서 뽑은 scripts/quote_constants.json을,
제품 53종의 제작사양은 scripts/parse_package_specs.py가 만든 quote_products.json을 쓴다.

  python scripts/build_quote_xlsx.py            # → docs/패키지_견적계산기.xlsx
  python scripts/build_quote_xlsx.py out.xlsx

엑셀 전용 기능(대시보드에는 반영하지 않음, 사용자 지정 2026-09-08):
  · 제품 선택 → 사양 자동 채움, 수량·사이즈는 직접 입력으로 덮어쓰기
  · 용지 규격 자동 선택 — 전개 크기가 들어가는 가장 작은 표준용지를 고른다.
    실측 대조에서 이것만으로 산출/표준원가 배율 중앙값이 1.75배 → 0.95배로 붙었다.
  · 계산기 27지종에 없는 지류를 파생 단가로 추가(scripts/derived_papers.json)
  · 표준원가(실제 매입 단가)를 수량 보간해 산출값과 나란히 비교

매크로(VBA)를 쓰지 않는 이유: 계산이 전부 사칙연산·구간표 조회라 수식으로 충분하고,
인터넷에서 받은 .xlsm은 Office가 Mark of the Web를 보고 매크로를 기본 차단한다.
"""
import json
import sys
from datetime import date
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

ROOT = Path(__file__).resolve().parent.parent
C = json.loads((ROOT / "scripts" / "quote_constants.json").read_text(encoding="utf-8"))
DERIVED = json.loads((ROOT / "scripts" / "derived_papers.json").read_text(encoding="utf-8"))
PRODUCTS = json.loads((ROOT / "scripts" / "quote_products.json").read_text(encoding="utf-8"))

SIZES = C["QC_SIZE_ORDER"]           # 작은 규격 → 큰 규격 (자동상향 순서)
BASE_PAPERS = list(C["QC_PAPER_PRICES"])
DERIVED_PAPERS = [k for k in DERIVED if not k.startswith("_")]
PAPERS = BASE_PAPERS + DERIVED_PAPERS
COLS = C["QC_SIZE_COLS"]             # 원본 단가 배열의 컬럼 순서
STD = C["QC_PAPER_STD"]              # 표준용지 10종 (면적 오름차순)
CORR = C["QC_CORR_PRICES"]
FORMS = C["QC_FORM_TYPES"]
CORR_APPLY = C["QC_CORR_APPLY"]
TIERS = [100, 300, 500, 1000, 3000, 5000, 10000, 30000]

FONT = "맑은 고딕"  # 한글 문서라 Arial 대신 사용 — Arial은 한글이 폰트 폴백으로 렌더된다
INPUT_FILL = PatternFill("solid", fgColor="FFF9C4")   # 노랑 = 직접 입력
AUTO_FILL = PatternFill("solid", fgColor="E8F5E9")    # 연두 = 제품에서 자동으로 찬 값
HEAD_FILL = PatternFill("solid", fgColor="263238")
SUB_FILL = PatternFill("solid", fgColor="ECEFF1")
BLUE = Font(name=FONT, size=10, color="0000FF")       # 하드코딩 입력값
BLACK = Font(name=FONT, size=10)
GREEN = Font(name=FONT, size=10, color="008000")      # 다른 시트 참조
THIN = Side(style="thin", color="B0BEC5")
BOX = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
WON = '#,##0"원"'
NUM = "#,##0"
NUM2 = "#,##0.00"


def title(ws, cell, text, size=13):
    ws[cell] = text
    ws[cell].font = Font(name=FONT, size=size, bold=True, color="FFFFFF")
    ws[cell].fill = HEAD_FILL


def sub(ws, cell, text):
    ws[cell] = text
    ws[cell].font = Font(name=FONT, size=10, bold=True)
    ws[cell].fill = SUB_FILL


def note(ws, cell, text):
    ws[cell] = text
    ws[cell].font = Font(name=FONT, size=9, color="607D8B")


wb = Workbook()

# ============================== 단가표 ==============================
lk = wb.active
lk.title = "단가표"
R = {}

title(lk, "A1", "지류·공정 단가표 — 단가가 바뀌면 이 시트만 고치면 견적 시트가 따라옵니다")
note(lk, "A2", f"출처: SCM 대시보드 견적 계산기(외주버전 v1.2.2 단가표) · 생성 {date.today()}")

r = 4
sub(lk, f"A{r}", "① 지류 단가 (원/장) — 규격은 작은 것부터")
r += 1
head_row = r
lk.cell(head_row, 1, "지종").font = Font(name=FONT, size=10, bold=True)
for j, s in enumerate(SIZES):
    c = lk.cell(head_row, 2 + j, s)
    c.font = Font(name=FONT, size=9, bold=True)
    c.alignment = Alignment(horizontal="center", wrap_text=True)
price_top = head_row + 1
for i, p in enumerate(BASE_PAPERS):
    lk.cell(price_top + i, 1, p).font = BLACK
    row_vals = C["QC_PAPER_PRICES"][p]
    for j, s in enumerate(SIZES):
        c = lk.cell(price_top + i, 2 + j, row_vals[COLS.index(s)])
        c.font = BLUE
        c.number_format = NUM2
# 파생 지류 — 원본 지종 행 × 배수를 «수식»으로 건다(원본이 바뀌면 따라간다)
for i, p in enumerate(DERIVED_PAPERS):
    row = price_top + len(BASE_PAPERS) + i
    src, mult = DERIVED[p]
    src_row = price_top + BASE_PAPERS.index(src)
    lk.cell(row, 1, p).font = Font(name=FONT, size=10, bold=True, color="008000")
    for j in range(len(SIZES)):
        col = get_column_letter(2 + j)
        c = lk.cell(row, 2 + j, f"={col}{src_row}*{mult}")
        c.font = GREEN
        c.number_format = NUM2
    note(lk, f"{get_column_letter(2 + len(SIZES))}{row}", f"← {src} × {mult} (사용자 지정 2026-09-08)")
price_bot = price_top + len(PAPERS) - 1
R["price"] = f"단가표!$B${price_top}:$P${price_bot}"
R["paper_names"] = f"단가표!$A${price_top}:$A${price_bot}"
R["size_names"] = f"단가표!$B${head_row}:$P${head_row}"
note(lk, f"A{price_bot + 1}", "0 = 그 규격 단가 없음 → ②에서 다음 큰 규격으로 자동 상향. 초록 행은 계산기에 없는 지류를 위 지종에서 파생시킨 단가입니다.")

r = price_bot + 3
for label, key in [("대판여부 (1=대판, 연수 500 기준)", "big"), ("톰슨 단가 (원/통)", "tomson"),
                   ("특수공정 단가 (원/통)", "spec"), ("합지 2합 (원/통)", "lam2"), ("합지 3합 (원/통)", "lam3")]:
    lk.cell(r, 1, label).font = Font(name=FONT, size=10, bold=True)
    for j, s in enumerate(SIZES):
        v = (1 if s in C["QC_BIG_SIZES"] else 0) if key == "big" else \
            dict(C["tomson"])[s] if key == "tomson" else \
            dict(C["spec"])[s] if key == "spec" else \
            C["lam"][s][0 if key == "lam2" else 1]
        cc = lk.cell(r, 2 + j, v)
        cc.font = BLUE
        cc.number_format = NUM
    R[key] = f"단가표!$B${r}:$P${r}"
    r += 1

r += 1
sub(lk, f"A{r}", "② 규격 자동상향 — 선택 규격의 단가가 0이면 다음 큰 규격의 열번호 (수식, 고치지 마세요)")
r += 1
res_head = r
lk.cell(res_head, 1, "지종").font = Font(name=FONT, size=10, bold=True)
for j, s in enumerate(SIZES):
    c = lk.cell(res_head, 2 + j, s)
    c.font = Font(name=FONT, size=9, bold=True)
    c.alignment = Alignment(horizontal="center", wrap_text=True)
res_top = res_head + 1
for i in range(len(PAPERS)):
    lk.cell(res_top + i, 1, f"=A{price_top + i}").font = GREEN
    for j in range(len(SIZES) - 1, -1, -1):
        col = get_column_letter(2 + j)
        tail = "0" if j == len(SIZES) - 1 else f"{get_column_letter(3 + j)}{res_top + i}"
        cc = lk.cell(res_top + i, 2 + j, f"=IF({col}{price_top + i}>0,{j + 1},{tail})")
        cc.font = BLACK
        cc.number_format = NUM
res_bot = res_top + len(PAPERS) - 1
R["resolve"] = f"단가표!$B${res_top}:$P${res_bot}"

r = res_bot + 2
sub(lk, f"A{r}", "③ 골판지 재질 단가")
r += 1
corr_top = r
for k, v in CORR.items():
    lk.cell(r, 1, k).font = BLACK
    lk.cell(r, 2, v).font = BLUE
    lk.cell(r, 2).number_format = NUM
    r += 1
R["corr_names"] = f"단가표!$A${corr_top}:$A${r - 1}"
R["corr_prices"] = f"단가표!$B${corr_top}:$B${r - 1}"

r += 1
sub(lk, f"A{r}", "④ 표준용지 (전개 크기가 들어가는지 판정 · 면적 오름차순 = 자동 선택 순서)")
r += 1
for j, h in enumerate(["규격", "가로(mm)", "세로(mm)"]):
    lk.cell(r, 1 + j, h).font = Font(name=FONT, size=10, bold=True)
r += 1
std_top = r
for s in STD:
    lk.cell(r, 1, s["name"]).font = BLACK
    lk.cell(r, 2, s["w"]).font = BLUE
    lk.cell(r, 3, s["h"]).font = BLUE
    r += 1
std_bot = r - 1
R["std_names"] = f"단가표!$A${std_top}:$A${std_bot}"

r += 1
sub(lk, f"A{r}", "⑤ 구간 단가 · 최소금액 · 계수")
r += 1


def kv_block(header, pairs, unit_a, unit_b):
    global r
    lk.cell(r, 1, header).font = Font(name=FONT, size=10, bold=True)
    lk.cell(r, 2, unit_a).font = Font(name=FONT, size=9, bold=True)
    lk.cell(r, 3, unit_b).font = Font(name=FONT, size=9, bold=True)
    r += 1
    refs = []
    for a, b in pairs:
        lk.cell(r, 2, a).font = BLUE
        lk.cell(r, 3, b).font = BLUE
        lk.cell(r, 2).number_format = NUM
        lk.cell(r, 3).number_format = NUM
        refs.append((f"단가표!$B${r}", f"단가표!$C${r}"))
        r += 1
    r += 1
    return refs


loss_refs = kv_block("여분(로스) 장수", [(500, 200), (5000, 300), (10000, 500), (20000, 700), (0, 1000)], "수량 이하", "여분 장수")
print_refs = kv_block("인쇄 도당단가", [(2, 12000), (5, 10000), (10, 9000), (15, 8000), (20, 7000), (30, 6000), (0, 5000)], "연수", "원/도/연")
adh_refs = kv_block("접착 단가", [(2000, 50), (5000, 40), (10000, 30), (0, 20)], "통수 이하", "원/통")
cl_refs = kv_block("골판지 여분", [(3000, 100), (5000, 200), (10000, 300), (0, 500)], "수량 미만", "여분 장수")

sub(lk, f"A{r}", "최소금액 · 계수")
r += 1
K = {}
for label, val in [("인쇄 최소금액", 36000), ("코팅 최소금액", 45000), ("톰슨 최소금액", 50000),
                   ("접착 최소금액", 60000), ("에폭시 최소금액", 100000), ("금은박·형압 최소금액", 80000),
                   ("합지 최소금액", 80000), ("관리비 최소금액", 150000), ("마진 최소금액", 200000),
                   ("인쇄 판비(CTP, 원/도)", 7000), ("동판비(원, 고정)", 10000),
                   ("코팅 계수(전개면적×계수÷1,000,000)", 145), ("필름비 계수(전개면적×계수÷1,000)", 50),
                   ("에폭시 통당 단가", 100), ("골판지 최소 장수", 500), ("관리비율", 0.10)]:
    lk.cell(r, 1, label).font = BLACK
    c = lk.cell(r, 2, val)
    c.font = BLUE
    c.number_format = "0%" if label == "관리비율" else NUM
    K[label] = f"단가표!$B${r}"
    r += 1

lk.column_dimensions["A"].width = 34
for j in range(len(SIZES)):
    lk.column_dimensions[get_column_letter(2 + j)].width = 11

# ============================== 제품목록 ==============================
pl = wb.create_sheet("제품목록")
title(pl, "A1", "커스텀 패키지 제작사양 — 견적 시트의 «제품 선택»이 이 표를 읽습니다")
note(pl, "A2", "출처: Airtable parts export «4. parts-패키지사양.csv» · 표준원가는 실제 매입 단가(개당)")
PCOLS = ["제품명", "굿즈", "대분류", "박스형태", "지종", "W", "D", "H", "인쇄도수", "코팅", "코팅면",
         "접착", "톰슨", "금은박", "형압", "에폭시", "골판지", "골판지재질"] + [f"{t}개" for t in TIERS] + ["비고"]
for j, h in enumerate(PCOLS):
    c = pl.cell(4, 1 + j, h)
    c.font = Font(name=FONT, size=9, bold=True, color="FFFFFF")
    c.fill = HEAD_FILL
    c.alignment = Alignment(horizontal="center", wrap_text=True)
YN = lambda b: "Y" if b else "N"
prod_top = 5
usable = [p for p in PRODUCTS if p["지종"] and p["박스형태"] and p["W"]]
blocked = [p for p in PRODUCTS if p not in usable]
for i, p in enumerate(usable + blocked):
    row = prod_top + i
    why = [n for n, ok in (("지종 미매핑", p["지종"]), ("박스형태 미매핑", p["박스형태"]), ("치수 없음", p["W"])) if not ok]
    vals = [p["파츠명"], p["굿즈"], p["대분류"], p["박스형태"], p["지종"], p["W"], p["D"], p["H"],
            p["인쇄도수"], YN(p["코팅"]), p["코팅면"], YN(p["접착"]), YN(p["톰슨"]), YN(p["금은박"]),
            YN(p["형압"]), YN(p["에폭시"]), p["골판지"], p["골판지재질"]] \
           + [p["표준원가"].get(str(t), "") for t in TIERS] + ["· ".join(why)]
    for j, v in enumerate(vals):
        c = pl.cell(row, 1 + j, v)
        c.font = Font(name=FONT, size=9, color="C62828") if why else Font(name=FONT, size=9)
        if isinstance(v, (int, float)):
            c.number_format = NUM
prod_bot = prod_top + len(PRODUCTS) - 1
R["prod_names"] = f"제품목록!$A${prod_top}:$A${prod_bot}"
R["prod_all"] = f"제품목록!$A${prod_top}:${get_column_letter(len(PCOLS))}${prod_bot}"
R["tier_qty"] = f"제품목록!${get_column_letter(19)}$4:${get_column_letter(26)}$4"   # 헤더('100개'…) 자리
R["tier_row"] = None
note(pl, f"A{prod_bot + 2}", f"빨간 행 {len(blocked)}건은 지종·박스형태·치수가 매핑되지 않아 견적 산출이 안 됩니다(비고 참고). 나머지 {len(usable)}건은 선택 즉시 산출됩니다.")
# 수량 구간 헤더를 숫자로도 한 줄 둔다 — 표준원가 보간이 이 행을 읽는다
for j, t in enumerate(TIERS):
    c = pl.cell(3, 19 + j, t)
    c.font = Font(name=FONT, size=9, bold=True, color="607D8B")
    c.number_format = NUM
pl.cell(3, 18, "보간용 수량 →").font = Font(name=FONT, size=9, color="607D8B")
R["tier_qty"] = f"제품목록!${get_column_letter(19)}$3:${get_column_letter(26)}$3"
pl.column_dimensions["A"].width = 46
pl.column_dimensions["B"].width = 20
pl.column_dimensions["C"].width = 20
pl.freeze_panes = "A5"

# ============================== 견적계산기 ==============================
q = wb.create_sheet("견적계산기", 0)
title(q, "A1", "패키지 견적 계산기", 15)
note(q, "A2", "① 제품을 고르면 사양이 자동으로 찹니다(연두) → ② 수량·사이즈 등 바꿀 값만 노란 칸에 적으면 그 값이 우선합니다. 매크로 없음.")

I, A, H, S = {}, {}, {}, {}
row = 4
sub(q, f"A{row}", "■ 제품 선택")
row += 1
q.cell(row, 1, "제품").font = Font(name=FONT, size=10, bold=True)
pc = q.cell(row, 2, usable[0]["파츠명"])
pc.font = BLUE
pc.fill = INPUT_FILL
pc.border = BOX
PROD = f"$B${row}"
I["제품"] = PROD
q.merge_cells(start_row=row, start_column=2, end_row=row, end_column=4)
row += 1
PROW = f"$B${row}"
q.cell(row, 1, "제품 행번호").font = Font(name=FONT, size=9, color="607D8B")
q.cell(row, 2, f"=IFERROR(MATCH({PROD},{R['prod_names']},0),0)").font = BLACK
row += 2

sub(q, f"A{row}", "■ 사양  (B=제품 기본값 · C=직접 입력(비우면 기본값) · D=적용값)")
row += 1
for j, h in enumerate(["항목", "제품 기본값", "직접 입력", "적용값"]):
    c = q.cell(row, 1 + j, h)
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
    c.fill = HEAD_FILL
row += 1


def spec(label, pcol, fmt=None, hint=""):
    """pcol = 제품목록의 열 번호(1-based). None이면 제품과 무관한 순수 입력."""
    global row
    q.cell(row, 1, label).font = Font(name=FONT, size=10, bold=True)
    b = q.cell(row, 2, f"=IF({PROW}=0,\"\",INDEX({R['prod_all']},{PROW},{pcol}))" if pcol else "")
    b.font = GREEN
    b.fill = AUTO_FILL
    c = q.cell(row, 3)
    c.font = BLUE
    c.fill = INPUT_FILL
    c.border = BOX
    # 제품 기본값이 비어 있으면(제품과 무관한 항목이거나 그 제품에 값이 없음) 빈 문자열로 넘긴다 —
    # 그냥 $B$r를 쓰면 «빈 셀 = 0»이 되어 «규격 자동선택»처럼 «비었으면» 분기가 안 걸린다.
    d = q.cell(row, 4, f'=IF($C${row}<>"",$C${row},IF($B${row}="","",$B${row}))')
    d.font = Font(name=FONT, size=10, bold=True)
    if fmt:
        b.number_format = c.number_format = d.number_format = fmt
    if hint:
        note(q, f"E{row}", hint)
    I[label], A[label] = f"$C${row}", f"$D${row}"
    row += 1
    return A[label]


spec("박스 형태", 4, hint="드롭다운")
spec("내경 가로 W (mm)", 6, NUM)
spec("내경 세로 D (mm)", 7, NUM)
spec("내경 높이 H (mm)", 8, NUM)
spec("원단1 지종", 5, hint="드롭다운")
spec("원단2 지종", 5)
spec("인쇄 도수", 9, NUM, "0이면 인쇄 없음")
spec("코팅", 10, hint="Y / N")
spec("코팅 면", 11, hint="단면 / 양면")
spec("접착", 12, hint="Y / N — 단박스만")
spec("톰슨", 13, hint="Y / N")
spec("금은박", 14, hint="Y / N")
spec("형압", 15, hint="Y / N")
spec("에폭시", 16, hint="Y / N")
spec("골판지 합지", 17, hint="해당없음 / 2합 / 3합")
spec("골판지 재질", 18)
spec("제작수량 (EA)", None, NUM, "★ 직접 입력")
spec("판걸이", None, NUM, "★ 한 장에 몇 개 앉히는지. 비우면 1")
spec("원단1 규격", None, hint="★ 비우면 전개 크기에 맞는 최소 표준용지 자동 선택")
spec("원단2 규격", None, hint="★ 비우면 자동 선택")
spec("배면 인쇄지", None, hint="Y / N — 골판지 합지 적용 시만")
spec("배면 지종", None)
spec("배면 규격", None, hint="비우면 파트1 규격")
spec("배면 인쇄", None, hint="Y / N")
spec("배면 인쇄 도수", None, NUM)
spec("배면 코팅", None, hint="Y / N — 단면 기준")
spec("마진율 (%)", None, NUM, "비우면 30 · 최소 마진 20만원 보장")
q[I["제작수량 (EA)"].replace("$", "")] = 1000
q[I["마진율 (%)"].replace("$", "")] = 30
q["A2"].alignment = Alignment(wrap_text=False)

row += 1
sub(q, f"A{row}", "■ 추가비용")
row += 1
for j, h in enumerate(["항목", "수량", "단가", "금액"]):
    q.cell(row, 1 + j, h).font = Font(name=FONT, size=10, bold=True)
row += 1
ex_top = row
for lbl in ["수작업", "포장", "배송비", "기타"]:
    q.cell(row, 1, lbl).font = BLACK
    for cc in (2, 3):
        c = q.cell(row, cc, 0)
        c.font = BLUE
        c.fill = INPUT_FILL
        c.border = BOX
        c.number_format = NUM
    c = q.cell(row, 4, f"=B{row}*C{row}")
    c.number_format = WON
    row += 1
ex_bot = row - 1
EXTRA = f"$D${ex_top}:$D${ex_bot}"

# ---------- 보조 계산 ----------
row += 1
sub(q, f"A{row}", "■ 보조 계산 (자동)")
row += 1


def calc(label, formula, fmt=None, hint=""):
    global row
    q.cell(row, 1, label).font = Font(name=FONT, size=10)
    c = q.cell(row, 2, formula)
    c.font = BLACK
    if fmt:
        c.number_format = fmt
    if hint:
        note(q, f"C{row}", hint)
    H[label] = f"$B${row}"
    row += 1
    return H[label]


QTY = calc("적용 수량", f'=IF({A["제작수량 (EA)"]}="",0,{A["제작수량 (EA)"]})', NUM)
GAN = calc("적용 판걸이", f'=IF(OR({A["판걸이"]}="",{A["판걸이"]}<1),1,{A["판걸이"]})', NUM)
MRG = calc("적용 마진율", f'=IF({A["마진율 (%)"]}="",30,{A["마진율 (%)"]})', NUM)
W, D, Hh, form = A["내경 가로 W (mm)"], A["내경 세로 D (mm)"], A["내경 높이 H (mm)"], A["박스 형태"]
tong = calc("통수", f"={QTY}/{GAN}", NUM2)
loss_f = f"IF({QTY}<={loss_refs[0][0]},{loss_refs[0][1]},IF({QTY}<={loss_refs[1][0]},{loss_refs[1][1]}," \
         f"IF({QTY}<={loss_refs[2][0]},{loss_refs[2][1]},IF({QTY}<={loss_refs[3][0]},{loss_refs[3][1]},{loss_refs[4][1]})))"
loss_f += ")"
calc("여분(로스) 장수", f"={loss_f}", NUM)
sheets = calc("실통수 (통수+여분)", f"={tong}+{H['여분(로스) 장수']}", NUM2)

f1w = (f'=IF({form}="{FORMS[0]}",({W}+{D})*2+50,IF({form}="{FORMS[1]}",{W}+{Hh}*4+72,'
       f'IF({form}="{FORMS[2]}",{W}+{Hh}*4+60,{W}+30)))')
f1h = (f'=IF({form}="{FORMS[0]}",{D}*2+{Hh}+70,IF({form}="{FORMS[1]}",{D}+{Hh}*4+72,'
       f'IF({form}="{FORMS[2]}",{D}*2+{Hh}*3+60,({D}+{Hh})*2+50)))')
calc("파트1 전개 가로 (mm)", f1w, NUM)
calc("파트1 전개 세로 (mm)", f1h, NUM)
p2on = calc("파트2 사용여부", f'=IF(OR({form}="{FORMS[1]}",{form}="{FORMS[3]}"),1,0)', NUM)
calc("파트2 전개 가로 (mm)", f"=IF({p2on}=0,0,{W}+{Hh}*4+70)", NUM)
calc("파트2 전개 세로 (mm)", f"=IF({p2on}=0,0,{D}+{Hh}*4+70)", NUM)

# 규격 자동 선택 — 전개 크기가 들어가는 가장 작은 표준용지(90° 회전 허용)
for idx in (1, 2):
    pw, ph = H[f"파트{idx} 전개 가로 (mm)"], H[f"파트{idx} 전개 세로 (mm)"]
    q.cell(row, 1, f"파트{idx} 표준용지 수용 판정").font = Font(name=FONT, size=9, color="607D8B")
    fit_row = row
    for k in range(len(STD)):
        sw, sh = f"단가표!$B${std_top + k}", f"단가표!$C${std_top + k}"
        q.cell(row, 4 + k, f"=IF(AND({pw}>0,OR(AND({pw}<={sw},{ph}<={sh}),AND({pw}<={sh},{ph}<={sw}))),1,0)").number_format = NUM
    fit_rng = f"$D${fit_row}:${get_column_letter(3 + len(STD))}${fit_row}"
    row += 1
    calc(f"파트{idx} 최소 표준용지", f'=IFERROR(INDEX({R["std_names"]},MATCH(1,{fit_rng},0)),"규격초과")')
    calc(f"파트{idx} 적용 규격",
         f'=IF({A[f"원단{idx} 규격"]}<>"",{A[f"원단{idx} 규격"]},'
         f'IF({H[f"파트{idx} 최소 표준용지"]}="규격초과","전지",{H[f"파트{idx} 최소 표준용지"]}))',
         hint="직접 입력이 없으면 자동 선택" if idx == 1 else "")

PART = {}
for idx in (1, 2):
    pt = A[f"원단{idx} 지종"]
    ps = H[f"파트{idx} 적용 규격"]
    prow = calc(f"파트{idx} 지종 행번호", f"=IFERROR(MATCH({pt},{R['paper_names']},0),0)", NUM)
    pcol = calc(f"파트{idx} 규격 열번호", f"=IFERROR(MATCH({ps},{R['size_names']},0),0)", NUM)
    ridx = calc(f"파트{idx} 적용규격 열번호", f"=IF(OR({prow}=0,{pcol}=0),0,INDEX({R['resolve']},{prow},{pcol}))", NUM)
    calc(f"파트{idx} 최종 규격", f'=IF({ridx}=0,"단가없음",INDEX({R["size_names"]},1,{ridx}))')
    price = calc(f"파트{idx} 지류단가 (원/장)", f"=IF({ridx}=0,0,INDEX({R['price']},{prow},{ridx}))", NUM2)
    big = calc(f"파트{idx} 대판여부", f"=IF({ridx}=0,0,INDEX({R['big']},1,{ridx}))", NUM)
    yeon = calc(f"파트{idx} 연수", f"=MAX(1,ROUND({tong}/IF({big}=1,500,1000)*2,0)/2)", "0.0")
    tu = calc(f"파트{idx} 톰슨단가", f"=IF({ridx}=0,0,INDEX({R['tomson']},1,{ridx}))", NUM)
    su = calc(f"파트{idx} 특수공정단가", f"=IF({ridx}=0,0,INDEX({R['spec']},1,{ridx}))", NUM)
    l2 = calc(f"파트{idx} 합지2합단가", f"=IF({ridx}=0,0,INDEX({R['lam2']},1,{ridx}))", NUM)
    l3 = calc(f"파트{idx} 합지3합단가", f"=IF({ridx}=0,0,INDEX({R['lam3']},1,{ridx}))", NUM)
    PART[idx] = dict(w=H[f"파트{idx} 전개 가로 (mm)"], h=H[f"파트{idx} 전개 세로 (mm)"],
                     price=price, yeon=yeon, tomson=tu, spec=su, lam2=l2, lam3=l3, ridx=ridx)

b_size = calc("배면 적용 규격", f'=IF({A["배면 규격"]}<>"",{A["배면 규격"]},{H["파트1 적용 규격"]})')
b_type = calc("배면 적용 지종", f'=IF({A["배면 지종"]}<>"",{A["배면 지종"]},"sc240g")')
b_prow = calc("배면 지종 행번호", f"=IFERROR(MATCH({b_type},{R['paper_names']},0),0)", NUM)
b_pcol = calc("배면 규격 열번호", f"=IFERROR(MATCH({b_size},{R['size_names']},0),0)", NUM)
b_ridx = calc("배면 적용규격 열번호", f"=IF(OR({b_prow}=0,{b_pcol}=0),0,INDEX({R['resolve']},{b_prow},{b_pcol}))", NUM)
b_price = calc("배면 지류단가 (원/장)", f"=IF({b_ridx}=0,0,INDEX({R['price']},{b_prow},{b_ridx}))", NUM2)
b_big = calc("배면 대판여부", f"=IF({b_ridx}=0,0,INDEX({R['big']},1,{b_ridx}))", NUM)
b_yeon = calc("배면 연수", f"=MAX(1,ROUND({tong}/IF({b_big}=1,500,1000)*2,0)/2)", "0.0")


def print_unit(y):
    f = f"{print_refs[6][1]}"
    for a, b in reversed(print_refs[1:6]):
        f = f"IF({y}<={a},{b},{f})"
    return f"IF({y}<{print_refs[0][0]},{print_refs[0][1]},{f})"


adh_f = (f"IF({tong}<={adh_refs[0][0]},{adh_refs[0][1]},IF({tong}<={adh_refs[1][0]},{adh_refs[1][1]},"
         f"IF({tong}<{adh_refs[2][0]},{adh_refs[2][1]},{adh_refs[3][1]})))")
corr_loss_f = (f"IF({QTY}<{cl_refs[0][0]},{cl_refs[0][1]},IF({QTY}<{cl_refs[1][0]},{cl_refs[1][1]},"
               f"IF({QTY}<{cl_refs[2][0]},{cl_refs[2][1]},{cl_refs[3][1]})))")
calc("골판지 여분 장수", f"={corr_loss_f}", NUM)
calc("골판지 재질단가", f"=IFERROR(INDEX({R['corr_prices']},MATCH({A['골판지 재질']},{R['corr_names']},0)),0)", NUM)
corr_on = calc("골판지 적용여부",
               f'=IF(AND({A["골판지 합지"]}<>"해당없음",{A["골판지 합지"]}<>"",OR('
               + ",".join(f'{form}="{t}"' for t in CORR_APPLY) + f'),{H["골판지 재질단가"]}>0),1,0)', NUM)

# ---------- 원가 명세 ----------
row += 1
sub(q, f"A{row}", "■ 원가 명세")
row += 1
for j, hd in enumerate(["항목", "구분", "산출 근거", "금액"]):
    c = q.cell(row, 1 + j, hd)
    c.font = Font(name=FONT, size=10, bold=True, color="FFFFFF")
    c.fill = HEAD_FILL
row += 1
cost_top = row
YES = lambda ref: f'UPPER(LEFT({ref}&"",1))="Y"'


def line(label, group, basis, formula):
    global row
    q.cell(row, 1, label).font = BLACK
    q.cell(row, 2, group).font = Font(name=FONT, size=9, color="607D8B")
    q.cell(row, 3, basis).font = Font(name=FONT, size=9, color="607D8B")
    c = q.cell(row, 4, formula)
    c.font = BLACK
    c.number_format = WON
    c.border = BOX
    row += 1


mn = K
PR = A["인쇄 도수"]
for idx in (1, 2):
    P = PART[idx]
    g0 = "" if idx == 1 else f"IF({p2on}=0,0,"
    g1 = "" if idx == 1 else ")"
    line(f"파트{idx} 원단비", "원단", "지류단가 × 실통수", f"={g0}ROUND({sheets}*{P['price']},0){g1}")
    line(f"파트{idx} 인쇄 작업비", "인쇄", "도당단가 × 도수 × 연수 (최소금액)",
         f"={g0}IF(N({PR})>0,MAX({mn['인쇄 최소금액']},({print_unit(P['yeon'])})*{PR}*{P['yeon']}),0){g1}")
    line(f"파트{idx} 인쇄 판비(CTP)", "인쇄", "도수 × CTP 단가", f"={g0}IF(N({PR})>0,{PR}*{mn['인쇄 판비(CTP, 원/도)']},0){g1}")
    line(f"파트{idx} 코팅", "코팅", "ROUNDUP(전개면적×계수÷1,000,000) × 면수 × 통수",
         f"={g0}IF({YES(A['코팅'])},MAX({mn['코팅 최소금액']},ROUNDUP({P['w']}*{P['h']}*{mn['코팅 계수(전개면적×계수÷1,000,000)']}/1000000,0)"
         f"*IF({A['코팅 면']}=\"양면\",2,1)*{tong}),0){g1}")
    line(f"파트{idx} 톰슨", "후가공", "톰슨단가 × 통수",
         f"={g0}IF({YES(A['톰슨'])},MAX({mn['톰슨 최소금액']},{P['tomson']}*{tong}),0){g1}")

P1 = PART[1]
line("접착", "후가공", "구간단가 × 통수 — 단박스만",
     f'=IF(AND({YES(A["접착"])},{form}="{FORMS[0]}"),MAX({mn["접착 최소금액"]},({adh_f})*{tong}),0)')
line("에폭시 작업비", "특수", "통수 × 통당단가", f"=IF({YES(A['에폭시'])},MAX({mn['에폭시 최소금액']},{tong}*{mn['에폭시 통당 단가']}),0)")
line("에폭시 필름비", "특수", "ROUNDUP(전개면적×계수÷1,000)",
     f"=IF({YES(A['에폭시'])},ROUNDUP({P1['w']}*{P1['h']}*{mn['필름비 계수(전개면적×계수÷1,000)']}/1000,0),0)")
for nm in ("금은박", "형압"):
    line(f"{nm} 작업비", "특수", "통수 × 특수공정단가", f"=IF({YES(A[nm])},MAX({mn['금은박·형압 최소금액']},{tong}*{P1['spec']}),0)")
    line(f"{nm} 필름비", "특수", "ROUNDUP(전개면적×계수÷1,000)",
         f"=IF({YES(A[nm])},ROUNDUP({P1['w']}*{P1['h']}*{mn['필름비 계수(전개면적×계수÷1,000)']}/1000,0),0)")
    line(f"{nm} 동판비", "특수", "고정", f"=IF({YES(A[nm])},{mn['동판비(원, 고정)']},0)")

back_on = f"AND({corr_on}=1,{YES(A['배면 인쇄지'])},{b_ridx}>0)"
BPR = A["배면 인쇄 도수"]
line("배면 원단비", "배면", "배면 지류단가 × 실통수", f"=IF({back_on},ROUND({sheets}*{b_price},0),0)")
line("배면 인쇄", "배면", "도당단가 × 도수 × 배면연수",
     f"=IF(AND({back_on},{YES(A['배면 인쇄'])},N({BPR})>0),MAX({mn['인쇄 최소금액']},({print_unit(b_yeon)})*{BPR}*{b_yeon}),0)")
line("배면 CTP", "배면", "도수 × CTP 단가",
     f"=IF(AND({back_on},{YES(A['배면 인쇄'])},N({BPR})>0),{BPR}*{mn['인쇄 판비(CTP, 원/도)']},0)")
line("배면 코팅", "배면", "ROUNDUP(파트1 전개면적×계수÷1,000,000) × 통수 (단면)",
     f"=IF(AND({back_on},{YES(A['배면 코팅'])}),MAX({mn['코팅 최소금액']},"
     f"ROUNDUP({P1['w']}*{P1['h']}*{mn['코팅 계수(전개면적×계수÷1,000,000)']}/1000000,0)*{tong}),0)")
line("골판지 원단", "골판지", "ROUNDUP(재질단가×전개면적÷1,000,000) × MAX(최소장수, 통수+여분)",
     f"=IF({corr_on}=1,ROUNDUP({H['골판지 재질단가']}*{P1['w']}*{P1['h']}/1000000,0)"
     f"*MAX({mn['골판지 최소 장수']},{tong}+{H['골판지 여분 장수']}),0)")
line("합지", "골판지", "합지단가 × 통수",
     f'=IF({corr_on}=1,IF(IF({A["골판지 합지"]}="2합",{P1["lam2"]},{P1["lam3"]})>0,'
     f'MAX({mn["합지 최소금액"]},ROUND({tong}*IF({A["골판지 합지"]}="2합",{P1["lam2"]},{P1["lam3"]}),0)),0),0)')
cost_bot = row - 1

# ---------- 요약 ----------
row += 1
sub(q, f"A{row}", "■ 견적 요약")
row += 1


def summary(label, formula, fmt=WON, bold=False):
    global row
    q.cell(row, 1, label).font = Font(name=FONT, size=11, bold=True) if bold else Font(name=FONT, size=10)
    c = q.cell(row, 2, formula)
    c.font = Font(name=FONT, size=12, bold=True) if bold else BLACK
    c.number_format = fmt
    c.border = BOX
    if bold:
        c.fill = PatternFill("solid", fgColor="E3F2FD")
    S[label] = f"$B${row}"
    row += 1


summary("제조원가", f"=SUM($D${cost_top}:$D${cost_bot})")
summary("관리비", f"=MAX({mn['관리비 최소금액']},ROUND({S['제조원가']}*{mn['관리비율']},0))")
summary("추가비용", f"=SUM({EXTRA})")
summary("총원가", f"={S['제조원가']}+{S['관리비']}+{S['추가비용']}", bold=True)
summary("개당 원가", f"=IF({QTY}>0,{S['총원가']}/{QTY},0)", bold=True)
summary("적용 마진율", f"=MAX(0,MIN(99,{MRG}))/100", "0.0%")
summary("마진액", f"=MAX({S['총원가']}*{S['적용 마진율']},{mn['마진 최소금액']})")
summary("총 판매금액", f"={S['총원가']}+{S['마진액']}", bold=True)
summary("개당 소비자가", f"=IF({QTY}>0,{S['총 판매금액']}/{QTY},0)", bold=True)
summary("실 마진율", f"=IF({S['총 판매금액']}>0,{S['마진액']}/{S['총 판매금액']},0)", "0.0%")

# ---------- 표준원가 대조 ----------
row += 1
sub(q, f"A{row}", "■ 표준원가 대조 (실제 매입 단가와 비교)")
row += 1
tier_first, tier_last = 19, 19 + len(TIERS) - 1
prod_tier = f"OFFSET(제품목록!$A$1,{PROW}+{prod_top - 2},{tier_first - 1},1,{len(TIERS)})"
lo = calc("표준원가 구간 위치", f"=IF({PROW}=0,0,IFERROR(MATCH({QTY},{R['tier_qty']},1),0))", NUM)
summary("표준원가 (개당, 수량 보간)",
        f'=IF(OR({PROW}=0,{lo}=0,INDEX({prod_tier},1,{lo})=""),"",'
        f'IF({lo}>={len(TIERS)},INDEX({prod_tier},1,{len(TIERS)}),'
        f'IF(INDEX({prod_tier},1,{lo}+1)="",INDEX({prod_tier},1,{lo}),'
        f'INDEX({prod_tier},1,{lo})+(INDEX({prod_tier},1,{lo}+1)-INDEX({prod_tier},1,{lo}))'
        f'*({QTY}-INDEX({R["tier_qty"]},1,{lo}))/(INDEX({R["tier_qty"]},1,{lo}+1)-INDEX({R["tier_qty"]},1,{lo})))))')
summary("산출 ÷ 표준원가",
        f'=IF(N({S["표준원가 (개당, 수량 보간)"]})=0,"",{S["개당 원가"]}/{S["표준원가 (개당, 수량 보간)"]})', "0.00\"배\"")
note(q, f"C{row - 1}", "1.00이면 일치. 실측 중앙값 0.95배(규격 자동선택 기준) — 소량은 과대, 3,000개 이상은 과소 경향")

row += 1
warn = (f'=IF({QTY}=0,"⚠ 제작수량을 입력하세요",'
        f'IF(OR(N({W})=0,N({D})=0,N({Hh})=0),"⚠ 내경을 입력하세요",'
        f'IF({PART[1]["ridx"]}=0,"⚠ 원단1: 이 지종·규격에 단가가 없습니다",'
        f'IF(AND({p2on}=1,{PART[2]["ridx"]}=0),"⚠ 원단2: 이 지종·규격에 단가가 없습니다",'
        f'IF({H["파트1 최소 표준용지"]}="규격초과","⚠ 전개 크기가 최대 표준용지(전지)를 넘습니다 — 특수발주",'
        f'"정상")))))')
q.cell(row, 1, "검증").font = Font(name=FONT, size=10, bold=True)
c = q.cell(row, 2, warn)
c.font = Font(name=FONT, size=11, bold=True, color="C62828")
S["검증"] = f"$B${row}"
row += 2
note(q, f"A{row}", "산식 출처: SCM 대시보드 견적 계산기(index.html qcCalc). 최소금액·계수·구간단가는 모두 «단가표» 시트 셀을 참조합니다.")
note(q, f"A{row + 1}", "규격을 비워두면 전개 크기에 맞는 최소 표준용지를 자동으로 고릅니다 — 실측 대조에서 이것만으로 표준원가 대비 배율 중앙값이 1.75배 → 0.95배로 붙었습니다.")
note(q, f"A{row + 2}", "판걸이(한 장에 몇 개 앉히는지)는 원본 사양에 없어 비우면 1로 계산합니다. 실제 터잡기 수를 넣으면 원단비가 그만큼 나눠집니다.")

# 드롭다운
for ref, src in [(I["제품"], R["prod_names"]),
                 (I["박스 형태"], '"' + ",".join(FORMS) + '"'),
                 (I["원단1 지종"], R["paper_names"]), (I["원단2 지종"], R["paper_names"]), (I["배면 지종"], R["paper_names"]),
                 (I["원단1 규격"], R["size_names"]), (I["원단2 규격"], R["size_names"]), (I["배면 규격"], R["size_names"]),
                 (I["골판지 재질"], R["corr_names"]),
                 (I["골판지 합지"], '"해당없음,2합,3합"'), (I["코팅 면"], '"단면,양면"')] + \
                [(I[k], '"Y,N"') for k in ["코팅", "접착", "톰슨", "금은박", "형압", "에폭시",
                                            "배면 인쇄지", "배면 인쇄", "배면 코팅"]]:
    dv = DataValidation(type="list", formula1=src, allow_blank=True)
    q.add_data_validation(dv)
    dv.add(q[ref.replace("$", "")])

q.column_dimensions["A"].width = 26
q.column_dimensions["B"].width = 30
q.column_dimensions["C"].width = 16
q.column_dimensions["D"].width = 18
q.column_dimensions["E"].width = 44
q.freeze_panes = "A4"

out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "패키지_견적계산기.xlsx"
out.parent.mkdir(parents=True, exist_ok=True)
wb.save(out)
(out.parent / (out.stem + "_cells.json")).write_text(
    json.dumps({"input": {k: v.replace("$", "") for k, v in I.items()},
                "applied": {k: v.replace("$", "") for k, v in A.items()},
                "summary": {k: v.replace("$", "") for k, v in S.items()},
                "helper": {k: v.replace("$", "") for k, v in H.items()},
                "extras_first_row": ex_top,
                "products": [p["파츠명"] for p in usable]}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"saved: {out}  (제품 {len(usable)}종 산출가능 / 미매핑 {len(blocked)}종)")
