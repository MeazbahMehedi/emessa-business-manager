#!/usr/bin/env node
import fs from 'node:fs';
import {transformSync} from 'esbuild';
const root=new URL('../',import.meta.url);
const source=['shared/inventory.ts','shared/images.ts'].map(name=>fs.readFileSync(new URL(name,root),'utf8').replace(/^export /gm,'')).join('\n');
const result=transformSync(source,{loader:'ts',target:'es2020',legalComments:'inline'});
const output='// Generated from shared/inventory.ts by npm run build:inventory. Do not edit.\n'+result.code;
const generated={
  'apps-script/inventory/InventoryDomain.gs':output,
  'apps-script/inventory/Code.gs':output+['FormulaTemplates.gs','InventoryApi.gs','InventoryAssets.gs'].map(name=>fs.readFileSync(new URL('apps-script/inventory/'+name,root),'utf8')).join('\n')
};
for(const [name,content] of Object.entries(generated)){
  const target=new URL(name,root);
  if(process.argv.includes('--check')){
    if(!fs.existsSync(target)||fs.readFileSync(target,'utf8')!==content){console.error(name+' is stale. Run npm run build:inventory.');process.exitCode=1;}
  }else fs.writeFileSync(target,content);
}
