"""수식 엑셀 견적서가 대시보드 계산기와 같은 값을 내는지 검증한다.

실제 Excel(COM)로 워크북을 열어 시나리오별 입력을 써 넣고 재계산시킨 뒤,
index.html에서 그대로 뽑아낸 qcCalc()의 결과와 대조한다. 수식이 «에러 없이 계산된다»가
아니라 «대시보드와 같은 숫자가 나온다»를 본다.

  python test_quote_xlsx.py            # docs/패키지_견적계산기.xlsx 검증
  python test_quote_xlsx.py 파일.xlsx

Excel이 없는 환경에서는 SKIP으로 끝난다(수식 검증은 Excel 없이는 불가능).
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

sys.stdout.reconfigure(encoding="utf-8", errors="replace")  # 콘솔 기본이 cp949라 한글·—가 깨진다

ROOT = Path(__file__).resolve().parent
XLSX = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else ROOT / "docs" / "패키지_견적계산기.xlsx"
CELLS = json.loads((XLSX.parent / (XLSX.stem + "_cells.json")).read_text(encoding="utf-8"))

FORMS = json.loads((ROOT / "scripts" / "quote_constants.json").read_text(encoding="utf-8"))["QC_FORM_TYPES"]
Y = lambda b: "Y" if b else "N"

# (설명, 대시보드 qcCalc 입력) — 엑셀 입력은 아래 to_sheet()가 같은 값에서 만든다
SCENARIOS = [
    ("단박스 · 인쇄 4도", dict(type=FORMS[0], width=100, depth=80, height=60, qty=1000, ganjuk=1,
                             paperType1="sc350g", paperSize1="국전", print=True, printColors=4, margin=30)),
    ("테일러드(2파트) · 인쇄+양면코팅+톰슨", dict(type=FORMS[1], width=150, depth=120, height=70, qty=3000, ganjuk=1,
                                        paperType1="sc300g", paperSize1="2절", paperType2="sc260g", paperSize2="국전",
                                        print=True, printColors=2, coating=True, coatingType="양면", tomson=True, margin=25)),
    ("SolidG · 골판지 2합 + 배면 인쇄지 전체", dict(type=FORMS[2], width=200, depth=150, height=80, qty=5000, ganjuk=1,
                                          paperType1="riv300g", paperSize1="전지", print=True, printColors=4,
                                          corrType="2합", corrMat="SK B", backPaperOn=True, backPaperType="sc240g",
                                          backPaperSize="국전", backPrint=True, backPrintColors=1, backCoating=True, margin=20)),
    ("open페이퍼박스/motion박스 · 에폭시+금은박+형압", dict(type=FORMS[3], width=90, depth=70, height=50, qty=2000, ganjuk=1,
                                                paperType1="문보드310g", paperSize1="국전", paperType2="sc300g",
                                                paperSize2="국2절", print=True, printColors=1,
                                                epoxy=True, foil=True, emboss=True, margin=40)),
    ("단박스 · 접착 + 추가비용 + 마진 0(최소 20만 발동)", dict(type=FORMS[0], width=120, depth=100, height=90, qty=800, ganjuk=1,
                                                 paperType1="sc400g", paperSize1="국전", print=True, printColors=4,
                                                 adhesive=True, margin=0,
                                                 extras=[{"label": "수작업", "on": True, "qty": 800, "price": 300},
                                                         {"label": "포장", "on": True, "qty": 800, "price": 150}])),
    ("대량 5만개 · 판걸이 2 (여분 1000 · 인쇄 최저구간)", dict(type=FORMS[0], width=80, depth=60, height=40, qty=50000, ganjuk=2,
                                                 paperType1="sc260g", paperSize1="전지", print=True, printColors=4, margin=15)),
    ("규격 자동상향 · sc240g 8절(단가 0) → 4절", dict(type=FORMS[0], width=100, depth=80, height=60, qty=1000, ganjuk=1,
                                             paperType1="sc240g", paperSize1="8절", print=True, printColors=4, margin=30)),
    ("규격 자동상향 · sc240g 소국2절(0) → 국2절", dict(type=FORMS[0], width=100, depth=80, height=60, qty=1200, ganjuk=1,
                                              paperType1="sc240g", paperSize1="소국2절", print=True, printColors=2,
                                              coating=True, coatingType="단면", margin=35)),
    ("골판지 3합 · 하드롱 규격", dict(type=FORMS[1], width=250, depth=180, height=100, qty=1500, ganjuk=1,
                              paperType1="ab라이트325g", paperSize1="하드롱2절", paperType2="sc300g", paperSize2="국전",
                              print=True, printColors=4, tomson=True, corrType="3합", corrMat="KLB CK", margin=28)),
]


def to_sheet(s):
    """qcCalc 입력 → 엑셀 입력 셀 값"""
    ex = s.get("extras") or []
    ex = {e["label"]: e for e in ex if e.get("on")}
    return {
        "박스 형태": s["type"],
        "내경 가로 W (mm)": s["width"], "내경 세로 D (mm)": s["depth"], "내경 높이 H (mm)": s["height"],
        "제작수량 (EA)": s["qty"], "판걸이": s.get("ganjuk", 1),
        "원단1 지종": s.get("paperType1", "sc350g"), "원단1 규격": s.get("paperSize1", "국전"),
        "원단2 지종": s.get("paperType2") or s.get("paperType1", "sc350g"),
        "원단2 규격": s.get("paperSize2") or s.get("paperSize1", "국전"),
        "인쇄 도수": (s.get("printColors", 0) or 0) if s.get("print") else 0,
        "코팅": Y(s.get("coating")), "코팅 면": s.get("coatingType") or "단면",
        "톰슨": Y(s.get("tomson")), "접착": Y(s.get("adhesive")),
        "에폭시": Y(s.get("epoxy")), "금은박": Y(s.get("foil")), "형압": Y(s.get("emboss")),
        "골판지 합지": s.get("corrType") or "해당없음", "골판지 재질": s.get("corrMat") or "SK B",
        "배면 인쇄지": Y(s.get("backPaperOn")), "배면 지종": s.get("backPaperType") or "sc240g",
        "배면 규격": s.get("backPaperSize") or "국전",
        "배면 인쇄": Y(s.get("backPrint")), "배면 인쇄 도수": s.get("backPrintColors", 1) or 1,
        "배면 코팅": Y(s.get("backCoating")), "마진율 (%)": s.get("margin", 0),
    }, ex


# ---- 대시보드 기준값 (index.html qcCalc 원문) ----
payload = json.dumps([s for _, s in SCENARIOS], ensure_ascii=False)
proc = subprocess.run(["node", str(ROOT / "scripts" / "qc_engine_export.mjs")],
                      input=payload.encode("utf-8"), capture_output=True)
if proc.returncode != 0:
    sys.exit("qc_engine_export.mjs 실패:\n" + proc.stderr.decode("utf-8", "replace"))
expected = json.loads(proc.stdout.decode("utf-8"))

# ---- 엑셀 실측 ----
try:
    import win32com.client as win32
except ImportError:
    sys.exit("SKIP — pywin32 없음 (pip install pywin32). 수식 검증은 Excel 없이 불가능합니다.")

try:
    # DispatchEx = 새 인스턴스. Dispatch는 사용자가 쓰고 있는 Excel에 붙어버려서,
    # 그 창을 숨기려다 COM 오류가 나거나 사용자 작업을 방해한다.
    app = win32.DispatchEx("Excel.Application")
except Exception as e:  # noqa: BLE001
    sys.exit(f"SKIP — Excel을 열 수 없습니다: {e}")

for prop, value in (("Visible", False), ("DisplayAlerts", False)):
    try:
        setattr(app, prop, value)
    except Exception:  # noqa: BLE001 — 인스턴스 상태에 따라 거부될 수 있으나 계산에는 지장 없다
        pass
fails, checked = [], 0
# 원본이 엑셀에 열려 있으면 읽기 전용으로 잡혀 셀 쓰기가 COM 오류로 죽는다 — 사본으로 돌린다
tmp = Path(tempfile.gettempdir()) / f"_quote_test_{os.getpid()}.xlsx"
shutil.copyfile(XLSX, tmp)
try:
    wb = app.Workbooks.Open(str(tmp))
    ws = wb.Worksheets("견적계산기")
    for (desc, s), exp in zip(SCENARIOS, expected):
        vals, ex = to_sheet(s)
        for label, v in vals.items():
            ws.Range(CELLS["input"][label]).Value = v
        r0 = CELLS["extras_first_row"]
        for i, lbl in enumerate(["수작업", "포장", "배송비", "기타"]):
            e = ex.get(lbl)
            ws.Range(f"B{r0 + i}").Value = e["qty"] if e else 0
            ws.Range(f"C{r0 + i}").Value = e["price"] if e else 0
        app.CalculateFullRebuild()
        got = {k: ws.Range(cell).Value for k, cell in CELLS["summary"].items()}
        for key, ekey in [("제조원가", "제조원가"), ("관리비", "관리비"), ("추가비용", "추가비용"),
                          ("총원가", "총원가"), ("개당 원가", "개당원가"), ("마진액", "마진액"),
                          ("총 판매금액", "총판매금액"), ("개당 소비자가", "개당소비자가")]:
            checked += 1
            a, b = float(got[key] or 0), float(exp[ekey])
            if abs(a - b) > 0.5:  # 표시 반올림 오차 허용
                fails.append(f"{desc} · {key}: 엑셀 {a:,.2f} ≠ 대시보드 {b:,.2f}")
    # 두 시트 전체에 #NAME?·#REF! 같은 수식 오류가 남아 있지 않은지 (마지막 시나리오 상태 기준)
    for sheet in wb.Worksheets:
        try:
            formulas = sheet.UsedRange.SpecialCells(-4123)  # xlCellTypeFormulas
        except Exception:  # noqa: BLE001  — 수식이 하나도 없는 시트
            continue
        for cell in formulas:
            checked += 1
            if isinstance(cell.Text, str) and cell.Text.startswith("#"):
                fails.append(f"수식 오류 {sheet.Name}!{cell.Address(0, 0)} → {cell.Text}")
    wb.Close(SaveChanges=False)
finally:
    app.Quit()
    tmp.unlink(missing_ok=True)

print(f"시나리오 {len(SCENARIOS)}건 × 지표 8종 + 전체 수식 셀 = {checked}개 검사")
if fails:
    print("\n".join("  ✗ " + f for f in fails))
    sys.exit(f"FAIL — {len(fails)}건 불일치")
print("OK — 수식 엑셀이 대시보드 견적 계산기와 전 항목 일치")
