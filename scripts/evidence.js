'use strict';
// 제출문에 붙일 "막히는 장면"을 실제로 요청해서 만든다.
//   node scripts/evidence.js > evidence.md            (임시 DB로 이 컴퓨터에서 서버를 띄워 실행)
//   node scripts/evidence.js https://pds-diary.fly.dev  (배포 주소에 같은 장면을 실행: 시험용 계정 4개가 새로 생김)
// 비밀번호·세션 토큰은 출력 전에 모두 가린다. 실행 끝에 원문이 출력에 남았는지 스스로 검사한다.
const http = require('node:http');
const crypto = require('node:crypto');
const { open } = require('../db');
const { createApp } = require('../server');

const out = [];
const secrets = new Set();
const say = (s = '') => out.push(s);
const mask = (s) => String(s).replace(/(pds_session=)([A-Za-z0-9_-]{8,})/g, (_, k, v) => `${k}${v.slice(0, 4)}…생략`)
  .replace(/("(?:password|current_password|new_password)":)"[^"]*"/g, '$1"●●●●(가림)"');
const tokenOf = (c) => c.split('=')[1];

async function main() {
  let base = process.argv[2], srv, db, remote = !!base;
  if (!remote) {
    process.env.PDS_TODAY = '2026-11-10';
    db = open(':memory:'); srv = http.createServer(createApp(db));
    await new Promise((r) => srv.listen(0, r)); base = `http://127.0.0.1:${srv.address().port}`;
  }
  const stamp = crypto.randomBytes(3).toString('hex');
  const pw = () => { const p = 'ev-' + crypto.randomBytes(9).toString('base64url'); secrets.add(p); return p; };
  const mail = (n) => `evidence-${n}-${stamp}@example.com`;

  async function rec(label, method, path, { body, cookie, headers = {}, show = true } = {}) {
    const h = { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers };
    const r = await fetch(base + path, { method, headers: h, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    const sc = r.headers.getSetCookie()[0];
    if (cookie) secrets.add(tokenOf(cookie));
    if (sc) secrets.add(tokenOf(sc.split(';')[0]));
    if (show) {
      say('```http');
      if (label) say('# ' + label);
      say(`> ${method} ${path}`);
      if (cookie) say(mask(`> Cookie: ${cookie}`));
      for (const [k, v] of Object.entries(headers)) say(`> ${k}: ${v}`);
      if (body) say(mask('> ' + JSON.stringify(body)));
      say(`< ${r.status}`);
      if (sc) say(mask(`< Set-Cookie: ${sc}`));
      say('< ' + mask(text.length > 400 ? text.slice(0, 400) + '…(생략)' : text));
      say('```');
    }
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: r.status, json, text, cookie: sc ? sc.split(';')[0] : null, setCookie: sc };
  }
  const pair = async (title, okReq, badReq) => {
    say(`**${title}**`); say();
    const a = await rec('성공(내 자료·로그인 상태)', ...okReq); const b = await rec('거절', ...badReq);
    say(); return [a.status, b.status];
  };

  // ----- 카드 1: 가입·로그인·로그아웃 -----
  const PA = pw(), PB = pw(), PS = pw();
  say('## 카드 1 — 가입·로그인·로그아웃');
  say('### 1-1 로그인하지 않고 자료 주소를 열면 (API)'); say();
  await rec('', 'GET', '/api/plans');
  say(); say('화면에서도 `#/tasks` 같은 자료 주소를 로그인 없이 열면 로그인 화면이 나옵니다(스크린샷은 제출문에 별도).'); say();
  say('### 1-2 가입 → 같은 이메일로 다시 가입 → 로그인 실패 두 경우 → 로그인 → 로그아웃'); say();
  const A = await rec('가입(계정 A)', 'POST', '/api/auth/signup', { body: { email: mail('a'), password: PA } });
  await rec('같은 이메일(대문자로 바꿔서)로 다시 가입', 'POST', '/api/auth/signup', { body: { email: mail('a').toUpperCase(), password: PA } });
  const wrongPw = await rec('이메일은 맞고 비밀번호만 틀림', 'POST', '/api/auth/login', { body: { email: mail('a'), password: pw() } });
  const noUser = await rec('없는 이메일', 'POST', '/api/auth/login', { body: { email: mail('nobody'), password: pw() } });
  say(`> 두 실패 응답이 같은가: 상태 ${wrongPw.status}/${noUser.status}, 본문 ${wrongPw.text === noUser.text ? '글자까지 같음' : '다름!'}`); say();
  const A2 = await rec('로그인(계정 A)', 'POST', '/api/auth/login', { body: { email: mail('a'), password: PA } });
  await rec('로그아웃', 'POST', '/api/auth/logout', { cookie: A2.cookie });

  // ----- 카드 2: 비밀번호 보관 -----
  say(); say('## 카드 2 — 비밀번호 보관 (scrypt)'); say();
  const same1 = await rec('', 'POST', '/api/auth/signup', { body: { email: mail('s1'), password: PS }, show: false });
  const same2 = await rec('', 'POST', '/api/auth/signup', { body: { email: mail('s2'), password: PS }, show: false });
  if (db) {
    const rows = db.prepare("SELECT email, password_hash FROM users WHERE email IN (?,?) ORDER BY id").all(mail('s1'), mail('s2'));
    say('같은 비밀번호로 가입한 두 계정의 `users.password_hash` (해시 뒷부분은 앞 22자만, 나머지는 …생략):'); say('```');
    for (const r of rows) { const [alg, N, rr, p, salt, hash] = r.password_hash.split('$'); say(`${r.email.slice(0, 18)}…  ${[alg, N, rr, p, salt, hash.slice(0, 22) + '…생략'].join('$')}   (해시 전체 길이 ${hash.length}자)`); }
    say('```');
    say(`두 저장값이 같은가: ${rows[0].password_hash === rows[1].password_hash ? '같음(문제!)' : '서로 다름'} · 저장값 안에 입력한 비밀번호가 들어 있는가: ${rows.some((r) => r.password_hash.includes(PS)) ? '있음(문제!)' : '없음'}`); say();
  } else say('(배포 주소에서는 DB를 직접 열 수 없어 이 항목은 로컬 실행에서만 출력합니다)');
  void same1; void same2;

  // ----- 카드 3: 세션 -----
  say('## 카드 3 — 세션 (같은 주소·같은 방식, 달라진 것은 로그아웃 여부뿐)'); say();
  const S = await rec('', 'POST', '/api/auth/login', { body: { email: mail('a'), password: PA }, show: false });
  say('**로그아웃 전**'); say();
  await rec('GET /api/auth/me — 로그인 상태', 'GET', '/api/auth/me', { cookie: S.cookie });
  await rec('로그아웃', 'POST', '/api/auth/logout', { cookie: S.cookie });
  say('**로그아웃 뒤 — 쿠키 값은 위와 똑같이 보냄**'); say();
  await rec('GET /api/auth/me — 같은 쿠키로 다시', 'GET', '/api/auth/me', { cookie: S.cookie });
  if (db) {
    const row = db.prepare('SELECT token_hash, created_at, expires_at FROM sessions ORDER BY id DESC LIMIT 1').get();
    say(`세션 한 줄(DB): token_hash=${row.token_hash.slice(0, 8)}…생략(SHA-256, 토큰 원문 아님) · 만들어진 때 ${row.created_at} · 만료 ${row.expires_at} → ${(new Date(row.expires_at) - new Date(row.created_at)) / 86400000}일 뒤 끊김`); say();
  }
  say('쿠키 속성: ' + mask(S.setCookie.replace(/;.*?(HttpOnly)/, '; $1')) + '  → HttpOnly(자바스크립트로 못 읽음), SameSite=Strict, Max-Age=604800(7일), HTTPS 접속이면 Secure가 붙음. 값은 주소(URL)에 실리지 않고 응답 본문에도 없음.'); say();
  say('### 비밀번호를 바꾸면 이전에 발급한 세션이 끊김'); say();
  const D1 = await rec('', 'POST', '/api/auth/login', { body: { email: mail('s1'), password: PS }, show: false });
  const D2 = await rec('', 'POST', '/api/auth/login', { body: { email: mail('s1'), password: PS }, show: false });
  const NEWPW = pw();
  const ch = await rec('다른 기기(D1)에서 비밀번호 변경', 'POST', '/api/auth/password', { cookie: D1.cookie, body: { current_password: PS, new_password: NEWPW } });
  await rec('변경 전에 받은 다른 세션(D2)으로 요청', 'GET', '/api/auth/me', { cookie: D2.cookie });
  await rec('변경 전에 받은 같은 세션(D1)으로 요청', 'GET', '/api/auth/me', { cookie: D1.cookie });
  await rec('변경하면서 새로 받은 세션으로 요청', 'GET', '/api/auth/me', { cookie: ch.cookie });
  await rec('옛 비밀번호로 로그인', 'POST', '/api/auth/login', { body: { email: mail('s1'), password: PS } });

  // ----- 카드 4: 남의 자료 -----
  say(); say('## 카드 4 — 남의 자료'); say();
  const ma = (await rec('', 'POST', '/api/auth/login', { body: { email: mail('a'), password: PA }, show: false }));
  const SB = await rec('', 'POST', '/api/auth/signup', { body: { email: mail('b'), password: PB }, show: false });
  const CA = ma.cookie, CB = SB.cookie;
  const mkPlan = (c, t) => rec('', 'POST', '/api/plans', { cookie: c, body: { title: t, start_date: '2026-11-01', end_date: '2026-11-09', priority: 1, success_criteria: '기준', estimated_minutes: 60 }, show: false }).then((r) => r.json);
  const pA = await mkPlan(CA, '계정 A의 계획'), pB = await mkPlan(CB, '계정 B의 계획');
  const tA = [], tB = [];
  for (const [c, plan, arr, who] of [[CA, pA, tA, 'A'], [CB, pB, tB, 'B']]) for (let i = 1; i <= 3; i++) arr.push((await rec('', 'POST', '/api/tasks', { cookie: c, body: { plan_id: plan.id, title: `${who}의 할 일 ${i}`, estimated_minutes: 10 * i }, show: false })).json);
  say(`계정 A(…${mail('a').slice(9, 20)})에 계획 1건·할 일 3건, 계정 B에 계획 1건·할 일 3건을 넣었습니다. (비밀번호는 적지 않음) A의 할 일 ID ${tA.map((t) => t.id)}, B의 할 일 ID ${tB.map((t) => t.id)}`); say();
  const count = async (c) => { const [p, t] = await Promise.all([rec('', 'GET', '/api/plans', { cookie: c, show: false }), rec('', 'GET', '/api/tasks', { cookie: c, show: false })]); return `계획 ${p.json.plans.length}건·할 일 ${t.json.tasks.length}건`; };
  for (const [dir, me, hisCookie, his, hisPlan] of [['A → B', CA, CB, tB, pB], ['B → A', CB, CA, tA, pA]]) {
    say(`### ${dir} (${dir[0]}의 로그인으로 ${dir[4]}의 자료를 건드림)`); say();
    const before = await count(hisCookie);
    await rec('읽기', 'GET', `/api/tasks/${his[0].id}`, { cookie: me });
    await rec('수정', 'PUT', `/api/tasks/${his[0].id}`, { cookie: me, body: { title: '남이 바꾼 제목' } });
    await rec('삭제', 'DELETE', `/api/tasks/${his[0].id}`, { cookie: me });
    await rec('남의 계획에 할 일 끼워 넣기', 'POST', '/api/tasks', { cookie: me, body: { plan_id: hisPlan.id, title: '몰래 끼워 넣은 할 일' } });
    const after = await count(hisCookie);
    say(`반대편(${dir[4]}) 자료 건수 — 거절 전: ${before} / 거절 후: ${after} → ${before === after ? '같음' : '달라짐(문제!)'}`);
    const still = await rec('', 'GET', `/api/tasks/${his[0].id}`, { cookie: hisCookie, show: false });
    say(`반대편 본인이 다시 읽은 제목: 「${still.json.title}」(바뀌지 않음), 새로 생긴 자료 없음`); say();
  }
  say('### 주소·헤더·본문에 남의 계정을 적어 보내도 내 자료만 돌아옴 (A의 로그인)'); say();
  await rec('주소에 남의 계획·사용자, 헤더에 남의 ID, 본문(GET이라 주소만)', 'GET', `/api/tasks?plan_id=${pB.id}&user_id=2&owner=${encodeURIComponent(mail('b'))}`, { cookie: CA, headers: { 'X-User-Id': '2', 'X-Owner': mail('b') } });
  const mine = await rec('본문에 남의 user_id를 적어 계획 만들기', 'POST', '/api/plans', { cookie: CA, headers: { 'X-User-Id': '2' }, body: { title: '본문에 남 지정', start_date: '2026-11-01', end_date: '2026-11-02', priority: 1, success_criteria: 'x', estimated_minutes: 1, user_id: 2 } });
  say(`→ 만들어진 계획의 user_id는 요청이 아니라 로그인한 사람의 값: ${mine.json.user_id === ma.json.user.id ? 'A 본인(요청에 적은 2는 무시됨)' : '확인 필요'}`); say();
  say('### 로그인 없이 자료를 직접 요청'); say();
  await rec('', 'GET', `/api/tasks/${tA[0].id}`);
  await rec('', 'GET', '/api/tasks');
  say('### 목록 응답에 남의 자료가 없음 (A의 로그인으로 전체 목록)'); say();
  const listA = await rec('', 'GET', '/api/tasks', { cookie: CA, show: false });
  say(`A의 \`/api/tasks\` 응답: ${listA.json.tasks.length}건, 제목 = ${JSON.stringify(listA.json.tasks.map((t) => t.title))}. 응답 전체에서 "B의"가 들어 있는 곳: ${listA.text.includes('B의') ? '있음(문제!)' : '0곳'}`); say();
  const reviewA = await rec('', 'GET', '/api/review', { cookie: CA, show: false });
  const exA = await rec('', 'GET', '/api/export', { cookie: CA, show: false });
  say(`A의 돌아보기 계획 수 ${reviewA.json.metrics.plan_count}(B 것은 안 셈), A의 내보내기에서 "B의" 포함 여부: ${exA.text.includes('B의') ? '있음(문제!)' : '없음'}`); say();

  // ----- 카드 5: 확인 다섯 가지 (성공/거절 나란히) -----
  say('## 카드 5 — 확인 다섯 가지 (각각 성공한 요청과 거절된 요청을 나란히)'); say();
  const L = await rec('', 'POST', '/api/auth/login', { body: { email: mail('a'), password: PA }, show: false });
  await pair('① 로그인 여부: 로그인한 요청 vs 로그인 없는 요청', ['GET', '/api/tasks', { cookie: L.cookie }], ['GET', '/api/tasks', {}]);
  await pair('② 내 자료 읽기 vs 남의 자료 읽기', ['GET', `/api/tasks/${tA[1].id}`, { cookie: L.cookie }], ['GET', `/api/tasks/${tB[1].id}`, { cookie: L.cookie }]);
  await pair('③ 내 자료 수정 vs 남의 자료 수정', ['PUT', `/api/tasks/${tA[1].id}`, { cookie: L.cookie, body: { note: '내가 고침' } }], ['PUT', `/api/tasks/${tB[1].id}`, { cookie: L.cookie, body: { note: '남이 고침' } }]);
  await pair('④ 내 자료 삭제 vs 남의 자료 삭제', ['DELETE', `/api/tasks/${tA[2].id}`, { cookie: L.cookie }], ['DELETE', `/api/tasks/${tB[2].id}`, { cookie: L.cookie }]);
  await rec('(⑤를 위해) 로그아웃', 'POST', '/api/auth/logout', { cookie: L.cookie, show: false });
  const L2 = await rec('', 'POST', '/api/auth/login', { body: { email: mail('a'), password: PA }, show: false });
  say('**⑤ 로그아웃 전 vs 로그아웃 뒤 (같은 쿠키·같은 주소)**'); say();
  await rec('성공(로그아웃 전)', 'GET', '/api/plans', { cookie: L2.cookie });
  await rec('로그아웃', 'POST', '/api/auth/logout', { cookie: L2.cookie });
  await rec('거절(로그아웃 뒤, 같은 쿠키)', 'GET', '/api/plans', { cookie: L2.cookie });
  void A; void same1;

  // ----- 카드 5: 내보내기와 계정 삭제 -----
  say(); say('### 내 자료 내보내기와 계정 삭제'); say();
  const L3 = await rec('', 'POST', '/api/auth/login', { body: { email: mail('a'), password: PA }, show: false });
  const ex = await rec('', 'GET', '/api/export', { cookie: L3.cookie, show: false });
  say(`내보내기 \`GET /api/export\` → ${ex.status}, 파일 한 개(JSON). 들어 있는 항목: ${Object.keys(ex.json || {}).join(', ')}. 비밀번호·해시 포함 여부: ${/scrypt\$|"password/i.test(ex.text) ? '있음(문제!)' : '없음'}, 남의 자료("B의") 포함 여부: ${ex.text.includes('B의') ? '있음(문제!)' : '없음'}`); say();
  const bBefore = await count(CB);
  await rec('계정 A를 지움(비밀번호 확인)', 'DELETE', '/api/auth/account', { cookie: L3.cookie, body: { password: PA } });
  await rec('지운 계정의 같은 쿠키로 요청', 'GET', '/api/plans', { cookie: L3.cookie });
  say(`다른 계정(B)의 자료 — 지우기 전: ${bBefore} / 지운 뒤: ${await count(CB)} (A만 지워지고 B는 그대로)`); say();

  // ----- 원문 검사 -----
  const all = out.join('\n');
  const leaked = [...secrets].filter((s) => s.length >= 8 && all.includes(s));
  say(); say(`## 비밀값 원문 검사\n이 문서 전체에서 이번 실행에 쓴 비밀번호 ${[...secrets].length}개(세션 토큰 포함)의 원문을 찾은 결과: ${leaked.length}건`);
  console.log(out.join('\n'));
  if (srv) { srv.closeAllConnections(); srv.close(); }
  if (leaked.length) { console.error('원문이 새었습니다!'); process.exit(1); }
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
