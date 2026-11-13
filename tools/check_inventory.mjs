#!/usr/bin/env node
/** Safe owner-machine probe: no business rows, provider messages or grants are printed. */
import fs from 'node:fs';
import {setupDiagnostic} from './authorize_google.mjs';
if(fs.existsSync('.dev.vars'))process.loadEnvFile('.dev.vars');
const env=process.env;
const report={inventory_deployment_configured:/^[A-Za-z0-9_-]{10,220}$/.test(env.GOOGLE_INVENTORY_DEPLOYMENT_ID||''),inventory_grant_configured:!!env.GOOGLE_INVENTORY_REFRESH_TOKEN};
if(!report.inventory_deployment_configured||!report.inventory_grant_configured){console.log(JSON.stringify({...report,code:'WRITE_SETUP_REQUIRED'},null,2));process.exitCode=1;}
else {
 let stage='token-exchange';
 try{
  const tokenResponse=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_CLIENT_ID,client_secret:env.GOOGLE_CLIENT_SECRET,refresh_token:env.GOOGLE_INVENTORY_REFRESH_TOKEN}),signal:AbortSignal.timeout(20000)});
  report.token_http=tokenResponse.status;
  if(!tokenResponse.ok)throw new Error('token');const token=await tokenResponse.json();if(typeof token.access_token!=='string')throw new Error('token');
  stage='inventory-execution';
  const response=await fetch('https://script.googleapis.com/v1/scripts/'+env.GOOGLE_INVENTORY_DEPLOYMENT_ID+':run',{method:'POST',headers:{authorization:'Bearer '+token.access_token,'content-type':'application/json'},body:JSON.stringify({function:'emessaInventory',parameters:[{version:1,operation:'inventory.read'}],devMode:false}),signal:AbortSignal.timeout(25000)});
  report.execution_http=response.status;
  const body=await response.json();const reasons=(body.error?.details||[]).map(v=>v.reason).filter(v=>['SERVICE_DISABLED','ACCESS_TOKEN_SCOPE_INSUFFICIENT','CONSUMER_INVALID','RATE_LIMIT_EXCEEDED'].includes(v));if(reasons.length)report.api_reasons=[...new Set(reasons)];
  const result=body.response?.result;
  if(result?.ok&&['staging','live'].includes(result.data?.mode))Object.assign(report,{ok:true,mode:result.data.mode,enabled:result.data.enabled===true,product_count:Array.isArray(result.data.products)?result.data.products.length:null,remaining:result.data.remaining});
  else {const codes=['SETUP_REQUIRED','NOT_INITIALIZED','ALREADY_INITIALIZED','FORBIDDEN','SCHEMA_MISMATCH','FORMULA_MISMATCH','SOURCE_CHANGED','SOURCE_REVIEW_REQUIRED','WRITE_DISABLED','BUSY','LIVE_ACTIVATION_REQUIRED','STAGING_TARGET_REQUIRED'];report.code=codes.includes(result?.error?.code)?result.error.code:'INVENTORY_EXECUTION_FAILED';if(/^Product Inventory![A-Z]{1,2}[1-9][0-9]{0,3}$/.test(result?.error?.location||''))report.location=result.error.location;process.exitCode=1;}
 }catch(error){report.stage=stage;report.code=setupDiagnostic(error,stage).code;process.exitCode=1;}
 console.log(JSON.stringify(report,null,2));
}
