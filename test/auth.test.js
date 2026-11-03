'use strict';
// 7번: 인증·주인 확인·5일 관찰 시험. 비밀번호는 시험용 값이며 진짜 계정과 무관하다.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { open } = require('../db');
const { createApp } = require('../server');

let srv, base, db, logs = [];
const origLog = console.log, origErr = console.error;
const PW_A = 'alice-test-pw-1234', PW_B = 'bob-test-pw-5678', SAME = 'same-test-pw-0000';

test.before(async () => {
  process.env.PDS_TODAY = '2026-11-10';
  console.log = (...a) => logs.push(a.join(' ')); console.error = (...a) => logs.push(a.join(' '));
  db = open(':memory:');
  srv = http.createServer(createApp(db));
  await new Promise((r) => srv.listen(0, r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
test.after(() => { console.log = origLog; console.error = origErr; srv.closeAllConnections(); srv.close(); });

const responses = [];
async function call(method, url, body, cookie, headers = {}) {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await r.text();
  responses.push(text + JSON.stringify([...r.headers]));
  let json; try { json = JSON.parse(text); } catch { json = text; }
  const sc = r.headers.getSetCookie()[0];
  return { status: r.status, json, cookie: sc ? sc.split(';')[0] : null, setCookie: sc, headers: r.headers };
}
const signup = (email, pw) => call('POST', '/api/auth/signup', { email, password: pw });
const mkPlan = (cookie, title) => call('POST', '/api/plans', { title, start_date: '2026-11-01', end_date: '2026-11-09', priority: 1, success_criteria: '기준', estimated_minutes: 60 }, cookie);

test('C94-C99 가입·로그인·로그아웃, 중복 가입 거절, 로그인 실패 문구 동일', async () => {
  const s = await signup('Alice@Example.com', PW_A);
  assert.equal(s.status, 201);
  assert.match(s.setCookie, /HttpOnly/); assert.match(s.setCookie, /SameSite=Strict/); assert.match(s.setCookie, /Max-Age=604800/);
  assert.equal((await signup('alice@example.com', PW_A)).status, 409); // 대소문자만 다른 같은 이메일
  const noPw = await call('POST', '/api/auth/login', { email: 'alice@example.com', password: 'wrong-password-xx' });
  const noUser = await call('POST', '/api/auth/login', { email: 'nobody@example.com', password: 'wrong-password-xx' });
  assert.equal(noPw.status, 401); assert.equal(noUser.status, 401);
  assert.deepEqual(noPw.json, noUser.json);
  const li = await call('POST', '/api/auth/login', { email: 'alice@example.com', password: PW_A });
  assert.equal(li.status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, li.cookie)).json.user.email, 'alice@example.com');
  assert.equal((await call('POST', '/api/auth/logout', null, li.cookie)).status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, li.cookie)).status, 401); // 같은 값으로 다시 요청 → 거절
  assert.equal((await signup('x', PW_A)).status, 400);
  assert.equal((await signup('short@example.com', 'short')).status, 400);
});

test('C97 로그인하지 않으면 모든 자료 주소가 401', async () => {
  for (const [m, u] of [['GET', '/api/plans'], ['GET', '/api/tasks'], ['GET', '/api/runs'], ['GET', '/api/review'], ['GET', '/api/export'], ['GET', '/api/plans/1'], ['GET', '/api/tasks/1'], ['DELETE', '/api/tasks/1'], ['GET', '/api/experiment']]) {
    const r = await call(m, u);
    assert.equal(r.status, 401, m + ' ' + u);
    assert.deepEqual(r.json, { error: '로그인이 필요합니다' });
  }
  assert.equal((await call('GET', '/api/plans', null, 'pds_session=garbage')).status, 401);
  assert.equal((await call('GET', '/api/health')).status, 200); // 공개 길은 건강 확인뿐
});

test('C101-C106 비밀번호는 scrypt, 소금값이 달라 같은 비밀번호도 저장값이 다르고 응답·로그에 원문이 없다', async () => {
  await signup('same1@example.com', SAME); await signup('same2@example.com', SAME);
  const rows = db.prepare("SELECT password_hash FROM users WHERE email LIKE 'same%' ORDER BY id").all();
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].password_hash, rows[1].password_hash);
  for (const r of rows) { assert.match(r.password_hash, /^scrypt\$32768\$8\$1\$/); assert.ok(!r.password_hash.includes(SAME)); }
  for (const pw of [PW_A, SAME]) {
    assert.ok(!responses.some((t) => t.includes(pw)), '응답에 비밀번호 원문 없음');
    assert.ok(!logs.some((t) => t.includes(pw)), '서버 로그에 비밀번호 원문 없음');
  }
});

test('C108-C115 세션: DB에는 토큰 해시만, 로그아웃·비밀번호 변경으로 이전 값이 끊긴다, 만료 시각이 있다', async () => {
  const s = await signup('sess@example.com', 'sess-test-pw-1111');
  const token = s.cookie.split('=')[1];
  const row = db.prepare('SELECT token_hash, created_at, expires_at FROM sessions ORDER BY id DESC LIMIT 1').get();
  assert.notEqual(row.token_hash, token); assert.equal(row.token_hash.length, 64);
  assert.equal(new Date(row.expires_at) - new Date(row.created_at), 7 * 24 * 3600 * 1000);
  assert.ok(!JSON.stringify(s.json).includes(token)); // 응답 본문에 토큰 없음(쿠키로만)
  // 비밀번호를 바꾸면 이전 세션이 끊긴다
  const other = (await call('POST', '/api/auth/login', { email: 'sess@example.com', password: 'sess-test-pw-1111' })).cookie;
  const ch = await call('POST', '/api/auth/password', { current_password: 'sess-test-pw-1111', new_password: 'sess-test-pw-2222' }, s.cookie);
  assert.equal(ch.status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, other)).status, 401);
  assert.equal((await call('GET', '/api/auth/me', null, s.cookie)).status, 401);
  assert.equal((await call('GET', '/api/auth/me', null, ch.cookie)).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { email: 'sess@example.com', password: 'sess-test-pw-1111' })).status, 401);
  // 만료된 세션은 거절되고 지워진다
  db.prepare('UPDATE sessions SET expires_at=? WHERE token_hash=?').run('2000-01-01T00:00:00.000Z', require('../auth').sha256(ch.cookie.split('=')[1]));
  assert.equal((await call('GET', '/api/auth/me', null, ch.cookie)).status, 401);
});

test('C116-C126 남의 자료는 읽기·수정·삭제 모두 404, 거절 앞뒤 건수 같음, 목록에 섞이지 않음', async () => {
  const A = (await signup('own-a@example.com', PW_A)).cookie, B = (await signup('own-b@example.com', PW_B)).cookie;
  const pa = (await mkPlan(A, 'A의 계획')).json, pb = (await mkPlan(B, 'B의 계획')).json;
  const ta = (await call('POST', '/api/tasks', { plan_id: pa.id, title: 'A의 할 일', estimated_minutes: 10 }, A)).json;
  const tb = (await call('POST', '/api/tasks', { plan_id: pb.id, title: 'B의 할 일', estimated_minutes: 20 }, B)).json;
  await call('POST', `/api/tasks/${tb.id}/runs`, { started_at: '2026-11-02T09:00', ended_at: '2026-11-02T09:30' }, B);
  const counts = (c) => Promise.all([call('GET', '/api/plans', null, c), call('GET', '/api/tasks', null, c), call('GET', '/api/runs', null, c)]).then(([p, t, r]) => [p.json.plans.length, t.json.tasks.length, r.json.runs.length]);
  for (const [who, me, his, hisPlan, hisTask, hisCookie] of [['A→B', A, B, pb, tb, B], ['B→A', B, A, pa, ta, A]]) {
    const before = await counts(hisCookie);
    const hisTitle = hisTask.title;
    const tries = [
      call('GET', '/api/tasks/' + hisTask.id, null, me),
      call('PUT', '/api/tasks/' + hisTask.id, { title: '해킹됨' }, me),
      call('DELETE', '/api/tasks/' + hisTask.id, null, me),
      call('POST', `/api/tasks/${hisTask.id}/complete`, null, me),
      call('POST', `/api/tasks/${hisTask.id}/runs`, { started_at: '2026-11-03T09:00', ended_at: '2026-11-03T09:10' }, me),
      call('GET', '/api/plans/' + hisPlan.id, null, me),
      call('PUT', '/api/plans/' + hisPlan.id, { title: '해킹됨' }, me),
      call('POST', '/api/tasks', { plan_id: hisPlan.id, title: '몰래 끼워 넣기' }, me),
      call('POST', '/api/review/carry', { from_plan_id: hisPlan.id, text: '몰래' }, me),
    ];
    for (const r of await Promise.all(tries)) { assert.equal(r.status, 404, who); assert.ok(!JSON.stringify(r.json).includes(hisTitle)); }
    assert.deepEqual(await counts(hisCookie), before, who + ' 거절 앞뒤 건수');
    assert.equal((await call('GET', '/api/tasks/' + hisTask.id, null, hisCookie)).json.title, hisTitle);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM tasks WHERE title=?').get('몰래 끼워 넣기').c, 0);
  }
  // 목록·돌아보기·내보내기에 남의 자료가 없다
  for (const u of ['/api/plans', '/api/tasks', '/api/runs', '/api/review/snapshots', '/api/export', '/api/review']) {
    const text = JSON.stringify((await call('GET', u, null, A)).json);
    assert.ok(!text.includes('B의'), u);
  }
  assert.equal((await call('GET', '/api/review', null, A)).json.metrics.plan_count, 1);
  // 주소·헤더·본문에 남의 계정을 적어도 소용없다
  const sneaky = await call('GET', `/api/tasks?plan_id=${pb.id}&user_id=2&owner=own-b@example.com`, null, A, { 'X-User-Id': '2', 'X-Owner': 'own-b@example.com' });
  assert.deepEqual(sneaky.json.tasks, []);
  const mine = await call('POST', '/api/plans', { title: '본문에 남 지정', start_date: '2026-11-01', end_date: '2026-11-02', priority: 1, success_criteria: 'x', estimated_minutes: 1, user_id: 2 }, A, { 'X-User-Id': '2' });
  assert.equal(db.prepare('SELECT user_id FROM plans WHERE id=?').get(mine.json.id).user_id, db.prepare("SELECT id FROM users WHERE email='own-a@example.com'").get().id);
  // 요청 키도 계정별: 남의 키로 내 할 일을 완료 처리해도 남의 것이 영향받지 않는다
  const k = 'shared-key-0001';
  const ra = await call('POST', `/api/tasks/${ta.id}/complete`, null, A, { 'Idempotency-Key': k });
  const rb = await call('POST', `/api/tasks/${tb.id}/complete`, null, B, { 'Idempotency-Key': k });
  assert.equal(ra.json.counted, true); assert.equal(rb.json.counted, true);
});

test('다른 사이트(Origin)에서 온 쓰기 요청은 403', async () => {
  const A = (await signup('csrf@example.com', PW_A)).cookie;
  const r = await call('POST', '/api/plans', { title: 'x' }, A, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
});

test('C133-C134 내보내기에는 내 자료만(비밀번호 해시 없음), 계정 삭제 시 내 자료만 함께 삭제', async () => {
  const A = (await signup('del-a@example.com', PW_A)).cookie, B = (await signup('del-b@example.com', PW_B)).cookie;
  const pa = (await mkPlan(A, '지울 계획')).json; await mkPlan(B, '남길 계획');
  await call('POST', '/api/tasks', { plan_id: pa.id, title: '지울 할 일' }, A);
  const ex = await call('GET', '/api/export', null, A);
  const text = JSON.stringify(ex.json);
  assert.ok(text.includes('지울 계획') && !text.includes('남길 계획') && !text.includes('password') && !text.includes('scrypt'));
  assert.equal((await call('DELETE', '/api/auth/account', { password: 'wrong-password-xx' }, A)).status, 401);
  assert.equal((await call('DELETE', '/api/auth/account', { password: PW_A }, A)).status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM plans WHERE title='지울 계획'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM tasks WHERE title='지울 할 일'").get().c, 0);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM plans WHERE title='남길 계획'").get().c, 1);
  assert.equal((await call('GET', '/api/auth/me', null, A)).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { email: 'del-a@example.com', password: PW_A })).status, 401);
});

test('C04-C15,C23-C27 5일 관찰: 규칙은 2일차 뒤·3일차 앞에서 한 번만, 합계·평균은 손 계산과 같다', async () => {
  const U = (await signup('exp@example.com', PW_A)).cookie;
  const rec = (date, p, a) => call('POST', '/api/experiment/records', { record_date: date, planned_minutes: p, actual_minutes: a }, U);
  assert.equal((await rec('2026-11-06', 100, 100)).status, 409); // 질문을 정하기 전에는 기록 못 함
  const e = await call('POST', '/api/experiment', { question: '하루 계획을 줄이면 오차가 줄어드는가?', plan_rule: '하루에 할 일을 5개까지 계획한다' }, U);
  assert.equal(e.status, 201); assert.equal(e.json.metric.unit, '분');
  assert.equal((await call('POST', '/api/experiment', { question: '다시', plan_rule: '다시' }, U)).status, 409); // 고칠 수 없음
  assert.equal((await rec('2026-11-06', '', 100)).status, 400); // 빠진 값
  assert.equal((await rec('2026-11-06', 100, 2000)).status, 400); // 하루 1440분 초과
  assert.equal((await rec('2026-11-11', 100, 100)).status, 400); // 미래
  assert.equal((await rec('2026-11-06', 300, 240)).status, 201); // 1일차 오차 60
  assert.equal((await rec('2026-11-06', 1, 1)).status, 409); // 같은 날짜 중복
  assert.equal((await rec('2026-11-05', 1, 1)).status, 400); // 앞선 날짜
  assert.equal((await call('POST', '/api/experiment/rule-change', { reason: '너무 이르다', new_rule: '3개까지' }, U)).status, 409); // 기록 1일뿐
  assert.equal((await rec('2026-11-07', 300, 330)).status, 201); // 2일차 오차 30
  assert.equal((await rec('2026-11-08', 200, 200)).status, 409); // 규칙을 바꾸기 전에는 3일차 기록 못 함
  const ch = await call('POST', '/api/experiment/rule-change', { reason: '5개는 많아서 3개로 줄인다', new_rule: '하루에 할 일을 3개까지 계획한다' }, U);
  assert.equal(ch.status, 201);
  const rc = ch.json.rule_change;
  assert.deepEqual([rc.after_record1_id, rc.after_record2_id], ch.json.records.map((r) => r.id));
  assert.equal((await call('POST', '/api/experiment/rule-change', { reason: '또', new_rule: '2개' }, U)).status, 409); // 한 번만
  for (const [d, p, a] of [['2026-11-08', 200, 215], ['2026-11-09', 180, 180], ['2026-11-10', 240, 250]]) assert.equal((await rec(d, p, a)).status, 201);
  assert.equal((await rec('2026-11-10', 1, 1)).status, 409);
  const v = (await call('GET', '/api/experiment', null, U)).json;
  assert.equal(v.records.length, 5);
  assert.ok(new Date(rc.changed_at) > new Date(v.records[1].created_at) && new Date(rc.changed_at) < new Date(v.records[2].created_at));
  // 손 계산: 오차 60, 30, 15, 0, 10 → 합 115, 평균 23, 앞 평균 45, 뒤 평균 8.3
  assert.deepEqual(v.records.map((r) => r.error_minutes), [60, 30, 15, 0, 10]);
  assert.equal(v.summary.error_sum, 115); assert.equal(v.summary.error_avg, 23);
  assert.equal(v.summary.planned_sum, 300 + 300 + 200 + 180 + 240); assert.equal(v.summary.actual_sum, 240 + 330 + 215 + 180 + 250);
  assert.equal(v.comparison.before.error_avg, 45); assert.equal(v.comparison.after.error_avg, 8.3);
  assert.equal(v.comparison.diff_error_avg, -36.7);
  assert.equal(v.comparison.unit, '분');
});
