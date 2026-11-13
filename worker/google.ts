import { AppError, type Env, type Fetcher } from './types';
import type { ConnectionData, WorkspaceData } from '../shared/types';

type ReadOperation = 'health' | 'workspace.read';
interface CachedToken { value:string; expires:number; key:string }
let tokenCache: CachedToken | undefined;

export function connectorConfigured(env: Env): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN &&
    env.GOOGLE_SCRIPT_DEPLOYMENT_ID && /^[A-Za-z0-9_-]{10,220}$/.test(env.GOOGLE_SCRIPT_DEPLOYMENT_ID));
}
export async function accessToken(env: Env, fetcher: Fetcher): Promise<string> {
  const cacheKey=env.GOOGLE_CLIENT_ID+'|'+env.GOOGLE_REFRESH_TOKEN;
  if(tokenCache?.key===cacheKey && tokenCache.expires>Date.now()+60000) return tokenCache.value;
  let response: Response;
  try{response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,refresh_token:env.GOOGLE_REFRESH_TOKEN!}),signal:AbortSignal.timeout(15000)});}
  catch{throw new AppError('GOOGLE_UNAVAILABLE','Google could not be reached. Please try again shortly.',502);}
  if(response.status===429)throw new AppError('QUOTA_EXCEEDED','Google is limiting requests. Wait a moment before trying again.',429);
  if(!response.ok){tokenCache=undefined;throw new AppError('GOOGLE_REAUTH_REQUIRED','The owner needs to reconnect Google authorization.',503);}
  const body=await response.json() as {access_token?:string;expires_in?:number};
  if(!body.access_token)throw new AppError('GOOGLE_REAUTH_REQUIRED','The owner needs to reconnect Google authorization.',503);
  tokenCache={key:cacheKey,value:body.access_token,expires:Date.now()+Math.min(Number(body.expires_in)||3600,3600)*1000};
  return body.access_token;
}
export async function googleRead<T>(env: Env, operation: ReadOperation, fetcher: Fetcher = fetch): Promise<T> {
  if(!['health','workspace.read'].includes(operation))throw new AppError('FORBIDDEN','Only approved read operations are available.',403);
  if(!connectorConfigured(env))throw new AppError('SETUP_REQUIRED','Connect your private Google Sheets to load business records.',503);
  const token=await accessToken(env,fetcher);
  let response: Response;
  try{response=await fetcher(`https://script.googleapis.com/v1/scripts/${env.GOOGLE_SCRIPT_DEPLOYMENT_ID}:run`,{
    method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},
    body:JSON.stringify({function:'emessaRead',parameters:[{version:1,operation}],devMode:false}),signal:AbortSignal.timeout(25000),
  });}catch{throw new AppError('GOOGLE_UNAVAILABLE','The Google connection took too long. No business changes were requested.',504);}
  if(response.status===401){tokenCache=undefined;throw new AppError('GOOGLE_REAUTH_REQUIRED','The owner needs to reconnect Google authorization.',503);}
  if(response.status===403)throw new AppError('GOOGLE_PERMISSION_REQUIRED','Google access is denied. Check the owner, API deployment and shared Cloud project.',503);
  if(response.status===429)throw new AppError('QUOTA_EXCEEDED','Google is limiting requests. Wait a moment before trying again.',429);
  if(!response.ok)throw new AppError('GOOGLE_UNAVAILABLE','The Google read service is temporarily unavailable.',502);
  const body=await response.json() as {done?:boolean;error?:unknown;response?:{result?:{ok:boolean;data?:T;error?:{code:string;message:string}}}};
  if(body.error || body.done===false)throw new AppError('GOOGLE_EXECUTION_FAILED','The read service could not complete. Check the connection setup.',502);
  const result=body.response?.result;
  if(!result?.ok || !result.data){
    const safeCodes=['FORBIDDEN','SCHEMA_MISMATCH','SETUP_REQUIRED','QUOTA_EXCEEDED'];
    const code=safeCodes.includes(result?.error?.code||'')?result!.error!.code:'GOOGLE_EXECUTION_FAILED';
    const messages:Record<string,string>={FORBIDDEN:'The Google read service rejected this owner account.',SCHEMA_MISMATCH:'The source Sheet headers do not match the expected layout.',SETUP_REQUIRED:'The Google read service needs its owner and Sheet IDs configured.',QUOTA_EXCEEDED:'Google is limiting reads. Please try again later.'};
    throw new AppError(code,messages[code]||'The read service could not load records.',503);
  }
  return result.data;
}
export function setupConnection(env: Env): ConnectionData {
  return {state:'setup_required',checkedAt:new Date().toISOString(),readOnly:true,checks:[
    {label:'Admin sign-in',status:'passed',detail:'Your authorized account has a verified session.'},
    {label:'Google read service',status:connectorConfigured(env)?'not_run':'needs_setup',detail:connectorConfigured(env)?'Ready for a connection check.':'Owner authorization and API deployment need to be configured.'},
    {label:'Sales and investment Sheets',status:'not_run',detail:'Sheet access has not been verified.'},
  ]};
}
export function validateWorkspace(value: WorkspaceData): WorkspaceData {
  const text=(v:unknown)=>typeof v==='string'&&v.length<=1000;
  const numeric=(v:unknown)=>v===null||(typeof v==='number'&&Number.isFinite(v));
  if(!value || value.mode!=='google' || !text(value.asOf) || !Number.isFinite(Date.parse(value.asOf)) || !text(value.timezone) ||
    !Array.isArray(value.products) || !Array.isArray(value.invoices) || value.products.length>200 || value.invoices.length>1000 ||
    !Array.isArray(value.warnings) || !value.warnings.every(text) ||
    !value.products.every(p=>p&&[p.id,p.sku,p.name,p.category].every(text)&&[p.openingStock,p.stock,p.price,p.cost].every(numeric)) ||
    !value.invoices.every(i=>i&&[i.id,i.number,i.date,i.customer,i.phone,i.paymentStatus,i.deliveryStatus,i.tracking].every(text)&&[i.total,i.expectedCredit,i.actualCredit].every(numeric)))
    throw new AppError('SCHEMA_MISMATCH','The Google read service returned an unexpected layout.',502);
  try {new Intl.DateTimeFormat('en',{timeZone:value.timezone});} catch {throw new AppError('SCHEMA_MISMATCH','The business timezone needs to be configured correctly.',502);}
  return value;
}

export function validateConnection(value: ConnectionData): ConnectionData {
  if(!value || !['connected','setup_required','attention'].includes(value.state) || value.readOnly!==true ||
    !Number.isFinite(Date.parse(value.checkedAt)) || !Array.isArray(value.checks) || value.checks.length>12 ||
    !value.checks.every(c=>c&&typeof c.label==='string'&&c.label.length<=200&&typeof c.detail==='string'&&c.detail.length<=1000&&['passed','needs_setup','not_run','failed'].includes(c.status)))
    throw new AppError('SCHEMA_MISMATCH','The Google connection check returned an unexpected layout.',502);
  return value;
}
