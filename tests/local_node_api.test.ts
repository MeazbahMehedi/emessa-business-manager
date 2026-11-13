import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { once } from 'node:events';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { localNodeApiMiddleware } from '../vite.config';
import { createApp } from '../worker/index';
import { issueSession } from '../worker/auth';
import type { Env, Fetcher } from '../worker/types';

const nativeFetch=globalThis.fetch;
const closes:Array<()=>Promise<void>>=[];
afterEach(async()=>{vi.unstubAllGlobals();await Promise.all(closes.splice(0).map(close=>close()));});
const environment=():Env=>({ASSETS:{fetch:async()=>new Response('asset')},APP_ENV:'local',LOCAL_DEMO:'false',APP_ORIGIN:'http://localhost:5173',SESSION_SECRET:'synthetic-secret-for-adapter-tests-over-32-characters',ADMIN_EMAIL:'owner@example.test',ADMIN_GOOGLE_SUB:'owner-sub',GOOGLE_CLIENT_ID:'adapter-test-client',GOOGLE_CLIENT_SECRET:'SYNTHETIC_PRIVATE_CLIENT'});
async function start(fetcher:Fetcher=vi.fn()){
 const env=environment();let middleware:ReturnType<typeof localNodeApiMiddleware>;
 const server=createServer((req,res)=>{void middleware(req,res,()=>{res.writeHead(204);res.end();});});
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('test server address');env.APP_ORIGIN='http://127.0.0.1:'+address.port;
 middleware=localNodeApiMiddleware(env,createApp(fetcher));
 closes.push(()=>new Promise<void>(resolve=>{server.closeAllConnections();server.close(()=>resolve());}));return {env,origin:env.APP_ORIGIN!};
}
let pair:Awaited<ReturnType<typeof generateKeyPair>>, jwk:Awaited<ReturnType<typeof exportJWK>>;
beforeAll(async()=>{pair=await generateKeyPair('RS256');jwk=await exportJWK(pair.publicKey);jwk.kid='adapter-key';});
async function login(account='owner@example.test'){
 let idToken='';const provider=vi.fn<Fetcher>(async()=>new Response(JSON.stringify({id_token:idToken}),{headers:{'content-type':'application/json'}}));const site=await start(provider);
 const begin=await nativeFetch(site.origin+'/auth/start',{redirect:'manual'});const google=new URL(begin.headers.get('location')!);const flow=begin.headers.getSetCookie()[0].split(';')[0];
 idToken=await new SignJWT({email:account,email_verified:true,nonce:google.searchParams.get('nonce'),name:'Owner'}).setSubject(account==='owner@example.test'?'owner-sub':'other-sub').setProtectedHeader({alg:'RS256',kid:'adapter-key'}).setIssuer('https://accounts.google.com').setAudience('adapter-test-client').setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
 vi.stubGlobal('fetch',async(input:RequestInfo|URL)=>{expect(String(input)).toBe('https://www.googleapis.com/oauth2/v3/certs');return new Response(JSON.stringify({keys:[jwk]}),{headers:{'content-type':'application/json'}});});
 const response=await nativeFetch(site.origin+'/auth/callback?state='+google.searchParams.get('state')+'&code=synthetic-code',{headers:{cookie:flow},redirect:'manual'});return {...site,response,provider};
}
describe('local Node API over real HTTP with unchanged owner checks',()=>{
 it('reports Google availability and no-store headers',async()=>{const site=await start();const response=await nativeFetch(site.origin+'/auth/bootstrap');expect(await response.json()).toMatchObject({data:{googleLoginAvailable:true,localPreviewAvailable:false}});expect(response.headers.get('cache-control')).toContain('no-store');});
 it('denies unauthenticated private data without provider access',async()=>{const provider=vi.fn<Fetcher>();const site=await start(provider);expect((await nativeFetch(site.origin+'/api/v1/workspace')).status).toBe(401);expect(provider).not.toHaveBeenCalled();});
 it('completes real encrypted-flow/JWT callback and preserves both Set-Cookie headers',async()=>{
  const site=await login();expect(site.response.status).toBe(302);expect(site.response.headers.get('location')).toBe('/overview');const cookies=site.response.headers.getSetCookie();expect(cookies).toHaveLength(2);expect(cookies.some(cookie=>cookie.startsWith('emessa-flow=;'))).toBe(true);const session=cookies.find(cookie=>cookie.startsWith('emessa-session='))!.split(';')[0];const me=await nativeFetch(site.origin+'/api/v1/me',{headers:{cookie:session}});expect(await me.json()).toMatchObject({data:{email:'owner@example.test',mode:'google'}});
 });
 it('denies a different Google account even with a valid provider signature',async()=>{const site=await login('other@example.test');expect(site.response.headers.get('location')).toContain('error=signin_failed');expect(site.response.headers.getSetCookie().some(cookie=>cookie.startsWith('emessa-session='))).toBe(false);});
 it('protects private pages before Vite serves the frontend',async()=>{const site=await start();const response=await nativeFetch(site.origin+'/overview',{redirect:'manual'});expect(response.status).toBe(302);expect(response.headers.get('location')).toBe('/login');});
 it('keeps CSRF protection on logout',async()=>{const site=await start();const token=await issueSession(new Request(site.origin),site.env,{sub:'owner-sub',email:'owner@example.test',name:'Owner',mode:'google'});expect((await nativeFetch(site.origin+'/auth/logout',{method:'POST',headers:{cookie:'emessa-session='+token}})).status).toBe(403);});
 it('rejects an unexpected Host header',async()=>{const site=await start();const status=await new Promise<number>((resolve,reject)=>{const req=httpRequest(site.origin+'/auth/bootstrap',{headers:{host:'other.example.test'}},response=>{response.resume();resolve(response.statusCode!);});req.on('error',reject);req.end();});expect(status).toBe(403);});
 it('bounds incoming request bodies',async()=>{const site=await start();expect((await nativeFetch(site.origin+'/auth/logout',{method:'POST',body:'x'.repeat(65537)})).status).toBe(413);});
 it('delegates login assets to Vite after the shared route policy',async()=>{const site=await start();expect((await nativeFetch(site.origin+'/login')).status).toBe(204);});
 it('cannot start the adapter for production or non-loopback origins',()=>{expect(()=>localNodeApiMiddleware({...environment(),APP_ENV:'production'})).toThrow();expect(()=>localNodeApiMiddleware({...environment(),APP_ORIGIN:'https://admin.example.test'})).toThrow();});
 it('rejects non-loopback peers and absolute cross-origin requests',async()=>{
  const middleware=localNodeApiMiddleware(environment());const deny=async(req:Partial<IncomingMessage>)=>{const result={status:0,text:''};const res={writeHead:(status:number)=>{result.status=status;},end:(value:string)=>{result.text=value;}} as unknown as ServerResponse;await middleware(req as IncomingMessage,res,()=>expect.fail('must deny'));expect(result.status).toBe(403);};
  await deny({url:'/auth/bootstrap',headers:{host:'localhost:5173'},socket:{remoteAddress:'192.0.2.2'} as IncomingMessage['socket']});await deny({url:'https://other.example.test/auth/bootstrap',headers:{host:'localhost:5173'},socket:{remoteAddress:'127.0.0.1'} as IncomingMessage['socket']});
 });
});
