/** Phase 3 domain services. A durable locked/atomic adapter is required for live use. */
export interface CatalogRecord {
  id:string; revision:number; sku:string; name:string; category:string;
  openingStock:number; stock:number; buyingPrice:string; desiredProfit:string;
  imageAssetIds:string[]; archived:boolean;
}
export interface StockMovement { id:string; productId:string; delta:number; before:number; after:number; reason:string; actor:string; recordedAt:string }
export type InventoryAction='product.create'|'product.update'|'stock.adjust'|'product.archive';
export interface InventoryCommand {requestId:string;action:InventoryAction;expectedRevision:number|null;productId:string;data:Record<string,unknown>}
export interface InventoryResult {product:CatalogRecord;movementId?:string}
export interface InventoryTransaction {
  product(id:string):Promise<CatalogRecord|undefined>;
  skuOwner(sku:string):Promise<string|undefined>;
  approvedAsset(id:string):Promise<boolean>;
  operation(id:string):Promise<{fingerprint:string;result:InventoryResult}|undefined>;
  /** Must commit product, optional movement and journal result atomically. */
  commit(product:CatalogRecord,movement:StockMovement|undefined,requestId:string,fingerprint:string,result:InventoryResult):Promise<void>;
}
export interface InventoryStore { transaction<T>(work:(tx:InventoryTransaction)=>Promise<T>):Promise<T> }
export class InventoryError extends Error {constructor(public code:string){super(code);}}
const fail=(code:string):never=>{throw new InventoryError(code);};
function text(value:unknown,max:number,required=false):string {
  if(typeof value!=='string'||value.length>max||/[\u0000-\u001f\u007f]/.test(value))return fail('INVALID_INPUT');
  const result=value.trim();if(required&&!result)return fail('INVALID_INPUT');return result;
}
function money(value:unknown):string {
  if(typeof value!=='string'||!/^\d{1,12}(?:\.\d{1,6})?$/.test(value)||value.replace('.','').replace(/^0+/,'').replace(/0+$/,'').length>15)return fail('INVALID_MONEY');
  // Keep decimal inputs exact. Source formulas own conversions and calculated prices.
  return value.replace(/^0+(?=\d)/,'');
}
function keys(data:Record<string,unknown>,allowed:string[]){if(Object.keys(data).some(key=>!allowed.includes(key)))fail('PROTECTED_OR_UNKNOWN_FIELD');}
function plainObject(value:unknown):value is Record<string,unknown>{return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;}
export function validateInventoryCommand(raw:unknown):InventoryCommand {
  if(!plainObject(raw))return fail('INVALID_INPUT');
  keys(raw,['requestId','action','expectedRevision','productId','data']);
  if(typeof raw.requestId!=='string'||! /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw.requestId))return fail('INVALID_REQUEST_ID');
  if(!['product.create','product.update','stock.adjust','product.archive'].includes(String(raw.action)))return fail('INVALID_ACTION');
  if(!plainObject(raw.data))return fail('INVALID_INPUT');
  const productId=text(raw.productId,100,true);if(!/^[A-Za-z0-9_-]+$/.test(productId))return fail('INVALID_PRODUCT_ID');
  const action=raw.action as InventoryAction;
  if(action==='product.create'?raw.expectedRevision!==null:!Number.isSafeInteger(raw.expectedRevision)||Number(raw.expectedRevision)<1)return fail('INVALID_REVISION');
  const input=raw.data,data:Record<string,unknown>={};
  if(action==='product.create'||action==='product.update'){
    keys(input,['sku','name','category','buyingPrice','desiredProfit','imageAssetIds',...(action==='product.create'?['openingStock']:[])]);
    const originalSku=text(input.sku,100,true),sku=action==='product.create'?originalSku.toUpperCase():originalSku;if(!/^[A-Z0-9][A-Z0-9._-]*$/i.test(sku))return fail('INVALID_SKU');
    Object.assign(data,{sku,name:text(input.name,200,true),category:text(input.category,100),buyingPrice:money(input.buyingPrice),desiredProfit:action==='product.update'&&input.desiredProfit===''?'':money(input.desiredProfit)});
    if(!Array.isArray(input.imageAssetIds)||input.imageAssetIds.length>8)return fail('INVALID_ASSETS');
    const ids=input.imageAssetIds.map(id=>text(id,100,true));if(ids.some(id=>! /^[A-Za-z0-9_-]+$/.test(id))||new Set(ids).size!==ids.length)return fail('INVALID_ASSETS');data.imageAssetIds=ids;
    if(action==='product.create'){if(!Number.isSafeInteger(input.openingStock)||Number(input.openingStock)<0||Number(input.openingStock)>1000000)return fail('INVALID_QUANTITY');data.openingStock=input.openingStock;}
  }else if(action==='stock.adjust'){
    keys(input,['delta','reason']);if(!Number.isSafeInteger(input.delta)||Number(input.delta)===0||Math.abs(Number(input.delta))>1000000)return fail('INVALID_QUANTITY');
    data.delta=input.delta;data.reason=text(input.reason,500,true);
  }else keys(input,[]);
  return {requestId:raw.requestId,action,expectedRevision:raw.expectedRevision as number|null,productId,data};
}
export function canonicalInventoryValue(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(canonicalInventoryValue).join(',')+']';
  if(plainObject(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalInventoryValue(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
export function cloneInventoryValue<T>(value:T):T {return JSON.parse(JSON.stringify(value)) as T;}
/** Synchronous shared planner also runs inside Apps Script's locked transaction. */
export function planInventoryChange(command:InventoryCommand,existing:CatalogRecord|undefined,actor:string,now:Date):{result:InventoryResult;movement:StockMovement|undefined} {
  text(actor,200,true);if(!Number.isFinite(now.getTime()))return fail('INVALID_TIME');
  const create=command.action==='product.create';
  if(create&&existing)return fail('DUPLICATE_PRODUCT');if(!create&&!existing)return fail('PRODUCT_NOT_FOUND');
  if(existing&&existing.revision!==command.expectedRevision)return fail('STALE_REVISION');
  if(existing?.archived)return fail('PRODUCT_ARCHIVED');
  let product:CatalogRecord;
  if(create){const d=command.data;product={id:command.productId,revision:1,sku:d.sku as string,name:d.name as string,category:d.category as string,buyingPrice:d.buyingPrice as string,desiredProfit:d.desiredProfit as string,imageAssetIds:d.imageAssetIds as string[],openingStock:d.openingStock as number,stock:d.openingStock as number,archived:false};}
  else product={...cloneInventoryValue(existing!),revision:existing!.revision+1};
  if(command.action==='product.update'){if(command.data.sku!==existing!.sku)return fail('SKU_LOCKED');Object.assign(product,command.data);}
  let movement:StockMovement|undefined;
  if(command.action==='stock.adjust'){
    const before=product.stock,after=before+Number(command.data.delta);
    if(!Number.isSafeInteger(after)||after<0)return fail('OUT_OF_STOCK');
    product.stock=after;movement={id:command.requestId,productId:product.id,delta:Number(command.data.delta),before,after,reason:String(command.data.reason),actor,recordedAt:now.toISOString()};
  }else if(create&&product.openingStock){movement={id:command.requestId,productId:product.id,delta:product.openingStock,before:0,after:product.openingStock,reason:'Opening stock',actor,recordedAt:now.toISOString()};}
  if(command.action==='product.archive')product.archived=true;
  const result:InventoryResult={product:cloneInventoryValue(product),...(movement?{movementId:movement.id}:{})};
  return {result,movement};
}
export async function applyInventoryCommand(store:InventoryStore,raw:unknown,actor:string,now=new Date()):Promise<InventoryResult> {
  const command=validateInventoryCommand(raw);text(actor,200,true);if(!Number.isFinite(now.getTime()))return fail('INVALID_TIME');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonicalInventoryValue({command,actor})));
  const fingerprint=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  return store.transaction(async tx=>{
    const previous=await tx.operation(command.requestId);
    if(previous){if(previous.fingerprint!==fingerprint)return fail('REQUEST_KEY_CONFLICT');return cloneInventoryValue(previous.result);}
    const existing=await tx.product(command.productId);
    const {result,movement}=planInventoryChange(command,existing,actor,now);
    const product=result.product;
    if(command.action==='product.create'||command.action==='product.update'){
      const owner=await tx.skuOwner(product.sku);if(owner&&owner!==product.id)return fail('DUPLICATE_SKU');
      for(const asset of product.imageAssetIds)if(!await tx.approvedAsset(asset))return fail('ASSET_NOT_APPROVED');
    }
    await tx.commit(product,movement,command.requestId,fingerprint,result);return cloneInventoryValue(result);
  });
}
