"""
웹페이지 생성: web/ → docs/

- web/index.html 의 {{BUILD}}, {{LATEST}} 를 채워 docs/index.html 생성
- web/assets/* 를 docs/assets/ 로 복사
- docs/.nojekyll 생성 (GitHub Pages가 파일을 그대로 서빙하도록)
- WIDI 회원 페이지: web/insight/*.html → docs/insight/, web/admin.html·privacy.html → docs/
  assets/widi-member.js 의 {{FIREBASE_CONFIG_B64}} 를 환경변수 FIREBASE_CONFIG(GitHub Secret, JSON)로 채움
데이터 파일(docs/data/*)은 analyze.py 가 만든다.
"""
from __future__ import annotations

import datetime as dt
import base64
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
DOCS = ROOT / "docs"


def main() -> int:
    DOCS.mkdir(exist_ok=True)
    (DOCS / "assets").mkdir(exist_ok=True)
    for f in (WEB / "assets").iterdir():
        shutil.copy2(f, DOCS / "assets" / f.name)

    meta_path = DOCS / "data" / "meta.json"
    meta = json.loads(meta_path.read_text(encoding="utf-8")) if meta_path.exists() else {}
    latest = meta.get("latest_month", "수집 중")
    build = dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).strftime("%Y%m%d%H%M")

    html = (WEB / "index.html").read_text(encoding="utf-8")
    html = html.replace("{{BUILD}}", build).replace("{{LATEST}}", latest)
    (DOCS / "index.html").write_text(html, encoding="utf-8")
    (DOCS / ".nojekyll").write_text("", encoding="utf-8")

    # WIDI 회원 로그인·변동 해설 페이지
    cfg = os.environ.get("FIREBASE_CONFIG", "").strip()
    b64 = base64.b64encode(cfg.encode("utf-8")).decode("ascii") if cfg else ""
    wm = DOCS / "assets" / "widi-member.js"
    if wm.exists():
        wm.write_text(wm.read_text(encoding="utf-8").replace("{{FIREBASE_CONFIG_B64}}", b64), encoding="utf-8")
    pages = [(p, DOCS / "insight" / p.name) for p in (WEB / "insight").glob("*.html")] if (WEB / "insight").exists() else []
    pages += [(WEB / n, DOCS / n) for n in ("admin.html", "privacy.html") if (WEB / n).exists()]
    for src, dst in pages:
        dst.parent.mkdir(exist_ok=True)
        t = src.read_text(encoding="utf-8").replace("{{BUILD}}", build).replace("{{PRIVACY_DATE}}", "2026년 11월 2일")
        dst.write_text(t, encoding="utf-8")
    print(f"build {build} (기준월 {latest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
