import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../apps-script/ReadApi.gs',import.meta.url),'utf8');
const manifest=JSON.parse(fs.readFileSync(new URL('../apps-script/appsscript.json',import.meta.url),'utf8'));
const productHeaders=['Product ID','Product Name','Category','Initial Stock\n(PCS)','Current Stock\n(PCS)','Selling Price\n/ unit (BDT)','Total Investment\n/ unit (BDT)'];
const invoiceHeaders=['Invoice No','Date','Invoice Total\n(BDT)','Payment\nStatus','Delivery\nStatus','Customer\nName','Tracking\nNumber','Expected Bank\nCredit','Actual Bank Credit'];
function reader(options:{owner?:string;badSchema?:boolean;duplicate?:boolean;salesZone?:string;investmentZone?:string;missingZone?:boolean;badInvestmentSchema?:boolean}={}){
 let reads=0;
 const spreadsheets={
  get:(id:string)=>{
   reads++;
   return {properties:options.missingZone?{}:{timeZone:id==='SALES_TEST_IDENTIFIER'?(options.salesZone??'Asia/Dhaka'):(options.investmentZone??'Asia/Dhaka')},sheets:['Product Inventory','Invoice Tracker','Sales Record','Invoice Line Items','Returns','Sales Archive','Batch Master','Product Entry','Weight & Shipping','Marketing & Packing','Other Expenses'].map(title=>({properties:{title}}))};
  },
  Values:{batchGet:(_id:string,optionsIn:{ranges:string[]})=>{
   reads++;
   const ranges=optionsIn.ranges;
   let arrays:unknown[][][];
   if(ranges[0].includes('Batch Master')) arrays=[[options.badInvestmentSchema?['Wrong']:['Batch ID','Initial Investment (BDT)','RMB Received']],[['Batch ID','Product ID / SKU','Quantity']]];
   else if(ranges[0].endsWith('AB5')) arrays=[[productHeaders],[invoiceHeaders]];
   else arrays=[[options.badSchema?['Wrong']:productHeaders,['SYNTH-A','Synthetic bag','Bags',10,8,150,100]], [invoiceHeaders,['SYNTH-I',46331,300,'Pending','Processing','Synthetic customer','SYNTH-TRACK',294,0]]];
   if(options.duplicate)arrays[0][0]=[...productHeaders,'Product ID'];
   return {valueRanges:arrays.map(values=>({values}))};
  }}
 };
 const sandbox={
  PropertiesService:{getScriptProperties:()=>({getProperties:()=>({ADMIN_EMAIL:'owner@example.test',SALES_SPREADSHEET_ID:'SALES_TEST_IDENTIFIER',INVESTMENT_SPREADSHEET_ID:'INVESTMENT_TEST_IDENTIFIER'})})},
  Session:{getEffectiveUser:()=>({getEmail:()=>options.owner??'owner@example.test'})},
  Sheets:{Spreadsheets:spreadsheets},
  emessaRead:undefined as unknown as (request:unknown)=>unknown,
 };
 vm.createContext(sandbox);new vm.Script(source).runInContext(sandbox);
 return {read:(operation:string)=>JSON.parse(JSON.stringify(sandbox.emessaRead({version:1,operation}))),reads:()=>reads};
}
describe('Apps Script owner-only read API',()=>{
 it('uses the owner-only manifest with no spreadsheet write scope',()=>{expect(manifest.executionApi.access).toBe('MYSELF');expect(manifest.oauthScopes).toContain('https://www.googleapis.com/auth/spreadsheets.readonly');expect(manifest.oauthScopes).not.toContain('https://www.googleapis.com/auth/spreadsheets');});
 it('rejects a different effective user without reading any Sheet',()=>{const r=reader({owner:'other@example.test'});expect(r.read('workspace.read').error.code).toBe('FORBIDDEN');expect(r.reads()).toBe(0);});
 it('rejects mutation names without touching a Sheet',()=>{const r=reader();expect(r.read('invoice.save').error.code).toBe('FORBIDDEN');expect(r.reads()).toBe(0);});
 it('normalizes newlines and returns mapped data rather than raw rows',()=>{const r=reader().read('workspace.read');expect(r.ok).toBe(true);expect(r.data.products[0]).toMatchObject({sku:'SYNTH-A',stock:8,price:150});expect(r.data.invoices[0]).toMatchObject({number:'SYNTH-I',expectedCredit:294,actualCredit:0});expect(JSON.stringify(r)).not.toContain('SPREADSHEET_ID');});
 it('fails safely for missing and duplicate headers',()=>{expect(reader({badSchema:true}).read('workspace.read').error.code).toBe('SCHEMA_MISMATCH');expect(reader({duplicate:true}).read('workspace.read').error.code).toBe('SCHEMA_MISMATCH');});
 it('checks both workbooks using read services only',()=>{const r=reader().read('health');expect(r.ok).toBe(true);expect(r.data.state).toBe('connected');expect(r.data.readOnly).toBe(true);});
 it.each(['salesZone','investmentZone'] as const)('flags a %s date-boundary mismatch even when source headers match',(key)=>{const r=reader({[key]:'America/Los_Angeles'}).read('health');expect(r.ok).toBe(true);expect(r.data.state).toBe('attention');expect(r.data.checks.some((c:{status:string;detail:string})=>c.status==='failed'&&c.detail.includes('America/Los_Angeles'))).toBe(true);expect(r.data.readOnly).toBe(true);});
 it('does not report full connection health when source timezone metadata is unavailable',()=>{const r=reader({missingZone:true}).read('health');expect(r.data.state).toBe('attention');expect(r.data.checks.filter((c:{status:string})=>c.status==='not_run')).toHaveLength(2);});
 it('keeps a failed investment header check out of connected state',()=>{const r=reader({badInvestmentSchema:true}).read('health');expect(r.ok).toBe(true);expect(r.data.state).toBe('setup_required');expect(r.data.checks.some((c:{label:string;status:string})=>c.label==='Investment Sheet'&&c.status==='failed')).toBe(true);});
});
