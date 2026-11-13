import { AppError,type Env,type Fetcher } from './types';
import { accessToken } from './google';
import { InventoryError,validateInventoryCommand,type InventoryResult } from '../shared/inventory';
import type { InventorySnapshot } from '../shared/inventory-api';
import { jpegDimensions,MAX_STORED_IMAGE_BYTES } from '../shared/images';
export const INVENTORY_BODY_LIMIT=450*1024;
export function inventoryConfigured(env:Env):boolean {
  return !!(env.GOOGLE_CLIENT_ID&&env.GOOGLE_CLIENT_SECRET&&env.GOOGLE_INVENTORY_REFRESH_TOKEN&&/^[A-Za-z0-9_-]{10,220}$/.test(env.GOOGLE_INVENTORY_DEPLOYMENT_ID||''));
}
const messages:Record<string,string>={
  NOT_INITIALIZED:'Initialize the reviewed staging inventory before connecting it.',ALREADY_INITIALIZED:'This inventory has already been initialized. Use its existing metadata.',LIVE_ACTIVATION_REQUIRED:'Complete staging checks and pause other inventory writers before activating live inventory.',WORKSPACE_CHANGED:'The inventory connection changed. Resolve the original request in its original workspace before saving.',WRITE_DISABLED:'Inventory changes have not been enabled by the owner.',SETUP_REQUIRED:'The inventory save service needs to be configured.',FORBIDDEN:'The inventory service rejected this account.',
  SCHEMA_MISMATCH:'The source layout has changed. Review the connection before saving.',FORMULA_MISMATCH:'A protected calculation has changed. Review the source formulas before saving.',
  SOURCE_CHANGED:'The source was edited outside the website. Reconcile those changes before saving.',SOURCE_REVIEW_REQUIRED:'Some existing source values need review before inventory can be enabled.',
  STALE_REVISION:'This product was changed after you opened it. Reload the latest product and review your edit.',DUPLICATE_SKU:'Another product already uses this SKU.',DUPLICATE_PRODUCT:'This product already exists.',
  PRODUCT_NOT_FOUND:'This product could not be found.',PRODUCT_ARCHIVED:'This product has been archived.',SKU_LOCKED:'The SKU cannot change after creation because sales history refers to it.',
  OUT_OF_STOCK:'This adjustment would leave stock below zero.',STOCK_UNAVAILABLE:'The current stock calculation is unavailable. No adjustment was saved.',
  CAPACITY_REACHED:'The current source supports 200 products. Its formulas need review before adding more rows.',JOURNAL_FULL:'The operation journal needs maintenance before more changes can be saved.',
  REQUEST_KEY_CONFLICT:'This request ID belongs to a different action. Refresh and review the operation.',BUSY:'Another inventory change is running. Retry this same request shortly.',
  INVALID_INPUT:'Check the product fields and try again.',INVALID_MONEY:'Enter a nonnegative price with up to six decimal places and 15 significant digits.',INVALID_QUANTITY:'Enter a valid whole-unit quantity.',INVALID_REQUEST_ID:'The request identifier is invalid.',INVALID_REVISION:'Reload this product before editing.',
  INVALID_PRODUCT_ID:'The product identifier is invalid.',INVALID_SKU:'Use letters, numbers, dots, underscores or hyphens for the SKU.',INVALID_ACTION:'This inventory action is unavailable.',PROTECTED_OR_UNKNOWN_FIELD:'Calculated or unknown fields cannot be edited.',
  INVALID_ASSETS:'The image reference is invalid.',ASSET_NOT_APPROVED:'The image has not finished uploading.',INVALID_IMAGE:'Choose a valid JPEG, PNG or WebP image under 2 MB.',IMAGE_SETUP_REQUIRED:'The private image folder has not been configured.',
  ASSET_NOT_PRIVATE:'The image permissions need review before it can be used.',ASSET_REVIEW_REQUIRED:'This image needs an owner review. Its existing copy has been preserved.',ASSET_NOT_FOUND:'The image could not be found.',ASSET_IN_USE:'This image is still linked or inside its retention period.',STAGING_TARGET_REQUIRED:'Choose a staging copy rather than a source workbook.'
};
export function inventoryError(error:unknown):never {
  const code=error instanceof InventoryError?error.code:'INVALID_INPUT';
  throw new AppError(code,messages[code]||'Check the inventory request.',400);
}
export function inventoryTokenEnv(env:Env):Env {return {...env,GOOGLE_REFRESH_TOKEN:env.GOOGLE_INVENTORY_REFRESH_TOKEN};}
export async function googleInventory<T>(env:Env,operation:string,parameters:Record<string,unknown>={},fetcher:Fetcher=fetch):Promise<T> {
  if(!['inventory.read','inventory.command','inventory.status','asset.upload','asset.read','asset.discard'].includes(operation))throw new AppError('FORBIDDEN','This inventory action is unavailable.',403);
  if(!inventoryConfigured(env))throw new AppError('WRITE_SETUP_REQUIRED','The inventory save service is not connected yet.',503);
  const token=await accessToken(inventoryTokenEnv(env),fetcher);
  const mutation=['inventory.command','asset.upload','asset.discard'].includes(operation);
  const uncertain=()=>new AppError(mutation?'SAVE_UNCERTAIN':'INVENTORY_UNAVAILABLE',mutation?'The save result is unconfirmed. Check its status or retry the same request; do not submit a second change.':'Inventory could not be reached. Please try again.',504);
  let response:Response;
  try{response=await fetcher(`https://script.googleapis.com/v1/scripts/${env.GOOGLE_INVENTORY_DEPLOYMENT_ID}:run`,{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({function:'emessaInventory',parameters:[{version:1,operation,...parameters}],devMode:false}),signal:AbortSignal.timeout(25000)});}catch{throw uncertain();}
  if(response.status===401||response.status===403)throw new AppError('GOOGLE_REAUTH_REQUIRED','Reconnect the owner’s inventory authorization.',503);
  if(response.status===429)throw new AppError('QUOTA_EXCEEDED','Google is limiting requests. Retry the same request later.',429);
  if(!response.ok)throw uncertain();
  let body:any;try{body=await response.json();}catch{throw uncertain();}
  if(body.error||body.done===false)throw uncertain();
  const result=body.response?.result;
  if(!result?.ok){const code=result?.error?.code;if(!messages[code])throw uncertain();const location=/^Product Inventory![A-Z]{1,2}[1-9][0-9]{0,3}$/.test(result?.error?.location||'')?' ('+result.error.location+')':'';throw new AppError(code,messages[code]+location,['STALE_REVISION','SOURCE_CHANGED','DUPLICATE_SKU','REQUEST_KEY_CONFLICT','OUT_OF_STOCK','SKU_LOCKED'].includes(code)?409:code==='BUSY'?503:400);}
  if(result.data===undefined)throw uncertain();
  return result.data as T;
}
export function validateInventorySnapshot(value:InventorySnapshot):InventorySnapshot {
  if(!value||! /^[a-f0-9]{64}$/.test(value.workspaceId)||!['staging','live'].includes(value.mode)||typeof value.enabled!=='boolean'||!Number.isFinite(Date.parse(value.asOf))||!Array.isArray(value.products)||value.products.length>200||!Array.isArray(value.movements)||value.movements.length>200||value.capacity!==200||value.remaining!==200-value.products.length)throw new AppError('SCHEMA_MISMATCH','Inventory returned an unexpected layout.',502);
  const ids=new Set<string>(),skus=new Set<string>();
  for(const p of value.products){
    try{validateInventoryCommand({requestId:'11111111-1111-4111-8111-111111111111',action:'product.update',expectedRevision:1,productId:p.id,data:{sku:p.sku,name:p.name,category:p.category,buyingPrice:p.buyingPrice,desiredProfit:p.desiredProfit,imageAssetIds:p.imageAssetIds}});}catch{throw new AppError('SCHEMA_MISMATCH','Inventory returned unexpected product fields.',502);}
    if(!Number.isSafeInteger(p.openingStock)||p.openingStock<0||p.openingStock>1000000||!Number.isSafeInteger(p.revision)||p.revision<1||!Number.isSafeInteger(p.stock)||typeof p.archived!=='boolean'||typeof p.legacyImage!=='boolean'||![p.price,p.cost].every(n=>n===null||typeof n==='number'&&Number.isFinite(n))||ids.has(p.id)||skus.has(p.sku.toUpperCase()))throw new AppError('SCHEMA_MISMATCH','Inventory returned an unexpected product.',502);
    ids.add(p.id);skus.add(p.sku.toUpperCase());
  }
  for(const m of value.movements)if(!m||![m.id,m.productId,m.reason,m.actor,m.recordedAt].every(s=>typeof s==='string'&&s.length<=500)||!Number.isFinite(Date.parse(m.recordedAt))||![m.delta,m.before,m.after].every(Number.isSafeInteger))throw new AppError('SCHEMA_MISMATCH','Inventory returned an unexpected movement.',502);
  return value;
}
export function validateInventoryResult(value:InventoryResult,command?:ReturnType<typeof validateInventoryCommand>):InventoryResult {
  const snapshot={workspaceId:'0'.repeat(64),mode:'staging',enabled:true,asOf:new Date().toISOString(),products:[{...value?.product,price:null,cost:null,legacyImage:false}],movements:[],capacity:200,remaining:199} as InventorySnapshot;
  validateInventorySnapshot(snapshot);
  if(command&&value.product.id!==command.productId)throw new AppError('SAVE_UNCERTAIN','The returned save result did not match this product. Check its status.',502);
  return value;
}
export async function boundedInventoryJson(request:Request):Promise<unknown>{
  if(request.headers.get('content-type')?.split(';')[0].trim()!=='application/json')throw new AppError('INVALID_INPUT','Send inventory fields as JSON.',415);
  if(Number(request.headers.get('content-length'))>INVENTORY_BODY_LIMIT)throw new AppError('REQUEST_TOO_LARGE','The image or request is too large.',413);
  const reader=request.body?.getReader();if(!reader)throw new AppError('INVALID_INPUT','The request is empty.',400);
  let total=0;const parts:Uint8Array[]=[];
  while(true){const {done,value}=await reader.read();if(done)break;total+=value.length;if(total>INVENTORY_BODY_LIMIT){await reader.cancel();throw new AppError('REQUEST_TOO_LARGE','The image or request is too large.',413);}parts.push(value);}
  const bytes=new Uint8Array(total);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  try{return JSON.parse(new TextDecoder().decode(bytes));}catch{throw new AppError('INVALID_INPUT','The request is not valid JSON.',400);}
}
export function validateUpload(raw:unknown):{requestId:string;base64:string}{
  const value=raw as Record<string,unknown>;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['requestId','base64'].includes(k))||typeof value.requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)||typeof value.base64!=='string'||value.base64.length>409600||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64))throw new AppError('INVALID_IMAGE',messages.INVALID_IMAGE,400);
  try{jpegDimensions(Uint8Array.from(atob(value.base64),n=>n.charCodeAt(0)));}catch{throw new AppError('INVALID_IMAGE',messages.INVALID_IMAGE,400);}
  return {requestId:value.requestId,base64:value.base64};
}
export async function inventoryImage(env:Env,assetId:string,fetcher:Fetcher):Promise<Response>{
  if(!/^a_[0-9a-f]{32}$/i.test(assetId))throw new AppError('NOT_FOUND','Image not found.',404);
  const pointer=await googleInventory<{fileId:string;mime:string;bytes:number}>(env,'asset.read',{assetId},fetcher);
  if(!/^[A-Za-z0-9_-]{10,150}$/.test(pointer.fileId)||pointer.mime!=='image/jpeg'||!Number.isSafeInteger(pointer.bytes)||pointer.bytes<20||pointer.bytes>MAX_STORED_IMAGE_BYTES)throw new AppError('SCHEMA_MISMATCH','The image reference needs review.',502);
  const token=await accessToken(inventoryTokenEnv(env),fetcher);
  let response:Response;try{response=await fetcher('https://www.googleapis.com/drive/v3/files/'+pointer.fileId+'?alt=media',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(15000)});}catch{throw new AppError('INVENTORY_UNAVAILABLE','The image could not be loaded.',502);}
  if(!response.ok)throw new AppError('INVENTORY_UNAVAILABLE','The image could not be loaded.',502);
  const reader=response.body?.getReader();if(!reader)throw new AppError('INVALID_IMAGE','The image is unavailable.',502);
  const parts:Uint8Array[]=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>MAX_STORED_IMAGE_BYTES){await reader.cancel();throw new AppError('INVALID_IMAGE','The image is too large.',502);}parts.push(value);}
  const bytes=new Uint8Array(size);let offset=0;for(const p of parts){bytes.set(p,offset);offset+=p.length;}
  try{if(size!==pointer.bytes)throw new Error();jpegDimensions(bytes);}catch{throw new AppError('INVALID_IMAGE','The image needs review.',502);}
  return new Response(bytes,{headers:{'content-type':'image/jpeg','content-length':String(size),'cache-control':'no-store','x-content-type-options':'nosniff'}});
}
