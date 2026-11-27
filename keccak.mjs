// Keccak-256 (Ethereum, suffix 0x01), not FIPS SHA3-256. BigInt implementation.
const MASK = (1n << 64n) - 1n;
const RC = [0x1n,0x8082n,0x800000000000808an,0x8000000080008000n,0x808bn,0x80000001n,0x8000000080008081n,0x8000000000008009n,0x8an,0x88n,0x80008009n,0x8000000an,0x8000808bn,0x800000000000008bn,0x8000000000008089n,0x8000000000008003n,0x8000000000008002n,0x8000000000000080n,0x800an,0x800000008000000an,0x8000000080008081n,0x8000000000008080n,0x80000001n,0x8000000080008008n];
const R = [0,1,62,28,27,36,44,6,55,20,3,10,43,25,39,41,45,15,21,8,18,2,61,56,14];
const rol = (x,n) => n ? ((x << BigInt(n)) | (x >> BigInt(64-n))) & MASK : x;
function permute(a) {
  for (const rc of RC) {
    const c = Array.from({length:5},(_,x)=>a[x]^a[x+5]^a[x+10]^a[x+15]^a[x+20]);
    const d = c.map((_,x)=>c[(x+4)%5]^rol(c[(x+1)%5],1));
    for(let y=0;y<5;y++)for(let x=0;x<5;x++)a[x+5*y]^=d[x];
    const b=Array(25).fill(0n);
    for(let y=0;y<5;y++)for(let x=0;x<5;x++)b[y+5*((2*x+3*y)%5)]=rol(a[x+5*y],R[x+5*y]);
    for(let y=0;y<5;y++)for(let x=0;x<5;x++)a[x+5*y]=(b[x+5*y]^((~b[(x+1)%5+5*y])&b[(x+2)%5+5*y]))&MASK;
    a[0]^=rc;
  }
}
export function keccak256(input) {
  const bytes=typeof input==='string'?new TextEncoder().encode(input):input;
  if(!(bytes instanceof Uint8Array))throw new TypeError('Expected text or Uint8Array.');
  const rate=136, padded=new Uint8Array(Math.ceil((bytes.length+1)/rate)*rate);padded.set(bytes);padded[bytes.length]=1;padded[padded.length-1]|=128;
  const a=Array(25).fill(0n);
  for(let start=0;start<padded.length;start+=rate){for(let j=0;j<rate;j++)a[j>>3]^=BigInt(padded[start+j])<<BigInt((j&7)*8);permute(a);}
  return '0x'+Array.from({length:32},(_,i)=>Number((a[i>>3]>>BigInt((i&7)*8))&255n).toString(16).padStart(2,'0')).join('');
}
export const selector = signature => keccak256(signature).slice(0,10);
