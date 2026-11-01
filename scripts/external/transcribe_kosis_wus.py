"""KOSIS 목재이용실태조사 제품별 '원자재 이용량' 표(kosis_wus_raw.json) → data/external/wus_inputs.csv
열: year, product, table, category, origin(국산/수입/미상/비목재), value_m3
- '총 이용량'(직접 이용 + 타사에서 위탁) 값을 씀 · 하위 합계(합계·원목·원목 외)는 빼고 세부 원자재만 남김
- 출처 구분: 이름에 '국산' → 국산, '수입' → 수입, 폐목재(건설·생활·사업장)·죽데기·미이용산림바이오매스·톱밥숯·대나무류·잡목·수피 → 국산(국내 발생),
  '기타'·'기타 원자재' → 미상, 플라스틱류 → 비목재. 원목 아래 '국산'·'수입'은 국산 원목·수입 원목."""
import csv, json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TABLES = {"p01": "DT_136034_2024_A014", "p06": "DT_136034_2024_B011", "p08": "DT_136034_2024_C011", "p07": "DT_136034_2024_D011",
          "p10": "DT_136034_2024_E010", "p02": "DT_136034_2024_G012", "p03": "DT_136034_2024_H011", "p04": "DT_136034_2024_I011",
          "p05": "DT_136034_2024_J011", "p12": "DT_136034_2024_K011", "p11": "DT_136034_2024_L014", "p14": "DT_136034_2024_N011",
          "p15": "DT_136034_2024_O012"}
SUBTOTAL = {"합계", "전체", "원목", "원목 외"}
DOMESTIC_WORDS = ("폐목재", "건설", "생활", "사업장", "죽데기", "미이용산림바이오매스", "톱밥숯", "대나무", "잡목", "수피")

def origin(cat, under_log):
    c = cat.strip()
    if under_log and c in ("국산", "수입"):
        return c, f"{c} 원목"
    if c.startswith("국산"): return "국산", c
    if c.startswith("수입"): return "수입", c
    if "플라스틱" in c: return "비목재", c
    if c in ("기타", "기타 원자재"): return "미상", c
    if any(w in c for w in DOMESTIC_WORDS): return "국산", c
    return "미상", c

def num(v):
    v = (v or "").replace(",", "").strip()
    return float(v) if re.fullmatch(r"-?\d+(\.\d+)?", v) else 0.0

raw = json.loads((ROOT / "data/external/kosis_wus_raw.json").read_text(encoding="utf-8"))
out = []
for prod, tid in TABLES.items():
    rows = raw[tid]["rows"]
    tot = [r for r in rows if (r.get("C2_NM") or "").strip().endswith("총 이용량")]
    for y in sorted({r["PRD_DE"] for r in tot}):
        seq = [r for r in tot if r["PRD_DE"] == y]
        under_log = False
        for r in seq:
            c = (r["C1_NM"] or "").strip()
            if c == "원목": under_log = True; continue
            if c == "원목 외": under_log = False; continue
            if c in SUBTOTAL: continue
            o, nm = origin(c, under_log)
            v = num(r["DT"])
            if v: out.append({"year": int(y), "product": prod, "table": tid, "category": nm, "origin": o, "value_m3": v})
p = ROOT / "data/external/wus_inputs.csv"
with p.open("w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fieldnames=["year", "product", "table", "category", "origin", "value_m3"]); w.writeheader(); w.writerows(out)
print(f"{len(out)}행 → {p}")
