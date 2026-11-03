'use strict';
// 5일 관찰: 질문 한 문장·지표 한 개·계산 규칙·계획 규칙을 처음에 한 번 정하고,
// 서로 다른 날짜 5일을 기록하며, 2일차 뒤·3일차 앞에서 계획 규칙을 딱 한 번 바꾼다.
// 모든 함수는 주인(uid)을 첫 인자로 받고, 모든 SQL에 user_id 조건이 붙는다.
const METRIC = {
  metric_name: '하루 계획 오차',
  unit: '분',
  calc_rule: '하루 계획 오차(분) = |그날 실제로 일한 시간(분) − 그날 계획했던 시간(분)|. 작을수록 계획이 현실에 가깝다. 비교는 항상 이 계산으로만 한다.',
};
const RULES = {
  missing: '계획 시간이나 실제 시간이 비어 있으면 저장하지 않고 거절합니다(0으로 채우지 않음). 기록 없는 날은 평균에서 빼고 「기록 없음」으로 둡니다.',
  duplicate: '같은 날짜(서울 기준)에는 기록 한 건만 둘 수 있습니다. 두 번째 입력은 409로 거절하고 첫 기록을 그대로 둡니다.',
  outlier: '그날 오차가 60분 이상이면서 나머지 날 오차 평균의 3배를 넘으면 「튀는 값」 표시만 합니다. 평균에서 빼지 않습니다. 하루 1440분(24시간)을 넘는 입력은 거절합니다.',
  rounding: '평균은 소수 둘째 자리에서 반올림(0.05는 올림)하여 소수 첫째 자리까지 보여 줍니다. 개별 값은 정수 분입니다.',
  week_start: '월요일',
};
const MAX_DAYS = 5;
const MAX_MIN = 1440;
const round1 = (x) => Math.round((x + 1e-9) * 10) / 10;
const avg = (arr) => (arr.length ? round1(arr.reduce((s, v) => s + v, 0) / arr.length) : null);

function makeExperiment(db, { HttpError, bad, nowIso, seoulToday, isDate, reqText, reqInt }) {
  const one = (sql, ...p) => db.prepare(sql).get(...p);
  const all = (sql, ...p) => db.prepare(sql).all(...p);
  const run = (sql, ...p) => db.prepare(sql).run(...p);
  const tx = (fn) => { db.exec('BEGIN IMMEDIATE'); try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; } };

  const records = (uid) => all('SELECT * FROM day_records WHERE user_id=? ORDER BY record_date, id', uid).map((r, i) => {
    const o = { ...r };
    delete o.user_id;
    o.day_no = i + 1;
    o.error_minutes = Math.abs(r.actual_minutes - r.planned_minutes);
    return o;
  });
  function flagOutliers(recs) {
    for (const r of recs) {
      const others = recs.filter((x) => x !== r).map((x) => x.error_minutes);
      const base = others.length ? others.reduce((s, v) => s + v, 0) / others.length : 0;
      r.outlier = others.length > 0 && r.error_minutes >= 60 && r.error_minutes > 3 * base;
    }
  }
  const part = (recs) => ({
    days: recs.length,
    planned_sum: recs.reduce((s, r) => s + r.planned_minutes, 0),
    actual_sum: recs.reduce((s, r) => s + r.actual_minutes, 0),
    error_sum: recs.reduce((s, r) => s + r.error_minutes, 0),
    error_avg: avg(recs.map((r) => r.error_minutes)),
  });

  function view(uid) {
    const exp = one('SELECT * FROM experiments WHERE user_id=?', uid);
    const recs = records(uid);
    flagOutliers(recs);
    const change = one('SELECT * FROM rule_changes WHERE user_id=?', uid);
    const out = {
      today: seoulToday(), max_days: MAX_DAYS, metric: METRIC, rules: RULES,
      experiment: null, records: recs, rule_change: change ? { ...change, user_id: undefined } : null, summary: part(recs),
    };
    if (exp) {
      out.experiment = { id: exp.id, question: exp.question, plan_rule_at_start: exp.plan_rule, created_at: exp.created_at,
        current_plan_rule: change ? change.new_rule : exp.plan_rule };
    }
    if (change) {
      const before = recs.filter((r) => r.day_no <= 2), after = recs.filter((r) => r.day_no >= 3);
      out.comparison = { metric: METRIC.metric_name, unit: METRIC.unit, calc_rule: METRIC.calc_rule, before: part(before), after: part(after),
        diff_error_avg: before.length && after.length ? round1(part(after).error_avg - part(before).error_avg) : null };
    }
    return out;
  }

  function create(uid, b) {
    const question = reqText(b.question, '이 관찰로 답하려는 질문 한 문장', 300);
    const plan_rule = reqText(b.plan_rule, '계획 규칙', 300);
    return tx(() => {
      if (one('SELECT 1 FROM experiments WHERE user_id=?', uid)) throw new HttpError(409, '이미 정했습니다. 질문·지표·계산 규칙은 1일차에 한 번만 정하고 고치지 않습니다');
      run('INSERT INTO experiments (user_id,question,metric_name,unit,calc_rule,plan_rule,rules_json,created_at) VALUES (?,?,?,?,?,?,?,?)',
        uid, question, METRIC.metric_name, METRIC.unit, METRIC.calc_rule, plan_rule, JSON.stringify(RULES), nowIso());
      return view(uid);
    });
  }

  function addRecord(uid, b) {
    const date = b.record_date === undefined || b.record_date === '' ? seoulToday() : b.record_date;
    if (!isDate(date)) throw bad('날짜: YYYY-MM-DD 형식이어야 합니다');
    if (date > seoulToday()) throw bad('오늘(서울)보다 뒤의 날짜는 기록할 수 없습니다');
    for (const [k, name] of [['planned_minutes', '계획한 시간'], ['actual_minutes', '실제로 일한 시간']]) {
      if (b[k] === undefined || b[k] === null || b[k] === '') throw bad(`${name}(분): 비워 둘 수 없습니다`);
    }
    const planned = reqInt(b.planned_minutes, '계획한 시간(분)', 0, MAX_MIN);
    const actual = reqInt(b.actual_minutes, '실제로 일한 시간(분)', 0, MAX_MIN);
    const note = typeof b.note === 'string' ? b.note.trim().slice(0, 500) : '';
    return tx(() => {
      if (!one('SELECT 1 FROM experiments WHERE user_id=?', uid)) throw new HttpError(409, '먼저 1일차에 질문과 계획 규칙을 정하세요');
      const recs = records(uid);
      if (recs.length >= MAX_DAYS) throw new HttpError(409, `${MAX_DAYS}일 기록이 이미 찼습니다`);
      if (recs.some((r) => r.record_date === date)) throw new HttpError(409, '이 날짜에는 이미 기록이 있습니다. 같은 날짜는 한 건만 둡니다');
      if (recs.length && date < recs[recs.length - 1].record_date) throw bad('이전 기록보다 앞선 날짜는 넣을 수 없습니다');
      if (recs.length === 2 && !one('SELECT 1 FROM rule_changes WHERE user_id=?', uid)) {
        throw new HttpError(409, '3일차 기록 전에 계획 규칙을 하나만 바꿔 기록하세요');
      }
      run('INSERT INTO day_records (user_id,record_date,planned_minutes,actual_minutes,note,created_at) VALUES (?,?,?,?,?,?)', uid, date, planned, actual, note, nowIso());
      return view(uid);
    });
  }

  function changeRule(uid, b) {
    const reason = reqText(b.reason, '바꾼 이유', 500);
    const newRule = reqText(b.new_rule, '새 계획 규칙', 300);
    return tx(() => {
      const exp = one('SELECT * FROM experiments WHERE user_id=?', uid);
      if (!exp) throw new HttpError(409, '먼저 1일차에 질문과 계획 규칙을 정하세요');
      if (one('SELECT 1 FROM rule_changes WHERE user_id=?', uid)) throw new HttpError(409, '계획 규칙은 한 번만 바꿉니다');
      const recs = records(uid);
      if (recs.length !== 2) throw new HttpError(409, '2일차 기록을 남긴 뒤, 3일차 기록 전에만 바꿀 수 있습니다 (지금 기록 ' + recs.length + '일)');
      if (newRule === exp.plan_rule) throw bad('새 계획 규칙이 기존 규칙과 같습니다');
      run('INSERT INTO rule_changes (user_id,changed_at,reason,old_rule,new_rule,after_record1_id,after_record2_id) VALUES (?,?,?,?,?,?,?)',
        uid, nowIso(), reason, exp.plan_rule, newRule, recs[0].id, recs[1].id);
      return view(uid);
    });
  }

  return { view, create, addRecord, changeRule, METRIC, RULES };
}

module.exports = { makeExperiment, METRIC, RULES, MAX_DAYS };
