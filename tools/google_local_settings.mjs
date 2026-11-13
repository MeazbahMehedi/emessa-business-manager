/** Owner-machine setup only. Never log client secrets, grants or source JSON. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export const ownerRedirect = 'http://127.0.0.1:8788/oauth/callback';
export const loginRedirect = 'http://localhost:5173/auth/callback';
const reserved = new Set(['APP_ENV','APP_ORIGIN','LOCAL_DEMO','LOCAL_DEMO_ORIGIN','ADMIN_EMAIL','BUSINESS_TIMEZONE','SESSION_VERSION','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_SCRIPT_DEPLOYMENT_ID','ADMIN_GOOGLE_SUB','GOOGLE_REFRESH_TOKEN','GOOGLE_INVENTORY_REFRESH_TOKEN','GOOGLE_INVENTORY_DEPLOYMENT_ID','SESSION_SECRET']);

export function validateWebClient(document, projectId) {
  const client = document?.web;
  if (!client || typeof client !== 'object' || document.installed) throw new Error('Choose the Web application OAuth JSON downloaded from the EMESSA Cloud project.');
  if (client.project_id !== projectId) throw new Error('The OAuth JSON belongs to a different Cloud project.');
  if (typeof client.client_id !== 'string' || !/^[a-zA-Z0-9-]+\.apps\.googleusercontent\.com$/.test(client.client_id)) throw new Error('The OAuth client ID is invalid.');
  if (typeof client.client_secret !== 'string' || !client.client_secret.length || /[\r\n\0]/.test(client.client_secret)) throw new Error('The OAuth client secret is missing or invalid.');
  if (!Array.isArray(client.redirect_uris) || ![ownerRedirect,loginRedirect].every(uri=>client.redirect_uris.includes(uri))) throw new Error('Register both documented local callback URLs on the Web OAuth client, then download its JSON again.');
  if (client.auth_uri !== 'https://accounts.google.com/o/oauth2/auth' && client.auth_uri !== 'https://accounts.google.com/o/oauth2/v2/auth') throw new Error('The OAuth authorization endpoint is not Google.');
  if (client.token_uri !== 'https://oauth2.googleapis.com/token') throw new Error('The OAuth token endpoint is not Google.');
  return { clientId:client.client_id, clientSecret:client.client_secret };
}

export function mergePrivateSettings(original, values) {
  const lines=original.split(/\r?\n/).filter(line=>!reserved.has(line.match(/^\s*([A-Z_]+)\s*=/)?.[1]) || !Object.hasOwn(values,line.match(/^\s*([A-Z_]+)\s*=/)?.[1]));
  for (const [key,value] of Object.entries(values)) {
    if (!reserved.has(key) || typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new Error('Invalid private configuration value.');
    lines.push(key+'='+JSON.stringify(value));
  }
  return lines.filter((line,index,array)=>line!=='' || index<array.length-1).join('\n')+'\n';
}

async function existingRegularFile(file) {
  try { const info=await fs.lstat(file); if (!info.isFile() || info.isSymbolicLink()) throw new Error('Private configuration must be a regular file.'); return await fs.readFile(file,'utf8'); }
  catch(error) { if(error.code==='ENOENT')return ''; throw error; }
}

export async function writePrivateSettings(file, values) {
  const original=await existingRegularFile(file);
  const result=mergePrivateSettings(original,values);
  const temp=path.join(path.dirname(file),'.dev.vars.setup-'+randomBytes(12).toString('hex'));
  try { await fs.writeFile(temp,result,{mode:0o600,flag:'wx'}); await fs.rename(temp,file); }
  finally { await fs.unlink(temp).catch(()=>{}); }
}

export async function importOwnerClient(jsonPath, root) {
  const config=JSON.parse(await fs.readFile(path.join(root,'config/reader-project.json'),'utf8'));
  const client=validateWebClient(JSON.parse(await fs.readFile(jsonPath,'utf8')),config.standard_cloud_project_id);
  const envPath=path.join(root,'.dev.vars');
  const original=await existingRegularFile(envPath);
  // A different existing client/identity must not inherit an earlier connector grant.
  const existingClient=original.match(/^GOOGLE_CLIENT_ID\s*=\s*"?([^"\r\n]+)"?\s*$/m)?.[1];
  const existingOwner=original.match(/^ADMIN_EMAIL\s*=\s*"?([^"\r\n]+)"?\s*$/m)?.[1];
  const reset=existingClient!==client.clientId || existingOwner?.toLowerCase()!==config.owner_email.toLowerCase();
  const values={APP_ENV:'local',APP_ORIGIN:'http://localhost:5173',LOCAL_DEMO:'false',ADMIN_EMAIL:config.owner_email,BUSINESS_TIMEZONE:config.script_timezone,GOOGLE_CLIENT_ID:client.clientId,GOOGLE_CLIENT_SECRET:client.clientSecret,GOOGLE_SCRIPT_DEPLOYMENT_ID:config.api_deployment_id};
  if(reset)Object.assign(values,{ADMIN_GOOGLE_SUB:'',GOOGLE_REFRESH_TOKEN:'',GOOGLE_INVENTORY_REFRESH_TOKEN:'',GOOGLE_INVENTORY_DEPLOYMENT_ID:''});
  await writePrivateSettings(envPath,values);
  return envPath;
}
