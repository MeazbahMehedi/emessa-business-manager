import { Hono } from 'hono';
import {boundedInventoryJson,googleInventory,inventoryConfigured,inventoryError,inventoryImage,validateInventoryResult,validateInventorySnapshot,validateUpload} from './inventory';
import {validateInventoryCommand} from '../shared/inventory';
import type {InventoryOperationStatus,InventorySnapshot} from '../shared/inventory-api';
import { appOrigin, beginGoogleLogin, checkCsrf, checkOrigin, demoAllowed, finishGoogleLogin, googleLoginConfigured, issueSession, readSession, setCookie } from './auth';
import { connectorConfigured, googleRead, setupConnection, validateConnection, validateWorkspace } from './google';
import { sampleConnection, sampleWorkspace } from './sample';
import { AppError, type AdminSession, type Env, type Fetcher } from './types';
import type { ConnectionData, SessionView, WorkspaceData } from '../shared/types';

type Bindings = { Bindings:Env; Variables:{requestId:string;session:AdminSession} };
export function createApp(fetcher: Fetcher = fetch) {
  const app = new Hono<Bindings>();
  app.use('*',async(c,next)=>{
    c.set('requestId',crypto.randomUUID());
    await next();
    const headers=new Headers(c.res.headers);
    headers.set('cache-control','no-store, max-age=0');
    headers.set('x-content-type-options','nosniff');
    headers.set('referrer-policy','no-referrer');
    headers.set('x-frame-options','DENY');
    headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');
    headers.set('x-request-id',c.get('requestId'));
    if(c.env.APP_ENV!=='local') {
      headers.set('content-security-policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
      headers.set('strict-transport-security','max-age=31536000');
    }
    c.res=new Response(c.res.body,{status:c.res.status,statusText:c.res.statusText,headers});
  });
  app.onError((error,c)=>{
    const safe=error instanceof AppError?error:new AppError('INTERNAL_ERROR','The workspace could not complete this request. Please try again.',500);
    return c.json({ok:false,error:{code:safe.code,message:safe.message},requestId:c.get('requestId')},safe.status as 400);
  });
  const ok=<T>(c:any,data:T)=>c.json({ok:true,data,requestId:c.get('requestId')});

  app.get('/auth/bootstrap',c=>ok(c,{googleLoginAvailable:googleLoginConfigured(c.env),localPreviewAvailable:demoAllowed(c.req.raw,c.env)}));
  app.get('/auth/start',async c=>{
    const login=await beginGoogleLogin(c.req.raw,c.env);
    c.header('set-cookie',login.cookie);return c.redirect(login.url,302);
  });
  app.get('/auth/callback',async c=>{
    c.header('set-cookie',setCookie(c.req.raw,c.env,'flow','',0));
    try{
      const token=await finishGoogleLogin(c.req.raw,c.env,fetcher);
      c.header('set-cookie',setCookie(c.req.raw,c.env,'session',token,3600),{append:true});
      return c.redirect('/overview',302);
    }catch(error){
      const failure=error as {code?:string;cause?:{code?:string}};
      const known=['FORBIDDEN','SETUP_REQUIRED','GOOGLE_SIGNIN_FAILED','UND_ERR_CONNECT_TIMEOUT','ERR_JWKS_TIMEOUT','ERR_JWT_EXPIRED','ERR_JWT_CLAIM_VALIDATION_FAILED','ERR_JWS_SIGNATURE_VERIFICATION_FAILED','ENOTFOUND','ECONNRESET'];
      const raw=failure?.cause?.code || failure?.code || '';
      const reason=known.includes(raw)?raw:'SIGNIN_FAILED';
      console.warn('[EMESSA sign-in] '+reason);
      return c.redirect('/login?error=signin_failed'+(c.env.APP_ENV==='local'?'&reason='+reason:''),302);
    }
  });
  app.post('/auth/local-preview',async c=>{
    if(!demoAllowed(c.req.raw,c.env))throw new AppError('NOT_FOUND','This route is unavailable.',404);
    checkOrigin(c.req.raw,c.env);
    if(c.req.header('x-emessa-preview')!=='1')throw new AppError('FORBIDDEN','Open the sample workspace from the sign-in page.',403);
    const token=await issueSession(c.req.raw,c.env,{sub:'local-synthetic-preview',name:'Local preview',email:'',mode:'sample'});
    c.header('set-cookie',setCookie(c.req.raw,c.env,'session',token,3600));return ok(c,{signedIn:true});
  });
  app.post('/auth/logout',async c=>{
    const session=await readSession(c.req.raw,c.env);
    if(!session)throw new AppError('UNAUTHENTICATED','Sign in to continue.',401);
    checkCsrf(c.req.raw,c.env,session);
    c.header('set-cookie',setCookie(c.req.raw,c.env,'session','',0));return ok(c,{signedOut:true});
  });

  app.use('/api/*',async(c,next)=>{
    const session=await readSession(c.req.raw,c.env);
    if(!session)throw new AppError('UNAUTHENTICATED','Sign in to your private workspace.',401);
    c.set('session',session);
    if(c.req.method!=='GET'){
      if(c.req.method!=='POST'||!['/api/v1/inventory/commands','/api/v1/inventory/assets'].includes(new URL(c.req.url).pathname)){
        c.header('allow','GET');throw new AppError('READ_ONLY','This operation currently supports viewing records only.',405);
      }
      checkCsrf(c.req.raw,c.env,session);
      if(session.mode!=='google')throw new AppError('READ_ONLY','Sample records cannot be changed.',405);
      if(!inventoryConfigured(c.env))throw new AppError('WRITE_SETUP_REQUIRED','The inventory save service is not connected yet.',503);
    }
    await next();
  });
  app.get('/api/v1/me',c=>{
    const s=c.get('session');
    return ok<SessionView>(c,{name:s.name,email:s.email,mode:s.mode,csrfToken:s.csrf,expiresAt:new Date(s.exp*1000).toISOString()});
  });
  async function loadWorkspace(env:Env,session:AdminSession){
    if(session.mode==='sample')return structuredClone(sampleWorkspace);
    return validateWorkspace(await googleRead<WorkspaceData>(env,'workspace.read',fetcher));
  }
  app.get('/api/v1/workspace',async c=>ok(c,await loadWorkspace(c.env,c.get('session'))));
  app.get('/api/v1/products',async c=>{
    const q=(c.req.query('q')||'').trim().toLowerCase(),category=c.req.query('category')||'';
    const offset=Number(c.req.query('offset')||0),limit=Number(c.req.query('limit')||20);
    if(q.length>100 || category.length>100 || !Number.isInteger(offset)||offset<0||offset>10000||!Number.isInteger(limit)||limit<1||limit>50)
      throw new AppError('INVALID_INPUT','Use a shorter search and a valid page size.',400);
    const data=await loadWorkspace(c.env,c.get('session'));
    const rows=data.products.filter(p=>(!q||[p.sku,p.name,p.category].some(x=>x.toLowerCase().includes(q)))&&(!category||p.category===category));
    return ok(c,{items:rows.slice(offset,offset+limit),total:rows.length,offset,limit,asOf:data.asOf,mode:data.mode});
  });
  app.get('/api/v1/inventory',async c=>{
    if(c.get('session').mode==='sample'||!inventoryConfigured(c.env))return ok(c,{configured:false,enabled:false});
    const value=validateInventorySnapshot(await googleInventory<InventorySnapshot>(c.env,'inventory.read',{},fetcher));
    return ok(c,{configured:true,...value});
  });
  app.post('/api/v1/inventory/commands',async c=>{
    const raw=await boundedInventoryJson(c.req.raw);
    let command;try{command=validateInventoryCommand(raw);}catch(error){inventoryError(error);}
    const workspaceId=c.req.header('x-inventory-workspace');if(!/^[a-f0-9]{64}$/.test(workspaceId||''))throw new AppError('WORKSPACE_CHANGED','Reload the inventory connection before saving.',409);
    const result=await googleInventory<any>(c.env,'inventory.command',{command,workspaceId},fetcher);
    return ok(c,validateInventoryResult(result,command));
  });
  app.get('/api/v1/inventory/operations/:id',async c=>{
    if(c.get('session').mode!=='google')throw new AppError('READ_ONLY','Sample records have no saved operations.',405);
    const requestId=c.req.param('id');if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId))throw new AppError('INVALID_INPUT','The operation ID is invalid.',400);
    const value=await googleInventory<InventoryOperationStatus>(c.env,'inventory.status',{requestId},fetcher);
    if(value?.state==='committed')validateInventoryResult(value.result);
    else if(value?.state!=='not_found')throw new AppError('SCHEMA_MISMATCH','The operation status needs review.',502);
    return ok(c,value);
  });
  app.post('/api/v1/inventory/assets',async c=>{
    const upload=validateUpload(await boundedInventoryJson(c.req.raw));
    const workspaceId=c.req.header('x-inventory-workspace');if(!/^[a-f0-9]{64}$/.test(workspaceId||''))throw new AppError('WORKSPACE_CHANGED','Reload inventory before uploading.',409);
    const result=await googleInventory<{assetId:string;status:string}>(c.env,'asset.upload',{...upload,workspaceId},fetcher);
    if(result?.assetId!=='a_'+upload.requestId.replaceAll('-','')||!['ready','attached'].includes(result?.status))throw new AppError('SAVE_UNCERTAIN','The image upload result is unconfirmed. Retry the same upload.',502);
    return ok(c,result);
  });
  app.get('/api/v1/inventory/assets/:id',async c=>{
    if(c.get('session').mode!=='google')throw new AppError('NOT_FOUND','Image not found.',404);
    return inventoryImage(c.env,c.req.param('id'),fetcher);
  });
  app.get('/api/v1/invoices',async c=>{
    const data=await loadWorkspace(c.env,c.get('session'));
    return ok(c,{items:data.invoices,asOf:data.asOf,mode:data.mode});
  });
  app.get('/api/v1/health',async c=>{
    if(c.get('session').mode==='sample')return ok(c,sampleConnection());
    if(!connectorConfigured(c.env))return ok(c,setupConnection(c.env));
    try{return ok(c,validateConnection(await googleRead<ConnectionData>(c.env,'health',fetcher)));}
    catch(error){
      const e=error instanceof AppError?error:new AppError('GOOGLE_UNAVAILABLE','Google is unavailable.',502);
      return ok<ConnectionData>(c,{state:'attention',checkedAt:new Date().toISOString(),readOnly:true,checks:[
        {label:'Admin sign-in',status:'passed',detail:'Your authorized account has a verified session.'},
        {label:'Google read service',status:'failed',detail:e.message},
        {label:'Source Sheets',status:'not_run',detail:'Source access has not been confirmed.'},
      ]});
    }
  });
  app.all('/api/*',c=>{throw new AppError('NOT_FOUND','This read operation is not available.',404);});
  app.all('*',async c=>{
    if(!['GET','HEAD'].includes(c.req.method))throw new AppError('READ_ONLY','This operation is not available.',405);
    const pathname=new URL(c.req.url).pathname;
    const publicAsset=/^\/assets\/[A-Za-z0-9_.-]+\.(js|css|woff2)$/.test(pathname);
    const devAsset=c.env.APP_ENV==='local' && /^\/(web\/|shared\/|@vite\/|@react-refresh|node_modules\/|@id\/|@fs\/)/.test(pathname);
    if(pathname!=='/login' && !publicAsset && !devAsset && !(await readSession(c.req.raw,c.env)))return c.redirect('/login',302);
    if(!c.env.ASSETS)throw new AppError('SETUP_REQUIRED','Build the website assets before opening the workspace.',503);
    return c.env.ASSETS.fetch(c.req.raw);
  });
  return app;
}

export default createApp();
