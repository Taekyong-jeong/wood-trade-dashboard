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
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"
DOCS = ROOT / "docs"


def main() -> int:
    DOCS.mkdir(exist_ok=True)
    (DOCS / "assets").mkdir(exist_ok=True)
    # 로컬 빌드(Secret 없음)에서 이미 게시된 Firebase 설정이 지워지지 않도록 기존 값을 기억해 둠
    prev_wm = DOCS / "assets" / "widi-member.js"
    m = re.search(r'const CFG_B64 = "([A-Za-z0-9+/=]+)"', prev_wm.read_text(encoding="utf-8")) if prev_wm.exists() else None
    prev_b64 = m.group(1) if m else ""
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
    if cfg:  # JSON이 아니면 콘솔의 'const firebaseConfig = {...}' 코드에서 키·값만 뽑음
        try:
            json.loads(cfg)
        except ValueError:
            keys = ("apiKey", "authDomain", "projectId", "storageBucket", "messagingSenderId", "appId", "measurementId")
            pairs = dict(re.findall(r'(\w+)\s*:\s*["\']([^"\']*)["\']', cfg))
            cfg = json.dumps({k: pairs[k] for k in keys if k in pairs})
    b64 = base64.b64encode(cfg.encode("utf-8")).decode("ascii") if cfg and cfg != "{}" else prev_b64
    wm = DOCS / "assets" / "widi-member.js"
    if wm.exists():
        wm.write_text(wm.read_text(encoding="utf-8").replace("{{FIREBASE_CONFIG_B64}}", b64), encoding="utf-8")
    pages = [(p, DOCS / "insight" / p.name) for p in (WEB / "insight").glob("*.html")] if (WEB / "insight").exists() else []
    pages += [(WEB / n, DOCS / n) for n in ("admin.html", "privacy.html") if (WEB / n).exists()]
    for n in ("admin.webmanifest", "admin-sw.js"):  # 관리자 화면 앱 설치(PWA)
        if (WEB / n).exists():
            shutil.copy2(WEB / n, DOCS / n)
    for src, dst in pages:
        dst.parent.mkdir(exist_ok=True)
        t = src.read_text(encoding="utf-8").replace("{{BUILD}}", build).replace("{{PRIVACY_DATE}}", "2026년 11월 2일")
        dst.write_text(t, encoding="utf-8")
    print(f"build {build} (기준월 {latest})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
