/** Storage accepts only raster JPEGs produced by the website's canvas pipeline. */
export const MAX_SOURCE_IMAGE_BYTES=2*1024*1024;
export const MAX_STORED_IMAGE_BYTES=300*1024;
function jpegDimensionsWithLimits(bytes:Uint8Array,maxBytes:number,maxDimension:number):{width:number;height:number} {
  const invalid=():never=>{throw new Error('INVALID_IMAGE');};
  if(bytes.length<20||bytes.length>maxBytes||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)return invalid();
  let at=2,width=0,height=0;
  while(at<bytes.length-2){
    if(bytes[at++]!==255)return invalid();
    while(bytes[at]===255)at++;
    const marker=bytes[at++];
    if(marker===217)break;
    const length=(bytes[at]<<8)|bytes[at+1];
    if(length<2||at+length>bytes.length-2)return invalid();
    if([192,193,194].includes(marker)){
      if(length<8||bytes[at+2]!==8)return invalid();
      height=(bytes[at+3]<<8)|bytes[at+4];width=(bytes[at+5]<<8)|bytes[at+6];
    }
    if(marker===218)break;
    at+=length;
  }
  if(width<1||height<1||width>maxDimension||height>maxDimension)return invalid();
  return {width,height};
}

export function jpegDimensions(bytes:Uint8Array):{width:number;height:number} {return jpegDimensionsWithLimits(bytes,MAX_STORED_IMAGE_BYTES,1600);}
/** Read dimensions before decoding an uploaded image to bound browser memory use. */
export function sourceImageDimensions(bytes:Uint8Array,mime:string):{width:number;height:number} {
  if(bytes.length>MAX_SOURCE_IMAGE_BYTES||bytes.length<20)throw new Error('INVALID_IMAGE');
  let width=0,height=0;
  if(mime==='image/jpeg')({width,height}=jpegDimensionsWithLimits(bytes,MAX_SOURCE_IMAGE_BYTES,16000));
  else if(mime==='image/png'){
    if([137,80,78,71,13,10,26,10].some((n,i)=>bytes[i]!==n)||bytes.length<33||String.fromCharCode(...bytes.subarray(12,16))!=='IHDR')throw new Error('INVALID_IMAGE');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);width=view.getUint32(16);height=view.getUint32(20);
  }else if(mime==='image/webp'){
    const ascii=(a:number,b:number)=>String.fromCharCode(...bytes.subarray(a,b));
    if(bytes.length<30||ascii(0,4)!=='RIFF'||ascii(8,12)!=='WEBP')throw new Error('INVALID_IMAGE');
    const chunk=ascii(12,16);
    if(chunk==='VP8X'){if(bytes[20]&2)throw new Error('INVALID_IMAGE');width=1+bytes[24]+(bytes[25]<<8)+(bytes[26]<<16);height=1+bytes[27]+(bytes[28]<<8)+(bytes[29]<<16);}
    else if(chunk==='VP8 '){if(bytes[23]!==157||bytes[24]!==1||bytes[25]!==42)throw new Error('INVALID_IMAGE');width=(bytes[26]|bytes[27]<<8)&16383;height=(bytes[28]|bytes[29]<<8)&16383;}
    else if(chunk==='VP8L'){if(bytes[20]!==47)throw new Error('INVALID_IMAGE');width=1+bytes[21]+((bytes[22]&63)<<8);height=1+(bytes[22]>>6)+(bytes[23]<<2)+((bytes[24]&15)<<10);}
  }
  if(width<1||height<1||width*height>16000000)throw new Error('INVALID_IMAGE');
  return {width,height};
}
