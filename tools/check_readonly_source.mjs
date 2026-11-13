#!/usr/bin/env node
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url);
const source=fs.readFileSync(new URL('apps-script/ReadApi.gs',root),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('apps-script/appsscript.json',root),'utf8'));
new vm.Script(source,{filename:'ReadApi.gs'});
assert.equal(manifest.executionApi.access,'MYSELF');
assert(manifest.oauthScopes.includes('https://www.googleapis.com/auth/spreadsheets.readonly'));
assert(!manifest.oauthScopes.some(s=>/\/auth\/(spreadsheets|drive|script\.send_mail)$/.test(s)));
assert(!/\.(?:setValue|setValues|setFormula|clearContent|deleteRow|deleteRows|appendRow|batchUpdate|update|insertSheet)\s*\(/.test(source),'A mutating method was found in the read-only source.');
assert(!/function\s+do(?:Get|Post)\s*\(/.test(source),'The read API must not expose a public web-app endpoint.');
console.log('Read-only Apps Script syntax, manifest and method checks passed.');
