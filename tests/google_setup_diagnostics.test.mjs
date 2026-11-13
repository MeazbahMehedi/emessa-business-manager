import { describe, expect, it } from 'vitest';
import {checkOwnerIdentity,exchangeGrant,probeGoogleNetwork,setupDiagnostic} from '../tools/authorize_google.mjs';
const credentials='SYNTHETIC-PRIVATE-CREDENTIAL';
const validTokens=()=>({id_token:'synthetic-identity-token',refresh_token:'synthetic-refresh-token',scope:'openid https://www.googleapis.com/auth/spreadsheets.readonly'});
const owner={nonce:'expected',email:'owner@example.test',subject:'owner-sub'};
const validIdentity=()=>({nonce:'expected',email:'owner@example.test',email_verified:true,sub:'owner-sub'});
const post=body=>async()=>new Response(JSON.stringify(body),{status:200});

describe('private Google setup diagnostics',()=>{
 it.each([['invalid_client','TOKEN_INVALID_CLIENT'],['invalid_grant','TOKEN_INVALID_GRANT'],['redirect_uri_mismatch','TOKEN_REDIRECT_MISMATCH'],[credentials,'TOKEN_REJECTED']])('reports %s without echoing provider text',async(error,code)=>{
  try{await exchangeGrant(new URLSearchParams(),async()=>new Response(JSON.stringify({error,error_description:credentials,refresh_token:credentials}),{status:400}));expect.fail('must reject');}
  catch(failure){const safe=setupDiagnostic(failure,'token-exchange');expect(safe.code).toBe(code);expect(JSON.stringify(safe)).not.toContain(credentials);}
 });
 it.each([['id_token','MISSING_ID_TOKEN'],['refresh_token','MISSING_REFRESH_TOKEN'],['scope','MISSING_READ_SCOPE']])('rejects missing %s',async(key,code)=>{
  const tokens=validTokens();delete tokens[key];await expect(exchangeGrant(new URLSearchParams(),post(tokens))).rejects.toMatchObject({code});
 });
 it('accepts the complete grant response',async()=>{expect(await exchangeGrant(new URLSearchParams(),post(validTokens()))).toEqual(validTokens());});
 it('distinguishes Node network failures without revealing exception contents',()=>{
  const error=new Error(credentials,{cause:{code:'ENOTFOUND',message:credentials}});expect(setupDiagnostic(error,'token-exchange').code).toBe('GOOGLE_NETWORK_ENOTFOUND');expect(JSON.stringify(setupDiagnostic(error,'token-exchange'))).not.toContain(credentials);
 });
 it('reports TLS validation failure without bypassing TLS checks',()=>{expect(setupDiagnostic({cause:{code:'UNABLE_TO_VERIFY_LEAF_SIGNATURE'}},'verify-signature').code).toBe('GOOGLE_TLS_CERTIFICATE');});
 it('reports expired identity tokens separately from network errors',()=>{expect(setupDiagnostic({code:'ERR_JWT_EXPIRED'},'verify-signature').code).toBe('IDENTITY_ERR_JWT_EXPIRED');});
 it('does not claim no credentials were written after a later local save failure',()=>{
  const safe=setupDiagnostic({message:credentials,code:'EPERM'},'save-config');expect(safe.code).toBe('LOCAL_SETTINGS_WRITE_FAILED');expect(safe.message).toContain('recovery file may exist');expect(safe.message).not.toContain(credentials);
 });
 it.each([['email','other@example.test','WRONG_OWNER'],['nonce','other','NONCE_MISMATCH'],['sub','other','OWNER_SUBJECT_MISMATCH'],['email_verified',false,'EMAIL_UNVERIFIED']])('keeps %s verification enforced', (field,value,code)=>{
  const payload={...validIdentity(),[field]:value};try{checkOwnerIdentity(payload,owner);expect.fail('must reject');}catch(error){expect(setupDiagnostic(error,'verify-owner').code).toBe(code);}
 });
 it('accepts the configured verified owner',()=>{expect(()=>checkOwnerIdentity(validIdentity(),owner)).not.toThrow();});
 it('tests connectivity without sending client credentials or authorization codes',async()=>{
  const requests=[];const results=await probeGoogleNetwork(async(url,options)=>{requests.push([url,options]);return new Response('',{status:url.includes('/token')?405:200});});
  expect(results.every(item=>item.ok)).toBe(true);expect(requests).toHaveLength(2);for(const [,options] of requests){expect(options.body).toBeUndefined();expect(options.headers).toBeUndefined();}
 });
 it('reports a failed signing-key request even when the token endpoint is reachable',async()=>{
  const results=await probeGoogleNetwork(async url=>{if(url.includes('/certs'))throw new Error(credentials,{cause:{code:'ECONNRESET'}});return new Response('',{status:405});});expect(results[1]).toMatchObject({ok:false,code:'GOOGLE_NETWORK_ECONNRESET'});expect(JSON.stringify(results)).not.toContain(credentials);
 });
});

describe('separate inventory grant',()=>{
 it('rejects an earlier read-only grant for the inventory API',async()=>{await expect(exchangeGrant(new URLSearchParams(),post(validTokens()),true)).rejects.toMatchObject({code:'MISSING_INVENTORY_SCOPE'});});
 it('requires spreadsheet edits, narrow Drive file access and verified email scopes',async()=>{const tokens={id_token:'identity',refresh_token:'grant',scope:'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file'};expect(await exchangeGrant(new URLSearchParams(),post(tokens),true)).toEqual(tokens);});
});
