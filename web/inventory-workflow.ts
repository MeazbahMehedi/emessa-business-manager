import {validateInventoryCommand,type InventoryCommand} from '../shared/inventory';
import {ApiError} from './api';
export const PENDING_INVENTORY_KEY='emessa.inventory.pending.v1';
/** Explicit recovery only: never replay a saved request automatically. */
export function rememberInventoryRequest(storage:Pick<Storage,'setItem'|'getItem'>,command:InventoryCommand,workspaceId:string,now=Date.now()) {
  const previous=storage.getItem(PENDING_INVENTORY_KEY);if(previous){let saved;try{saved=JSON.parse(previous);}catch{}if(saved?.workspaceId&&saved.workspaceId!==workspaceId)throw new Error('WORKSPACE_CHANGED');if(saved?.command?.requestId&&saved.command.requestId!==command.requestId)throw new Error('REQUEST_PENDING');}
  storage.setItem(PENDING_INVENTORY_KEY,JSON.stringify({version:1,createdAt:now,workspaceId,command:validateInventoryCommand(command)}));
}
export function recoverInventoryRequest(storage:Pick<Storage,'getItem'>,workspaceId:string):InventoryCommand|null {
  const raw=storage.getItem(PENDING_INVENTORY_KEY);if(!raw)return null;
  try{const saved=JSON.parse(raw);if(saved.version!==1||!Number.isFinite(saved.createdAt))return null;if(saved.workspaceId!==workspaceId)throw new Error('WORKSPACE_CHANGED');return validateInventoryCommand(saved.command);}catch(error){if(error instanceof Error&&error.message==='WORKSPACE_CHANGED')throw error;return null;}
}
export function saveMayBeUncertain(error:unknown):boolean {
  return !(error instanceof ApiError)||error.status===0||error.status===401||error.status===403||error.status>=500||['SAVE_UNCERTAIN','INVALID_RESPONSE','GOOGLE_REAUTH_REQUIRED'].includes(error.code);
}
