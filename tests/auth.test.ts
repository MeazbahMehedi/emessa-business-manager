import { describe, it, expect } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { appOrigin, beginGoogleLogin, cookieName, demoAllowed, googleLoginConfigured, issueSession, readSession, verifyGoogleIdentity } from '../worker/auth';
import type { Env } from '../worker/types';

const env:Env={ASSETS:{fetch:async()=>new Response('asset')},APP_ENV:'production',APP_ORIGIN:'https://admin.example.test',SESSION_SECRET:'unit-test-secret-with-over-32-characters',SESSION_VERSION:'1',ADMIN_EMAIL:'owner@example.test',ADMIN_GOOGLE_SUB:'owner-sub',GOOGLE_CLIENT_ID:'client-id',GOOGLE_CLIENT_SECRET:'test-client-secret'};
const request=new Request(env.APP_ORIGIN+'/overview');
async function authenticated(user={sub:'owner-sub',email:'owner@example.test',name:'Owner',mode:'google' as const},now=Date.now()){
 const token=await issueSession(request,env,user,now);return new Request(request,{headers:{cookie:`${cookieName(request,env,'session')}=${token}`}});
}
describe('private session boundary',()=>{
 it('accepts the configured owner with a signed, unexpired session',async()=>{const s=await readSession(await authenticated(),env);expect(s?.sub).toBe('owner-sub');expect(s?.csrf.length).toBeGreaterThan(30);});
 it('rejects tampered cookies',async()=>{const r=await authenticated();const cookie=r.headers.get('cookie')!;const at=cookie.lastIndexOf('.');expect(await readSession(new Request(r,{headers:{cookie:cookie.slice(0,at+1)+'bad-signature'}}),env)).toBeNull();});
 it('rejects another account even with a correctly signed test token',async()=>{expect(await readSession(await authenticated({sub:'other',email:'other@example.test',name:'Other',mode:'google'}),env)).toBeNull();});
 it('rejects expired sessions',async()=>{expect(await readSession(await authenticated(undefined,Date.now()-7200000),env)).toBeNull();});
 it('invalidates sessions after a version rotation',async()=>{expect(await readSession(await authenticated(),{...env,SESSION_VERSION:'2'})).toBeNull();});
 it('rejects a different application audience',async()=>{const token=await issueSession(request,env,{sub:'owner-sub',email:'owner@example.test',name:'Owner',mode:'google'});expect(await readSession(new Request('https://other.example.test/overview',{headers:{cookie:`__Host-emessa-session=${token}`}}),{...env,APP_ORIGIN:'https://other.example.test'})).toBeNull();});
 it('disables local preview in production even when its flag is set',()=>{expect(demoAllowed(request,{...env,LOCAL_DEMO:'true'})).toBe(false);});
 it('disables local preview on workers.dev even with local configuration',()=>{expect(demoAllowed(new Request('https://example.workers.dev/'),{...env,APP_ENV:'local',LOCAL_DEMO:'true'})).toBe(false);});
 it('allows only explicit local/preview configuration',()=>{expect(demoAllowed(new Request('http://localhost:5173/'),{...env,APP_ENV:'local',LOCAL_DEMO:'true'})).toBe(true);expect(demoAllowed(new Request('https://other.test/'),{...env,APP_ENV:'local',LOCAL_DEMO:'true'})).toBe(false);});
 it('never enables real Google sign-in on the HTTP synthetic preview',()=>{expect(googleLoginConfigured({...env,APP_ENV:'local',LOCAL_DEMO:'true',APP_ORIGIN:'http://terminal.local:4173',LOCAL_DEMO_ORIGIN:'http://terminal.local:4173'})).toBe(false);});
 it('rejects an unconfigured production origin',()=>{expect(()=>appOrigin(request,{...env,APP_ORIGIN:undefined})).toThrow();});
 it('generates nonce, state, and PKCE with an encrypted flow cookie',async()=>{const first=await beginGoogleLogin(request,env),second=await beginGoogleLogin(request,env);const url=new URL(first.url);expect(url.origin).toBe('https://accounts.google.com');expect(url.searchParams.get('code_challenge_method')).toBe('S256');expect(url.searchParams.get('state')).not.toBe(new URL(second.url).searchParams.get('state'));expect(first.cookie).toContain('HttpOnly');expect(first.cookie).toContain('Secure');expect(first.cookie).not.toContain('test-client-secret');});
});

describe('Google identity verification with real cryptography and local test keys',()=>{
 async function fixture(overrides:Record<string,unknown>={},options:{issuer?:string;audience?:string;expired?:boolean;otherKey?:boolean}={}){
  const pair=await generateKeyPair('RS256');const publicJwk=await exportJWK(pair.publicKey);publicJwk.kid='test';
  const signer=options.otherKey?(await generateKeyPair('RS256')).privateKey:pair.privateKey;
  const token=await new SignJWT({email:'owner@example.test',email_verified:true,nonce:'expected-nonce',name:'Owner',...overrides}).setSubject(String(overrides.sub||'owner-sub')).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(options.issuer||'https://accounts.google.com').setAudience(options.audience||'client-id').setIssuedAt().setExpirationTime(options.expired?'0s':'2m').sign(signer);
  return {token,resolver:createLocalJWKSet({keys:[publicJwk]})};
 }
 it('accepts only a verified owner identity',async()=>{const f=await fixture();expect((await verifyGoogleIdentity(f.token,env,'expected-nonce',f.resolver)).email).toBe('owner@example.test');});
 it.each([
  ['wrong email',{email:'other@example.test'},{}],['wrong subject',{sub:'other'},{}],['unverified email',{email_verified:false},{}],['wrong nonce',{nonce:'other'},{}],
  ['wrong audience',{}, {audience:'other-client'}],['wrong issuer',{}, {issuer:'https://attacker.test'}],['bad signature',{}, {otherKey:true}],['expired token',{}, {expired:true}],
 ])('rejects %s',async(_label,overrides,options)=>{const f=await fixture(overrides,options);await expect(verifyGoogleIdentity(f.token,env,'expected-nonce',f.resolver)).rejects.toThrow();});
});
