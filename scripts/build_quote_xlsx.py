"""패키지 견적 계산기 — 수식 엑셀(.xlsx) 생성기.

대시보드(index.html)의 견적 계산기와 같은 산식을 매크로 없이 엑셀 수식만으로 옮긴다.
단가표·구간표는 index.html에서 뽑아 둔 scripts/quote_constants.json을 그대로 쓴다
(복붙본을 두면 대시보드와 갈라지므로, 단가가 바뀌면 JSON을 다시 뽑아 이 스크립트를 돌린다).

  python scripts/build_quote_xlsx.py            # → docs/패키지_견적계산기.xlsx
  python scripts/build_quote_xlsx.py out.xlsx

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

SIZES = C["QC_SIZE_ORDER"]          # 작은 규격 → 큰 규격 (자동상향 순서)
PAPERS = list(C["QC_PAPER_PRICES"])  # 27 지종
COLS = C["QC_SIZE_COLS"]             # 원본 단가 배열의 컬럼 순서
STD = C["QC_PAPER_STD"]              # 표준용지 10종 (면적 오름차순)
CORR = C["QC_CORR_PRICES"]
FORMS = C["QC_FORM_TYPES"]
CORR_APPLY = C["QC_CORR_APPLY"]

FONT = "맑은 고딕"  # 한글 문서라 Arial 대신 사용 — Arial은 한글이 폰트 폴백으로 렌더된다
INPUT_FILL = PatternFill("solid", fgColor="FFF9C4")   # 노랑 = 입력 칸
LOOKUP_FILL = PatternFill("solid", fgColor="E8EAF6")  # 남보라 = 단가표(고치면 전체 반영)
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


# ============================== 단가표 시트 ==============================
wb = Workbook()
lk = wb.active
lk.title = "단가표"
R = {}  # 이름 → 행/범위 참조

title(lk, "A1", "지류·공정 단가표 — 단가가 바뀌면 이 시트만 고치면 견적 시트가 따라옵니다")
note(lk, "A2", f"출처: SCM 대시보드 견적 계산기(외주버전 v1.2.2 단가표) · 생성 {date.today()} · 값은 전부 대시보드와 동일")

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
for i, p in enumerate(PAPERS):
    lk.cell(price_top + i, 1, p).font = BLACK
    row_vals = C["QC_PAPER_PRICES"][p]
    for j, s in enumerate(SIZES):
        v = row_vals[COLS.index(s)]
        c = lk.cell(price_top + i, 2 + j, v)
        c.font = BLUE
        c.number_format = NUM2
price_bot = price_top + len(PAPERS) - 1
R["price"] = f"단가표!$B${price_top}:$P${price_bot}"
R["paper_names"] = f"단가표!$A${price_top}:$A${price_bot}"
R["size_names"] = f"단가표!$B${head_row}:$P${head_row}"
note(lk, f"A{price_bot + 1}", "0 = 그 규격 단가 없음 → 아래 ②에서 다음 큰 규격으로 자동 상향됩니다.")

r = price_bot + 3
for label, key in [("대판여부 (1=대판, 연수 500 기준)", "big"),
                   ("톰슨 단가 (원/통)", "tomson"),
                   ("특수공정 단가 (원/통)", "spec"),
                   ("합지 2합 (원/통)", "lam2"),
                   ("합지 3합 (원/통)", "lam3")]:
    lk.cell(r, 1, label).font = Font(name=FONT, size=10, bold=True)
    for j, s in enumerate(SIZES):
        if key == "big":
            v = 1 if s in C["QC_BIG_SIZES"] else 0
        elif key == "tomson":
            v = dict(C["tomson"])[s]
        elif key == "spec":
            v = dict(C["spec"])[s]
        else:
            v = C["lam"][s][0 if key == "lam2" else 1]
        cc = lk.cell(r, 2 + j, v)
        cc.font = BLUE
        cc.number_format = NUM
    R[key] = f"단가표!$B${r}:$P${r}"
    r += 1

r += 1
sub(lk, f"A{r}", "② 규격 자동상향 — 선택 규격의 단가가 0이면 다음 큰 규격의 열번호를 돌려줍니다 (수식, 직접 고치지 마세요)")
r += 1
res_head = r
lk.cell(res_head, 1, "지종").font = Font(name=FONT, size=10, bold=True)
for j, s in enumerate(SIZES):
    c = lk.cell(res_head, 2 + j, s)
    c.font = Font(name=FONT, size=9, bold=True)
    c.alignment = Alignment(horizontal="center", wrap_text=True)
res_top = res_head + 1
for i in range(len(PAPERS)):
    lk.cell(res_top + i, 1, f"={R['paper_names'].split('!')[0]}!A{price_top + i}").font = GREEN
    for j in range(len(SIZES) - 1, -1, -1):
        col = get_column_letter(2 + j)
        nxt = get_column_letter(3 + j)
        tail = "0" if j == len(SIZES) - 1 else f"{nxt}{res_top + i}"
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
sub(lk, f"A{r}", "④ 표준용지 (전개 사이즈가 들어가는지 판정용 · 면적 오름차순)")
r += 1
lk.cell(r, 1, "규격").font = Font(name=FONT, size=10, bold=True)
lk.cell(r, 2, "가로(mm)").font = Font(name=FONT, size=10, bold=True)
lk.cell(r, 3, "세로(mm)").font = Font(name=FONT, size=10, bold=True)
r += 1
std_top = r
for s in STD:
    lk.cell(r, 1, s["name"]).font = BLACK
    lk.cell(r, 2, s["w"]).font = BLUE
    lk.cell(r, 3, s["h"]).font = BLUE
    r += 1
std_bot = r - 1
R["std_names"] = f"단가표!$A${std_top}:$A${std_bot}"
R["std_w"] = f"단가표!$B${std_top}:$B${std_bot}"
R["std_h"] = f"단가표!$C${std_top}:$C${std_bot}"

r += 1
sub(lk, f"A{r}", "⑤ 구간 단가 · 최소금액 · 계수")
r += 1


def kv_block(header, pairs, unit_a, unit_b):
    """(구간, 값) 표를 세로로 쓰고 각 값 셀의 A1 참조 리스트를 돌려준다."""
    global r
    lk.cell(r, 1, header).font = Font(name=FONT, size=10, bold=True)
    lk.cell(r, 2, unit_a).font = Font(name=FONT, size=9, bold=True)
    lk.cell(r, 3, unit_b).font = Font(name=FONT, size=9, bold=True)
    r += 1
    refs = []
    for a, b in pairs:
        lk.cell(r, 1, "").font = BLACK
        lk.cell(r, 2, a).font = BLUE
        lk.cell(r, 3, b).font = BLUE
        lk.cell(r, 2).number_format = NUM
        lk.cell(r, 3).number_format = NUM
        refs.append((f"단가표!$B${r}", f"단가표!$C${r}"))
        r += 1
    r += 1
    return refs


loss_refs = kv_block("여분(로스) 장수", [(500, 200), (5000, 300), (10000, 500), (20000, 700), (0, 1000)],
                     "수량 이하", "여분 장수")
print_refs = kv_block("인쇄 도당단가", [(2, 12000), (5, 10000), (10, 9000), (15, 8000), (20, 7000), (30, 6000), (0, 5000)],
                      "연수", "원/도/연")
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
for row in lk.iter_rows():
    for c in row:
        if c.font is None or c.font.name is None:
            c.font = BLACK

# ============================== 견적계산기 시트 ==============================
q = wb.create_sheet("견적계산기", 0)
title(q, "A1", "패키지 견적 계산기", 15)
note(q, "A2", "노란 칸만 입력하세요. 나머지는 전부 수식입니다. 단가를 바꾸려면 «단가표» 시트를 고치면 됩니다. — 매크로 없음")

I = {}  # 입력 라벨 → 셀 참조
row = 4
sub(q, f"A{row}", "■ 입력")
row += 1


def inp(label, value, fmt=None, hint=""):
    global row
    q.cell(row, 1, label).font = Font(name=FONT, size=10, bold=True)
    c = q.cell(row, 2, value)
    c.font = BLUE
    c.fill = INPUT_FILL
    c.border = BOX
    if fmt:
        c.number_format = fmt
    if hint:
        note(q, f"C{row}", hint)
    ref = f"$B${row}"
    I[label] = ref
    row += 1
    return ref


inp("견적서 이름", "예) 차병원 타투스티커 패키지")
inp("박스 형태", FORMS[0], hint="드롭다운")
inp("내경 가로 W (mm)", 100, NUM)
inp("내경 세로 D (mm)", 80, NUM)
inp("내경 높이 H (mm)", 60, NUM)
inp("제작수량 (EA)", 1000, NUM)
inp("판걸이", 1, NUM, "1이면 1통=1개")
inp("원단1 지종", "sc350g", hint="드롭다운")
inp("원단1 규격", "국전", hint="단가 0이면 자동 상향")
inp("원단2 지종", "sc300g", hint="파트가 2개인 형태만 사용")
inp("원단2 규격", "국전")
inp("인쇄", "Y", hint="Y / N")
inp("인쇄 도수", 4, NUM)
inp("코팅", "N", hint="Y / N")
inp("코팅 면", "단면", hint="단면 / 양면")
inp("톰슨", "N", hint="Y / N")
inp("접착", "N", hint="Y / N — 단박스만 적용")
inp("에폭시", "N", hint="Y / N")
inp("금은박", "N", hint="Y / N")
inp("형압", "N", hint="Y / N")
inp("골판지 합지", "해당없음", hint="해당없음 / 2합 / 3합")
inp("골판지 재질", "SK B")
inp("배면 인쇄지", "N", hint="Y / N — 골판지 합지 적용 시만")
inp("배면 지종", "sc240g")
inp("배면 규격", "국전")
inp("배면 인쇄", "N", hint="Y / N")
inp("배면 인쇄 도수", 1, NUM)
inp("배면 코팅", "N", hint="Y / N — 단면 기준")
inp("마진율 (%)", 30, NUM, "0~99, 최소 마진 20만원")

row += 1
sub(q, f"A{row}", "■ 추가비용 (수작업·포장·배송 등)")
row += 1
q.cell(row, 1, "항목").font = Font(name=FONT, size=10, bold=True)
q.cell(row, 2, "수량").font = Font(name=FONT, size=10, bold=True)
q.cell(row, 3, "단가").font = Font(name=FONT, size=10, bold=True)
q.cell(row, 4, "금액").font = Font(name=FONT, size=10, bold=True)
row += 1
ex_top = row
for lbl in ["수작업", "포장", "배송비", "기타"]:
    q.cell(row, 1, lbl).font = BLUE
    q.cell(row, 1).fill = INPUT_FILL
    for cc in (2, 3):
        c = q.cell(row, cc, 0)
        c.font = BLUE
        c.fill = INPUT_FILL
        c.border = BOX
        c.number_format = NUM
    c = q.cell(row, 4, f"=B{row}*C{row}")
    c.number_format = WON
    c.font = BLACK
    row += 1
ex_bot = row - 1
EXTRA = f"$D${ex_top}:$D${ex_bot}"

# ---------- 보조 계산 ----------
row += 1
sub(q, f"A{row}", "■ 보조 계산 (자동)")
row += 1
H = {}


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


qty, gan = I["제작수량 (EA)"], I["판걸이"]
W, D, Hh = I["내경 가로 W (mm)"], I["내경 세로 D (mm)"], I["내경 높이 H (mm)"]
form = I["박스 형태"]

calc("통수", f"=IF({gan}<1,{qty},{qty}/MAX(1,{gan}))", NUM2)
tong = H["통수"]
loss_f = f"IF({qty}<={loss_refs[0][0]},{loss_refs[0][1]},IF({qty}<={loss_refs[1][0]},{loss_refs[1][1]}," \
         f"IF({qty}<={loss_refs[2][0]},{loss_refs[2][1]},IF({qty}<={loss_refs[3][0]},{loss_refs[3][1]},{loss_refs[4][1]}))))"
calc("여분(로스) 장수", f"={loss_f}", NUM)
calc("실통수 (통수+여분)", f"={tong}+{H['여분(로스) 장수']}", NUM2)
sheets = H["실통수 (통수+여분)"]

# 전개사이즈 — 박스 형태별
f1w = (f'=IF({form}="{FORMS[0]}",({W}+{D})*2+50,'
       f'IF({form}="{FORMS[1]}",{W}+{Hh}*4+72,'
       f'IF({form}="{FORMS[2]}",{W}+{Hh}*4+60,{W}+30)))')
f1h = (f'=IF({form}="{FORMS[0]}",{D}*2+{Hh}+70,'
       f'IF({form}="{FORMS[1]}",{D}+{Hh}*4+72,'
       f'IF({form}="{FORMS[2]}",{D}*2+{Hh}*3+60,({D}+{Hh})*2+50)))')
calc("파트1 전개 가로 (mm)", f1w, NUM)
calc("파트1 전개 세로 (mm)", f1h, NUM)
calc("파트2 사용여부", f'=IF(OR({form}="{FORMS[1]}",{form}="{FORMS[3]}"),1,0)', NUM,
     "테일러드 스트랩 박스 커스텀 / open페이퍼박스·motion박스만 파트 2개")
p2on = H["파트2 사용여부"]
calc("파트2 전개 가로 (mm)", f"=IF({p2on}=0,0,{W}+{Hh}*4+70)", NUM)
calc("파트2 전개 세로 (mm)", f"=IF({p2on}=0,0,{D}+{Hh}*4+70)", NUM)

PART = {}
for idx, (pt, ps) in enumerate([("원단1 지종", "원단1 규격"), ("원단2 지종", "원단2 규격")], start=1):
    pw, ph = H[f"파트{idx} 전개 가로 (mm)"], H[f"파트{idx} 전개 세로 (mm)"]
    prow = calc(f"파트{idx} 지종 행번호", f"=IFERROR(MATCH({I[pt]},{R['paper_names']},0),0)", NUM)
    pcol = calc(f"파트{idx} 선택규격 열번호", f"=IFERROR(MATCH({I[ps]},{R['size_names']},0),0)", NUM)
    ridx = calc(f"파트{idx} 적용규격 열번호",
                f"=IF(OR({prow}=0,{pcol}=0),0,INDEX({R['resolve']},{prow},{pcol}))", NUM,
                "선택 규격 단가가 0이면 다음 큰 규격")
    calc(f"파트{idx} 적용규격", f'=IF({ridx}=0,"단가없음",INDEX({R["size_names"]},1,{ridx}))')
    price = calc(f"파트{idx} 지류단가 (원/장)",
                 f"=IF({ridx}=0,0,INDEX({R['price']},{prow},{ridx}))", NUM2)
    big = calc(f"파트{idx} 대판여부", f"=IF({ridx}=0,0,INDEX({R['big']},1,{ridx}))", NUM)
    yeon = calc(f"파트{idx} 연수", f"=MAX(1,ROUND({tong}/IF({big}=1,500,1000)*2,0)/2)", "0.0")
    tu = calc(f"파트{idx} 톰슨단가", f"=IF({ridx}=0,0,INDEX({R['tomson']},1,{ridx}))", NUM)
    su = calc(f"파트{idx} 특수공정단가", f"=IF({ridx}=0,0,INDEX({R['spec']},1,{ridx}))", NUM)
    l2 = calc(f"파트{idx} 합지2합단가", f"=IF({ridx}=0,0,INDEX({R['lam2']},1,{ridx}))", NUM)
    l3 = calc(f"파트{idx} 합지3합단가", f"=IF({ridx}=0,0,INDEX({R['lam3']},1,{ridx}))", NUM)
    PART[idx] = dict(w=pw, h=ph, price=price, yeon=yeon, tomson=tu, spec=su, lam2=l2, lam3=l3, ridx=ridx)

# 배면 인쇄지
b_prow = calc("배면 지종 행번호", f"=IFERROR(MATCH({I['배면 지종']},{R['paper_names']},0),0)", NUM)
b_pcol = calc("배면 선택규격 열번호", f"=IFERROR(MATCH({I['배면 규격']},{R['size_names']},0),0)", NUM)
b_ridx = calc("배면 적용규격 열번호", f"=IF(OR({b_prow}=0,{b_pcol}=0),0,INDEX({R['resolve']},{b_prow},{b_pcol}))", NUM)
b_price = calc("배면 지류단가 (원/장)", f"=IF({b_ridx}=0,0,INDEX({R['price']},{b_prow},{b_ridx}))", NUM2)
b_big = calc("배면 대판여부", f"=IF({b_ridx}=0,0,INDEX({R['big']},1,{b_ridx}))", NUM)
b_yeon = calc("배면 연수", f"=MAX(1,ROUND({tong}/IF({b_big}=1,500,1000)*2,0)/2)", "0.0")

# 표준용지 추천 (규격 초과 경고용)
for idx in (1, 2):
    pw, ph = PART[idx]["w"], PART[idx]["h"]
    q.cell(row, 1, f"파트{idx} 표준용지 수용 판정").font = Font(name=FONT, size=10)
    fit_top = row
    for k in range(len(STD)):
        sw = f"단가표!$B${std_top + k}"
        sh = f"단가표!$C${std_top + k}"
        c = q.cell(row, 3 + k, f"=IF(OR(AND({pw}<={sw},{ph}<={sh}),AND({pw}<={sh},{ph}<={sw})),1,0)")
        c.font = BLACK
        c.number_format = NUM
    fit_rng = f"$D${fit_top}:${get_column_letter(3 + len(STD) - 1)}${fit_top}"
    row += 1
    calc(f"파트{idx} 최소 표준용지",
         f'=IF(AND({idx}=2,{p2on}=0),"—",IFERROR(INDEX({R["std_names"]},MATCH(1,{fit_rng},0)),"규격초과"))')

# 인쇄 도당단가 (연수 구간)
def print_unit(yeon_ref):
    f = f"{print_refs[6][1]}"
    for a, b in reversed(print_refs[1:6]):
        f = f"IF({yeon_ref}<={a},{b},{f})"
    return f"IF({yeon_ref}<{print_refs[0][0]},{print_refs[0][1]},{f})"


adh_f = (f"IF({tong}<={adh_refs[0][0]},{adh_refs[0][1]},IF({tong}<={adh_refs[1][0]},{adh_refs[1][1]},"
         f"IF({tong}<{adh_refs[2][0]},{adh_refs[2][1]},{adh_refs[3][1]})))")
corr_loss_f = (f"IF({qty}<{cl_refs[0][0]},{cl_refs[0][1]},IF({qty}<{cl_refs[1][0]},{cl_refs[1][1]},"
               f"IF({qty}<{cl_refs[2][0]},{cl_refs[2][1]},{cl_refs[3][1]})))")
calc("골판지 여분 장수", f"={corr_loss_f}", NUM)
calc("골판지 재질단가", f"=IFERROR(INDEX({R['corr_prices']},MATCH({I['골판지 재질']},{R['corr_names']},0)),0)", NUM)
calc("골판지 적용여부",
     f'=IF(AND({I["골판지 합지"]}<>"해당없음",OR(' +
     ",".join(f'{form}="{t}"' for t in CORR_APPLY) + f'),{H["골판지 재질단가"]}>0),1,0)', NUM)
corr_on = H["골판지 적용여부"]

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
YES = lambda ref: f'UPPER(LEFT({ref},1))="Y"'


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


mn = K  # 최소금액·계수
for idx in (1, 2):
    P = PART[idx]
    gate = "" if idx == 1 else f"IF({p2on}=0,0,"
    end = "" if idx == 1 else ")"
    line(f"파트{idx} 원단비", "원단", f"지류단가 × 실통수",
         f"={gate}ROUND({sheets}*{P['price']},0){end}")
    line(f"파트{idx} 인쇄 작업비", "인쇄", "도당단가 × 도수 × 연수 (최소금액 적용)",
         f"={gate}IF(AND({YES(I['인쇄'])},{I['인쇄 도수']}>0),MAX({mn['인쇄 최소금액']},({print_unit(P['yeon'])})*{I['인쇄 도수']}*{P['yeon']}),0){end}")
    line(f"파트{idx} 인쇄 판비(CTP)", "인쇄", "도수 × CTP 단가",
         f"={gate}IF(AND({YES(I['인쇄'])},{I['인쇄 도수']}>0),{I['인쇄 도수']}*{mn['인쇄 판비(CTP, 원/도)']},0){end}")
    line(f"파트{idx} 코팅", "코팅", "ROUNDUP(전개면적×계수÷1,000,000) × 면수 × 통수",
         f"={gate}IF({YES(I['코팅'])},MAX({mn['코팅 최소금액']},ROUNDUP({P['w']}*{P['h']}*{mn['코팅 계수(전개면적×계수÷1,000,000)']}/1000000,0)"
         f"*IF({I['코팅 면']}=\"양면\",2,1)*{tong}),0){end}")
    line(f"파트{idx} 톰슨", "후가공", "톰슨단가 × 통수",
         f"={gate}IF({YES(I['톰슨'])},MAX({mn['톰슨 최소금액']},{P['tomson']}*{tong}),0){end}")

P1 = PART[1]
line("접착", "후가공", "구간단가 × 통수 — 단박스만",
     f'=IF(AND({YES(I["접착"])},{form}="{FORMS[0]}"),MAX({mn["접착 최소금액"]},({adh_f})*{tong}),0)')
line("에폭시 작업비", "특수", "통수 × 통당단가",
     f"=IF({YES(I['에폭시'])},MAX({mn['에폭시 최소금액']},{tong}*{mn['에폭시 통당 단가']}),0)")
line("에폭시 필름비", "특수", "ROUNDUP(전개면적×계수÷1,000)",
     f"=IF({YES(I['에폭시'])},ROUNDUP({P1['w']}*{P1['h']}*{mn['필름비 계수(전개면적×계수÷1,000)']}/1000,0),0)")
for nm, key in [("금은박", "금은박"), ("형압", "형압")]:
    line(f"{nm} 작업비", "특수", "통수 × 특수공정단가",
         f"=IF({YES(I[key])},MAX({mn['금은박·형압 최소금액']},{tong}*{P1['spec']}),0)")
    line(f"{nm} 필름비", "특수", "ROUNDUP(전개면적×계수÷1,000)",
         f"=IF({YES(I[key])},ROUNDUP({P1['w']}*{P1['h']}*{mn['필름비 계수(전개면적×계수÷1,000)']}/1000,0),0)")
    line(f"{nm} 동판비", "특수", "고정",
         f"=IF({YES(I[key])},{mn['동판비(원, 고정)']},0)")

back_on = f"AND({corr_on}=1,{YES(I['배면 인쇄지'])},{b_ridx}>0)"
line("배면 원단비", "배면", "배면 지류단가 × 실통수",
     f"=IF({back_on},ROUND({sheets}*{b_price},0),0)")
line("배면 인쇄", "배면", "도당단가 × 도수 × 배면연수",
     f"=IF(AND({back_on},{YES(I['배면 인쇄'])},{I['배면 인쇄 도수']}>0),"
     f"MAX({mn['인쇄 최소금액']},({print_unit(b_yeon)})*{I['배면 인쇄 도수']}*{b_yeon}),0)")
line("배면 CTP", "배면", "도수 × CTP 단가",
     f"=IF(AND({back_on},{YES(I['배면 인쇄'])},{I['배면 인쇄 도수']}>0),{I['배면 인쇄 도수']}*{mn['인쇄 판비(CTP, 원/도)']},0)")
line("배면 코팅", "배면", "ROUNDUP(파트1 전개면적×계수÷1,000,000) × 통수 (단면)",
     f"=IF(AND({back_on},{YES(I['배면 코팅'])}),MAX({mn['코팅 최소금액']},"
     f"ROUNDUP({P1['w']}*{P1['h']}*{mn['코팅 계수(전개면적×계수÷1,000,000)']}/1000000,0)*{tong}),0)")
line("골판지 원단", "골판지", "ROUNDUP(재질단가×전개면적÷1,000,000) × MAX(최소장수, 통수+여분)",
     f"=IF({corr_on}=1,ROUNDUP({H['골판지 재질단가']}*{P1['w']}*{P1['h']}/1000000,0)"
     f"*MAX({mn['골판지 최소 장수']},{tong}+{H['골판지 여분 장수']}),0)")
line("합지", "골판지", "합지단가 × 통수",
     f'=IF({corr_on}=1,IF(IF({I["골판지 합지"]}="2합",{P1["lam2"]},{P1["lam3"]})>0,'
     f'MAX({mn["합지 최소금액"]},ROUND({tong}*IF({I["골판지 합지"]}="2합",{P1["lam2"]},{P1["lam3"]}),0)),0),0)')
cost_bot = row - 1

# ---------- 요약 ----------
row += 1
sub(q, f"A{row}", "■ 견적 요약")
row += 1
S = {}


def summary(label, formula, fmt=WON, bold=False):
    global row
    c0 = q.cell(row, 1, label)
    c0.font = Font(name=FONT, size=11, bold=True) if bold else Font(name=FONT, size=10)
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
summary("개당 원가", f"=IF({qty}>0,{S['총원가']}/{qty},0)", bold=True)
summary("적용 마진율", f"=MAX(0,MIN(99,{I['마진율 (%)']}))/100", "0.0%")
summary("마진액", f"=MAX({S['총원가']}*{S['적용 마진율']},{mn['마진 최소금액']})")
summary("총 판매금액", f"={S['총원가']}+{S['마진액']}", bold=True)
summary("개당 소비자가", f"=IF({qty}>0,{S['총 판매금액']}/{qty},0)", bold=True)
summary("실 마진율", f"=IF({S['총 판매금액']}>0,{S['마진액']}/{S['총 판매금액']},0)", "0.0%")

row += 1
warn = (f'=IF({qty}=0,"⚠ 제작수량을 입력하세요",'
        f'IF(OR({W}=0,{D}=0,{Hh}=0),"⚠ 내경을 입력하세요",'
        f'IF({PART[1]["ridx"]}=0,"⚠ 원단1: 선택한 규격 이상에 단가가 없습니다",'
        f'IF(AND({p2on}=1,{PART[2]["ridx"]}=0),"⚠ 원단2: 선택한 규격 이상에 단가가 없습니다",'
        f'IF(OR({H["파트1 최소 표준용지"]}="규격초과",{H["파트2 최소 표준용지"]}="규격초과"),'
        f'"⚠ 전개 사이즈가 최대 표준용지(전지)를 넘습니다","정상")))))')
q.cell(row, 1, "검증").font = Font(name=FONT, size=10, bold=True)
c = q.cell(row, 2, warn)
c.font = Font(name=FONT, size=11, bold=True, color="C62828")
row += 2
note(q, f"A{row}", "산식 출처: SCM 대시보드 견적 계산기(index.html qcCalc) — 최소금액·계수·구간단가는 모두 «단가표» 시트 셀을 참조합니다.")
note(q, f"A{row + 1}", "매크로(VBA)를 쓰지 않습니다. 파일을 열자마자 계산되며 Google Sheets·Mac Numbers에서도 동작합니다.")

# 드롭다운
for cell_ref, src in [(I["박스 형태"], '"' + ",".join(FORMS) + '"'),
                      (I["원단1 지종"], R["paper_names"]), (I["원단2 지종"], R["paper_names"]),
                      (I["배면 지종"], R["paper_names"]),
                      (I["원단1 규격"], R["size_names"]), (I["원단2 규격"], R["size_names"]),
                      (I["배면 규격"], R["size_names"]),
                      (I["골판지 재질"], R["corr_names"]),
                      (I["골판지 합지"], '"해당없음,2합,3합"'), (I["코팅 면"], '"단면,양면"')] + \
                     [(I[k], '"Y,N"') for k in ["인쇄", "코팅", "톰슨", "접착", "에폭시", "금은박", "형압",
                                                 "배면 인쇄지", "배면 인쇄", "배면 코팅"]]:
    dv = DataValidation(type="list", formula1=src, allow_blank=False)
    q.add_data_validation(dv)
    dv.add(q[cell_ref.replace("$", "")])

q.column_dimensions["A"].width = 30
q.column_dimensions["B"].width = 22
q.column_dimensions["C"].width = 46
q.column_dimensions["D"].width = 16
q.freeze_panes = "A4"

out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "docs" / "패키지_견적계산기.xlsx"
out.parent.mkdir(parents=True, exist_ok=True)
wb.save(out)
# 셀 주소 맵 — test_quote_xlsx.py가 이 파일을 보고 입력/결과 셀을 찾는다(주소 하드코딩 방지)
(out.parent / (out.stem + "_cells.json")).write_text(
    json.dumps({"input": {k: v.replace("$", "") for k, v in I.items()},
                "summary": {k: v.replace("$", "") for k, v in S.items()},
                "helper": {k: v.replace("$", "") for k, v in H.items()},
                "extras_first_row": ex_top}, ensure_ascii=False, indent=1), encoding="utf-8")
print(f"saved: {out}")
