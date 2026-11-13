/** All files remain owner-private. Upload intent is journaled before Drive side effects. */
function inventoryImageFolder_(p){var file=Drive.Files.get(p.INVENTORY_IMAGE_FOLDER_ID,{fields:EMESSA_FILE_FIELDS});inventoryPrivateFile_(file,p);if(file.appProperties&&file.appProperties.emessaFolder==='inventory-'+inventoryWorkspace_(p).slice(0,24))return file;inventoryFail_('IMAGE_SETUP_REQUIRED');}
function inventoryPrivateFile_(file,p,folder,allowTrashed) {
  if(!file||(!allowTrashed&&file.trashed)||!file.owners||file.owners.length!==1||String(file.owners[0].emailAddress).toLowerCase()!==p.ADMIN_EMAIL.toLowerCase()) inventoryFail_('ASSET_NOT_PRIVATE');
  if(!file.permissions||file.permissions.some(function(v){return v.type!=='user'||v.role!=='owner';})) inventoryFail_('ASSET_NOT_PRIVATE');
  if(folder&&(!file.parents||!file.parents.includes(folder))) inventoryFail_('ASSET_NOT_PRIVATE');
}
var EMESSA_FILE_FIELDS='id,mimeType,size,parents,owners(emailAddress),permissions(type,role),trashed,appProperties';
/** Run in the editor once, after initialization. App creates its own private folder. */
function emessaInventoryCreateImageFolder() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_();
    if(p.INVENTORY_IMAGE_FOLDER_ID){var current=Drive.Files.get(p.INVENTORY_IMAGE_FOLDER_ID,{fields:EMESSA_FILE_FIELDS});inventoryPrivateFile_(current,p);if(current.appProperties&&current.appProperties.emessaFolder==='inventory-'+inventoryWorkspace_(p).slice(0,24))return {ready:true};}
    var existing=Drive.Files.list({q:"trashed = false and mimeType = 'application/vnd.google-apps.folder' and appProperties has { key='emessaFolder' and value='inventory-"+inventoryWorkspace_(p).slice(0,24)+"' }",fields:'files('+EMESSA_FILE_FIELDS+')',pageSize:2}).files||[];
    if(existing.length>1)inventoryFail_('ASSET_REVIEW_REQUIRED');
    var folder=existing[0]||Drive.Files.create({name:'EMESSA Inventory Images ('+p.INVENTORY_MODE+')',mimeType:'application/vnd.google-apps.folder',appProperties:{emessaFolder:'inventory-'+inventoryWorkspace_(p).slice(0,24)}},null,{fields:EMESSA_FILE_FIELDS});
    inventoryPrivateFile_(folder,p);
    PropertiesService.getScriptProperties().setProperty('INVENTORY_IMAGE_FOLDER_ID',folder.id);
    return {ready:true};
  });
}
function inventoryAssetOperation_(p,request) {
  var state=Sheets.Spreadsheets.get(p.INVENTORY_SPREADSHEET_ID,{fields:'sheets.properties'}),sheets={};
  (state.sheets||[]).forEach(function(s){sheets[s.properties.title]=s.properties;});
  if(!sheets[EMESSA_ASSETS]||!p.INVENTORY_IMAGE_FOLDER_ID)inventoryFail_('IMAGE_SETUP_REQUIRED');
  var assets=inventoryTable_(p,EMESSA_ASSETS),entry,id;
  if(request.operation==='asset.upload') {
    if(p.INVENTORY_WRITE_ENABLED!=='true')inventoryFail_('WRITE_DISABLED');
    if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(request.requestId||''))inventoryFail_('INVALID_REQUEST_ID');
    if(typeof request.base64!=='string'||request.base64.length>409600||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.base64))inventoryFail_('INVALID_IMAGE');
    inventoryImageFolder_(p);
    var bytes;try{bytes=Utilities.base64Decode(request.base64);jpegDimensions(new Uint8Array(bytes.map(function(n){return (n+256)%256;})));}catch(e){inventoryFail_('INVALID_IMAGE');}
    id='a_'+request.requestId.replace(/-/g,'');entry=assets.entries[id];
    var fingerprint=inventoryDigest_(request.base64);
    if(entry&&entry.data.fingerprint!==fingerprint)inventoryFail_('REQUEST_KEY_CONFLICT');
    if(entry&&entry.data.status==='discarded')inventoryFail_('ASSET_NOT_APPROVED');
    if(!entry){
      if(assets.nextRow>10001)inventoryFail_('JOURNAL_FULL');
      entry={row:assets.nextRow,data:{status:'pending',fingerprint:fingerprint,createdAt:new Date().toISOString(),bytes:bytes.length,mime:'image/jpeg'}};
      Sheets.Spreadsheets.batchUpdate({requests:[inventoryJsonRow_(sheets[EMESSA_ASSETS].sheetId,entry.row,id,entry.data)]},p.INVENTORY_SPREADSHEET_ID);
    }
    if(!entry.data.fileId){
      // A retry discovers an upload whose final registry write/response was lost.
      var files=Drive.Files.list({q:"trashed = false and '"+p.INVENTORY_IMAGE_FOLDER_ID+"' in parents and appProperties has { key='emessaAsset' and value='"+id+"' }",fields:'files('+EMESSA_FILE_FIELDS+')',pageSize:2}).files||[];
      if(files.length>1)inventoryFail_('ASSET_REVIEW_REQUIRED');
      var file=files[0]||Drive.Files.create({name:id+'.jpg',mimeType:'image/jpeg',parents:[p.INVENTORY_IMAGE_FOLDER_ID],appProperties:{emessaAsset:id,fingerprint:fingerprint}},Utilities.newBlob(bytes,'image/jpeg',id+'.jpg'),{fields:EMESSA_FILE_FIELDS});
      inventoryPrivateFile_(file,p,p.INVENTORY_IMAGE_FOLDER_ID);
      if(file.mimeType!=='image/jpeg'||Number(file.size)!==bytes.length||file.appProperties.fingerprint!==fingerprint)inventoryFail_('ASSET_REVIEW_REQUIRED');
      entry.data.fileId=file.id;entry.data.status='ready';
      Sheets.Spreadsheets.batchUpdate({requests:[inventoryJsonRow_(sheets[EMESSA_ASSETS].sheetId,entry.row,id,entry.data)]},p.INVENTORY_SPREADSHEET_ID);
    }
    return {assetId:id,status:entry.data.status};
  }
  id=String(request.assetId||'');if(!/^a_[0-9a-f]{32}$/i.test(id))inventoryFail_('INVALID_ASSETS');
  entry=assets.entries[id];if(!entry)inventoryFail_('ASSET_NOT_FOUND');
  if(entry.data.status==='discarded'){if(request.operation==='asset.discard')return {discarded:true};inventoryFail_('ASSET_NOT_FOUND');}
  var meta=inventoryTable_(p,EMESSA_META);
  var linked=meta.order.some(function(key){return meta.entries[key].data.product.imageAssetIds.includes(id);});
  if(request.operation==='asset.discard') {
    if(p.INVENTORY_WRITE_ENABLED!=='true')inventoryFail_('WRITE_DISABLED');
    if(linked||Date.now()-Date.parse(entry.data.createdAt)<86400000)inventoryFail_('ASSET_IN_USE');
    if(!entry.data.fileId){
      var pendingFiles=Drive.Files.list({q:"trashed = false and '"+p.INVENTORY_IMAGE_FOLDER_ID+"' in parents and appProperties has { key='emessaAsset' and value='"+id+"' }",fields:'files('+EMESSA_FILE_FIELDS+')',pageSize:2}).files||[];
      if(pendingFiles.length>1)inventoryFail_('ASSET_REVIEW_REQUIRED');if(pendingFiles[0])entry.data.fileId=pendingFiles[0].id;
    }
    if(entry.data.fileId){inventoryPrivateFile_(Drive.Files.get(entry.data.fileId,{fields:EMESSA_FILE_FIELDS}),p,p.INVENTORY_IMAGE_FOLDER_ID,true);
    Drive.Files.update({trashed:true},entry.data.fileId);}
    entry.data.status='discarded';entry.data.discardedAt=new Date().toISOString();entry.data.discardedBy=p.ADMIN_EMAIL;Sheets.Spreadsheets.batchUpdate({requests:[inventoryJsonRow_(sheets[EMESSA_ASSETS].sheetId,entry.row,id,entry.data)]},p.INVENTORY_SPREADSHEET_ID);
    return {discarded:true};
  }
  if(!entry.data.fileId)inventoryFail_('ASSET_NOT_FOUND');
  var file=Drive.Files.get(entry.data.fileId,{fields:EMESSA_FILE_FIELDS});inventoryPrivateFile_(file,p,p.INVENTORY_IMAGE_FOLDER_ID);
  if(file.mimeType!=='image/jpeg'||Number(file.size)!==entry.data.bytes)inventoryFail_('ASSET_REVIEW_REQUIRED');
  return {fileId:entry.data.fileId,mime:'image/jpeg',bytes:entry.data.bytes};
}

function inventoryCleanupCandidates_(p) {
  var meta=inventoryTable_(p,EMESSA_META),assets=inventoryTable_(p,EMESSA_ASSETS),referenced={};
  meta.order.forEach(function(id){meta.entries[id].data.product.imageAssetIds.forEach(function(asset){referenced[asset]=true;});});
  var ids=assets.order.filter(function(id){var a=assets.entries[id].data;return !referenced[id]&&a.status!=='discarded'&&Date.now()-Date.parse(a.createdAt)>=86400000;}).sort();
  return {assetIds:ids,planDigest:inventoryDigest_({workspaceId:inventoryWorkspace_(p),assetIds:ids})};
}
/** Owner maintenance: inspect first; linked and <24-hour uploads are excluded. */
function emessaInventoryCleanupPlan() {return inventoryLocked_(function(){return inventoryCleanupCandidates_(inventoryOwner_());});}
function emessaInventoryCleanup() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_(),plan=inventoryCleanupCandidates_(p);
    if(p.INVENTORY_WRITE_ENABLED!=='true'||p.INVENTORY_APPROVED_CLEANUP!==plan.planDigest)inventoryFail_('PLAN_APPROVAL_REQUIRED');
    var results=[];
    plan.assetIds.forEach(function(id){try{inventoryAssetOperation_(p,{operation:'asset.discard',assetId:id});results.push({assetId:id,discarded:true});}catch(e){results.push({assetId:id,discarded:false,code:e instanceof InventoryError?e.code:'GOOGLE_EXECUTION_FAILED'});}});
    return {results:results};
  });
}
