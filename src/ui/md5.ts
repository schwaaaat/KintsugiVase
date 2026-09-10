/** MD5 of the exact UTF-8 bytes JSZip writes for a string, returned in the
 * uppercase form used by OrcaSlicer/Bambu `.gcode.md5` entries. */
export function md5Hex(text:string):string {
  const source=new TextEncoder().encode(text);
  const paddedLength=Math.ceil((source.length+9)/64)*64;
  const bytes=new Uint8Array(paddedLength);bytes.set(source);bytes[source.length]=0x80;
  const view=new DataView(bytes.buffer);
  const bitLength=source.length*8;
  view.setUint32(paddedLength-8,bitLength>>>0,true);
  view.setUint32(paddedLength-4,Math.floor(bitLength/0x100000000),true);
  let a0=0x67452301,b0=0xefcdab89,c0=0x98badcfe,d0=0x10325476;
  const shifts=[7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,
    5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,
    4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,
    6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  const constants=Array.from({length:64},(_,i)=>Math.floor(Math.abs(Math.sin(i+1))*0x100000000)>>>0);
  const rotate=(value:number,count:number)=>((value<<count)|(value>>>(32-count)))>>>0;
  for(let offset=0;offset<bytes.length;offset+=64){
    const words=Array.from({length:16},(_,i)=>view.getUint32(offset+i*4,true));
    let a=a0,b=b0,c=c0,d=d0;
    for(let i=0;i<64;i++){
      let f:number,g:number;
      if(i<16){f=(b&c)|(~b&d);g=i;}
      else if(i<32){f=(d&b)|(~d&c);g=(5*i+1)%16;}
      else if(i<48){f=b^c^d;g=(3*i+5)%16;}
      else{f=c^(b|~d);g=(7*i)%16;}
      const oldD=d;d=c;c=b;
      b=(b+rotate((a+f+constants[i]+words[g])>>>0,shifts[i]))>>>0;
      a=oldD;
    }
    a0=(a0+a)>>>0;b0=(b0+b)>>>0;c0=(c0+c)>>>0;d0=(d0+d)>>>0;
  }
  return [a0,b0,c0,d0].map(value=>[0,8,16,24].map(shift=>(value>>>shift&0xff).toString(16).padStart(2,'0')).join('')).join('').toUpperCase();
}
