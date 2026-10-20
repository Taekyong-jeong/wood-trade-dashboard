"""
웹페이지 생성: web/ → docs/

- web/index.html 의 {{BUILD}}, {{LATEST}} 를 채워 docs/index.html 생성
- web/assets/* 를 docs/assets/ 로 복사
- docs/.nojekyll 생성 (GitHub Pages가 파일을 그대로 서빙하도록)
데이터 파일(docs/data/*)은 analyze.py 가 만든다.
"""
from __future__ import annotations

import datetime as dt
import json
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
    print(f"build {build} (기준월 {latest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
