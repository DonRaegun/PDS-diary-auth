'use strict';
// 6번에서 만든 자료(주인 열이 비어 있는 계획·돌아보기)를 내 계정으로 옮긴다. 한 번 실행하면 끝이다.
//   node claim-legacy.js 내이메일@example.com
// 이미 가입한 계정만 받는다. 주인이 있는 자료는 건드리지 않는다.
const path = require('node:path');
const { open } = require('./db');

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) { console.error('사용법: node claim-legacy.js <가입한 이메일>'); process.exit(1); }
const file = process.env.PDS_DB || path.join(__dirname, 'data', 'diary.sqlite');
const db = open(file);
const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (!u) { console.error('그 이메일로 가입한 계정이 없습니다. 먼저 화면에서 가입하세요.'); process.exit(1); }
db.exec('BEGIN IMMEDIATE');
const plans = db.prepare('UPDATE plans SET user_id=? WHERE user_id IS NULL').run(u.id).changes;
const snaps = db.prepare('UPDATE review_snapshots SET user_id=? WHERE user_id IS NULL').run(u.id).changes;
db.exec('COMMIT');
console.log(`계정 #${u.id}로 옮김: 계획 ${plans}건, 저장한 돌아보기 ${snaps}건 (할 일·실행 기록·완료는 계획에 딸려 함께 옮겨짐)`);
