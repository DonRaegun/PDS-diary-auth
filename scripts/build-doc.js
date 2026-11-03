'use strict';
// docs/T07-설명서.template.md 의 <!--EVIDENCE--> 자리에 scripts/evidence.js 의 실행 결과를 끼워 docs/T07-설명서.md 를 만든다.
//   node scripts/build-doc.js                       (이 컴퓨터에서 임시 서버로 실행)
//   node scripts/build-doc.js https://배포주소      (배포본에 확인 기록을 남김)
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const evidence = execFileSync(process.execPath, [path.join(__dirname, 'evidence.js'), ...process.argv.slice(2)], { encoding: 'utf8', cwd: root, maxBuffer: 20e6 });
const tpl = fs.readFileSync(path.join(root, 'docs', 'T07-설명서.template.md'), 'utf8');
const stamp = `_이 기록을 만든 때: ${new Date().toISOString()} · 대상: ${process.argv[2] || '이 컴퓨터의 임시 서버(빈 DB)'}_\n\n`;
fs.writeFileSync(path.join(root, 'docs', 'T07-설명서.md'), tpl.replace('<!--EVIDENCE-->', stamp + evidence.replace(/^## /gm, '#### ').replace(/^### /gm, '##### ')));
console.log('docs/T07-설명서.md 를 만들었습니다');
