import { SignJWT, jwtVerify, EncryptJWT, jwtDecrypt, createRemoteJWKSet } from 'jose';
import type { JWTVerifyGetKey } from 'jose';
import { AppError, type AdminSession, type Env, type Fetcher } from './types';

const LOCAL_KEY = 'local-sample-only-does-not-authorize-google-6e9635bb37e54097';
const GOOGLE_KEYS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
const encoder = new TextEncoder();
const isLoopback = (hostname: string) => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

export function configuredOrigin(env: Env): string | undefined {
  if (!env.APP_ORIGIN) return;
  try {
    const u = new URL(env.APP_ORIGIN);
    const localHttp = env.APP_ENV === 'local' && (isLoopback(u.hostname) || (u.hostname === 'terminal.local' && env.LOCAL_DEMO === 'true' && env.LOCAL_DEMO_ORIGIN === u.origin));
    if (u.origin !== env.APP_ORIGIN || u.username || u.password || (u.protocol !== 'https:' && !localHttp)) return;
    return u.origin;
  } catch { return; }
}
export function appOrigin(request: Request, env: Env): string {
  const origin = configuredOrigin(env);
  if (origin) return origin;
  const u = new URL(request.url);
  if (env.APP_ENV === 'local' && isLoopback(u.hostname)) return u.origin;
  throw new AppError('SETUP_REQUIRED', 'The private workspace address has not been configured.', 503);
}
export function demoAllowed(request: Request, env: Env): boolean {
  if (env.APP_ENV !== 'local' || env.LOCAL_DEMO !== 'true') return false;
  const u = new URL(request.url);
  if (u.hostname.endsWith('.workers.dev')) return false;
  if (isLoopback(u.hostname)) return true;
  const preview = configuredOrigin(env);
  return !!preview && preview === env.LOCAL_DEMO_ORIGIN && !new URL(preview).hostname.endsWith('.workers.dev');
}
export function googleLoginConfigured(env: Env): boolean {
  const origin = configuredOrigin(env);
  if (!origin || (origin.startsWith('http:') && !isLoopback(new URL(origin).hostname))) return false;
  return !!(env.SESSION_SECRET && env.SESSION_SECRET.length >= 32 &&
    env.ADMIN_EMAIL && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.ADMIN_EMAIL) &&
    env.ADMIN_GOOGLE_SUB && env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}
function secret(request: Request, env: Env): string {
  if (env.SESSION_SECRET && env.SESSION_SECRET.length >= 32) return env.SESSION_SECRET;
  if (demoAllowed(request, env)) return LOCAL_KEY;
  throw new AppError('SETUP_REQUIRED', 'Secure admin sign-in has not been configured.', 503);
}
async function key(request: Request, env: Env, purpose: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(purpose + ':' + secret(request, env))));
}
export function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
}
export function cookies(request: Request): Record<string,string> {
  const result: Record<string,string> = Object.create(null);
  for (const pair of (request.headers.get('cookie') || '').split(';')) {
    const at = pair.indexOf('=');
    if (at > 0) result[pair.slice(0,at).trim()] = pair.slice(at+1).trim();
  }
  return result;
}
function secureOrigin(request: Request, env: Env): boolean {
  return (configuredOrigin(env) || new URL(request.url).origin).startsWith('https://');
}
export function cookieName(request: Request, env: Env, kind: 'session' | 'flow') {
  return (secureOrigin(request,env) ? '__Host-' : '') + 'emessa-' + kind;
}
export function setCookie(request: Request, env: Env, kind: 'session' | 'flow', value: string, age: number): string {
  return `${cookieName(request,env,kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secureOrigin(request,env)?'; Secure':''}`;
}

export async function issueSession(request: Request, env: Env, user: {sub:string;email:string;name:string;mode:'sample'|'google'}, now = Date.now()) {
  const iat = Math.floor(now/1000);
  return new SignJWT({...user, csrf:randomToken(), version:env.SESSION_VERSION || '1'})
    .setProtectedHeader({alg:'HS256',typ:'JWT'}).setIssuer('emessa-admin').setAudience(appOrigin(request,env))
    .setIssuedAt(iat).setExpirationTime(iat+3600).sign(await key(request,env,'session'));
}
export async function readSession(request: Request, env: Env, now = Date.now()): Promise<AdminSession | null> {
  const token = cookies(request)[cookieName(request,env,'session')];
  if (!token) return null;
  try {
    const {payload:p} = await jwtVerify(token,await key(request,env,'session'),{issuer:'emessa-admin',audience:appOrigin(request,env),algorithms:['HS256'],currentDate:new Date(now)});
    if (p.version !== (env.SESSION_VERSION || '1') || typeof p.sub !== 'string' || typeof p.email !== 'string' || typeof p.name !== 'string' || typeof p.csrf !== 'string' || typeof p.exp !== 'number') return null;
    if (p.mode === 'sample') {
      if (!demoAllowed(request,env) || p.sub !== 'local-synthetic-preview') return null;
    } else if (p.mode === 'google') {
      if (!googleLoginConfigured(env) || p.sub !== env.ADMIN_GOOGLE_SUB || p.email.toLowerCase() !== env.ADMIN_EMAIL!.toLowerCase()) return null;
    } else return null;
    return p as unknown as AdminSession;
  } catch { return null; }
}
export function checkOrigin(request: Request, env: Env): void {
  if (request.headers.get('origin') !== appOrigin(request,env) || request.headers.get('sec-fetch-site') === 'cross-site')
    throw new AppError('FORBIDDEN','This action must come from your private workspace.',403);
}
export function checkCsrf(request: Request, env: Env, session: AdminSession): void {
  checkOrigin(request,env);
  const supplied = request.headers.get('x-csrf-token') || '';
  if (!supplied || supplied.length !== session.csrf.length) throw new AppError('FORBIDDEN','Refresh the page before trying this action again.',403);
  let difference=0;
  for (let i=0;i<supplied.length;i++) difference |= supplied.charCodeAt(i)^session.csrf.charCodeAt(i);
  if (difference) throw new AppError('FORBIDDEN','Refresh the page before trying this action again.',403);
}

export interface VerifiedGoogle { sub:string;email:string;name:string }
export async function verifyGoogleIdentity(token: string, env: Env, nonce: string, resolver: JWTVerifyGetKey = GOOGLE_KEYS): Promise<VerifiedGoogle> {
  if (!env.GOOGLE_CLIENT_ID || !env.ADMIN_EMAIL || !env.ADMIN_GOOGLE_SUB) throw new AppError('SETUP_REQUIRED','The admin identity has not been configured.',503);
  const {payload:p}=await jwtVerify(token,resolver,{issuer:['https://accounts.google.com','accounts.google.com'],audience:env.GOOGLE_CLIENT_ID,algorithms:['RS256']});
  if (p.nonce !== nonce || p.email_verified !== true || typeof p.email !== 'string' || typeof p.sub !== 'string' ||
    !env.ADMIN_EMAIL || !env.ADMIN_GOOGLE_SUB || p.email.toLowerCase() !== env.ADMIN_EMAIL.toLowerCase() || p.sub !== env.ADMIN_GOOGLE_SUB)
    throw new AppError('FORBIDDEN','This Google account is not authorized for this workspace.',403);
  return {sub:p.sub,email:p.email,name:typeof p.name==='string'?p.name:'Admin'};
}

export async function beginGoogleLogin(request: Request, env: Env) {
  if (!googleLoginConfigured(env)) throw new AppError('SETUP_REQUIRED','Google admin sign-in needs to be configured first.',503);
  const state=randomToken(),nonce=randomToken(),verifier=randomToken();
  const flow=await new EncryptJWT({state,nonce,verifier}).setProtectedHeader({alg:'dir',enc:'A256GCM'})
    .setAudience(appOrigin(request,env)).setIssuedAt().setExpirationTime('10m').encrypt(await key(request,env,'oauth-flow'));
  const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(verifier)));
  const challenge=btoa(String.fromCharCode(...hash)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search=new URLSearchParams({client_id:env.GOOGLE_CLIENT_ID!,redirect_uri:appOrigin(request,env)+'/auth/callback',response_type:'code',scope:'openid email profile',state,nonce,code_challenge:challenge,code_challenge_method:'S256',prompt:'select_account'}).toString();
  return {url:url.toString(),cookie:setCookie(request,env,'flow',flow,600)};
}
export async function finishGoogleLogin(request: Request, env: Env, fetcher: Fetcher = fetch) {
  if (!googleLoginConfigured(env)) throw new AppError('SETUP_REQUIRED','Google sign-in is not configured.',503);
  const url=new URL(request.url),state=url.searchParams.get('state'),code=url.searchParams.get('code');
  const flowCookie=cookies(request)[cookieName(request,env,'flow')];
  if (!state || !code || !flowCookie || url.searchParams.has('error')) throw new AppError('FORBIDDEN','Google sign-in could not be completed.',403);
  let p;
  try {p=(await jwtDecrypt(flowCookie,await key(request,env,'oauth-flow'),{audience:appOrigin(request,env),keyManagementAlgorithms:['dir'],contentEncryptionAlgorithms:['A256GCM']})).payload;}
  catch {throw new AppError('FORBIDDEN','The sign-in request expired. Please try again.',403);}
  if(p.state!==state || typeof p.nonce!=='string' || typeof p.verifier!=='string') throw new AppError('FORBIDDEN','The sign-in request is invalid.',403);
  const response=await fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'authorization_code',code,client_id:env.GOOGLE_CLIENT_ID!,client_secret:env.GOOGLE_CLIENT_SECRET!,redirect_uri:appOrigin(request,env)+'/auth/callback',code_verifier:p.verifier}),signal:AbortSignal.timeout(15000)});
  if(!response.ok) throw new AppError('GOOGLE_SIGNIN_FAILED','Google sign-in failed. Please try again.',403);
  const body=await response.json() as {id_token?:string};
  if(!body.id_token)throw new AppError('GOOGLE_SIGNIN_FAILED','Google did not return a verified sign-in.',403);
  const user=await verifyGoogleIdentity(body.id_token,env,p.nonce);
  return issueSession(request,env,{...user,mode:'google'});
}
