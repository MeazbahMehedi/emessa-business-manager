/** Owner-only inventory API. Install in a SEPARATE Apps Script project from the read API. */
var EMESSA_META = '_EMESSA_Products';
var EMESSA_OPS = '_EMESSA_Operations';
var EMESSA_MOVES = '_EMESSA_Movements';
var EMESSA_ASSETS = '_EMESSA_Assets';
var EMESSA_MAX_JOURNAL = 10000;
function inventoryFail_(code,location) {var error=new InventoryError(code);if(location)error.location=location;throw error;}
function inventoryAddress_(col,row){var n=Number(col)+1,label='';while(n>0){n--;label=String.fromCharCode(65+n%26)+label;n=Math.floor(n/26);}return 'Product Inventory!'+label+row;}
function inventoryOwner_() {
  var p = PropertiesService.getScriptProperties().getProperties();
  var email = String(Session.getEffectiveUser().getEmail() || '').toLowerCase();
  if (!p.ADMIN_EMAIL || email !== p.ADMIN_EMAIL.toLowerCase()) inventoryFail_('FORBIDDEN');
  if (!/^[A-Za-z0-9_-]{20,150}$/.test(p.INVENTORY_SPREADSHEET_ID || '') || !['staging','live'].includes(p.INVENTORY_MODE)) inventoryFail_('SETUP_REQUIRED');
  if(p.INVENTORY_MODE==='live'&&p.INVENTORY_LIVE_ACKNOWLEDGEMENT!=='staging-tested-and-other-writers-paused')inventoryFail_('LIVE_ACTIVATION_REQUIRED');
  if (p.INVENTORY_MODE === 'staging') {
    var originals = [p.SALES_SPREADSHEET_ID,p.INVESTMENT_SPREADSHEET_ID];
    if (!originals.every(function(id){return /^[A-Za-z0-9_-]{20,150}$/.test(id||'');}) ||
        p.INVENTORY_SPREADSHEET_ID !== p.INVENTORY_ALLOWED_STAGING_ID ||
        originals.includes(p.INVENTORY_SPREADSHEET_ID)) inventoryFail_('STAGING_TARGET_REQUIRED');
  }
  return p;
}
function inventoryLocked_(work) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) inventoryFail_('BUSY');
  try { return work(); } finally { lock.releaseLock(); }
}
function inventoryDigest_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, canonicalInventoryValue(value), Utilities.Charset.UTF_8).map(function(n){return ('0'+((n+256)%256).toString(16)).slice(-2);}).join('');
}
function inventoryFormula_(column,row,migrated) {
  var base = EMESSA_FORMULAS[column].replace(/(\$?[A-Z]{1,3})6\b/g,function(_,col){return col+row;});
  if (Number(column) === 5 && migrated) return '=IF($C'+row+'="","",('+base.slice(1)+')+SUMIF(\''+EMESSA_MOVES+'\'!$B$2:$B$10001,$C'+row+',\''+EMESSA_MOVES+'\'!$C$2:$C$10001))';
  return base;
}
function inventoryInputHash_(values,formulas) {
  var inputs=[1,2,3,4,7,8,24,26].map(function(col){return [values[col]===undefined?'':values[col],formulas[col]===undefined?'':formulas[col]];});
  inputs.push(['image',formulas[0]===undefined?'':formulas[0]]);return inventoryDigest_(inputs);
}
function inventoryReadState_(p,migrated) {
  var id=p.INVENTORY_SPREADSHEET_ID;
  var book=Sheets.Spreadsheets.get(id,{fields:'sheets.properties'});
  var sheets={};(book.sheets||[]).forEach(function(s){sheets[s.properties.title]=s.properties;});
  if (!sheets['Product Inventory']) inventoryFail_('SCHEMA_MISMATCH');
  var initialized=[EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].some(function(name){return !!sheets[name];});
  if(!migrated&&initialized)inventoryFail_('ALREADY_INITIALIZED');
  if(migrated&&[EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].some(function(name){return !sheets[name];}))inventoryFail_('NOT_INITIALIZED');
  var range="'Product Inventory'!A5:AB205";
  var values=Sheets.Spreadsheets.Values.get(id,range,{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
  var formulas=Sheets.Spreadsheets.Values.get(id,range,{valueRenderOption:'FORMULA'}).values||[];
  var header=values[0]||[];
  Object.keys(EMESSA_HEADERS).forEach(function(col){if(String(header[col]||'').replace(/\s+/g,' ').trim()!==EMESSA_HEADERS[col]) inventoryFail_('SCHEMA_MISMATCH',inventoryAddress_(col,5));});
  var rows=[],seen={},migrations=[],blankImages=0,formulaCount=0;
  for(var i=1;i<=200;i++) {
    var row=i+5,v=values[i]||[],f=formulas[i]||[];
    Object.keys(EMESSA_FORMULAS).forEach(function(col){
      var actual=String(f[col]||'').trim();
      if(col==='0'&&actual===''){blankImages++;return;}
      if(actual)formulaCount++;
      if(actual===inventoryFormula_(col,row,migrated))return;
      var legacy=EMESSA_LEGACY_FORMULAS[col];
      if(!migrated&&legacy&&actual===legacy.replace(/(\$?[A-Z]{1,3})6\b/g,function(_,label){return label+row;})){migrations.push({row:row,column:Number(col)});return;}
      inventoryFail_('FORMULA_MISMATCH',inventoryAddress_(col,row));
    });
    var sku=String(v[2]||'').trim();
    if(sku && (seen[sku.toUpperCase()] || !/^[A-Z0-9][A-Z0-9._-]{0,99}$/i.test(sku))) inventoryFail_('SOURCE_REVIEW_REQUIRED');
    if(sku) seen[sku.toUpperCase()]=true;
    // Protect every source-owned input, image URL and reserved AA cell from silent overwrites.
    rows.push({row:row,values:v,formulas:f,hash:inventoryInputHash_(v,f),formulaHash:inventoryDigest_(Object.keys(EMESSA_FORMULAS).map(function(col){return f[col]||'';})),sku:sku});
  }
  return {sheets:sheets,rows:rows,migrations:migrations,blankImages:blankImages,formulaCount:formulaCount};
}
function inventoryTable_(p,title) {
  var rows=Sheets.Spreadsheets.Values.get(p.INVENTORY_SPREADSHEET_ID,"'"+title+"'!A1:D10001",{valueRenderOption:'UNFORMATTED_VALUE'}).values||[];
  var entries={},order=[];
  if(String(rows[0]&&rows[0][0])!=='ID' || String(rows[0]&&rows[0][1])!==(title===EMESSA_MOVES?'SKU':'DATA')) inventoryFail_('SCHEMA_MISMATCH');
  for(var i=1;i<rows.length;i++) {
    if(!rows[i][0]) inventoryFail_('SCHEMA_MISMATCH');
    var key=String(rows[i][0]);if(entries[key]) inventoryFail_('SCHEMA_MISMATCH');
    var data;try{data=JSON.parse(rows[i][title===EMESSA_MOVES?3:1]);}catch(e){inventoryFail_('SCHEMA_MISMATCH');}
    entries[key]={row:i+1,data:data};order.push(key);
  }
  return {entries:entries,order:order,nextRow:rows.length+1};
}
function inventoryCell_(value) {
  return {userEnteredValue:typeof value==='number'?{numberValue:value}:typeof value==='boolean'?{boolValue:value}:{stringValue:String(value)}};
}
function inventoryCells_(sheet,row,col,values) {
  return {updateCells:{range:{sheetId:sheet,startRowIndex:row-1,endRowIndex:row,startColumnIndex:col,endColumnIndex:col+values.length},rows:[{values:values.map(inventoryCell_)}],fields:'userEnteredValue'}};
}
function inventoryJsonRow_(sheet,row,id,data) { return inventoryCells_(sheet,row,0,[id,JSON.stringify(data)]); }
function inventoryRecord_(entry,source) {
  if(!source || source.hash!==entry.hash || source.sku!==entry.product.sku) inventoryFail_('SOURCE_CHANGED');
  var product=cloneInventoryValue(entry.product);
  if(!Number.isSafeInteger(source.values[5])) inventoryFail_('STOCK_UNAVAILABLE');
  product.stock=source.values[5];
  return product;
}
function inventoryWorkspace_(p) {return inventoryDigest_({target:p.INVENTORY_SPREADSHEET_ID,mode:p.INVENTORY_MODE});}
function inventorySnapshot_(p) {
  var state=inventoryReadState_(p,true),meta=inventoryTable_(p,EMESSA_META),moves=inventoryTable_(p,EMESSA_MOVES);
  var mapped={},products=[];
  meta.order.forEach(function(id){
    var entry=meta.entries[id].data,source=state.rows[entry.row-6];
    if(mapped[entry.row]) inventoryFail_('SCHEMA_MISMATCH');mapped[entry.row]=true;
    var product=inventoryRecord_(entry,source);
    products.push(Object.assign(product,{price:typeof source.values[16]==='number'?source.values[16]:null,cost:typeof source.values[15]==='number'?source.values[15]:null,legacyImage:!!source.values[24]}));
  });
  state.rows.forEach(function(row){if(row.sku&&!mapped[row.row])inventoryFail_('SOURCE_CHANGED');});
  return {workspaceId:inventoryWorkspace_(p),mode:p.INVENTORY_MODE,enabled:p.INVENTORY_WRITE_ENABLED==='true',asOf:new Date().toISOString(),products:products,movements:moves.order.slice(-200).map(function(id){return moves.entries[id].data;}),capacity:200,remaining:200-products.length};
}
function inventoryLegacyProduct_(source,id) {
  var v=source.values,command;
  try{command=validateInventoryCommand({requestId:Utilities.getUuid(),action:'product.update',expectedRevision:1,productId:id,data:{sku:source.sku,name:String(v[1]||''),category:String(v[3]||''),buyingPrice:String(v[7]===undefined?'':v[7]),desiredProfit:String(v[8]===undefined?'':v[8]),imageAssetIds:[]}});}
  catch(error){inventoryFail_('SOURCE_REVIEW_REQUIRED',inventoryAddress_(1,source.row));}
  if(!Number.isSafeInteger(v[4])||v[4]<0||v[4]>1000000||!Number.isSafeInteger(v[5])||v[5]<0)inventoryFail_('SOURCE_REVIEW_REQUIRED',inventoryAddress_(4,source.row));
  return Object.assign({id:id,revision:1,openingStock:v[4],stock:v[5],archived:false},command.data);
}
/** Run in the editor. Returns a digest of the proposed migration; makes no changes. */
function emessaInventoryPlan() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_(),state=inventoryReadState_(p,false);
    state.rows.filter(function(r){return !!r.sku;}).forEach(function(r){inventoryLegacyProduct_(r,'p_review');});
    [EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].forEach(function(name){if(state.sheets[name]) inventoryFail_('ALREADY_INITIALIZED');});
    var digest=inventoryDigest_({version:1,target:p.INVENTORY_SPREADSHEET_ID,rows:state.rows.map(function(r){return {row:r.row,hash:r.hash,formulaHash:r.formulaHash};})});
    return {version:1,mode:p.INVENTORY_MODE,products:state.rows.filter(function(r){return !!r.sku;}).length,capacity:200,formulaCellsReviewed:4000,formulaCellsPresent:state.formulaCount,blankImageCellsPreserved:state.blankImages,legacyStockFormulas:state.migrations.filter(function(m){return m.column===5;}).length,legacyProfitFormulas:state.migrations.filter(function(m){return m.column===23;}).length,blankProfitInputsPreserved:state.rows.filter(function(r){return r.sku&&(r.values[8]===undefined||r.values[8]==='');}).length,legacySkuCasePreserved:state.rows.filter(function(r){return r.sku&&r.sku!==r.sku.toUpperCase();}).length,requiresReconciliation:state.migrations.length>0,formulaChange:'Normalize only recognized legacy stock/profit formulas to reviewed active-quantity templates and add audited stock adjustments. Preserve source inputs and image cells.',planDigest:digest};
  });
}
/** Run only after setting INVENTORY_APPROVED_PLAN to the digest from emessaInventoryPlan. */
function emessaInventoryInitialize() {
  return inventoryLocked_(function(){
    var p=inventoryOwner_(),plan=emessaInventoryPlanUnlocked_(p);
    if(p.INVENTORY_WRITE_ENABLED==='true' || !p.INVENTORY_APPROVED_PLAN || p.INVENTORY_APPROVED_PLAN!==plan.digest) inventoryFail_('PLAN_APPROVAL_REQUIRED');
    var state=plan.state,requests=[],maxId=0;Object.keys(state.sheets).forEach(function(k){maxId=Math.max(maxId,state.sheets[k].sheetId);});
    var ids={};
    [EMESSA_META,EMESSA_OPS,EMESSA_MOVES,EMESSA_ASSETS].forEach(function(name){
      if(state.sheets[name]) inventoryFail_('ALREADY_INITIALIZED');
      var sid=++maxId;ids[name]=sid;
      requests.push({addSheet:{properties:{title:name,sheetId:sid,hidden:true,gridProperties:{rowCount:10001,columnCount:4}}}});
      requests.push(inventoryCells_(sid,1,0,name===EMESSA_MOVES?['ID','SKU','Adjustment delta','Evidence']:['ID','DATA']));
    });
    var metaRow=2;
    state.rows.forEach(function(source){
      if(source.sku){
        var v=source.values,id='p_'+Utilities.getUuid().replace(/-/g,'');
        var product=inventoryLegacyProduct_(source,id);
        requests.push(inventoryJsonRow_(ids[EMESSA_META],metaRow++,id,{row:source.row,hash:source.hash,product:product,migrationBaseline:{stock:v[5],actualProfit:typeof v[23]==='number'?v[23]:null,reviewedAt:new Date().toISOString()}}));
      }
      requests.push({updateCells:{range:{sheetId:state.sheets['Product Inventory'].sheetId,startRowIndex:source.row-1,endRowIndex:source.row,startColumnIndex:5,endColumnIndex:6},rows:[{values:[{userEnteredValue:{formulaValue:inventoryFormula_(5,source.row,true)}}]}],fields:'userEnteredValue'}});
    });
    state.migrations.filter(function(m){return m.column!==5;}).forEach(function(m){requests.push({updateCells:{range:{sheetId:state.sheets['Product Inventory'].sheetId,startRowIndex:m.row-1,endRowIndex:m.row,startColumnIndex:m.column,endColumnIndex:m.column+1},rows:[{values:[{userEnteredValue:{formulaValue:inventoryFormula_(m.column,m.row,false)}}]}],fields:'userEnteredValue'}});});
    Sheets.Spreadsheets.batchUpdate({requests:requests},p.INVENTORY_SPREADSHEET_ID);
    return {initialized:true,mode:p.INVENTORY_MODE,products:metaRow-2};
  });
}
function emessaInventoryPlanUnlocked_(p) {
  var state=inventoryReadState_(p,false);
  return {state:state,digest:inventoryDigest_({version:1,target:p.INVENTORY_SPREADSHEET_ID,rows:state.rows.map(function(r){return {row:r.row,hash:r.hash,formulaHash:r.formulaHash};})})};
}
function inventoryCommit_(p,raw) {
  if(p.INVENTORY_WRITE_ENABLED!=='true') inventoryFail_('WRITE_DISABLED');
  var command=validateInventoryCommand(raw),actor=p.ADMIN_EMAIL.toLowerCase();
  var fingerprint=inventoryDigest_({command:command,actor:actor});
  var ops=inventoryTable_(p,EMESSA_OPS),old=ops.entries[command.requestId];
  if(old){if(old.data.fingerprint!==fingerprint)inventoryFail_('REQUEST_KEY_CONFLICT');return old.data.result;}
  if(ops.nextRow>10001) inventoryFail_('JOURNAL_FULL');
  var state=inventoryReadState_(p,true),meta=inventoryTable_(p,EMESSA_META),moves=inventoryTable_(p,EMESSA_MOVES),assets=inventoryTable_(p,EMESSA_ASSETS);
  var found=meta.entries[command.productId],existing=found?inventoryRecord_(found.data,state.rows[found.data.row-6]):undefined;
  // Catch unregistered source additions and edits before any save, including SKU collisions.
  var occupied={};meta.order.forEach(function(id){var e=meta.entries[id].data;if(occupied[e.row])inventoryFail_('SCHEMA_MISMATCH');occupied[e.row]=id;inventoryRecord_(e,state.rows[e.row-6]);});
  state.rows.forEach(function(r){if(r.sku&&!occupied[r.row])inventoryFail_('SOURCE_CHANGED');});
  var planned=planInventoryChange(command,existing,actor,new Date()),product=planned.result.product;
  if(existing&&product.sku!==existing.sku) inventoryFail_('SKU_LOCKED');
  if(meta.order.some(function(id){return id!==product.id&&meta.entries[id].data.product.sku.toUpperCase()===product.sku.toUpperCase();})) inventoryFail_('DUPLICATE_SKU');
  product.imageAssetIds.forEach(function(id){var asset=assets.entries[id];if(!asset||!['ready','attached'].includes(asset.data.status))inventoryFail_('ASSET_NOT_APPROVED');});
  var row=found?found.data.row:0;
  if(!row){for(var i=0;i<state.rows.length;i++)if(!state.rows[i].sku&&!occupied[state.rows[i].row]){var rawValues=state.rows[i].values;if([1,2,3,4,7,8,24,26].some(function(c){return rawValues[c]!==''&&rawValues[c]!==undefined;}))continue;row=state.rows[i].row;break;}}
  if(!row) inventoryFail_('CAPACITY_REACHED');
  var requests=[],sid=state.sheets['Product Inventory'].sheetId,source=state.rows[row-6];
  var future=source.values.slice(),futureInputs=source.formulas.slice();
  if(command.action==='product.create'||command.action==='product.update') {
    [[1,product.name],[2,product.sku],[3,product.category],[7,Number(product.buyingPrice)],[8,product.desiredProfit===''?'':Number(product.desiredProfit)]].forEach(function(pair){requests.push(inventoryCells_(sid,row,pair[0],[pair[1]]));future[pair[0]]=pair[1];futureInputs[pair[0]]=pair[1];});
    if(command.action==='product.create'){requests.push(inventoryCells_(sid,row,4,[product.openingStock]));future[4]=product.openingStock;futureInputs[4]=product.openingStock;}
  }
  // Original image URL/formula remain intact. Website assets are private references in metadata.
  var hash=inventoryInputHash_(future,futureInputs);
  requests.push(inventoryJsonRow_(state.sheets[EMESSA_META].sheetId,found?found.row:meta.nextRow,product.id,{row:row,hash:hash,product:product}));
  if(planned.movement){
    if(moves.nextRow>10001) inventoryFail_('JOURNAL_FULL');
    // SKU/delta are formula inputs; full movement evidence is retained as JSON in column D.
    requests.push(inventoryCells_(state.sheets[EMESSA_MOVES].sheetId,moves.nextRow,0,[planned.movement.id,product.sku,command.action==='stock.adjust'?planned.movement.delta:0,JSON.stringify(planned.movement)]));
  }
  var ids=product.imageAssetIds.concat(existing?existing.imageAssetIds:[]);
  Array.from(new Set(ids)).forEach(function(id){var e=assets.entries[id];if(!e)return;var data=cloneInventoryValue(e.data);data.status=product.imageAssetIds.includes(id)?'attached':'ready';requests.push(inventoryJsonRow_(state.sheets[EMESSA_ASSETS].sheetId,e.row,id,data));});
  requests.push(inventoryJsonRow_(state.sheets[EMESSA_OPS].sheetId,ops.nextRow,command.requestId,{fingerprint:fingerprint,result:planned.result,actor:actor,recordedAt:new Date().toISOString()}));
  // A single atomic Sheets batch is the only commit point. A lost response is resolved by the same request ID.
  Sheets.Spreadsheets.batchUpdate({requests:requests},p.INVENTORY_SPREADSHEET_ID);
  return planned.result;
}
function emessaInventory(request) {
  try {
    var p=inventoryOwner_();
    if(!request||request.version!==1||!['inventory.read','inventory.command','inventory.status','asset.upload','asset.read','asset.discard'].includes(request.operation)) inventoryFail_('FORBIDDEN');
    return inventoryLocked_(function(){
      if(['inventory.command','asset.upload','asset.discard'].includes(request.operation)&&request.workspaceId!==inventoryWorkspace_(p))inventoryFail_('WORKSPACE_CHANGED');
      var data;
      if(request.operation==='inventory.read') data=inventorySnapshot_(p);
      else if(request.operation==='inventory.command') {if(request.workspaceId!==inventoryWorkspace_(p))inventoryFail_('WORKSPACE_CHANGED');data=inventoryCommit_(p,request.command);}
      else if(request.operation==='inventory.status') {
        if(!/^[0-9a-f-]{36}$/i.test(request.requestId||'')) inventoryFail_('INVALID_REQUEST_ID');
        var op=inventoryTable_(p,EMESSA_OPS).entries[request.requestId];data=op?{state:'committed',result:op.data.result}:{state:'not_found'};
      } else data=inventoryAssetOperation_(p,request);
      return {ok:true,data:data};
    });
  } catch(error) {
    var code=error instanceof InventoryError?error.code:'GOOGLE_EXECUTION_FAILED';
    return {ok:false,error:Object.assign({code:code},error instanceof InventoryError&&error.location?{location:error.location}:{})};
  }
}

/** Editor helpers print sanitized reports, since returned objects are not shown in its log. */
function emessaInventoryPrintPlan() {
  try{var report=emessaInventoryPlan();console.log(JSON.stringify(report,null,2));return report;}
  catch(e){throw new Error((e instanceof InventoryError?e.code:'GOOGLE_EXECUTION_FAILED')+(e.location?' ('+e.location+')':''));}
}
function emessaInventoryPrintStatus() {
  var result=emessaInventory({version:1,operation:'inventory.read'});
  var report=result.ok?{ok:true,mode:result.data.mode,enabled:result.data.enabled,products:result.data.products.length,remaining:result.data.remaining}:{ok:false,error:result.error};
  console.log(JSON.stringify(report,null,2));return report;
}
function emessaInventoryPrintCleanupPlan() {var report=emessaInventoryCleanupPlan();console.log(JSON.stringify(report,null,2));return report;}
