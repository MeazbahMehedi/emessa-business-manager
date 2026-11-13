import type {CatalogRecord,InventoryResult,StockMovement} from './inventory';
export interface ManagedProduct extends CatalogRecord {price:number|null;cost:number|null;legacyImage:boolean}
export interface InventorySnapshot {workspaceId:string;mode:'staging'|'live';enabled:boolean;asOf:string;products:ManagedProduct[];movements:StockMovement[];capacity:number;remaining:number}
export type InventoryConnection={configured:false;enabled:false}|({configured:true}&InventorySnapshot);
export type InventoryOperationStatus={state:'committed';result:InventoryResult}|{state:'not_found'};
