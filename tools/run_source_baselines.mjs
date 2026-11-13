#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const argv=process.argv.slice(2);
function option(name){const i=argv.indexOf(name);if(i<0||!argv[i+1])throw new Error(`Required ${name}`);return argv[i+1];}
const source=fs.readFileSync(option('--source-code'),'utf8');
const fixtures=JSON.parse(fs.readFileSync(option('--fixtures'),'utf8'));
const output=option('--output');
new vm.Script(source,{filename:'Original Code.gs syntax check'});
const starts=[...source.matchAll(/^function\s+(\w+)\s*\(/gm)];
function extract(name){const i=starts.findIndex(m=>m[1]===name);if(i<0)throw new Error(`Missing source function ${name}`);return source.slice(starts[i].index,starts[i+1]?.index??source.length);}
const status=source.match(/^var DELIVERY_STATUS_LIST\s*=\s*(\[[^\n]+\]);/m);
if(!status)throw new Error('Missing delivery status list');
const pure=[...new Set(fixtures.cases.map(c=>c.function))];
const sandbox=vm.createContext({});
vm.runInContext('var DELIVERY_STATUS_LIST='+status[1]+';\n'+pure.map(extract).join('\n'),sandbox,{timeout:1000});
const results=[];
for(const c of fixtures.cases){
 try{sandbox.input=c.args;const actual=vm.runInContext(`${c.function}.apply(null,input)`,sandbox,{timeout:1000});assert.deepEqual(JSON.parse(JSON.stringify(actual)),c.expected);results.push({id:c.id,status:'passed',note:c.note??null});}
 catch(error){results.push({id:c.id,status:'failed',error:error.message});}
}
// Characterize the actual legacy return wrapper without writing spreadsheet data.
const requests=[];
const returnSandbox=vm.createContext({getActiveSaleLines_:()=>[{productId:'SYNTH-A',active:3,lineId:'LINE-A'},{productId:'SYNTH-B',active:3,lineId:'LINE-B'}],processInvoiceLifecycle_:(...args)=>{requests.push(args);return {ok:true};}});
vm.runInContext(extract('executeReturnWithLines'),returnSandbox);
vm.runInContext("executeReturnWithLines('SYNTH-INV','test',0,10,'Cash',[{productId:'SYNTH-A',qty:1,lineId:'LINE-A'},{productId:'SYNTH-B',qty:1,lineId:'LINE-B'}]);executeReturnWithLines('SYNTH-INV','test',0,10,'Cash',[{productId:'SYNTH-A',qty:1,lineId:'LINE-A'},{productId:'SYNTH-B',qty:1,lineId:'LINE-B'}]);",returnSandbox,{timeout:1000});
assert.equal(requests[0][1],'returned_partial');
assert.equal(requests[0][2].idempotencyKey,requests[1][2].idempotencyKey);
results.push({id:'return-key-characterization',status:'passed',note:'Observed unsafe legacy behavior: distinct same-shape partial returns receive an identical key; fix before website writes.'});
// Execute the original frozen-money function with in-memory service stubs.
const writes={};
const sr={map:{'Selling Price (BDT)':1,'Revenue (BDT)':2,'Product Cost (BDT)':3,'Profit (BDT)':4,'Pathao Fee at Sale (BDT)':5,'Invoice No':6},sheet:{getRange:(row,col,n)=>({getValues:()=>Array.from({length:n??1},()=>['SYNTH-INV']),clearContent(){return this;},setValues(values){writes[col]=values;return this;}})}};
const it={map:{'Invoice No':1},sheet:{getLastRow:()=>5}};
const frozen=vm.createContext({cols_:name=>name==='SR'?sr:it,SR_SHEET:'SR',IT_SHEET:'IT',IT_FIRST_ROW:6,IT_LAST_ROW:1005,ensureSrReversalColumns_:()=>{},setSrReversalDefaults_:()=>{},SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:()=>({getRange:()=>({getValue:()=>2})})})}});
vm.runInContext(extract('freezeSalesRecordMoneyAtSale_'),frozen);
vm.runInContext('freezeSalesRecordMoneyAtSale_(6,1,[153],[100],[1]);',frozen,{timeout:1000});
assert.equal(writes[5][0][0],3.06);assert.equal(writes[4][0][0],49.94);
results.push({id:'frozen-fee-source-example',status:'passed',note:'Original function stores fee 3.06 and profit 49.94 for sell=153,cost=100,quantity=1,pct=2; tracker picker uses a different basis.'});
const failed=results.filter(r=>r.status==='failed').length;
const report={source_syntax:'passed',scope:fixtures.scope,tests:results,passed:results.length-failed,failed,live_google_tests:'not run',warning:'Characterization passes document source behavior, including known unsafe cases; they are not production acceptance.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,failed,source_syntax:report.source_syntax,live_google_tests:report.live_google_tests}));
if(failed)process.exitCode=1;
