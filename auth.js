'use strict';
// 인증: 가입·로그인·로그아웃·비밀번호 바꾸기·계정 삭제.
// - 비밀번호: Node 내장 crypto.scrypt(소금값은 계정마다 새로 뽑음). 외부 패키지 없음.
// - 사람 알아보기: 서버가 가진 "세션". 브라우저에는 무작위 토큰 하나만 HttpOnly 쿠키로 간다.
//   DB에는 토큰의 SHA-256만 저장하므로 DB가 새어도 토큰 원문을 알 수 없다. 서명용 비밀키가 없는 방식이라 지킬 비밀키 자체가 없다.
const crypto = require('node:crypto');

const COOKIE = 'pds_session';
const SESSION_MS = 7 * 24 * 3600 * 1000; // 7일 뒤 끊김(처음 로그인한 때부터, 쓸수록 늘어나지 않음)
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 64, maxmem: 128 * 1024 * 1024 };

const scrypt = (pw, salt) => new Promise((resolve, reject) =>
  crypto.scrypt(pw.normalize('NFKC'), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem },
    (e, key) => (e ? reject(e) : resolve(key))));

// 저장 모양: scrypt$N$r$p$<소금값 base64>$<해시 base64>
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}
async function verifyPassword(pw, stored) {
  const [alg, N, r, p, saltB64, keyB64] = String(stored).split('$');
  if (alg !== 'scrypt' || Number(N) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p) return false;
  const want = Buffer.from(keyB64, 'base64');
  const got = await scrypt(pw, Buffer.from(saltB64, 'base64'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function readCookie(req, name) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return null;
}
const isHttps = (req) => !!req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https';
function sessionCookie(req, token, maxAgeSec) {
  return `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSec}${isHttps(req) ? '; Secure' : ''}`;
}

function normEmail(v, bad) {
  if (typeof v !== 'string') throw bad('이메일을 입력하세요');
  const e = v.trim().toLowerCase();
  if (e.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) throw bad('이메일 형식이 올바르지 않습니다');
  return e;
}
function checkNewPassword(v, bad) {
  if (typeof v !== 'string' || v.length < 10) throw bad('비밀번호는 10자 이상이어야 합니다');
  if (v.length > 128) throw bad('비밀번호는 128자 이하여야 합니다');
  return v;
}

function makeAuth(db, { HttpError, bad, nowIso }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  let dummyHash; // 없는 이메일로 로그인해도 같은 시간만큼 계산하기 위한 가짜 해시
  const FAIL = () => new HttpError(401, '이메일 또는 비밀번호가 올바르지 않습니다');

  // 요청에 실린 쿠키로 사람을 알아본다. 모르거나 만료됐으면 null.
  function userFromRequest(req) {
    const token = readCookie(req, COOKIE);
    if (!token || token.length > 100) return null;
    const row = one(`SELECT s.id AS session_id, s.expires_at, u.id, u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?`, sha256(token));
    if (!row) return null;
    if (row.expires_at <= nowIso()) { run('DELETE FROM sessions WHERE id=?', row.session_id); return null; }
    return { id: row.id, email: row.email, session_id: row.session_id };
  }
  function startSession(req, userId, cookies) {
    const token = newToken();
    const now = Date.now();
    run('DELETE FROM sessions WHERE expires_at <= ?', nowIso());
    run('INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES (?,?,?,?)',
      userId, sha256(token), new Date(now).toISOString(), new Date(now + SESSION_MS).toISOString());
    cookies.push(sessionCookie(req, token, SESSION_MS / 1000));
  }

  async function signup(c) {
    const email = normEmail(c.body.email, bad);
    const password = checkNewPassword(c.body.password, bad);
    const hash = await hashPassword(password);
    let id;
    try {
      id = Number(run('INSERT INTO users (email, password_hash, created_at) VALUES (?,?,?)', email, hash, nowIso()).lastInsertRowid);
    } catch (e) {
      if (/UNIQUE/i.test(e.message)) throw new HttpError(409, '이미 가입된 이메일입니다');
      throw e;
    }
    startSession(c.req, id, c.cookies);
    return [201, { user: { id, email } }];
  }

  async function login(c) {
    const email = typeof c.body.email === 'string' ? c.body.email.trim().toLowerCase() : '';
    const password = typeof c.body.password === 'string' ? c.body.password : '';
    const u = email && password.length <= 128 ? one('SELECT id, email, password_hash FROM users WHERE email=?', email) : null;
    if (!dummyHash) dummyHash = await hashPassword('dummy-password-for-timing');
    const ok = await verifyPassword(password.slice(0, 128), u ? u.password_hash : dummyHash);
    if (!u || !ok) throw FAIL(); // 이메일이 없을 때와 비밀번호가 틀릴 때 문구·상태 코드가 같다
    startSession(c.req, u.id, c.cookies);
    return { user: { id: u.id, email: u.email } };
  }

  function logout(c) {
    run('DELETE FROM sessions WHERE id=?', c.user.session_id); // 서버에서 세션을 지운다(브라우저 쿠키만 지우는 게 아님)
    c.cookies.push(sessionCookie(c.req, '', 0));
    return { ok: true };
  }

  async function changePassword(c) {
    const cur = one('SELECT password_hash FROM users WHERE id=?', c.user.id);
    if (typeof c.body.current_password !== 'string' || !(await verifyPassword(c.body.current_password.slice(0, 128), cur.password_hash))) {
      throw new HttpError(401, '현재 비밀번호가 올바르지 않습니다');
    }
    const next = checkNewPassword(c.body.new_password, bad);
    const hash = await hashPassword(next);
    run('UPDATE users SET password_hash=? WHERE id=?', hash, c.user.id);
    run('DELETE FROM sessions WHERE user_id=?', c.user.id); // 이전에 발급한 세션은 전부 끊는다
    startSession(c.req, c.user.id, c.cookies); // 지금 쓰는 브라우저에만 새 세션을 준다
    return { ok: true, other_sessions_revoked: true };
  }

  async function deleteAccount(c) {
    const cur = one('SELECT password_hash FROM users WHERE id=?', c.user.id);
    if (typeof c.body.password !== 'string' || !(await verifyPassword(c.body.password.slice(0, 128), cur.password_hash))) {
      throw new HttpError(401, '비밀번호가 올바르지 않습니다');
    }
    const uid = c.user.id;
    db.exec('BEGIN IMMEDIATE');
    try {
      const mine = '(SELECT id FROM plans WHERE user_id=?)';
      const myTasks = `(SELECT id FROM tasks WHERE plan_id IN ${mine})`;
      run(`DELETE FROM review_carryovers WHERE from_plan_id IN ${mine} OR to_plan_id IN ${mine}`, uid, uid);
      run('DELETE FROM review_snapshots WHERE user_id=?', uid);
      run(`DELETE FROM completions WHERE task_id IN ${myTasks}`, uid);
      run(`DELETE FROM runs WHERE task_id IN ${myTasks}`, uid);
      run(`DELETE FROM task_tags WHERE task_id IN ${myTasks}`, uid);
      run(`DELETE FROM tasks WHERE plan_id IN ${mine}`, uid);
      run(`DELETE FROM plan_revisions WHERE plan_id IN ${mine}`, uid);
      run('DELETE FROM plans WHERE user_id=?', uid);
      run('DELETE FROM rule_changes WHERE user_id=?', uid);
      run('DELETE FROM day_records WHERE user_id=?', uid);
      run('DELETE FROM experiments WHERE user_id=?', uid);
      run('DELETE FROM sessions WHERE user_id=?', uid);
      run('DELETE FROM users WHERE id=?', uid);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    c.cookies.push(sessionCookie(c.req, '', 0));
    return { deleted: true };
  }

  return { userFromRequest, signup, login, logout, changePassword, deleteAccount };
}

module.exports = { makeAuth, hashPassword, verifyPassword, sha256, COOKIE, SESSION_MS };
