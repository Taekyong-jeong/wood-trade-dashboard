"""한국임업진흥원 「원목시장가격조사」 검수표 → data/external/roundwood_price.csv
- 국산 원목 시장가격: 통계 요약 검수표의 수종별 시트, 전국 월별(권역·시군 표 바로 위 7개 등급 행), 원/㎥ (원료재급(톤)은 원/톤)
- 수입 원목 가격: 부록 수입원목가격 통계표(CNF 인천), 수종·등급·원산지별 월별, US$/MBF 또는 US$/㎥, 범위값(예 133~134)은 하한·상한·중앙
원자료: data/external/raw_roundwood/ (사용자 제공, 2026-11-02, 2026년 1분기 검수표 = 누적)
"""
import csv, pathlib, re
import openpyxl

ROOT = pathlib.Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "external" / "raw_roundwood"
OUT = ROOT / "data" / "external" / "roundwood_price.csv"
SP = {"소나무": "소나무", "낙엽송": "낙엽송", "잣나무": "잣나무", "리기다": "리기다소나무", "참나무류": "참나무류", "편백": "편백", "삼나무": "삼나무"}


def ym(label):
    m = re.match(r"(\d{2})년\s*(\d{1,2})월", str(label or ""))
    return f"20{m.group(1)}-{int(m.group(2)):02d}" if m else None


def domestic(rows, src):
    wb = openpyxl.load_workbook(RAW / "2026Q1_summary.xlsx", read_only=True, data_only=True)
    for ws in wb.worksheets:
        sp = SP.get(ws.title.split("_")[0])
        if not sp:
            continue
        data = list(ws.iter_rows(values_only=True))
        h = next(i for i, r in enumerate(data) if r and r[0] == "등급")       # 권역·시군 표 머리글
        months = [ym(v) for v in data[h]]
        i = h - 1
        while i >= 0 and not (data[i] and data[i][3]):                          # 빈 줄 건너뜀
            i -= 1
        block = []
        while i >= 0 and data[i] and data[i][3] and str(data[i][3])[:1].isdigit():
            block.append(data[i]); i -= 1
        for r in reversed(block):
            g = str(r[3]).split(".", 1)[1]
            unit = "원/톤" if "톤" in g else "원/㎥"
            for c, m in enumerate(months):
                if m and c < len(r) and isinstance(r[c], (int, float)):
                    rows.append(dict(ym=m, kind="국산_시장", species=sp, grade=g, origin="국산", unit=unit, value=r[c], lo="", hi="", source=src))


def imported(rows, src):
    wb = openpyxl.load_workbook(RAW / "2026Q1_import_cnf.xlsx", read_only=True, data_only=True)
    data = list(wb.worksheets[0].iter_rows(values_only=True))
    yr_row, mo_row = data[0], data[1]
    cols, y = {}, None
    for c, v in enumerate(yr_row):
        m = re.match(r"(\d{4})년", str(v or ""))
        if m:
            y = int(m.group(1))
        mm = re.match(r"(\d{1,2})월", str(mo_row[c] or ""))
        if y and mm:
            cols[c] = f"{y}-{int(mm.group(1)):02d}"
    sp = unit = org = None
    for r in data[2:]:
        if r[0] not in (None, "") and r[0] != "":                               # 두 번째 표(해외목재 유통정보)는 같은 값 → 첫 표만
            if rows and any(x["kind"] == "수입_CNF" for x in rows):
                break
        if not r[2]:
            continue
        sp = (str(r[1]).replace("\n", "") if r[1] else sp); org = r[3] or org; unit = r[4] or unit
        for c, m in cols.items():
            v = r[c] if c < len(r) else None
            if v in (None, "", "-"):
                continue
            s = str(v).replace(",", "")
            nums = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", s)]
            if not nums:
                continue
            lo, hi = nums[0], nums[-1]
            rows.append(dict(ym=m, kind="수입_CNF", species=sp, grade=str(r[2]), origin=org, unit=str(unit).replace("US$MBF", "US$/MBF").replace("US$/m³", "US$/㎥"),
                             value=round((lo + hi) / 2, 1), lo=lo if lo != hi else "", hi=hi if lo != hi else "", source=src))


def main():
    rows = []
    domestic(rows, "한국임업진흥원 원목시장가격조사 통계 요약 검수표(2026년 1분기)")
    imported(rows, "한국임업진흥원 원목시장가격조사 부록 수입원목가격 통계표(CNF 인천, 2026년 1분기 검수표)")
    with OUT.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["ym", "kind", "species", "grade", "origin", "unit", "value", "lo", "hi", "source"]); w.writeheader(); w.writerows(rows)
    print(len(rows), "rows →", OUT)


if __name__ == "__main__":
    main()
