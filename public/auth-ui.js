'use strict';
// 가입·로그인 화면, 5일 관찰 화면, 내 계정 화면. app.js의 h/api/field/formData/guard/toast/views/render/me를 같이 쓴다.

// ---------- 가입·로그인 ----------
function showAuth(note) {
  document.getElementById('nav').hidden = true;
  document.body.classList.add('is-auth');
  let mode = 'login';
  const draw = () => {
    const f = h('form', { class: 'grid auth', onsubmit: guard(async (e) => {
      e.preventDefault();
      const d = formData(f);
      if (mode === 'signup' && d.password !== d.password2) throw new Error('비밀번호 확인이 서로 다릅니다. 다시 입력해 주세요');
      const out = await api('POST', mode === 'login' ? '/api/auth/login' : '/api/auth/signup', { email: d.email, password: d.password });
      me = out.user; enterApp();
    }) },
      field('이메일', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'username', maxlength: 254 })),
      field(mode === 'login' ? '비밀번호' : '비밀번호 (10자 이상)', h('input', { name: 'password', type: 'password', required: true, minlength: mode === 'login' ? 1 : 10, maxlength: 128, autocomplete: mode === 'login' ? 'current-password' : 'new-password', oninput: () => mode === 'signup' && showMatch(f) })),
      mode === 'signup' ? h('label', {}, '비밀번호 다시 입력', h('input', { name: 'password2', type: 'password', required: true, minlength: 10, maxlength: 128, autocomplete: 'new-password', oninput: () => showMatch(f) }), h('span', { id: 'pwmatch', class: 'small', role: 'status' })) : null,
      h('button', { type: 'submit' }, mode === 'login' ? '로그인' : '가입하기'));
    $app.replaceChildren(h('div', { class: 'card authbox' },
      h('div', { class: 'auth-brand' }, h('span', { class: 'logo' }, 'P'), h('div', {}, h('b', {}, 'Plan · Do · See'), h('div', { class: 'small muted' }, '계획하고, 실행하고, 돌아보는 나만의 다이어리'))),
      h('h2', {}, mode === 'login' ? '로그인' : '가입'),
      note ? h('p', { class: 'muted' }, note) : null,
      mode === 'signup' ? h('p', { class: 'small muted' }, '이메일과 10자 이상의 비밀번호만 있으면 됩니다. 이메일 확인 메일은 보내지 않습니다.') : null,
      f,
      h('p', { class: 'small' }, mode === 'login' ? '아직 계정이 없나요? ' : '이미 계정이 있나요? ',
        h('button', { type: 'button', class: 'ghost', onclick: () => { mode = mode === 'login' ? 'signup' : 'login'; draw(); } }, mode === 'login' ? '새로 가입하기' : '로그인하러 가기'))));
  };
  draw();
}
function showMatch(f) {
  const el = document.getElementById('pwmatch'), a = f.password.value, b = f.password2.value;
  el.textContent = !b ? '' : a === b ? '비밀번호가 일치합니다' : '비밀번호가 일치하지 않습니다';
  el.className = 'small ' + (!b ? '' : a === b ? 'match-ok' : 'match-bad');
}
function enterApp() {
  document.getElementById('nav').hidden = false;
  document.getElementById('who').textContent = me.email;
  document.body.classList.remove('is-auth');
  render();
}
document.getElementById('logout').addEventListener('click', guard(async () => {
  await api('POST', '/api/auth/logout');
  me = null; location.hash = '#/'; showAuth('로그아웃했습니다');
}));

// ---------- 5일 관찰 ----------
// 평소 적은 할 일(그날 마감, 예상 시간 합계)과 실행 기록(그날 시작, 실제 시간 합계)으로 두 칸을 채운다. 비어 있으면 건드리지 않는다.
async function fillFromDiary(f) {
  const day = f.record_date.value;
  if (!day) throw new Error('먼저 날짜를 고르세요');
  const [{ tasks }, { runs }] = await Promise.all([api('GET', '/api/tasks'), api('GET', '/api/runs')]);
  const t = tasks.filter((x) => x.due_date === day), r = runs.filter((x) => x.started_at && seoulDay(new Date(x.started_at)) === day);
  if (!t.length && !r.length) throw new Error(`${day}에 마감인 할 일도, 시작한 실행 기록도 없습니다. 숫자를 직접 적어 주세요`);
  if (t.length) f.planned_minutes.value = t.reduce((n, x) => n + x.estimated_minutes, 0);
  if (r.length) f.actual_minutes.value = r.reduce((n, x) => n + x.actual_minutes, 0);
  toast(`할 일 ${t.length}개, 실행 기록 ${r.length}건으로 채웠습니다. 맞는지 확인하고 고치세요`);
}


// 날짜별 하루 계획 오차(분) 막대그래프. 실제 기록 값만 쓰고, 규칙을 바꾼 뒤 기록은 보라색으로 구분한다.
function errorChart(records, rc) {
  const W = 560, H = 190, L = 36, B = 28, T = 14, max = Math.max(10, ...records.map((r) => r.error_minutes));
  const ns = 'http://www.w3.org/2000/svg';
  const mk = (tag, a, txt) => { const e = document.createElementNS(ns, tag); for (const [k, x] of Object.entries(a)) e.setAttribute(k, x); if (txt !== undefined) e.textContent = txt; return e; };
  const svg = mk('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart', role: 'img', 'aria-label': '날짜별 하루 계획 오차(분) 막대그래프' });
  const slot = (W - L) / 5, ph = H - B - T;
  [0, 0.5, 1].forEach((f) => { const y = T + ph * (1 - f); svg.append(mk('line', { x1: L, x2: W, y1: y, y2: y, class: 'grid-line' }), mk('text', { x: L - 6, y: y + 4, 'text-anchor': 'end' }, Math.round(max * f))); });
  records.forEach((r) => {
    const x = L + (r.day_no - 1) * slot + slot * 0.2, bh = ph * r.error_minutes / max;
    svg.append(mk('rect', { x, y: T + ph - bh, width: slot * 0.6, height: bh, rx: 4, class: r.day_no > 2 && rc ? 'bar-after' : 'bar-before' }),
      mk('text', { x: x + slot * 0.3, y: T + ph - bh - 5, 'text-anchor': 'middle' }, r.error_minutes), mk('text', { x: x + slot * 0.3, y: H - 8, 'text-anchor': 'middle' }, r.day_no + '일차'));
  });
  if (rc) svg.append(mk('line', { x1: L + 2 * slot, x2: L + 2 * slot, y1: T, y2: T + ph, class: 'split' }));
  return h('div', { class: 'card' }, h('b', {}, '날짜별 하루 계획 오차 (분)'), svg,
    h('div', { class: 'legend' }, h('span', {}, h('i', { class: 'l-plan' }), '규칙 바꾸기 전'), rc ? h('span', {}, h('i', { class: 'l-see' }), '규칙 바꾼 뒤') : null));
}
views.experiment = async () => {
  const v = await api('GET', '/api/experiment');
  const rulesBox = h('details', { class: 'card small' }, h('summary', {}, '계산 규칙 보기 (지표·단위·빠진 값·중복 값 처리)'),
    h('div', {}, h('b', {}, '지표: '), v.metric.metric_name, ' (단위: ', v.metric.unit, ')'),
    h('div', {}, h('b', {}, '계산 규칙: '), v.metric.calc_rule),
    h('div', {}, h('b', {}, '빠진 값: '), v.rules.missing),
    h('div', {}, h('b', {}, '중복 값: '), v.rules.duplicate),
    h('div', {}, h('b', {}, '튀는 값: '), v.rules.outlier),
    h('div', {}, h('b', {}, '반올림: '), v.rules.rounding),
    h('div', {}, h('b', {}, '주 시작 요일: '), v.rules.week_start));
  const out = h('div', {}, h('p', {}, link('#/review', '← 돌아보기')), h('h2', {}, '5일 점검'),
    h('p', { class: 'muted' }, '내 계획이 실제와 얼마나 맞는지 5일 동안 점검합니다. 하루에 「계획한 시간」과 「실제로 일한 시간」 두 숫자만 적으면 차이(하루 계획 오차)를 계산해 줍니다. 순서: ① 1일차에 질문과 계획 규칙을 정한다 → ② 서로 다른 날짜로 2일을 기록한다 → ③ 계획 규칙을 한 번 바꾼다 → ④ 나머지 3일을 기록한다. ALEPH 과정 기록(그쪽 이름은 「5일 관찰」)에도 같은 값을 남겨 주세요.'), rulesBox);
  if (!v.experiment) {
    const f = h('form', { class: 'grid', onsubmit: guard(async (e) => {
      e.preventDefault(); await api('POST', '/api/experiment', formData(f)); toast('1일차 질문과 규칙을 정했습니다'); render();
    }) },
      h('label', { class: 'wide' }, '이 5일로 답하려는 질문 (한 문장, 정하면 고치지 못합니다)', h('input', { name: 'question', placeholder: '예) 하루 계획 시간을 줄여 잡으면 계획과 실제의 차이가 줄어드나?', required: true, maxlength: 300 })),
      h('label', { class: 'wide' }, '지금 내가 계획을 세우는 방식 (계획 규칙, 한 문장)', h('input', { name: 'plan_rule', placeholder: '예) 하루에 6시간 일하는 것으로 계획한다', required: true, maxlength: 300 })),
      h('button', { type: 'submit' }, '1일차에 정하기'));
    out.append(h('h3', {}, '1일차: 질문과 규칙 정하기'), h('div', { class: 'card' }, f));
    return out;
  }
  const e = v.experiment, n = v.records.length, rc = v.rule_change;
  out.append(h('div', { class: 'card' },
    h('div', {}, h('b', {}, '질문: '), e.question),
    h('div', {}, h('b', {}, '처음 계획 규칙: '), e.plan_rule_at_start),
    h('div', {}, h('b', {}, '지금 계획 규칙: '), e.current_plan_rule),
    h('div', { class: 'small muted' }, '정한 시각(서울) ' + fmtTime(e.created_at))));
  out.append(h('h3', {}, `날짜별 기록 (${n}/${v.max_days}일)`));
  out.append(n ? h('div', { class: 'table-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, ['일차', '날짜(서울)', '계획한 시간', '실제로 일한 시간', '하루 계획 오차', '메모'].map((t) => h('th', {}, t)))),
    h('tbody', {}, v.records.map((r) => h('tr', {}, h('td', {}, r.day_no + '일차'), h('td', {}, r.record_date), h('td', {}, r.planned_minutes + '분'), h('td', {}, r.actual_minutes + '분'),
      h('td', {}, r.error_minutes + '분', r.outlier ? h('span', { class: 'badge late' }, '튀는 값') : null), h('td', {}, r.note || '-')))))) : h('p', { class: 'muted' }, '아직 기록이 없습니다.'));
  const s = v.summary;
  if (n) out.append(errorChart(v.records, rc));
  out.append(h('div', { class: 'card' },
    h('div', {}, h('b', {}, `합계 (${s.days}일): `), `계획 ${s.planned_sum}분 · 실제 ${s.actual_sum}분 · 오차 ${s.error_sum}분`),
    h('div', {}, h('b', {}, '평균 오차: '), s.error_avg === null ? '기록 없음' : s.error_avg + '분'),
    h('div', { class: 'small muted' }, '평균 = 오차 합계 ÷ 기록한 날 수, 소수 첫째 자리')));
  const dayOf = (id) => v.records.find((r) => r.id === id);
  if (n === 2 && !rc) {
    const f = h('form', { class: 'grid', onsubmit: guard(async (ev) => {
      ev.preventDefault(); if (!confirm('계획 규칙은 한 번만 바꿀 수 있습니다. 바꿀까요?')) return;
      await api('POST', '/api/experiment/rule-change', formData(f)); toast('계획 규칙을 바꿨습니다'); render();
    }) },
      h('label', { class: 'wide' }, '새 계획 규칙 (한 문장)', h('input', { name: 'new_rule', placeholder: '예) 하루에 4시간 일하는 것으로 계획한다', required: true, maxlength: 300 })),
      h('label', { class: 'wide' }, '바꾼 이유', h('input', { name: 'reason', placeholder: '예) 계획한 만큼 해내지 못한 날이 많았다', required: true, maxlength: 500 })),
      h('button', { type: 'submit' }, '규칙 한 번 바꾸기'));
    out.append(h('h3', {}, '2일차 뒤 · 3일차 앞: 계획 규칙 바꾸기'), h('div', { class: 'card' }, f));
  } else if (rc) {
    const a = dayOf(rc.after_record1_id), b = dayOf(rc.after_record2_id);
    out.append(h('h3', {}, '계획 규칙 변경 기록'), h('div', { class: 'card small rulechange' },
      h('div', {}, '바꾼 시각(서울): ' + fmtTime(rc.changed_at)),
      h('div', {}, `가리키는 기록: ${a.day_no}일차(${a.record_date}) · ${b.day_no}일차(${b.record_date}) — 이 두 기록 뒤, 3일차 기록 앞`),
      h('div', {}, '이전 규칙: ' + rc.old_rule), h('div', {}, '새 규칙: ' + rc.new_rule), h('div', {}, '이유: ' + rc.reason)));
  }
  if (rc && v.comparison) {
    const c = v.comparison;
    const row = (name, p) => h('tr', {}, h('td', {}, name), h('td', {}, p.days + '일'), h('td', {}, p.error_avg === null ? '기록 없음' : p.error_avg + c.unit));
    out.append(h('h3', {}, `바꾸기 전 · 후 비교 (같은 지표「${c.metric}」· 같은 단위 ${c.unit} · 같은 계산 규칙)`),
      h('div', { class: 'table-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['구간', '기록한 날', '평균 오차'].map((t) => h('th', {}, t)))),
        h('tbody', {}, row('바꾸기 전 (1~2일차)', c.before), row('바꾼 뒤 (3~5일차)', c.after)))),
      h('p', {}, c.diff_error_avg === null ? '아직 바꾼 뒤 기록이 없어 비교할 수 없습니다.' : `뒤 − 앞 = ${c.diff_error_avg > 0 ? '+' : ''}${c.diff_error_avg}${c.unit} (작을수록 계획이 현실에 가깝습니다. 나빠졌어도 그대로 둡니다)`));
  }
  if (n < v.max_days && !(n === 2 && !rc)) {
    const f = h('form', { class: 'grid', onsubmit: guard(async (ev) => {
      ev.preventDefault(); await api('POST', '/api/experiment/records', formData(f)); toast('기록했습니다'); render();
    }) },
      field('날짜(서울)', h('input', { name: 'record_date', type: 'date', required: true, max: v.today, value: v.today })),
      field('그날 계획한 시간(분)', h('input', { name: 'planned_minutes', type: 'number', min: 0, max: 1440, required: true })),
      field('그날 실제로 일한 시간(분)', h('input', { name: 'actual_minutes', type: 'number', min: 0, max: 1440, required: true })),
      h('label', { class: 'wide' }, '메모(선택)', h('input', { name: 'note', maxlength: 500 })),
      h('button', { type: 'button', class: 'ghost wide', onclick: guard(() => fillFromDiary(f)) }, '고른 날짜의 할 일·실행 기록에서 숫자 채우기'),
      h('button', { type: 'submit' }, `${n + 1}일차 기록하기`));
    out.append(h('h3', {}, `${n + 1}일차 기록`), h('div', { class: 'card' }, f));
  }
  return out;
};

// ---------- 내 계정 ----------
const currentTheme = () => { try { return localStorage.getItem('pds-theme') || 'auto'; } catch { return 'auto'; } };
function setTheme(v) {
  try { if (v === 'auto') localStorage.removeItem('pds-theme'); else localStorage.setItem('pds-theme', v); } catch { /* 저장 못 해도 이번 화면에는 적용 */ }
  if (v === 'auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = v;
}
views.account = async () => {
  const pf = h('form', { class: 'grid', onsubmit: guard(async (e) => {
    e.preventDefault(); const d = formData(pf);
    await api('POST', '/api/auth/password', { current_password: d.current_password, new_password: d.new_password });
    pf.reset(); toast('비밀번호를 바꿨습니다. 다른 곳에서 로그인한 세션은 모두 끊겼습니다');
  }) },
    field('현재 비밀번호', h('input', { name: 'current_password', type: 'password', required: true, autocomplete: 'current-password' })),
    field('새 비밀번호 (10자 이상)', h('input', { name: 'new_password', type: 'password', required: true, minlength: 10, maxlength: 128, autocomplete: 'new-password' })),
    h('button', { type: 'submit' }, '비밀번호 바꾸기'));
  const df = h('form', { class: 'grid', onsubmit: guard(async (e) => {
    e.preventDefault();
    if (!confirm('계정과 내 모든 자료(계획·할 일·기록·5일 점검)가 완전히 지워지고 되돌릴 수 없습니다. 지울까요?')) return;
    await api('DELETE', '/api/auth/account', { password: formData(df).password });
    me = null; location.hash = '#/'; showAuth('계정과 자료를 지웠습니다');
  }) },
    field('비밀번호 확인', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('button', { type: 'submit', class: 'danger' }, '계정과 내 자료 모두 지우기'));
  return h('div', {}, h('h2', {}, '내 계정'), h('p', {}, '로그인한 이메일: ', me.email),
    h('h3', {}, '화면 색상'), h('div', { class: 'card' }, h('label', {}, '라이트 / 다크', h('select', { onchange: (e) => setTheme(e.target.value) },
      [['auto', '기기 설정 따르기'], ['light', '라이트'], ['dark', '다크']].map(([v, t]) => h('option', { value: v, selected: v === currentTheme() }, t))))),
    h('h3', {}, '내 자료 내려받기'), h('p', {}, h('a', { href: '/api/export', download: '' }, '내보내기(JSON) — 내 자료 전체를 파일 하나로')),
    h('h3', {}, '비밀번호 바꾸기'), h('div', { class: 'card' }, pf),
    h('h3', {}, '계정 지우기'),
    h('p', { class: 'small' }, '계정을 지우면 내 계획·할 일·실행 기록·돌아보기·5일 점검이 서버에서 함께 지워집니다. 먼저 위에서 내보내기로 내려받아 두세요.'),
    h('div', { class: 'card' }, df));
};

// ---------- 시작 ----------
(async () => {
  try { me = (await api('GET', '/api/auth/me')).user; } catch { me = null; }
  if (me) enterApp(); else showAuth();
})();
