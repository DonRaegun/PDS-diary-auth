'use strict';
// 가입·로그인 화면, 5일 관찰 화면, 내 계정 화면. app.js의 h/api/field/formData/guard/toast/views/render/me를 같이 쓴다.

// ---------- 가입·로그인 ----------
function showAuth(note) {
  document.getElementById('nav').hidden = true;
  document.getElementById('notice').hidden = false;
  let mode = 'login';
  const draw = () => {
    const f = h('form', { class: 'grid auth', onsubmit: guard(async (e) => {
      e.preventDefault();
      const d = formData(f);
      const out = await api('POST', mode === 'login' ? '/api/auth/login' : '/api/auth/signup', { email: d.email, password: d.password });
      me = out.user; enterApp();
    }) },
      field('이메일', h('input', { name: 'email', type: 'email', required: true, autocomplete: 'username', maxlength: 254 })),
      field(mode === 'login' ? '비밀번호' : '비밀번호 (10자 이상)', h('input', { name: 'password', type: 'password', required: true, minlength: mode === 'login' ? 1 : 10, maxlength: 128, autocomplete: mode === 'login' ? 'current-password' : 'new-password' })),
      h('button', { type: 'submit' }, mode === 'login' ? '로그인' : '가입하기'));
    $app.replaceChildren(h('div', { class: 'card authbox' },
      h('h2', {}, mode === 'login' ? '로그인' : '가입'),
      note ? h('p', { class: 'muted' }, note) : null,
      f,
      h('p', { class: 'small' }, mode === 'login' ? '처음이세요? ' : '이미 계정이 있나요? ',
        h('a', { href: '#', onclick: (e) => { e.preventDefault(); mode = mode === 'login' ? 'signup' : 'login'; draw(); } }, mode === 'login' ? '가입하기' : '로그인하기')),
      h('p', { class: 'small muted' }, '내 기록은 로그인한 나만 볼 수 있습니다. 비밀번호는 서버에 원문으로 저장되지 않습니다.')));
  };
  draw();
}
function enterApp() {
  document.getElementById('nav').hidden = false;
  document.getElementById('notice').hidden = true;
  document.getElementById('who').textContent = me.email;
  render();
}
document.getElementById('logout').addEventListener('click', guard(async () => {
  await api('POST', '/api/auth/logout');
  me = null; location.hash = '#/'; showAuth('로그아웃했습니다');
}));

// ---------- 5일 관찰 ----------
views.experiment = async () => {
  const v = await api('GET', '/api/experiment');
  const rulesBox = h('div', { class: 'card small' },
    h('div', {}, h('b', {}, '지표: '), v.metric.metric_name, ' (단위: ', v.metric.unit, ')'),
    h('div', {}, h('b', {}, '계산 규칙: '), v.metric.calc_rule),
    h('div', {}, h('b', {}, '빠진 값: '), v.rules.missing),
    h('div', {}, h('b', {}, '중복 값: '), v.rules.duplicate),
    h('div', {}, h('b', {}, '튀는 값: '), v.rules.outlier),
    h('div', {}, h('b', {}, '반올림: '), v.rules.rounding),
    h('div', {}, h('b', {}, '주 시작 요일: '), v.rules.week_start));
  const out = h('div', {}, h('h2', {}, '5일 관찰'), rulesBox);
  if (!v.experiment) {
    const f = h('form', { class: 'grid', onsubmit: guard(async (e) => {
      e.preventDefault(); await api('POST', '/api/experiment', formData(f)); toast('1일차 질문과 규칙을 정했습니다'); render();
    }) },
      h('label', { class: 'wide' }, '이 5일로 답하려는 질문 (한 문장, 정하면 고치지 못합니다)', h('input', { name: 'question', required: true, maxlength: 300 })),
      h('label', { class: 'wide' }, '지금의 계획 규칙 (한 문장)', h('input', { name: 'plan_rule', required: true, maxlength: 300 })),
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
      h('label', { class: 'wide' }, '새 계획 규칙 (한 문장)', h('input', { name: 'new_rule', required: true, maxlength: 300 })),
      h('label', { class: 'wide' }, '바꾼 이유', h('input', { name: 'reason', required: true, maxlength: 500 })),
      h('button', { type: 'submit' }, '규칙 한 번 바꾸기'));
    out.append(h('h3', {}, '2일차 뒤 · 3일차 앞: 계획 규칙 바꾸기'), h('div', { class: 'card' }, f));
  } else if (rc) {
    const a = dayOf(rc.after_record1_id), b = dayOf(rc.after_record2_id);
    out.append(h('h3', {}, '계획 규칙 변경 기록'), h('div', { class: 'card small' },
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
      h('button', { type: 'submit' }, `${n + 1}일차 기록하기`));
    out.append(h('h3', {}, `${n + 1}일차 기록`), h('div', { class: 'card' }, f));
  }
  return out;
};

// ---------- 내 계정 ----------
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
    if (!confirm('계정과 내 모든 자료(계획·할 일·기록·5일 관찰)가 완전히 지워지고 되돌릴 수 없습니다. 지울까요?')) return;
    await api('DELETE', '/api/auth/account', { password: formData(df).password });
    me = null; location.hash = '#/'; showAuth('계정과 자료를 지웠습니다');
  }) },
    field('비밀번호 확인', h('input', { name: 'password', type: 'password', required: true, autocomplete: 'current-password' })),
    h('button', { type: 'submit', class: 'danger' }, '계정과 내 자료 모두 지우기'));
  return h('div', {}, h('h2', {}, '내 계정'), h('p', {}, '로그인한 이메일: ', me.email),
    h('h3', {}, '내 자료 내려받기'), h('p', {}, h('a', { href: '/api/export', download: '' }, '내보내기(JSON) — 내 자료 전체를 파일 하나로')),
    h('h3', {}, '비밀번호 바꾸기'), h('div', { class: 'card' }, pf),
    h('h3', {}, '계정 지우기'),
    h('p', { class: 'small' }, '계정을 지우면 내 계획·할 일·실행 기록·돌아보기·5일 관찰이 서버에서 함께 지워집니다. 먼저 위에서 내보내기로 내려받아 두세요.'),
    h('div', { class: 'card' }, df));
};

// ---------- 시작 ----------
(async () => {
  try { me = (await api('GET', '/api/auth/me')).user; } catch { me = null; }
  if (me) enterApp(); else showAuth();
})();
