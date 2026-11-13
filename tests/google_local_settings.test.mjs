import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { importOwnerClient, mergePrivateSettings, validateWebClient, writePrivateSettings } from '../tools/google_local_settings.mjs';

const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>fs.rm(root,{recursive:true,force:true})));});
const client=()=>({web:{project_id:'example-project',client_id:'123-test.apps.googleusercontent.com',client_secret:'synthetic-secret',auth_uri:'https://accounts.google.com/o/oauth2/auth',token_uri:'https://oauth2.googleapis.com/token',redirect_uris:['http://127.0.0.1:8788/oauth/callback','http://localhost:5173/auth/callback']}});
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'emessa-owner-test-'));roots.push(root);
 await fs.mkdir(path.join(root,'config'));
 await fs.writeFile(path.join(root,'config/reader-project.json'),JSON.stringify({standard_cloud_project_id:'example-project',owner_email:'owner@example.test',script_timezone:'Asia/Dhaka',api_deployment_id:'synthetic-deployment'}));
 const input=path.join(root,'downloaded.json');await fs.writeFile(input,JSON.stringify(client()));return {root,input,env:path.join(root,'.dev.vars')};
}
describe('owner OAuth setup boundary',()=>{
 it.each([
  ['another project',value=>{value.web.project_id='other-project';}],
  ['missing callback',value=>{value.web.redirect_uris.pop();}],
  ['non-Google endpoint',value=>{value.web.token_uri='https://attacker.test/token';}],
  ['configuration injection',value=>{value.web.client_secret='secret\nLOCAL_DEMO=true';}],
 ])('rejects %s without disclosing the secret',(_name,change)=>{
  const input=client();change(input);let message='';try{validateWebClient(input,'example-project');}catch(error){message=error.message;}
  expect(message).not.toBe('');expect(message).not.toContain(input.web.client_secret);
 });
 it('replaces duplicate controlled keys while preserving unrelated settings',()=>{
  const text=mergePrivateSettings('# owner settings\nLOCAL_DEMO=true\nLOCAL_DEMO="true"\nEXTRA_SETTING=retained\n',{LOCAL_DEMO:'false',GOOGLE_CLIENT_SECRET:'synthetic-secret'});
  expect(text.match(/^LOCAL_DEMO=/gm)).toHaveLength(1);expect(parseEnv(text)).toMatchObject({LOCAL_DEMO:'false',GOOGLE_CLIENT_SECRET:'synthetic-secret',EXTRA_SETTING:'retained'});
 });
 it('imports credentials locally, disables sample mode and clears another client grant',async()=>{
  const f=await fixture();await fs.writeFile(f.env,'GOOGLE_CLIENT_ID=old-client\nADMIN_EMAIL=owner@example.test\nGOOGLE_REFRESH_TOKEN=old-grant\nADMIN_GOOGLE_SUB=old-sub\nLOCAL_DEMO=true\nEXTRA_SETTING=retained\n');
  await importOwnerClient(f.input,f.root);const settings=parseEnv(await fs.readFile(f.env,'utf8'));
  expect(settings).toMatchObject({GOOGLE_CLIENT_ID:client().web.client_id,GOOGLE_CLIENT_SECRET:'synthetic-secret',GOOGLE_SCRIPT_DEPLOYMENT_ID:'synthetic-deployment',LOCAL_DEMO:'false',APP_ORIGIN:'http://localhost:5173',ADMIN_EMAIL:'owner@example.test',ADMIN_GOOGLE_SUB:'',GOOGLE_REFRESH_TOKEN:'',EXTRA_SETTING:'retained'});
  if(process.platform!=='win32')expect((await fs.stat(f.env)).mode & 0o777).toBe(0o600);
 });
 it('retains the matching owner grant when importing the same client again',async()=>{
  const f=await fixture();await fs.writeFile(f.env,`GOOGLE_CLIENT_ID="${client().web.client_id}"\nADMIN_EMAIL="owner@example.test"\nGOOGLE_REFRESH_TOKEN="synthetic-grant"\nADMIN_GOOGLE_SUB="owner-sub"\n`);
  await importOwnerClient(f.input,f.root);expect(parseEnv(await fs.readFile(f.env,'utf8'))).toMatchObject({GOOGLE_REFRESH_TOKEN:'synthetic-grant',ADMIN_GOOGLE_SUB:'owner-sub'});
 });
 it('refuses a symlink instead of changing a different file',async({skip})=>{
  const f=await fixture();const target=path.join(f.root,'other.env');await fs.writeFile(target,'unchanged');
  try{await fs.symlink(target,f.env);}catch(error){
   if(process.platform==='win32'&&error.code==='EPERM')skip('Windows does not grant symbolic-link creation to this session.');
   throw error;
  }
  await expect(writePrivateSettings(f.env,{GOOGLE_REFRESH_TOKEN:'synthetic-grant'})).rejects.toThrow();expect(await fs.readFile(target,'utf8')).toBe('unchanged');
 });
});
