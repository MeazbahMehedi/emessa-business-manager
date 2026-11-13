import {describe,it,expect} from 'vitest';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash,randomUUID} from 'node:crypto';
const scripts=['InventoryDomain.gs','FormulaTemplates.gs','InventoryApi.gs','InventoryAssets.gs'].map(name=>fs.readFileSync(new URL('../apps-script/inventory/'+name,import.meta.url),'utf8')).join('\n');
const photo=fs.readFileSync(new URL('./fixtures/image.jpg.base64',import.meta.url),'utf8').trim();
type Sheet={properties:{sheetId:number;title:string;gridProperties:{rowCount:number;columnCount:number}};rows:any[][]};
function fixture(){
 let writes=0,reads=0,locked=false,failBefore=false,failAfter=false,driveFailAfter=false;
 const props:Record<string,string>={ADMIN_EMAIL:'owner@example.test',INVENTORY_SPREADSHEET_ID:'STAGING_WORKBOOK_IDENTIFIER',INVENTORY_ALLOWED_STAGING_ID:'STAGING_WORKBOOK_IDENTIFIER',SALES_SPREADSHEET_ID:'SYNTHETIC_SALES_WORKBOOK',INVESTMENT_SPREADSHEET_ID:'SYNTHETIC_INVESTMENT_WORKBOOK',INVENTORY_MODE:'staging'};
 let owner='owner@example.test',book:Record<string,Sheet>={};
 const files:Record<string,any>={};let createdFiles=0;
 function pickFile(id:string){if(!files[id])throw new Error('not found');return structuredClone(files[id]);}
 const sandbox:any={
  PropertiesService:{getScriptProperties:()=>({getProperties:()=>({...props}),setProperty:(k:string,v:string)=>{props[k]=v;}})},
  Session:{getEffectiveUser:()=>({getEmail:()=>owner})},
  LockService:{getScriptLock:()=>({tryLock:()=>{if(locked)return false;locked=true;return true;},releaseLock:()=>{locked=false;}})},
  Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},getUuid:randomUUID,computeDigest:(_a:string,s:string)=>Array.from(createHash('sha256').update(s).digest()),base64Decode:(s:string)=>Array.from(Buffer.from(s,'base64')),newBlob:(b:number[],mime:string,name:string)=>({bytes:b,mime,name})},
  Drive:{Files:{
   list:({q}:{q:string})=>({files:Object.values(files).filter(f=>!f.trashed&&(q.includes('emessaFolder')?f.mimeType==='application/vnd.google-apps.folder':f.appProperties?.emessaAsset&&q.includes(f.appProperties.emessaAsset))).map(f=>structuredClone(f))}),
   get:pickFile,
   create:(data:any,blob:any)=>{const f={...structuredClone(data),id:'DRIVE_FILE_'+(++createdFiles),owners:[{emailAddress:'owner@example.test'}],permissions:[{type:'user',role:'owner'}],trashed:false,...(blob?{size:String(blob.bytes.length)}:{})};files[f.id]=f;if(driveFailAfter){driveFailAfter=false;throw new Error('response lost after upload');}return structuredClone(f);},
   update:(data:any,id:string)=>{Object.assign(files[id],data);return pickFile(id);}
  }},
  Sheets:{Spreadsheets:{
   get:()=>{reads++;return {sheets:Object.values(book).map(s=>({properties:s.properties}))};},
   Values:{get:(_id:string,range:string,options:any)=>{
    reads++;
    const title=range.match(/^'([^']+)'/)![1],sheet=book[title];if(!sheet)throw new Error('missing sheet');
    const start=title==='Product Inventory'?4:0,end=title==='Product Inventory'?205:10001;
    const rows=sheet.rows.slice(start,end).map((r,i)=>Array.from(r,(value,col)=>{
     if(options.valueRenderOption==='FORMULA'||typeof value!=='string'||!value.startsWith('='))return value;
     if(col===5){const sku=String(r[2]||'');if(!sku)return '';let adjustments=0;for(const m of book._EMESSA_Movements?.rows.slice(1)||[])if(m[1]===sku)adjustments+=m[2]||0;return Number(r[4]||0)+adjustments;}
     if(col===15)return r[2]?Number(r[7]||0)*16: '';
     if(col===16)return r[2]?Number(r[7]||0)*16+Number(r[8]||0):'';
     return '';
    }));
    while(rows.length&&(!rows.at(-1)?.length||rows.at(-1)?.every(v=>v===undefined||v==='')))rows.pop();
    return {values:rows};
   }},
   batchUpdate:({requests}:{requests:any[]})=>{
    writes++;if(failBefore){failBefore=false;throw new Error('batch rejected before commit');}
    const next=structuredClone(book);
    for(const request of requests){
     if(request.addSheet){const p=request.addSheet.properties;if(next[p.title])throw new Error('duplicate title');next[p.title]={properties:p,rows:[]};}
     if(request.updateCells){const u=request.updateCells,r=u.range,s=Object.values(next).find(s=>s.properties.sheetId===r.sheetId);if(!s)throw new Error('missing id');
      if(r.endRowIndex>s.properties.gridProperties.rowCount||r.endColumnIndex>s.properties.gridProperties.columnCount)throw new Error('outside range');
      u.rows.forEach((line:any,i:number)=>{const row=r.startRowIndex+i;s.rows[row]||=[];line.values.forEach((cell:any,j:number)=>{const v=cell.userEnteredValue;s.rows[row][r.startColumnIndex+j]=v.formulaValue??v.stringValue??v.numberValue??v.boolValue??'';});});
     }
    }
    book=next;if(failAfter){failAfter=false;throw new Error('lost response after atomic commit');}return {};
   }
  }}
 };
 vm.createContext(sandbox);new vm.Script(scripts).runInContext(sandbox);
 const base:Sheet={properties:{sheetId:1,title:'Product Inventory',gridProperties:{rowCount:205,columnCount:28}},rows:Array.from({length:205},()=>[])};
 for(const [col,text] of Object.entries(sandbox.EMESSA_HEADERS))base.rows[4][Number(col)]=text;
 for(let row=6;row<=205;row++)for(const col of Object.keys(sandbox.EMESSA_FORMULAS))base.rows[row-1][Number(col)]=sandbox.inventoryFormula_(col,row,false);
 base.rows[5][1]='Original product';base.rows[5][2]='SYNTH-1';base.rows[5][3]='Bags';base.rows[5][4]=10;base.rows[5][7]=2.5;base.rows[5][8]=15;
 book['Product Inventory']=base;
 function run(name:string,arg?:unknown){sandbox.input=arg===undefined?undefined:JSON.stringify(arg);return JSON.parse(JSON.stringify(vm.runInContext(name+'('+(arg===undefined?'':'JSON.parse(input)')+')',sandbox)));}
 function init(){const plan=run('emessaInventoryPlan');props.INVENTORY_APPROVED_PLAN=plan.planDigest;run('emessaInventoryInitialize');props.INVENTORY_WRITE_ENABLED='true';}
 const api=(operation:string,extra:Record<string,unknown>={})=>run('emessaInventory',{version:1,operation,workspaceId:sandbox.inventoryWorkspace_(props),...extra});
 return {props,api,init,run,files,writes:()=>writes,reads:()=>reads,createdFiles:()=>createdFiles,setOwner:(s:string)=>{owner=s;},blockLock:()=>{locked=true;},failBefore:()=>{failBefore=true;},failAfter:()=>{failAfter=true;},driveFail:()=>{driveFailAfter=true;},edit:(row:number,col:number,v:unknown)=>{book['Product Inventory'].rows[row-1][col]=v;},book:()=>book};
}
const command=(action='product.create',productId='product_2',expectedRevision:number|null=null,data:Record<string,unknown>={sku:'SYNTH-2',name:'Website product',category:'Bags',openingStock:4,buyingPrice:'3.25',desiredProfit:'10',imageAssetIds:[]})=>({requestId:randomUUID(),action,productId,expectedRevision,data});
function product(f:ReturnType<typeof fixture>){return f.api('inventory.read').data.products[0];}
describe('durable inventory adapter',()=>{
 it('previews without writes and requires the exact reviewed migration digest',()=>{const f=fixture();const p=f.run('emessaInventoryPlan');expect(p).toMatchObject({products:1,capacity:200,formulaCellsReviewed:4000});expect(f.writes()).toBe(0);f.props.INVENTORY_APPROVED_PLAN='wrong';expect(()=>f.run('emessaInventoryInitialize')).toThrow();expect(f.writes()).toBe(0);});
 it('refuses a plan changed by a direct source edit',()=>{const f=fixture();f.props.INVENTORY_APPROVED_PLAN=f.run('emessaInventoryPlan').planDigest;f.edit(6,1,'Changed');expect(()=>f.run('emessaInventoryInitialize')).toThrow();expect(f.writes()).toBe(0);});
 it('migrates metadata and the adjustment formula atomically, keeping opening stock',()=>{const f=fixture();f.init();expect(f.writes()).toBe(1);expect(product(f)).toMatchObject({sku:'SYNTH-1',stock:10,openingStock:10,revision:1});expect(f.book()['Product Inventory'].rows[5][5]).toContain("'_EMESSA_Movements'!$C$2:$C$10001");expect(f.book()['Product Inventory'].rows[5][5]).toContain("'Sales Archive'!");expect(f.book()['Product Inventory'].rows[5][4]).toBe(10);});
 it('blocks a different owner and staging against a source before reading',()=>{const f=fixture();f.setOwner('intruder@example.test');expect(f.api('inventory.read').error.code).toBe('FORBIDDEN');expect(f.reads()).toBe(0);f.setOwner('owner@example.test');f.props.INVENTORY_SPREADSHEET_ID=f.props.SALES_SPREADSHEET_ID;f.props.INVENTORY_ALLOWED_STAGING_ID=f.props.SALES_SPREADSHEET_ID;expect(f.api('inventory.read').error.code).toBe('STAGING_TARGET_REQUIRED');expect(f.reads()).toBe(0);});
 it('rejects a command bound to another inventory',()=>{const f=fixture();f.init();expect(f.api('inventory.command',{workspaceId:'wrong',command:command()}).error.code).toBe('WORKSPACE_CHANGED');expect(f.writes()).toBe(1);});
 it('requires the live activation acknowledgement before accessing a live target',()=>{const f=fixture();f.props.INVENTORY_MODE='live';expect(f.api('inventory.read').error.code).toBe('LIVE_ACTIVATION_REQUIRED');expect(f.reads()).toBe(0);});
 it('fails closed while the script lock is busy',()=>{const f=fixture();f.init();f.blockLock();expect(f.api('inventory.command',{command:command()}).error.code).toBe('BUSY');expect(f.writes()).toBe(1);});
 it('persists a product, opening movement and operation in one batch, then reads it afresh',()=>{const f=fixture();f.init();const c=command();const saved=f.api('inventory.command',{command:c});expect(saved.ok).toBe(true);expect(f.writes()).toBe(2);const snap=f.api('inventory.read');expect(snap.data.products.find((p:any)=>p.id===c.productId)).toMatchObject({name:'Website product',stock:4,openingStock:4,price:62});expect(snap.data.movements).toHaveLength(1);expect(f.api('inventory.status',{requestId:c.requestId}).data).toEqual({state:'committed',result:saved.data});});
 it('stores a formula-looking name as a literal string rather than a formula',()=>{const f=fixture();f.init();const c=command();c.data.name='=IMPORTXML("https://example.test")';expect(f.api('inventory.command',{command:c}).ok).toBe(true);expect(f.book()['Product Inventory'].rows[6][1]).toBe(c.data.name);});
 it('replays the original result after a lost response without a second stock movement',()=>{const f=fixture();f.init();const p=product(f),c=command('stock.adjust',p.id,1,{delta:3,reason:'New stock'});f.failAfter();expect(f.api('inventory.command',{command:c}).error.code).toBe('GOOGLE_EXECUTION_FAILED');expect(f.api('inventory.status',{requestId:c.requestId}).data.state).toBe('committed');expect(f.api('inventory.command',{command:c}).data.product.stock).toBe(13);expect(product(f).stock).toBe(13);expect(product(f).openingStock).toBe(10);expect(f.api('inventory.read').data.movements).toHaveLength(1);expect(f.writes()).toBe(2);});
 it('a rejected batch leaves product, movement and operation unchanged; retry succeeds once',()=>{const f=fixture();f.init();const p=product(f),c=command('stock.adjust',p.id,1,{delta:-2,reason:'Damaged'});f.failBefore();expect(f.api('inventory.command',{command:c}).ok).toBe(false);expect(product(f).stock).toBe(10);expect(f.api('inventory.status',{requestId:c.requestId}).data.state).toBe('not_found');expect(f.api('inventory.command',{command:c}).ok).toBe(true);expect(product(f).stock).toBe(8);});
 it('rejects reuse of an idempotency key for a different command',()=>{const f=fixture();f.init();const c=command();f.api('inventory.command',{command:c});c.data.name='Different';expect(f.api('inventory.command',{command:c}).error.code).toBe('REQUEST_KEY_CONFLICT');expect(f.writes()).toBe(2);});
 it('protects stale revisions, duplicate SKUs, immutable legacy SKU and below-zero stock',()=>{const f=fixture();f.init();const p=product(f);expect(f.api('inventory.command',{command:command('stock.adjust',p.id,99,{delta:1,reason:'x'})}).error.code).toBe('STALE_REVISION');expect(f.api('inventory.command',{command:command('stock.adjust',p.id,1,{delta:-11,reason:'x'})}).error.code).toBe('OUT_OF_STOCK');const c=command();c.data.sku=p.sku;expect(f.api('inventory.command',{command:c}).error.code).toBe('DUPLICATE_SKU');const data={sku:'NEW-SKU',name:p.name,category:p.category,buyingPrice:p.buyingPrice,desiredProfit:p.desiredProfit,imageAssetIds:[]};expect(f.api('inventory.command',{command:command('product.update',p.id,1,data)}).error.code).toBe('SKU_LOCKED');expect(f.writes()).toBe(1);});
 it.each([1,4,7,8,24,26])('detects a direct edit to input column %s before saving',col=>{const f=fixture();f.init();const p=product(f);f.edit(6,col,'External change');expect(f.api('inventory.command',{command:command('stock.adjust',p.id,1,{delta:1,reason:'x'})}).error.code).toBe('SOURCE_CHANGED');expect(f.writes()).toBe(1);});
 it('detects changed formulas, including on an unused row, before saving',()=>{const f=fixture();f.init();f.edit(205,16,'=1');expect(f.api('inventory.command',{command:command()}).error.code).toBe('FORMULA_MISMATCH');expect(f.writes()).toBe(1);});
 it('archives without clearing stock, reusing its row or deleting history',()=>{const f=fixture();f.init();const p=product(f);expect(f.api('inventory.command',{command:command('product.archive',p.id,1,{})}).ok).toBe(true);expect(product(f)).toMatchObject({archived:true,stock:10});expect(f.book()['Product Inventory'].rows[5][2]).toBe(p.sku);expect(f.api('inventory.command',{command:command('stock.adjust',p.id,2,{delta:1,reason:'x'})}).error.code).toBe('PRODUCT_ARCHIVED');});
 it('stops at 200 product slots and retains the last reviewed formula row',()=>{const f=fixture();for(let r=7;r<=205;r++){f.edit(r,1,'Product '+r);f.edit(r,2,'SKU-'+r);f.edit(r,3,'Test');f.edit(r,4,0);f.edit(r,7,0);f.edit(r,8,0);}f.init();expect(f.api('inventory.read').data.remaining).toBe(0);expect(f.api('inventory.command',{command:command()}).error.code).toBe('CAPACITY_REACHED');expect(f.writes()).toBe(1);});
 it('keeps changes disabled until the owner explicitly enables them',()=>{const f=fixture();f.init();f.props.INVENTORY_WRITE_ENABLED='false';expect(f.api('inventory.command',{command:command()}).error.code).toBe('WRITE_DISABLED');expect(f.writes()).toBe(1);});
});
describe('private Drive image lifecycle',()=>{
 function images(){const f=fixture();f.init();f.run('emessaInventoryCreateImageFolder');return f;}

 it('cleans an aged orphan after a lost Drive response, with a reviewed cleanup plan',()=>{const f=images(),upload={requestId:randomUUID(),base64:photo};f.driveFail();expect(f.api('asset.upload',upload).ok).toBe(false);const sheet=f.book()._EMESSA_Assets;const data=JSON.parse(sheet.rows[1][1]);data.createdAt=new Date(Date.now()-172800000).toISOString();sheet.rows[1][1]=JSON.stringify(data);const plan=f.run('emessaInventoryCleanupPlan');expect(plan.assetIds).toHaveLength(1);expect(()=>f.run('emessaInventoryCleanup')).toThrow();f.props.INVENTORY_APPROVED_CLEANUP=plan.planDigest;expect(f.run('emessaInventoryCleanup').results[0].discarded).toBe(true);const file=Object.values(f.files).find((v:any)=>v.mimeType==='image/jpeg');expect(file.trashed).toBe(true);expect(f.api('asset.discard',{assetId:plan.assetIds[0]}).data.discarded).toBe(true);});
 it('retains attached images even after their age exceeds the cleanup period',()=>{const f=images();const asset=f.api('asset.upload',{requestId:randomUUID(),base64:photo}).data.assetId;const c=command();c.data.imageAssetIds=[asset];expect(f.api('inventory.command',{command:c}).ok).toBe(true);const sheet=f.book()._EMESSA_Assets,data=JSON.parse(sheet.rows[1][1]);data.createdAt=new Date(Date.now()-172800000).toISOString();sheet.rows[1][1]=JSON.stringify(data);expect(f.run('emessaInventoryCleanupPlan').assetIds).toHaveLength(0);});
 it('uses only drive.file and an owner-only API executable',()=>{const m=JSON.parse(fs.readFileSync(new URL('../apps-script/inventory/appsscript.json',import.meta.url),'utf8'));expect(m.executionApi.access).toBe('MYSELF');expect(m.oauthScopes).toContain('https://www.googleapis.com/auth/drive.file');expect(m.oauthScopes).not.toContain('https://www.googleapis.com/auth/drive');});
 it('journals upload intent, stores a private file and links it atomically with a product',()=>{const f=images();const upload={requestId:randomUUID(),base64:photo};const asset=f.api('asset.upload',upload);expect(asset).toMatchObject({ok:true,data:{status:'ready'}});expect(f.api('asset.upload',upload)).toEqual(asset);expect(f.createdFiles()).toBe(2);const c=command();c.data.imageAssetIds=[asset.data.assetId];expect(f.api('inventory.command',{command:c}).ok).toBe(true);expect(f.api('asset.read',{assetId:asset.data.assetId}).data.mime).toBe('image/jpeg');});
 it('discovers a completed Drive upload after its response was lost, without duplicating it',()=>{const f=images(),upload={requestId:randomUUID(),base64:photo};f.driveFail();expect(f.api('asset.upload',upload).ok).toBe(false);expect(f.api('asset.upload',upload).ok).toBe(true);expect(f.createdFiles()).toBe(2);});
 it('rejects forged images, arbitrary IDs and reusing an upload key for different bytes',()=>{const f=images();expect(f.api('asset.upload',{requestId:randomUUID(),base64:Buffer.from('<svg/>').toString('base64')}).error.code).toBe('INVALID_IMAGE');const upload={requestId:randomUUID(),base64:photo};f.api('asset.upload',upload);const bytes=Buffer.from(photo,'base64');bytes[30]^=1;expect(f.api('asset.upload',{...upload,base64:bytes.toString('base64')}).error.code).toBe('REQUEST_KEY_CONFLICT');expect(f.api('asset.read',{assetId:'arbitrary_drive_file'}).ok).toBe(false);});
 it('refuses a shared image or a shared destination folder',()=>{const f=images();const asset=f.api('asset.upload',{requestId:randomUUID(),base64:photo}).data.assetId;Object.values(f.files).find((v:any)=>v.mimeType==='image/jpeg')!.permissions.push({type:'anyone',role:'reader'});expect(f.api('asset.read',{assetId:asset}).error.code).toBe('ASSET_NOT_PRIVATE');f.files[f.props.INVENTORY_IMAGE_FOLDER_ID].permissions.push({type:'anyone',role:'reader'});expect(f.api('asset.upload',{requestId:randomUUID(),base64:photo}).error.code).toBe('ASSET_NOT_PRIVATE');expect(f.createdFiles()).toBe(2);});
 it('preserves replaced images and forbids deleting a linked or recently uploaded file',()=>{const f=images(),asset=f.api('asset.upload',{requestId:randomUUID(),base64:photo}).data.assetId;expect(f.api('asset.discard',{assetId:asset}).error.code).toBe('ASSET_IN_USE');const c=command();c.data.imageAssetIds=[asset];const p=f.api('inventory.command',{command:c}).data.product;expect(f.api('asset.discard',{assetId:asset}).error.code).toBe('ASSET_IN_USE');const edit=command('product.update',p.id,1,{sku:p.sku,name:p.name,category:p.category,buyingPrice:p.buyingPrice,desiredProfit:p.desiredProfit,imageAssetIds:[]});expect(f.api('inventory.command',{command:edit}).ok).toBe(true);expect(f.api('asset.read',{assetId:asset}).ok).toBe(true);expect(Object.values(f.files).every((v:any)=>!v.trashed)).toBe(true);});
});

/** Sanitized shape of the current connected workbook; contains no real product inputs. */
function liveShapeFixture(){
 const f=fixture();const formulas:any={};
 const sandbox:any={};vm.createContext(sandbox);new vm.Script(fs.readFileSync(new URL('../apps-script/inventory/FormulaTemplates.gs',import.meta.url),'utf8')).runInContext(sandbox);
 for(let row=6;row<=54;row++){
   f.edit(row,0,undefined);f.edit(row,1,'Synthetic product '+row);f.edit(row,2,row===7||row===8?'sku-'+row:'SKU-'+row);f.edit(row,3,'Bags');f.edit(row,4,10);f.edit(row,7,2.5);f.edit(row,8,row>=13?undefined:15);
 }
 for(let row=7;row<=205;row++)for(const col of [5,23])f.edit(row,col,sandbox.EMESSA_LEGACY_FORMULAS[col].replace(/(\$?[A-Z]{1,3})6\b/g,(_:string,label:string)=>label+row));
 return f;
}
describe('current source shape and migration review',()=>{
 it('previews 49 products, lowercase identifiers, blank profit inputs and mixed formula families without writing',()=>{const f=liveShapeFixture();expect(f.run('emessaInventoryPlan')).toMatchObject({products:49,formulaCellsReviewed:4000,formulaCellsPresent:3951,blankImageCellsPreserved:49,legacyStockFormulas:199,legacyProfitFormulas:199,blankProfitInputsPreserved:42,legacySkuCasePreserved:2,requiresReconciliation:true});expect(f.writes()).toBe(0);});
 it('initializes the reviewed mixed layout atomically, preserves blanks/case and then reads all products',()=>{const f=liveShapeFixture();f.init();const snapshot=f.api('inventory.read');expect(snapshot.ok).toBe(true);expect(snapshot.data.products).toHaveLength(49);expect(snapshot.data.products.find((p:any)=>p.sku==='sku-7')).toBeTruthy();expect(snapshot.data.products.find((p:any)=>p.sku==='SKU-13').desiredProfit).toBe('');expect(f.book()['Product Inventory'].rows[12][8]).toBeUndefined();expect(f.book()['Product Inventory'].rows[5][0]).toBeUndefined();expect(f.book()['Product Inventory'].rows[6][23]).toContain("'Sales Record'!$Y$6:$Y$1005");expect(f.writes()).toBe(1);});
 it('keeps an existing lowercase SKU unchanged when editing other fields',()=>{const f=liveShapeFixture();f.init();const p=f.api('inventory.read').data.products.find((p:any)=>p.sku==='sku-7');const c=command('product.update',p.id,1,{sku:p.sku,name:'Renamed',category:p.category,buyingPrice:p.buyingPrice,desiredProfit:p.desiredProfit,imageAssetIds:[]});expect(f.api('inventory.command',{command:c}).ok).toBe(true);expect(f.book()['Product Inventory'].rows[6][2]).toBe('sku-7');c.requestId=randomUUID();c.expectedRevision=2;c.data.sku='SKU-7';expect(f.api('inventory.command',{command:c}).error.code).toBe('SKU_LOCKED');});
 it('preserves a blank desired-profit input through product edits instead of replacing it with zero',()=>{const f=liveShapeFixture();f.init();const p=f.api('inventory.read').data.products.find((p:any)=>p.sku==='SKU-13');expect(f.api('inventory.command',{command:command('product.update',p.id,1,{sku:p.sku,name:'Renamed',category:p.category,buyingPrice:p.buyingPrice,desiredProfit:'',imageAssetIds:[]})}).ok).toBe(true);expect(f.book()['Product Inventory'].rows[12][8]).toBe('');});
 it('prevents creating an uppercase duplicate of an existing lowercase SKU',()=>{const f=liveShapeFixture();f.init();const c=command();c.data.sku='SKU-7';expect(f.api('inventory.command',{command:c}).error.code).toBe('DUPLICATE_SKU');});
 it('includes recognized source formula versions in the approval digest',()=>{const f=liveShapeFixture();const old=f.run('emessaInventoryPlan');f.props.INVENTORY_APPROVED_PLAN=old.planDigest;const canonical=f.book()['Product Inventory'].rows[5][23];f.edit(7,23,canonical.replace(/(\$?[A-Z]{1,3})6\b/g,(_:string,label:string)=>label+'7'));expect(f.run('emessaInventoryPlan').planDigest).not.toBe(old.planDigest);expect(()=>f.run('emessaInventoryInitialize')).toThrow('PLAN_APPROVAL_REQUIRED');expect(f.writes()).toBe(0);});
 it('does not treat an unknown financial formula as an approved legacy family',()=>{const f=liveShapeFixture();f.edit(7,5,'=E7+1000');expect(()=>f.run('emessaInventoryPlan')).toThrow('FORMULA_MISMATCH');expect(f.writes()).toBe(0);});
 it('detects a source image-cell change after initialization, even to an otherwise trusted image formula',()=>{const f=liveShapeFixture();f.init();f.edit(6,0,'=IF(Y6="","",IFERROR(image(Y6,4,200,200),""))');expect(f.api('inventory.read').error.code).toBe('SOURCE_CHANGED');});
 it('reports missing initialization and repeat initialization explicitly',()=>{const f=fixture();expect(f.api('inventory.read').error.code).toBe('NOT_INITIALIZED');f.init();expect(()=>f.run('emessaInventoryPlan')).toThrow('ALREADY_INITIALIZED');});
 it('rejects invalid legacy inputs during preview, before an approval digest is offered',()=>{const f=liveShapeFixture();f.edit(13,8,-1);expect(()=>f.run('emessaInventoryPlan')).toThrow('SOURCE_REVIEW_REQUIRED');expect(f.writes()).toBe(0);});
});
