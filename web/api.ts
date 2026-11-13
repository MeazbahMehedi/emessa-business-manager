import type { ApiEnvelope, ApiFailure } from '../shared/types';
export class ApiError extends Error {
  constructor(public code:string,message:string,public status:number){super(message);}
}
export async function api<T>(path:string,options:RequestInit={}):Promise<T>{
  let response:Response;
  try{response=await fetch(path,{...options,credentials:'same-origin',cache:'no-store'});}
  catch{throw new ApiError('NETWORK_ERROR','The workspace could not be reached. Check your connection and try again.',0);}
  let result:ApiEnvelope<T>|ApiFailure;
  try{result=await response.json();}catch{throw new ApiError('INVALID_RESPONSE','The workspace returned an unexpected response. Try refreshing.',response.status);}
  if(!response.ok||!result.ok){const error=result.ok?undefined:result.error;throw new ApiError(error?.code||'REQUEST_FAILED',error?.message||'The request could not be completed.',response.status);}
  return result.data;
}
