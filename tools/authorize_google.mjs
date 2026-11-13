#!/usr/bin/env node
/** Run on the owner's computer. Never prints authorization codes or tokens. */
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { randomBytes, createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { importOwnerClient, writePrivateSettings } from './google_local_settings.mjs';

// Only fixed diagnostic codes/messages leave the local process. Never print an
// exception message, token response body, callback URL, JWT or client secret.
export class SetupFailure extends Error {
  constructor(code) { super(code); this.code=code; }
}
const reasons={
  TOKEN_INVALID_CLIENT:'Google rejected the client credentials. Check the downloaded Web client JSON and whether that client/secret is still enabled.',
  TOKEN_INVALID_GRANT:'Google rejected the authorization code. Restart setup and open only the newly printed URL; a code can be used once.',
  TOKEN_REDIRECT_MISMATCH:'Google rejected the callback URL. Register http://127.0.0.1:8788/oauth/callback exactly.',
  TOKEN_REJECTED:'Google rejected the token exchange. Review the Web client, callback and consent settings.',
  TOKEN_BAD_RESPONSE:'Google did not return a valid token response.',
  MISSING_ID_TOKEN:'Google did not return an identity token. Review the identity permissions and restart setup.',
  MISSING_REFRESH_TOKEN:'Google did not return offline access. Restart setup and review the requested read permission.',
  MISSING_INVENTORY_SCOPE:'The inventory grant needs spreadsheet editing, app-created Drive files and email permissions.',
  MISSING_READ_SCOPE:'The spreadsheet read permission was not granted. Restart setup and include that permission.',
  WRONG_OWNER:'The signed-in Google account does not match the configured admin.',
  OWNER_SUBJECT_MISMATCH:'The Google identity differs from the previously configured owner. Do not replace the owner identity automatically.',
  EMAIL_UNVERIFIED:'Google did not report a verified owner email.',
  NONCE_MISMATCH:'The identity response does not match this setup attempt. Restart and use the new URL.',
  INVALID_OWNER_IDENTITY:'The verified token is missing a usable owner identity.',
  UNSAFE_OUTPUT:'The private output directory is not safe to use.',
};
export function setupDiagnostic(error,stage='setup') {
  if(error instanceof SetupFailure && Object.hasOwn(reasons,error.code))return {code:error.code,message:reasons[error.code]};
  const cause=error?.cause?.code || error?.code;
  if(['ENOTFOUND','EAI_AGAIN','ECONNRESET','ECONNREFUSED','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(cause))return {code:'GOOGLE_NETWORK_'+cause,message:'Node could not reach Google. Check this computer’s internet, DNS and authorized network/proxy settings.'};
  if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT_LOCALLY','ERR_TLS_CERT_ALTNAME_INVALID'].includes(cause))return {code:'GOOGLE_TLS_CERTIFICATE',message:'Node could not validate Google’s TLS connection. Check the system clock and trusted network certificate setup; keep TLS verification enabled.'};
  if(error?.name==='TimeoutError'||error?.name==='AbortError'||cause==='ERR_JWKS_TIMEOUT')return {code:'GOOGLE_TIMEOUT',message:'The Google request timed out. Check connectivity and restart setup.'};
  if(['ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ERR_JWS_INVALID','ERR_JWT_INVALID','ERR_JOSE_ALG_NOT_ALLOWED','ERR_JWKS_NO_MATCHING_KEY'].includes(cause))return {code:'IDENTITY_'+cause,message:'Google identity-token verification failed. Check the computer clock and use the new URL from a fresh setup attempt.'};
  if(['save-backup','save-config'].includes(stage))return {code:'LOCAL_SETTINGS_WRITE_FAILED',message:'Google authorization was received, but local settings could not be saved. Check folder write permissions. A private recovery file may exist under .oauth-local; do not share it.'};
  if(['token-exchange','verify-signature','network-check'].includes(stage))return {code:'GOOGLE_REQUEST_FAILED',message:'The Google request or response failed. Run node tools/authorize_google.mjs --check-network before retrying consent.'};
  return {code:'SETUP_FAILED',message:'Setup did not finish. Check the current stage and the owner/client configuration.'};
}
export async function exchangeGrant(parameters,fetcher=fetch,inventory=false) {
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:parameters,signal:AbortSignal.timeout(20000)});
  let tokens;try{tokens=await response.json();}catch{throw new SetupFailure('TOKEN_BAD_RESPONSE');}
  if(!response.ok){
    const codes={invalid_client:'TOKEN_INVALID_CLIENT',invalid_grant:'TOKEN_INVALID_GRANT',redirect_uri_mismatch:'TOKEN_REDIRECT_MISMATCH'};
    throw new SetupFailure(Object.hasOwn(codes,tokens?.error)?codes[tokens.error]:'TOKEN_REJECTED');
  }
  if(!tokens || typeof tokens!=='object')throw new SetupFailure('TOKEN_BAD_RESPONSE');
  if(typeof tokens.id_token!=='string'||!tokens.id_token)throw new SetupFailure('MISSING_ID_TOKEN');
  if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token)throw new SetupFailure('MISSING_REFRESH_TOKEN');
  const scopes=new Set(typeof tokens.scope==='string'?tokens.scope.split(/\s+/):[]);
  if(inventory){if(!['https://www.googleapis.com/auth/spreadsheets','https://www.googleapis.com/auth/drive.file','https://www.googleapis.com/auth/userinfo.email'].every(scope=>scopes.has(scope)))throw new SetupFailure('MISSING_INVENTORY_SCOPE');}
  else if(!scopes.has('https://www.googleapis.com/auth/spreadsheets.readonly'))throw new SetupFailure('MISSING_READ_SCOPE');
  return tokens;
}
export function checkOwnerIdentity(payload,{nonce,email,subject}) {
  if(payload.nonce!==nonce)throw new SetupFailure('NONCE_MISMATCH');
  if(payload.email_verified!==true)throw new SetupFailure('EMAIL_UNVERIFIED');
  if(typeof payload.sub!=='string'||!payload.sub||typeof payload.email!=='string')throw new SetupFailure('INVALID_OWNER_IDENTITY');
  if(payload.email.toLowerCase()!==email.toLowerCase())throw new SetupFailure('WRONG_OWNER');
  if(subject&&payload.sub!==subject)throw new SetupFailure('OWNER_SUBJECT_MISMATCH');
}
export async function probeGoogleNetwork(fetcher=fetch) {
  const targets=[['token-endpoint','https://oauth2.googleapis.com/token'],['signing-keys','https://www.googleapis.com/oauth2/v3/certs']];
  const results=[];
  for(const [name,url] of targets){
    try{const response=await fetcher(url,{signal:AbortSignal.timeout(15000)});const ok=name==='token-endpoint'?[200,400,404,405].includes(response.status):response.ok;results.push({name,ok,code:'HTTP_'+response.status});await response.body?.cancel();}
    catch(error){results.push({name,ok:false,...setupDiagnostic(error,'network-check')});}
  }
  return results;
}

async function main(){
if(process.argv.includes('--check-network')){
  const results=await probeGoogleNetwork();
  for(const result of results)console.log(result.name+': '+result.code+(result.message?' — '+result.message:''));
  if(results.some(result=>!result.ok))process.exitCode=1;
  return;
}
if(process.argv.includes('--help')){
  console.log('Owner-only connector setup. Add --inventory only for the separate Phase 3 inventory API.\nRun on your computer: npm run setup:google -- --client-json "C:\\path\\to\\your-client.json"\nThis imports the Web OAuth JSON into ignored .dev.vars and starts owner consent.\nAlternatively, fill ADMIN_EMAIL, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .dev.vars, then run npm run setup:google.\nBoth documented local callback URLs must be registered. No authorization codes, client secrets or tokens are printed.');
  process.exit(0);
}
const inventory=process.argv.includes('--inventory');
const argumentsList=process.argv.slice(2).filter(value=>value!=='--inventory');
if(argumentsList.length){
  if(argumentsList.length!==2||argumentsList[0]!=='--client-json'){
    console.error('Usage: npm run setup:google -- --client-json "path/to/downloaded-client.json"'); process.exit(1);
  }
  try{
    await importOwnerClient(path.resolve(argumentsList[1]),process.cwd());
    console.log('Web OAuth settings imported into ignored local configuration.');
  }catch{
    console.error('OAuth JSON was not imported. Check that it is a Web client from the EMESSA project with both documented callback URLs, and that the configuration path is a regular file.');process.exit(1);
  }
}
if(fsSync.existsSync('.dev.vars'))process.loadEnvFile('.dev.vars');
const {ADMIN_EMAIL,ADMIN_GOOGLE_SUB,GOOGLE_CLIENT_ID,GOOGLE_CLIENT_SECRET}=process.env;
if(!ADMIN_EMAIL||!GOOGLE_CLIENT_ID||!GOOGLE_CLIENT_SECRET){
  console.error('Set ADMIN_EMAIL, GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in your private local configuration first.');
  process.exit(1);
}
if(inventory&&!/^[A-Za-z0-9_-]{10,220}$/.test(process.env.GOOGLE_INVENTORY_DEPLOYMENT_ID||'')){console.error('Set GOOGLE_INVENTORY_DEPLOYMENT_ID in .dev.vars to the separately deployed inventory API first.');process.exitCode=1;return;}
const redirect='http://127.0.0.1:8788/oauth/callback';
const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url');
const authorization=new URL('https://accounts.google.com/o/oauth2/v2/auth');
authorization.search=new URLSearchParams({client_id:GOOGLE_CLIENT_ID,redirect_uri:redirect,response_type:'code',scope:inventory?'openid email profile https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file':'openid email profile https://www.googleapis.com/auth/spreadsheets.readonly',access_type:'offline',prompt:'consent',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
const keys=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
let finished=false,completed=false;
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/','http://127.0.0.1:8788');
  res.setHeader('cache-control','no-store');res.setHeader('referrer-policy','no-referrer');
  if(url.pathname==='/complete'){if(!completed){res.writeHead(400);res.end('Authorization has not completed. Return to the terminal.');return;}res.writeHead(200,{'content-type':'text/plain'});res.end('Authorization complete. Return to the terminal for the private configuration file.');return;}
  if(finished||url.pathname!=='/oauth/callback'||url.searchParams.get('state')!==state||!url.searchParams.get('code')){res.writeHead(400);res.end('Invalid or expired setup request.');return;}
  finished=true;
  let stage='token-exchange';
  try{
    const tokens=await exchangeGrant(new URLSearchParams({grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:redirect,client_id:GOOGLE_CLIENT_ID,client_secret:GOOGLE_CLIENT_SECRET,code_verifier:verifier}),fetch,inventory);
    stage='verify-signature';
    const {payload}=await jwtVerify(tokens.id_token,keys,{issuer:['https://accounts.google.com','accounts.google.com'],audience:GOOGLE_CLIENT_ID,algorithms:['RS256']});
    stage='verify-owner';
    checkOwnerIdentity(payload,{nonce,email:ADMIN_EMAIL,subject:ADMIN_GOOGLE_SUB});
    stage='save-backup';
    const directory=path.resolve('.oauth-local');
    await fs.mkdir(directory,{recursive:true,mode:0o700});
    if((await fs.lstat(directory)).isSymbolicLink())throw new SetupFailure('UNSAFE_OUTPUT');
    const secret=process.env.SESSION_SECRET&&process.env.SESSION_SECRET.length>=32?process.env.SESSION_SECRET:randomBytes(48).toString('base64url');
    const entries={ADMIN_EMAIL:payload.email,ADMIN_GOOGLE_SUB:payload.sub,[inventory?'GOOGLE_INVENTORY_REFRESH_TOKEN':'GOOGLE_REFRESH_TOKEN']:tokens.refresh_token,SESSION_SECRET:secret};
    const file=path.join(directory,(inventory?'inventory-connection-':'connection-')+Date.now()+'.env');
    await fs.writeFile(file,Object.entries(entries).map(([k,v])=>k+'='+JSON.stringify(v)).join('\n')+'\n',{mode:0o600,flag:'wx'});
    stage='save-config';
    await writePrivateSettings(path.resolve('.dev.vars'),entries);
    completed=true;
    console.log((inventory?'Owner identity and inventory grant verified.':'Owner identity and read-only grant verified.')+'\nLocal configuration updated. Private recovery settings saved to '+file+'\nRun npm run dev, then sign in at http://localhost:5173. Do not commit or share the private configuration.');
    res.writeHead(303,{location:'/complete'});res.end();
    clearTimeout(expiration);setTimeout(()=>server.close(),3000);
  }catch(error){
    const diagnostic=setupDiagnostic(error,stage);
    console.error('Authorization did not finish. Stage: '+stage+'; code: '+diagnostic.code+'\n'+diagnostic.message+'\nNo secrets or tokens are printed.');
    res.writeHead(403,{'content-type':'text/plain'});res.end('Owner authorization did not finish. Stage: '+stage+'; code: '+diagnostic.code+'. Return to PowerShell for instructions.');clearTimeout(expiration);server.close();process.exitCode=1;
  }
});
server.on('error',()=>{console.error('The local callback could not start on 127.0.0.1:8788. Close any program using that port and retry.');clearTimeout(expiration);process.exitCode=1;});
const expiration=setTimeout(()=>{console.error('Setup expired without completion. No credentials were saved.');server.close();},600000);
server.listen(8788,'127.0.0.1',()=>console.log('Open this Google consent URL on this computer and authorize the configured owner account:\n'+authorization.toString()+'\nWaiting for the local callback. No passwords or tokens are requested through chat.'));

}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)await main();
