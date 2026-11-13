import {describe,it,expect} from 'vitest';
import {PENDING_INVENTORY_KEY,recoverInventoryRequest,rememberInventoryRequest,saveMayBeUncertain} from '../web/inventory-workflow';
import {ApiError} from '../web/api';
function storage(){const data=new Map<string,string>();return {getItem:(key:string)=>data.get(key)||null,setItem:(key:string,value:string)=>{data.set(key,value);}};}
const command=()=>({requestId:crypto.randomUUID(),action:'stock.adjust' as const,productId:'product1',expectedRevision:2,data:{delta:2,reason:'New stock'}});
describe('inventory save recovery and grant separation',()=>{
 it('retains the exact request ID and payload through a page reload for explicit recovery',()=>{const s=storage(),c=command();rememberInventoryRequest(s,c,'workspace1');expect(recoverInventoryRequest(s,'workspace1')).toEqual(c);expect(recoverInventoryRequest(s,'workspace1')?.requestId).toBe(c.requestId);});
 it('does not replay a pending command into another workbook',()=>{const s=storage();rememberInventoryRequest(s,command(),'old');expect(()=>recoverInventoryRequest(s,'new')).toThrow('WORKSPACE_CHANGED');});
 it('does not recover malformed or protected fields as a valid command',()=>{const s=storage();s.setItem(PENDING_INVENTORY_KEY,'not JSON');expect(recoverInventoryRequest(s,'workspace1')).toBe(null);s.setItem(PENDING_INVENTORY_KEY,JSON.stringify({version:1,createdAt:Date.now(),workspaceId:'workspace1',command:{...command(),data:{delta:2,reason:'x',stock:100}}}));expect(recoverInventoryRequest(s,'workspace1')).toBe(null);});
 it.each([0,500,502,503,504])('keeps status checking and same-key retry after status %s',status=>{expect(saveMayBeUncertain(new ApiError('SAVE_UNCERTAIN','Unconfirmed',status))).toBe(true);});
 it('treats an explicit stale rejection as an edit conflict and an invalid response as uncertain',()=>{expect(saveMayBeUncertain(new ApiError('STALE_REVISION','Reload',409))).toBe(false);expect(saveMayBeUncertain(new ApiError('INVALID_RESPONSE','Bad response',200))).toBe(true);});
});
