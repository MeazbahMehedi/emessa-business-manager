#!/usr/bin/env python3
"""Package a source checkpoint, excluding private inputs and build caches."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import zipfile

def main():
 p=argparse.ArgumentParser();p.add_argument('--project',required=True,type=Path);p.add_argument('--output',required=True,type=Path);p.add_argument('--checkpoint',default='phase-1-source-audit');a=p.parse_args()
 root=a.project.resolve();out=a.output.resolve()
 if out==root or root in out.parents:raise ValueError('Write the archive outside the project directory.')
 excluded={'__pycache__','node_modules','.git','.wrangler','dist','.oauth-local','coverage'}
 files=[]
 candidates=[]
 for directory,dirs,names in os.walk(root):
  dirs[:]=[name for name in dirs if name not in excluded]
  candidates.extend(Path(directory)/name for name in names)
 for item in sorted(candidates):
  rel=item.relative_to(root)
  if rel.as_posix()=="CHECKPOINT_MANIFEST.json":continue
  if any(part in excluded for part in rel.parts):continue
  if item.is_symlink():raise ValueError(f'Unexpected symlink: {rel}')
  if not item.is_file():continue
  if (item.name.startswith('.env') or item.name.startswith('.dev.vars')) and not item.name.endswith('.example'):continue
  if item.name.startswith('client_secret') and item.suffix=='.json':raise ValueError(f'Credential JSON must not be packaged: {rel}')
  if item.suffix in {'.xlsx','.pyc'}:raise ValueError(f'Private/generated input must not be packaged: {rel}')
  files.append(item)
 reader_config=root/'config/reader-project.json'
 reader_deployed=bool(json.loads(reader_config.read_text()).get('api_deployment_id')) if reader_config.exists() else False
 inventory_config=root/'config/inventory-project.json'
 inventory=json.loads(inventory_config.read_text()) if inventory_config.exists() else {}
 manifest={'checkpoint':a.checkpoint,'application_complete':False,'live_google_connection':'owner_reported_working','live_deployment':False,'website_deployed':False,'inventory_service_implemented':True,'inventory_service_deployed':bool(inventory.get('api_deployment_id')),'inventory_staging_proof':False,'inventory_staging_copy_prepared':bool(inventory.get('staging_spreadsheet_id')),'inventory_staging_initialized':inventory.get('staging_initialized',False),'live_inventory_writes_enabled':False,'reader_api_deployed':reader_deployed,'files':[{'path':p.relative_to(root).as_posix(),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'bytes':p.stat().st_size} for p in files]}
 prefix='EMESSA_Business_Manager/'
 out.parent.mkdir(parents=True,exist_ok=True)
 with zipfile.ZipFile(out,'w',compression=zipfile.ZIP_DEFLATED) as z:
  for item in files:z.write(item,prefix+item.relative_to(root).as_posix())
  z.writestr(prefix+'CHECKPOINT_MANIFEST.json',json.dumps(manifest,indent=2)+'\n')
 with zipfile.ZipFile(out) as z:
  assert z.testzip() is None
  for item in manifest['files']:
   assert hashlib.sha256(z.read(prefix+item['path'])).hexdigest()==item['sha256']
 print(json.dumps({'archive':str(out),'files':len(files)+1,'bytes':out.stat().st_size,'verified':True}))

if __name__=='__main__':main()
