// WIDI 회원 로그인·회원 전용 해설 (Firebase Authentication + Firestore)
// 설정값은 build.py가 GitHub Secret FIREBASE_CONFIG로 채움. 비어 있으면 '준비 중' 표시.
const CFG_B64 = "{{FIREBASE_CONFIG_B64}}";
const V = "10.12.2";
const ADMIN_EMAIL = "jty2533@naver.com";

let FB = null;
async function fb() {
  if (FB) return FB;
  let cfg = null;
  try { cfg = JSON.parse(decodeURIComponent(escape(atob(CFG_B64)))); } catch (e) { cfg = null; }
  if (!cfg || !cfg.apiKey) return null;
  const [{ initializeApp }, A, F] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`),
  ]);
  const app = initializeApp(cfg);
  const auth = A.getAuth(app);
  const db = F.getFirestore(app);
  FB = { app, auth, db, A, F };
  return FB;
}
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtD = (t) => { if (!t) return "–"; const d = t.toDate ? t.toDate() : new Date(t); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, "0")}.${String(d.getDate()).padStart(2, "0")}`; };
const ERR = {
  "auth/invalid-credential": "이메일 또는 비밀번호가 맞지 않음", "auth/wrong-password": "비밀번호가 맞지 않음", "auth/user-not-found": "가입된 이메일이 아님",
  "auth/email-already-in-use": "이미 가입된 이메일임. 로그인을 눌러 주세요", "auth/weak-password": "비밀번호는 6자 이상", "auth/invalid-email": "이메일 형식을 확인해 주세요",
  "auth/popup-closed-by-user": "로그인 창이 닫혔음", "auth/too-many-requests": "시도가 많아 잠시 막혔음. 잠시 뒤 다시 시도해 주세요",
};
const msg = (e) => ERR[e?.code] || e?.message || String(e);

// ───────── 회원 전용 해설 페이지 ─────────
export async function boot({ insightId }) {
  const gate = $("#gate"), box = $("#member");
  const F0 = await fb().catch(() => null);
  if (!F0) { gate.innerHTML = `<h2>회원 전용 해설 준비 중</h2><p class="muted">회원 로그인 기능을 준비하고 있음. 문의: ${ADMIN_EMAIL}</p>`; return; }
  const { auth, db, A, F } = F0;
  A.onAuthStateChanged(auth, async (user) => {
    box.innerHTML = "";
    if (!user) return renderLogin(gate, F0);
    const who = `<div class="who"><span>${esc(user.email || "")} 로그인됨</span><button type="button" id="logout">로그아웃</button></div>`;
    const bindOut = () => { const b = $("#logout"); if (b) b.onclick = () => A.signOut(auth); };
    let mem = null;
    try { const s = await F.getDoc(F.doc(db, "members", user.uid)); mem = s.exists() ? s.data() : null; } catch (e) { mem = null; }
    const active = mem && mem.status === "active" && mem.expiresAt && mem.expiresAt.toDate() > new Date();
    let isAdmin = false;
    try { isAdmin = (await F.getDoc(F.doc(db, "admins", user.uid))).exists(); } catch (e) {}
    if (active || isAdmin) {
      try {
        const s = await F.getDoc(F.doc(db, "insights", insightId));
        if (!s.exists()) { gate.innerHTML = who + `<p>해설 본문이 아직 올라오지 않았음.</p>`; bindOut(); return; }
        const d = s.data();
        gate.innerHTML = who + (active ? `<p class="muted">회원 기간: ${fmtD(mem.expiresAt)}까지</p>` : `<p class="muted">관리자 보기</p>`);
        bindOut();
        box.innerHTML = d.html || "";
        if (d.js) { try { new Function(d.js)(); } catch (e) { console.error(e); } }
      } catch (e) { gate.innerHTML = who + `<p class="err">본문을 불러오지 못했음: ${esc(msg(e))}</p>`; bindOut(); }
      return;
    }
    let join = {};
    try { const s = await F.getDoc(F.doc(db, "settings", "join")); join = s.exists() ? s.data() : {}; } catch (e) {}
    const bank = join.bankText ? `<div class="bank">${esc(join.bankText)}</div>` : "";
    if (mem && mem.status === "pending") {
      gate.innerHTML = who + `<h2>회원 신청이 접수됐음</h2><p>연회비 입금이 확인되면 연구회장이 승인함. 승인되면 이 페이지에서 바로 본문이 보임.</p>${bank}<p class="muted">신청일 ${fmtD(mem.appliedAt)} · 입금자명 ${esc(mem.depositor)}</p>`;
      bindOut(); return;
    }
    const again = mem && (mem.status === "expired" || mem.status === "rejected" || (mem.status === "active" && !active));
    gate.innerHTML = who + `<h2>${again ? "회원 기간이 끝났음 — 다시 신청" : "WIDI 회원 신청"}</h2>
      <p>연회비 1만원(1년). 입금 확인 후 승인되면 모든 회원 전용 해설을 볼 수 있음.</p>${bank}
      <div class="row2"><label>이름<input type="text" id="f-name" value="${esc(mem?.name || user.displayName || "")}" maxlength="40"></label>
      <label>소속 (선택)<input type="text" id="f-org" value="${esc(mem?.org || "")}" maxlength="60"></label></div>
      <label>입금자명 (통장에 찍히는 이름)<input type="text" id="f-dep" value="${esc(mem?.depositor || "")}" maxlength="40"></label>
      <label class="chk"><input type="checkbox" id="f-agree"> <span>개인정보(이름·소속·이메일·입금자명) 수집·이용에 동의함 — <a href="../privacy.html" target="_blank" rel="noopener">개인정보 처리방침</a></span></label>
      <div class="btns"><button class="btn pri" id="f-go" type="button">신청하기</button></div><p class="err" id="f-err"></p>`;
    bindOut();
    $("#f-go").onclick = async () => {
      const name = $("#f-name").value.trim(), org = $("#f-org").value.trim(), dep = $("#f-dep").value.trim();
      if (!name || !dep) { $("#f-err").textContent = "이름과 입금자명을 적어 주세요"; return; }
      if (!$("#f-agree").checked) { $("#f-err").textContent = "개인정보 수집·이용에 동의해야 신청할 수 있음"; return; }
      $("#f-go").disabled = true;
      try {
        await F.setDoc(F.doc(db, "members", user.uid), { name, org, email: user.email || "", depositor: dep, status: "pending", agree: true, appliedAt: F.serverTimestamp() }, { merge: !!mem });
        location.reload();
      } catch (e) { $("#f-err").textContent = "신청 실패: " + msg(e); $("#f-go").disabled = false; }
    };
  });
}

function renderLogin(gate, { auth, A }) {
  gate.innerHTML = `<h2>회원 전용 해설입니다</h2>
    <p>원인 분석 본문은 WIDI 회원(연회비 1만원)만 볼 수 있음. 로그인 후 이 페이지에서 바로 신청할 수 있음.</p>
    <div class="btns"><button class="btn pri" id="g-in" type="button">구글 계정으로 로그인</button></div>
    <div class="divider">또는 이메일</div>
    <div class="row2"><label>이메일<input type="email" id="e-mail" autocomplete="email"></label>
    <label>비밀번호 (6자 이상)<input type="password" id="e-pw" autocomplete="current-password"></label></div>
    <div class="btns"><button class="btn" id="e-in" type="button">로그인</button><button class="btn" id="e-up" type="button">이메일로 가입</button><button class="btn" id="e-reset" type="button">비밀번호 찾기</button></div>
    <p class="err" id="e-err"></p>`;
  const err = (t) => { $("#e-err").textContent = t; };
  $("#g-in").onclick = () => A.signInWithPopup(auth, new A.GoogleAuthProvider()).catch((e) => err(msg(e)));
  const em = () => $("#e-mail").value.trim(), pw = () => $("#e-pw").value;
  $("#e-in").onclick = () => A.signInWithEmailAndPassword(auth, em(), pw()).catch((e) => err(msg(e)));
  $("#e-up").onclick = () => A.createUserWithEmailAndPassword(auth, em(), pw()).catch((e) => err(msg(e)));
  $("#e-reset").onclick = () => { if (!em()) return err("이메일을 먼저 적어 주세요"); A.sendPasswordResetEmail(auth, em()).then(() => err("비밀번호 재설정 메일을 보냈음")).catch((e) => err(msg(e))); };
}

// ───────── 관리자 화면 ─────────
export async function adminBoot() {
  const root = $("#admin");
  const F0 = await fb().catch(() => null);
  if (!F0) { root.innerHTML = `<p>Firebase 설정이 아직 없음 (GitHub Secret FIREBASE_CONFIG).</p>`; return; }
  const { auth, db, A, F } = F0;
  A.onAuthStateChanged(auth, async (user) => {
    if (!user) { renderLogin(root, F0); root.querySelector("h2").textContent = "WIDI 관리자 로그인"; return; }
    const out = `<div class="who"><span>${esc(user.email)} · UID <code>${esc(user.uid)}</code></span><button type="button" id="logout">로그아웃</button></div>`;
    let ok = false; try { ok = (await F.getDoc(F.doc(db, "admins", user.uid))).exists(); } catch (e) {}
    if (!ok) { root.innerHTML = out + `<p>관리자 권한이 없음. 처음 한 번은 Firebase 콘솔 → Firestore → <code>admins</code> 컬렉션에 위 UID로 문서를 만들어야 함.</p>`; $("#logout").onclick = () => A.signOut(auth); return; }
    const draw = async () => {
      const snap = await F.getDocs(F.collection(db, "members"));
      const rows = []; snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
      const rank = { pending: 0, active: 1, expired: 2, rejected: 3 };
      rows.sort((a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || ((b.appliedAt?.seconds || 0) - (a.appliedAt?.seconds || 0)));
      const now = new Date();
      const st = (m) => m.status === "active" && m.expiresAt?.toDate() <= now ? "기간 끝" : ({ pending: "승인 대기", active: "회원", expired: "기간 끝", rejected: "반려" }[m.status] || m.status);
      let join = {}; try { const s = await F.getDoc(F.doc(db, "settings", "join")); join = s.exists() ? s.data() : {}; } catch (e) {}
      root.innerHTML = out + `
        <h2>회원 신청·관리</h2>
        <p class="muted">승인 대기 ${rows.filter((r) => r.status === "pending").length}명 · 회원 ${rows.filter((r) => r.status === "active" && r.expiresAt?.toDate() > now).length}명 · 통장 알림에서 입금자명을 확인한 뒤 승인</p>
        <div class="tbl"><table><thead><tr><th>상태</th><th>이름</th><th>소속</th><th>입금자명</th><th>이메일</th><th>신청</th><th>만료</th><th></th></tr></thead><tbody>
        ${rows.map((m) => `<tr><td>${st(m)}</td><td>${esc(m.name)}</td><td>${esc(m.org)}</td><td><b>${esc(m.depositor)}</b></td><td>${esc(m.email)}</td><td>${fmtD(m.appliedAt)}</td><td>${fmtD(m.expiresAt)}</td>
          <td class="btns"><button class="btn pri" data-a="ok" data-id="${m.id}" type="button">${m.status === "active" ? "1년 연장" : "승인 (1년)"}</button><button class="btn" data-a="no" data-id="${m.id}" type="button">${m.status === "active" ? "해지" : "반려"}</button></td></tr>`).join("") || `<tr><td colspan="8">신청 없음</td></tr>`}
        </tbody></table></div>
        <h2>가입 안내 문구 (로그인한 사람에게만 보임)</h2>
        <label>입금 계좌·안내<textarea id="bank" rows="4" style="font:inherit;padding:9px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink)">${esc(join.bankText || "")}</textarea></label>
        <div class="btns"><button class="btn" id="bank-save" type="button">안내 문구 저장</button></div>
        <h2>해설 본문 올리기</h2>
        <p class="muted">Claude가 만든 해설 본문 파일(insight_○○_member.json)을 고르면 그대로 올라감. 같은 번호면 덮어씀.</p>
        <div class="btns"><input type="file" id="ins-file" accept=".json,application/json"><button class="btn pri" id="ins-up" type="button">올리기</button></div>
        <p class="err" id="a-err"></p>`;
      $("#logout").onclick = () => A.signOut(auth);
      root.querySelectorAll("button[data-a]").forEach((b) => b.onclick = async () => {
        const ref = F.doc(db, "members", b.dataset.id);
        try {
          if (b.dataset.a === "ok") {
            const cur = rows.find((r) => r.id === b.dataset.id);
            const base = cur.status === "active" && cur.expiresAt?.toDate() > now ? cur.expiresAt.toDate() : new Date();
            const exp = new Date(base); exp.setFullYear(exp.getFullYear() + 1);
            await F.updateDoc(ref, { status: "active", approvedAt: F.serverTimestamp(), expiresAt: F.Timestamp.fromDate(exp) });
          } else {
            if (!confirm("정말 처리할까요?")) return;
            await F.updateDoc(ref, { status: rows.find((r) => r.id === b.dataset.id).status === "active" ? "expired" : "rejected" });
          }
          draw();
        } catch (e) { $("#a-err").textContent = msg(e); }
      });
      $("#bank-save").onclick = async () => { try { await F.setDoc(F.doc(db, "settings", "join"), { bankText: $("#bank").value }, { merge: true }); $("#a-err").textContent = "저장했음"; } catch (e) { $("#a-err").textContent = msg(e); } };
      $("#ins-up").onclick = async () => {
        const f = $("#ins-file").files[0]; if (!f) return ($("#a-err").textContent = "파일을 골라 주세요");
        try { const d = JSON.parse(await f.text()); if (!d.id || !d.html) throw new Error("형식이 맞지 않음(id·html 필요)");
          await F.setDoc(F.doc(db, "insights", d.id), { title: d.title || "", html: d.html, js: d.js || "", updatedAt: F.serverTimestamp() });
          $("#a-err").textContent = `${d.id} 올렸음 (${Math.round(f.size / 1024)}KB)`;
        } catch (e) { $("#a-err").textContent = "올리기 실패: " + msg(e); }
      };
    };
    draw();
  });
}
