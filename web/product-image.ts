import {MAX_SOURCE_IMAGE_BYTES,MAX_STORED_IMAGE_BYTES,jpegDimensions,sourceImageDimensions} from '../shared/images';
export interface PreparedImage {requestId:string;base64:string;preview:string;bytes:number}
export async function prepareProductImage(file:File):Promise<PreparedImage>{
  if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>MAX_SOURCE_IMAGE_BYTES||file.size===0)throw new Error('Choose a JPEG, PNG or WebP image smaller than 2 MB.');
  try{sourceImageDimensions(new Uint8Array(await file.arrayBuffer()),file.type);}catch{throw new Error('Choose a valid, static JPEG, PNG or WebP photo with no more than 16 million pixels.');}
  const bitmap=await createImageBitmap(file);
  try{
    if(bitmap.width<1||bitmap.height<1||bitmap.width*bitmap.height>16000000)throw new Error('Choose an image with no more than 16 million pixels.');
    const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));
    const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
    const context=canvas.getContext('2d');if(!context)throw new Error('Your browser could not prepare this image.');
    context.fillStyle='#ffffff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
    let blob:Blob|null=null;
    for(const quality of [.86,.74,.62,.5]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=MAX_STORED_IMAGE_BYTES)break;}
    if(!blob||blob.size>MAX_STORED_IMAGE_BYTES)throw new Error('This image is too detailed to fit. Choose a smaller photo.');
    const bytes=new Uint8Array(await blob.arrayBuffer());jpegDimensions(bytes);
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    const base64=btoa(binary);
    return {requestId:crypto.randomUUID(),base64,preview:'data:image/jpeg;base64,'+base64,bytes:bytes.length};
  }finally{bitmap.close();}
}
