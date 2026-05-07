import { useState, useEffect, useRef, useCallback } from "react";

// ── Helpers ───────────────────────────────────────────────────
const clamp = (v,lo=0,hi=255) => Math.max(lo,Math.min(hi,v));
const clamp01 = v => Math.max(0,Math.min(1,v));
function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return[0,0,l];const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);let h=max===r?((g-b)/d+(g<b?6:0))/6:max===g?((b-r)/d+2)/6:((r-g)/d+4)/6;return[h*360,s,l];}
function hslToRgb(h,s,l){h/=360;if(s===0){const v=Math.round(l*255);return[v,v,v];}const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const f=t=>{if(t<0)t+=1;if(t>1)t-=1;return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};return[Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)];}

// Piecewise linear LUT for film sims
function lut(pts){const s=[...pts].sort((a,b)=>a[0]-b[0]),out=new Uint8Array(256);for(let x=0;x<256;x++){if(x<=s[0][0]){out[x]=clamp(s[0][1]);continue;}if(x>=s[s.length-1][0]){out[x]=clamp(s[s.length-1][1]);continue;}for(let i=0;i<s.length-1;i++){if(x>=s[i][0]&&x<=s[i+1][0]){const t=(x-s[i][0])/(s[i+1][0]-s[i][0]);out[x]=clamp(s[i][1]+t*(s[i+1][1]-s[i][1]));break;}}}return out;}

// Monotone cubic spline LUT for user curves
function splineLUT(pts){
  const sorted=[...pts].sort((a,b)=>a[0]-b[0]),n=sorted.length,out=new Uint8Array(256);
  if(n===1){out.fill(clamp(sorted[0][1]));return out;}
  if(n===2){const[[x0,y0],[x1,y1]]=sorted;for(let x=0;x<256;x++)out[x]=x<=x0?clamp(y0):x>=x1?clamp(y1):clamp(Math.round(y0+(y1-y0)*(x-x0)/(x1-x0)));return out;}
  const xs=sorted.map(p=>p[0]),ys=sorted.map(p=>p[1]);
  const delta=[];for(let i=0;i<n-1;i++)delta.push((ys[i+1]-ys[i])/(xs[i+1]-xs[i]));
  const m=[delta[0]];for(let i=1;i<n-1;i++)m.push((delta[i-1]+delta[i])/2);m.push(delta[n-2]);
  for(let i=0;i<n-1;i++){if(delta[i]===0){m[i]=0;m[i+1]=0;continue;}const a=m[i]/delta[i],b=m[i+1]/delta[i],ss=Math.sqrt(a*a+b*b);if(ss>3){m[i]=3*a/ss*delta[i];m[i+1]=3*b/ss*delta[i];}}
  const interp=x=>{if(x<=xs[0])return ys[0];if(x>=xs[n-1])return ys[n-1];let i=0;while(i<n-1&&xs[i+1]<x)i++;const h=xs[i+1]-xs[i],tv=(x-xs[i])/h,t2=tv*tv,t3=t2*tv;return(2*t3-3*t2+1)*ys[i]+(t3-2*t2+tv)*h*m[i]+(-2*t3+3*t2)*ys[i+1]+(t3-t2)*h*m[i+1];};
  for(let x=0;x<256;x++)out[x]=clamp(Math.round(interp(x)));
  return out;
}

// ── Film Simulations ──────────────────────────────────────────
const SIMS = {
  "Classic Chrome":{desc:"Muted · Cyan shadows · Restrained",sat:.70,bw:false,r:[[0,8],[128,122],[255,240]],g:[[0,5],[128,128],[255,250]],b:[[0,16],[128,138],[255,253]]},
  "Velvia":        {desc:"Vivid · Rich · High contrast",     sat:1.55,bw:false,r:[[0,0],[128,134],[255,255]],g:[[0,0],[128,130],[255,255]],b:[[0,0],[128,118],[255,246]]},
  "Provia":        {desc:"Natural · Balanced · True colour", sat:1.00,bw:false,r:[[0,0],[128,130],[255,255]],g:[[0,0],[128,129],[255,254]],b:[[0,0],[128,127],[255,252]]},
  "Eterna Cinema": {desc:"Flat · Cinematic · Lifted blacks", sat:.60, bw:false,r:[[0,26],[128,138],[255,222]],g:[[0,23],[128,136],[255,220]],b:[[0,30],[128,142],[255,227]]},
  "Acros":         {desc:"B&W · Punchy contrast · Film grain",sat:0,  bw:true, r:[[0,0],[128,134],[255,255]],g:[[0,0],[128,134],[255,255]],b:[[0,0],[128,134],[255,255]]},
  "Classic Neg":      {desc:"Warm shadows · Faded highlights",       sat:.82, bw:false,r:[[0,22],[128,162],[255,246]],g:[[0,13],[128,150],[255,241]],b:[[0,8],[128,134],[255,229]]},
  "Nostalgic Neg":    {desc:"Vintage warmth · Hazy · Faded",        sat:.76, bw:false,r:[[0,36],[128,172],[255,245]],g:[[0,21],[128,154],[255,228]],b:[[0,10],[128,124],[255,198]]},
  "Astia / Soft":     {desc:"Soft · Low contrast · Flattering",     sat:.90, bw:false,r:[[0,4],[64,68],[128,132],[192,196],[255,252]],g:[[0,3],[64,67],[128,130],[192,193],[255,250]],b:[[0,5],[64,66],[128,129],[192,191],[255,248]]},
  "Pro Neg Hi":       {desc:"Punchy · Portrait-ready · Rich",       sat:1.12,bw:false,r:[[0,0],[64,58],[128,136],[192,208],[255,255]],g:[[0,0],[64,56],[128,132],[192,204],[255,254]],b:[[0,0],[64,50],[128,124],[192,192],[255,248]]},
  "Pro Neg Std":      {desc:"Natural neg · Soft contrast · Skin",   sat:.92, bw:false,r:[[0,6],[64,66],[128,130],[192,194],[255,252]],g:[[0,4],[64,64],[128,128],[192,192],[255,250]],b:[[0,8],[64,64],[128,126],[192,188],[255,244]]},
  "Bleach Bypass":    {desc:"High contrast · Desaturated · Gritty", sat:.22, bw:false,r:[[0,8],[64,44],[128,140],[192,218],[255,252]],g:[[0,8],[64,44],[128,138],[192,214],[255,248]],b:[[0,12],[64,48],[128,136],[192,208],[255,242]]},
  "Reala Ace":        {desc:"Faithful · Natural · Slightly warm",   sat:1.05,bw:false,r:[[0,2],[64,66],[128,130],[192,195],[255,254]],g:[[0,1],[64,65],[128,129],[192,193],[255,253]],b:[[0,0],[64,62],[128,126],[192,190],[255,250]]},
};

// ── HSL Ranges ────────────────────────────────────────────────
const HSL_RANGES = [
  {name:'Reds',    col:'#e05555',hue:0,  width:40},
  {name:'Oranges', col:'#d4782a',hue:30, width:28},
  {name:'Yellows', col:'#c8b830',hue:60, width:28},
  {name:'Greens',  col:'#3a9e5a',hue:120,width:60},
  {name:'Aquas',   col:'#2a9e8a',hue:180,width:28},
  {name:'Blues',   col:'#4a7ec8',hue:225,width:55},
  {name:'Purples', col:'#8050b0',hue:285,width:28},
  {name:'Magentas',col:'#b83878',hue:330,width:32},
];

// ── Pixel Processing ──────────────────────────────────────────
const TO_LIN = new Float32Array(256);
for(let i=0;i<256;i++){const v=i/255;TO_LIN[i]=v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);}
const toSRGB = v=>{v=Math.max(0,Math.min(1,v));return Math.round((v<=0.0031308?v*12.92:1.055*Math.pow(v,1/2.4)-0.055)*255);};
const ss = (a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

function process(imageData, adj, simKey) {
  const src=imageData.data,n=src.length,out=new Uint8ClampedArray(n);
  const sim=simKey?SIMS[simKey]:null;
  const rL=sim?lut(sim.r):null,gL=sim?lut(sim.g):null,bL=sim?lut(sim.b):null;
  const expF=Math.pow(2,adj.exposure);
  const t=adj.temperature/100,ti=adj.tint/100;
  const rWB=Math.pow(2,t*0.40+ti*0.10),gWB=Math.pow(2,t*0.03-ti*0.20),bWB=Math.pow(2,-t*0.60+ti*0.06);
  const hasWB=adj.temperature||adj.tint;
  // Contrast LUT
  const cLUT=new Float32Array(1024);
  for(let i=0;i<1024;i++){const v=i/1023;if(!adj.contrast){cLUT[i]=v;continue;}const k=adj.contrast/100;cLUT[i]=k>0?(Math.tanh((v*2-1)*(1+k*3.5))/Math.tanh(1+k*3.5)+1)/2:0.5+(v-0.5)/(1+Math.abs(k)*2.5);}
  const applyC=v=>cLUT[Math.max(0,Math.min(1023,Math.round(v*1023)))];
  // Curves LUTs
  const mLUT=splineLUT(adj.curves.master),crLUT=splineLUT(adj.curves.r),cgLUT=splineLUT(adj.curves.g),cbLUT=splineLUT(adj.curves.b);
  const hasCurves=adj.curves.master.length>2||adj.curves.r.length>2||adj.curves.g.length>2||adj.curves.b.length>2||adj.curves.master.some(([x,y])=>Math.abs(y-x)>2);
  // HSL
  const hasHSL=HSL_RANGES.some(r=>{const h=adj.hsl[r.name];return h&&(h.h||h.s||h.l);});

  for(let i=0;i<n;i+=4){
    let r=TO_LIN[src[i]],g=TO_LIN[src[i+1]],b=TO_LIN[src[i+2]];
    if(hasWB){r*=rWB;g*=gWB;b*=bWB;}
    r*=expF;g*=expF;b*=expF;
    if(adj.blacks){const lm=0.2126*r+0.7152*g+0.0722*b,mk=Math.pow(ss(0.5,0,lm),1.2),sh=(adj.blacks/100)*0.30*mk;r+=sh;g+=sh;b+=sh;}
    if(adj.whites){const lm=0.2126*r+0.7152*g+0.0722*b,mk=Math.pow(ss(0.5,1.2,lm),1.2),sh=(adj.whites/100)*0.38*mk;r+=sh;g+=sh;b+=sh;}
    if(adj.shadows){const lm=0.2126*r+0.7152*g+0.0722*b,mk=ss(0.65,0,lm),sh=(adj.shadows/100)*0.50*mk;r+=sh;g+=sh;b+=sh;}
    if(adj.highlights){const lm=0.2126*r+0.7152*g+0.0722*b,mk=ss(0.35,1.1,lm),sh=(adj.highlights/100)*0.42*mk;r+=sh;g+=sh;b+=sh;}
    if(adj.contrast){r=applyC(Math.max(0,Math.min(1,r)));g=applyC(Math.max(0,Math.min(1,g)));b=applyC(Math.max(0,Math.min(1,b)));}
    if(adj.brightness){const br=adj.brightness/100*0.35;r+=br;g+=br;b+=br;}
    // → sRGB for HSL, curves, film sim
    let rS=toSRGB(r),gS=toSRGB(g),bS=toSRGB(b);
    // HSL adjustments
    if(hasHSL){
      const[h,s,l]=rgbToHsl(rS,gS,bS);
      let dh=0,ds=0,dl=0,tw=0;
      for(const range of HSL_RANGES){
        const a=adj.hsl[range.name];if(!a||(!a.h&&!a.s&&!a.l))continue;
        let diff=Math.abs(h-range.hue)%360;if(diff>180)diff=360-diff;
        const w=Math.max(0,1-diff/range.width);
        if(w>0){dh+=a.h*w;ds+=a.s*w;dl+=a.l*w;tw+=w;}
      }
      if(tw>0){[rS,gS,bS]=hslToRgb(((h+dh)+360)%360,clamp01(s+ds/100),clamp01(l+dl/100));}
    }
    // Curves
    if(hasCurves){rS=crLUT[mLUT[clamp(rS)]];gS=cgLUT[mLUT[clamp(gS)]];bS=cbLUT[mLUT[clamp(bS)]];}
    // Film sim
    if(sim){
      if(sim.bw){const gr=clamp(Math.round(.299*rS+.587*gS+.114*bS));rS=rL[gr];gS=gL[gr];bS=bL[gr];}
      else{rS=rL[clamp(rS)];gS=gL[clamp(gS)];bS=bL[clamp(bS)];if(sim.sat!==1){const[h,s,l]=rgbToHsl(rS,gS,bS);[rS,gS,bS]=hslToRgb(h,clamp01(s*sim.sat),l);}}
    }
    out[i]=rS;out[i+1]=gS;out[i+2]=bS;out[i+3]=src[i+3];
  }
  return new ImageData(out,imageData.width,imageData.height);
}

function boxBlur(imageData,radius){
  const{data,width,height}=imageData,r=Math.max(1,Math.floor(radius)),tmp=new Uint8ClampedArray(data.length),out=new Uint8ClampedArray(data.length);
  for(let y=0;y<height;y++){for(let x=0;x<width;x++){let rS=0,gS=0,bS=0,c=0;for(let dx=-r;dx<=r;dx++){const px=Math.min(width-1,Math.max(0,x+dx)),pi=(y*width+px)*4;rS+=data[pi];gS+=data[pi+1];bS+=data[pi+2];c++;}const oi=(y*width+x)*4;tmp[oi]=rS/c;tmp[oi+1]=gS/c;tmp[oi+2]=bS/c;tmp[oi+3]=data[oi+3];}}
  for(let y=0;y<height;y++){for(let x=0;x<width;x++){let rS=0,gS=0,bS=0,c=0;for(let dy=-r;dy<=r;dy++){const py=Math.min(height-1,Math.max(0,y+dy)),pi=(py*width+x)*4;rS+=tmp[pi];gS+=tmp[pi+1];bS+=tmp[pi+2];c++;}const oi=(y*width+x)*4;out[oi]=rS/c;out[oi+1]=gS/c;out[oi+2]=bS/c;out[oi+3]=tmp[oi+3];}}
  return new ImageData(out,width,height);
}
function sharpen(imageData,amount){
  if(!amount)return imageData;
  const blurred=boxBlur(imageData,1),{data:orig,width,height}=imageData,{data:blur}=blurred,result=new Uint8ClampedArray(orig.length),str=(amount/100)*2.5;
  for(let i=0;i<orig.length-3;i+=4){result[i]=clamp(orig[i]+str*(orig[i]-blur[i]));result[i+1]=clamp(orig[i+1]+str*(orig[i+1]-blur[i+1]));result[i+2]=clamp(orig[i+2]+str*(orig[i+2]-blur[i+2]));result[i+3]=orig[i+3];}
  return new ImageData(result,width,height);
}
function addVigGrain(ctx,w,h,vignette,grain){
  if(vignette!==0){const op=Math.abs(vignette)/100*.85,gr=ctx.createRadialGradient(w/2,h/2,h*.2,w/2,h/2,h*.9);gr.addColorStop(0,'transparent');gr.addColorStop(1,vignette>0?`rgba(0,0,0,${op})`:`rgba(255,255,255,${op})`);ctx.fillStyle=gr;ctx.fillRect(0,0,w,h);}
  if(grain>0){const id=ctx.getImageData(0,0,w,h),d=id.data,str=grain*.55;for(let i=0;i<d.length;i+=4){const nv=(Math.random()-.5)*str;d[i]=clamp(d[i]+nv);d[i+1]=clamp(d[i+1]+nv);d[i+2]=clamp(d[i+2]+nv);}ctx.putImageData(id,0,0);}
}

// ── RAW + HEIC ────────────────────────────────────────────────
const RAW_EXTS=new Set(['dng','orf','cr2','nef','arw','rw2','raf']);
const isRAW=f=>RAW_EXTS.has(f.name.split('.').pop().toLowerCase());
const HEIC_EXTS=new Set(['heic','heif']);
const isHEIC=f=>HEIC_EXTS.has(f.name.split('.').pop().toLowerCase())||f.type==='image/heic'||f.type==='image/heif';

function loadUTIF(){return new Promise((res,rej)=>{if(window.UTIF){res(window.UTIF);return;}const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';s.onload=()=>res(window.UTIF);s.onerror=()=>rej(new Error('Could not load RAW decoder'));document.head.appendChild(s);});}
async function decodeRAW(file){
  const UTIF=await loadUTIF(),buf=await file.arrayBuffer(),ifds=UTIF.decode(buf);
  if(!ifds.length)throw new Error('No image data found');
  const main=ifds.reduce((b,ifd)=>((ifd.t256?.[0]||0)*(ifd.t257?.[0]||0))>((b.t256?.[0]||0)*(b.t257?.[0]||0))?ifd:b);
  UTIF.decodeImage(buf,main);
  const W=main.t256?.[0],H=main.t257?.[0];if(!W||!H||!main.data)throw new Error('Cannot read pixel data');
  const spp=main.t277?.[0]||1,bps=main.t258?.[0]||8,data=main.data,maxV=bps<=8?255:65535;
  const scale=Math.min(1,1400/W,1000/H),outW=Math.round(W*scale),outH=Math.round(H*scale),out=new ImageData(outW,outH);
  const gamma=v=>Math.max(0,Math.min(1,v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055));
  if(spp>=3){for(let oy=0;oy<outH;oy++){for(let ox=0;ox<outW;ox++){const sx=Math.min(W-1,Math.round(ox/scale)),sy=Math.min(H-1,Math.round(oy/scale)),si=(sy*W+sx)*spp,oi=(oy*outW+ox)*4;if(bps>8){out.data[oi]=Math.round(gamma((data[si*2]|data[si*2+1]<<8)/maxV)*255);out.data[oi+1]=Math.round(gamma((data[(si+1)*2]|data[(si+1)*2+1]<<8)/maxV)*255);out.data[oi+2]=Math.round(gamma((data[(si+2)*2]|data[(si+2)*2+1]<<8)/maxV)*255);}else{out.data[oi]=Math.round(gamma(data[si]/maxV)*255);out.data[oi+1]=Math.round(gamma(data[si+1]/maxV)*255);out.data[oi+2]=Math.round(gamma(data[si+2]/maxV)*255);}out.data[oi+3]=255;}}}
  else{const cfa=main.t33422||[0,1,1,2],bLevel=(main.t50714?.[0]||0)/maxV,wLevel=(main.t50717?.[0]||maxV)/maxV,range=Math.max(.001,wLevel-bLevel),bW=Math.floor(W/2),bH=Math.floor(H/2);const getP=(x,y)=>{x=Math.max(0,Math.min(W-1,x));y=Math.max(0,Math.min(H-1,y));const raw=bps>8?(data[2*(y*W+x)]|data[2*(y*W+x)+1]<<8):data[y*W+x];return Math.max(0,Math.min(1,(raw/maxV-bLevel)/range));};for(let oy=0;oy<outH;oy++){for(let ox=0;ox<outW;ox++){const bx=Math.min(bW-1,Math.round(ox*bW/outW)),by=Math.min(bH-1,Math.round(oy*bH/outH)),x=bx*2,y=by*2,p=[getP(x,y),getP(x+1,y),getP(x,y+1),getP(x+1,y+1)];let rr=0,gg=0,gN=0,bb=0;for(let ci=0;ci<4;ci++){if(cfa[ci]===0)rr=p[ci];else if(cfa[ci]===1){gg+=p[ci];gN++;}else bb=p[ci];}gg=gN?gg/gN:0;const oi=(oy*outW+ox)*4;out.data[oi]=Math.round(gamma(rr)*255);out.data[oi+1]=Math.round(gamma(gg)*255);out.data[oi+2]=Math.round(gamma(bb)*255);out.data[oi+3]=255;}}}
  return out;
}

let _libheif=null;
async function loadLibheif(){if(_libheif)return _libheif;const mod=await import('https://cdn.jsdelivr.net/npm/libheif-js@1.19.8/libheif-wasm/libheif-bundle.mjs');_libheif=await mod.default();return _libheif;}
async function decodeHEIC(file){
  const libheif=await loadLibheif(),buf=await file.arrayBuffer(),decoder=new libheif.HeifDecoder(),data=decoder.decode(new Uint8Array(buf));
  if(!data||!data.length)throw new Error('No images found in HEIC file');
  const image=data[0],W=image.get_width(),H=image.get_height();
  const rawData=await new Promise((res,rej)=>{image.display({data:new Uint8ClampedArray(W*H*4),width:W,height:H},(d)=>{if(!d)return rej(new Error('HEIF decode failed'));res(d);});});
  const scale=Math.min(1,1400/W,1000/H);
  if(scale===1)return new ImageData(rawData.data,W,H);
  const outW=Math.round(W*scale),outH=Math.round(H*scale),tmp=document.createElement('canvas');tmp.width=W;tmp.height=H;tmp.getContext('2d').putImageData(new ImageData(rawData.data,W,H),0,0);
  const out=document.createElement('canvas');out.width=outW;out.height=outH;out.getContext('2d').drawImage(tmp,0,0,outW,outH);return out.getContext('2d').getImageData(0,0,outW,outH);
}

// ── Transform Helpers ─────────────────────────────────────────
function applyTransforms(srcCanvas,tx){const{r,flipH,flipV,freeRot}=tx;if(!r&&!flipH&&!flipV&&!freeRot)return srcCanvas;const sw=srcCanvas.width,sh=srcCanvas.height,is90=r%2!==0,dw=is90?sh:sw,dh=is90?sw:sh,tc=document.createElement('canvas');tc.width=dw;tc.height=dh;const ctx=tc.getContext('2d');ctx.translate(dw/2,dh/2);ctx.rotate((r*90+freeRot)*Math.PI/180);ctx.scale(flipH?-1:1,flipV?-1:1);ctx.drawImage(srcCanvas,-sw/2,-sh/2);return tc;}
function cropCanvas(srcCanvas,crop){if(!crop)return srcCanvas;const{x,y,w,h}=crop,pw=Math.max(1,Math.round(w*srcCanvas.width)),ph=Math.max(1,Math.round(h*srcCanvas.height)),tc=document.createElement('canvas');tc.width=pw;tc.height=ph;tc.getContext('2d').drawImage(srcCanvas,-Math.round(x*srcCanvas.width),-Math.round(y*srcCanvas.height));return tc;}
function resizeCanvas(srcCanvas,targetW,targetH){if(!targetW&&!targetH)return srcCanvas;const ar=srcCanvas.width/srcCanvas.height,w=targetW||Math.round(targetH*ar),h=targetH||Math.round(targetW/ar),tc=document.createElement('canvas');tc.width=w;tc.height=h;tc.getContext('2d').drawImage(srcCanvas,0,0,w,h);return tc;}

// ── Crop Overlay ──────────────────────────────────────────────
function CropOverlay({crop,onChange,onConfirm,onCancel}){
  const drag=useRef(null),el=useRef(null),CR=crop||{x:.1,y:.1,w:.8,h:.8};
  const getPos=e=>{const rect=el.current.getBoundingClientRect();return{px:(e.clientX-rect.left)/rect.width,py:(e.clientY-rect.top)/rect.height};};
  const startDrag=(e,type)=>{e.preventDefault();e.stopPropagation();drag.current={type,start:getPos(e),crop:{...CR}};window.addEventListener('mousemove',onMove);window.addEventListener('mouseup',onUp);};
  const onMove=useCallback(e=>{if(!drag.current)return;const{px,py}=getPos(e),dx=px-drag.current.start.px,dy=py-drag.current.start.py,c={...drag.current.crop},t=drag.current.type;if(t==='move'){c.x=Math.max(0,Math.min(1-c.w,c.x+dx));c.y=Math.max(0,Math.min(1-c.h,c.y+dy));}else{if(t.includes('e'))c.w=Math.max(.05,Math.min(1-c.x,c.w+dx));if(t.includes('s'))c.h=Math.max(.05,Math.min(1-c.y,c.h+dy));if(t.includes('w')){const nw=Math.max(.05,c.w-dx);c.x=Math.max(0,c.x+c.w-nw);c.w=nw;}if(t.includes('n')){const nh=Math.max(.05,c.h-dy);c.y=Math.max(0,c.y+c.h-nh);c.h=nh;}}drag.current.start={px,py};drag.current.crop=c;onChange(c);},[]);
  const onUp=useCallback(()=>{drag.current=null;window.removeEventListener('mousemove',onMove);window.removeEventListener('mouseup',onUp);},[]);
  const{x,y,w,h}=CR,P=v=>`${(v*100).toFixed(2)}%`;
  return(<div ref={el} style={{position:'absolute',inset:0,zIndex:10,userSelect:'none'}}>
    <div style={{position:'absolute',top:0,left:0,right:0,height:P(y),background:'rgba(0,0,0,0.6)'}}/>
    <div style={{position:'absolute',top:P(y),left:0,width:P(x),height:P(h),background:'rgba(0,0,0,0.6)'}}/>
    <div style={{position:'absolute',top:P(y),left:P(x+w),right:0,height:P(h),background:'rgba(0,0,0,0.6)'}}/>
    <div style={{position:'absolute',top:P(y+h),left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)'}}/>
    <div onMouseDown={e=>startDrag(e,'move')} style={{position:'absolute',top:P(y),left:P(x),width:P(w),height:P(h),border:'1.5px solid #4d8ef0',cursor:'move',boxSizing:'border-box'}}>
      {[1,2].map(i=><div key={`v${i}`} style={{position:'absolute',top:0,bottom:0,left:`${i/3*100}%`,width:1,background:'rgba(77,142,240,0.3)'}}/>)}
      {[1,2].map(i=><div key={`h${i}`} style={{position:'absolute',left:0,right:0,top:`${i/3*100}%`,height:1,background:'rgba(77,142,240,0.3)'}}/>)}
    </div>
    {[['nw',x,y,'nw-resize'],['ne',x+w,y,'ne-resize'],['sw',x,y+h,'sw-resize'],['se',x+w,y+h,'se-resize']].map(([id,cx,cy,cur])=>(
      <div key={id} onMouseDown={e=>startDrag(e,id)} style={{position:'absolute',top:P(cy),left:P(cx),width:12,height:12,background:'#4d8ef0',borderRadius:1,transform:'translate(-50%,-50%)',cursor:cur,zIndex:11}}/>
    ))}
    <div style={{position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',display:'flex',gap:8,zIndex:12}}>
      <button onClick={onCancel} style={{padding:'5px 14px',fontSize:'9px',background:'rgba(24,24,24,0.92)',border:'1px solid #2a2518',color:'#606060',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace"}}>CANCEL</button>
      <button onClick={onConfirm} style={{padding:'5px 14px',fontSize:'9px',background:'rgba(77,142,240,0.15)',border:'1px solid rgba(77,142,240,0.5)',color:'#4d8ef0',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace"}}>APPLY CROP</button>
    </div>
  </div>);
}

// ── Curve Editor ──────────────────────────────────────────────
const CH_COL={master:'#9aaac0',r:'#d85050',g:'#50b872',b:'#5090d8'};
function CurveEditor({curves,onChange}){
  const[ch,setCh]=useState('master'),cvRef=useRef(null),drag=useRef(null);
  const SZ=200,PAD=14,INN=SZ-PAD*2,pts=curves[ch];
  const toC=(px,py)=>[PAD+(px/255)*INN,PAD+(1-py/255)*INN];
  const fromC=(cx,cy)=>[Math.round(clamp((cx-PAD)/INN*255,0,255)),Math.round(clamp((1-(cy-PAD)/INN)*255,0,255))];
  const getPos=e=>{const r=cvRef.current.getBoundingClientRect();return[(e.clientX-r.left)*(SZ/r.width),(e.clientY-r.top)*(SZ/r.height)];};
  const findNear=(cx,cy)=>{const s=[...pts].sort((a,b)=>a[0]-b[0]);for(let i=0;i<s.length;i++){const[ax,ay]=toC(s[i][0],s[i][1]);if(Math.hypot(ax-cx,ay-cy)<12)return i;}return -1;};
  const onDown=e=>{const[cx,cy]=getPos(e),s=[...pts].sort((a,b)=>a[0]-b[0]),idx=findNear(cx,cy);if(idx>=0){drag.current={idx};}else{const[x,y]=fromC(cx,cy);if(!s.some(p=>Math.abs(p[0]-x)<8))onChange(ch,[...pts,[x,y]].sort((a,b)=>a[0]-b[0]));}};
  const onMove=e=>{if(!drag.current)return;const[cx,cy]=getPos(e),[x,y]=fromC(cx,cy),s=[...pts].sort((a,b)=>a[0]-b[0]);onChange(ch,s.map((p,i)=>i===drag.current.idx?[x,y]:p));};
  const onUp=()=>{if(drag.current)onChange(ch,[...pts].sort((a,b)=>a[0]-b[0]));drag.current=null;};
  const onDbl=e=>{const[cx,cy]=getPos(e),s=[...pts].sort((a,b)=>a[0]-b[0]),idx=findNear(cx,cy);if(idx>=0&&s.length>2&&s[idx][0]>4&&s[idx][0]<251)onChange(ch,pts.filter(p=>Math.abs(p[0]-s[idx][0])>2));};
  useEffect(()=>{
    const cv=cvRef.current;if(!cv)return;const ctx=cv.getContext('2d');
    ctx.fillStyle='#0f0f0f';ctx.fillRect(0,0,SZ,SZ);
    ctx.strokeStyle='#2e2e2e';ctx.lineWidth=1;
    [1,2,3].forEach(i=>{const gx=PAD+(i/4)*INN,gy=PAD+(i/4)*INN;ctx.beginPath();ctx.moveTo(gx,PAD);ctx.lineTo(gx,PAD+INN);ctx.stroke();ctx.beginPath();ctx.moveTo(PAD,gy);ctx.lineTo(PAD+INN,gy);ctx.stroke();});
    ctx.setLineDash([4,5]);ctx.strokeStyle='#1c1c1c';ctx.beginPath();ctx.moveTo(PAD,PAD+INN);ctx.lineTo(PAD+INN,PAD);ctx.stroke();ctx.setLineDash([]);
    const sorted=[...pts].sort((a,b)=>a[0]-b[0]),lut=splineLUT(sorted);
    ctx.strokeStyle=CH_COL[ch];ctx.lineWidth=1.5;ctx.beginPath();
    for(let x=0;x<=255;x++){const[cx,cy]=toC(x,lut[x]);x===0?ctx.moveTo(cx,cy):ctx.lineTo(cx,cy);}ctx.stroke();
    sorted.forEach(([px,py])=>{const[cx,cy]=toC(px,py);ctx.fillStyle=CH_COL[ch];ctx.strokeStyle='#0f0f0f';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(cx,cy,4.5,0,Math.PI*2);ctx.fill();ctx.stroke();});
    ctx.strokeStyle='#1c1c1c';ctx.lineWidth=1;ctx.strokeRect(PAD,PAD,INN,INN);
  },[pts,ch]);
  return(<div>
    <div style={{display:'flex',gap:3,marginBottom:8}}>
      {['master','r','g','b'].map(c=><button key={c} onClick={()=>setCh(c)} style={{flex:1,padding:'3px 0',fontSize:'9px',fontFamily:"'JetBrains Mono',monospace",border:`1px solid ${ch===c?CH_COL[c]:'#2e2e2e'}`,background:ch===c?`${CH_COL[c]}15`:'transparent',color:ch===c?CH_COL[c]:'#4a4a4a',borderRadius:2,cursor:'pointer'}}>{c==='master'?'RGB':c.toUpperCase()}</button>)}
    </div>
    <canvas ref={cvRef} width={SZ} height={SZ} style={{width:'100%',aspectRatio:'1',cursor:'crosshair',display:'block',borderRadius:2}}
      onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp} onDoubleClick={onDbl}/>
    <div style={{display:'flex',gap:4,marginTop:6}}>
      <div style={{fontSize:'8px',color:'#282828',flex:1,fontFamily:"'JetBrains Mono',monospace",lineHeight:1.7}}>Click · drag · dbl-click to remove</div>
      <button onClick={()=>onChange(ch,[[0,0],[255,255]])} style={{padding:'2px 7px',fontSize:'8px',background:'transparent',border:'1px solid #1e1c16',color:'#4a4a4a',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace"}}>RESET</button>
    </div>
  </div>);
}

// ── Slider ────────────────────────────────────────────────────
function Slider({label,value,min,max,step=1,unit='',onChange,color='#4d8ef0'}){
  const pct=((value-min)/(max-min))*100;
  return(<div style={{marginBottom:9}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:3}}><span style={{fontSize:'9px',letterSpacing:'0.07em',color:'#606060',fontFamily:"'JetBrains Mono',monospace"}}>{label.toUpperCase()}</span><span style={{fontSize:'9px',color:value!==0?color:'#282828',fontFamily:"'JetBrains Mono',monospace",transition:'color .15s'}}>{value>0?'+':''}{step<1?value.toFixed(2):value}{unit}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} style={{width:'100%',height:3,WebkitAppearance:'none',appearance:'none',borderRadius:2,cursor:'pointer',background:`linear-gradient(to right,${color} ${pct}%,#243048 ${pct}%)`}}/></div>);
}

// ── Defaults ──────────────────────────────────────────────────
const DEF_HSL = Object.fromEntries(HSL_RANGES.map(r=>[r.name,{h:0,s:0,l:0}]));
const DEF_CURVES = {master:[[0,0],[255,255]],r:[[0,0],[255,255]],g:[[0,0],[255,255]],b:[[0,0],[255,255]]};
const DEF_ADJ = {exposure:0,brightness:0,contrast:0,highlights:0,shadows:0,whites:0,blacks:0,temperature:0,tint:0,sharpness:0,noiseReduction:0,vignette:0,grain:0,hsl:DEF_HSL,curves:DEF_CURVES};
const DEF_TX = {r:0,flipH:false,flipV:false,freeRot:0};
const TABS = ['Basic','Tone','Color','HSL','Curves','Detail','Effects'];

// ── App ───────────────────────────────────────────────────────
export default function App(){
  const[orig,setOrig]=useState(null);
  const[adj,setAdj]=useState(DEF_ADJ);
  const[sim,setSim]=useState(null);
  const[tx,setTx]=useState(DEF_TX);
  const[crop,setCrop]=useState(null);
  const[cropDraft,setCropDraft]=useState(null);
  const[cropMode,setCropMode]=useState(false);
  const[showFreeRot,setFreeRot]=useState(false);
  const[showResize,setShowResize]=useState(false);
  const[resizeW,setResizeW]=useState('');
  const[resizeH,setResizeH]=useState('');
  const[lockAR,setLockAR]=useState(true);
  const[comparing,setCmp]=useState(false);
  const[dragging,setDrag]=useState(false);
  const[busy,setBusy]=useState(false);
  const[rawStatus,setRaw]=useState('');
  const[activeTab,setTab]=useState('Basic');
  const[hslRange,setHslRange]=useState('Reds');
  const canvasRef=useRef(null),origImgRef=useRef(null),processedRef=useRef(null),debRef=useRef(null),fileRef=useRef(null);
  const setA=(k,v)=>setAdj(a=>({...a,[k]:v}));
  const setHSL=(range,param,val)=>setAdj(a=>({...a,hsl:{...a.hsl,[range]:{...a.hsl[range],[param]:val}}}));
  const setCurve=(ch,p)=>setAdj(a=>({...a,curves:{...a.curves,[ch]:p}}));
  const origAR=orig?orig.width/orig.height:1;
  const handleResizeW=v=>{setResizeW(v);if(lockAR&&v)setResizeH(String(Math.round(parseInt(v)/origAR)));};
  const handleResizeH=v=>{setResizeH(v);if(lockAR&&v)setResizeW(String(Math.round(parseInt(v)*origAR)));};

  // Custom presets
  const [customPresets, setCustomPresets] = useState(()=>{try{return JSON.parse(localStorage.getItem('fuji-darkroom-presets')||'[]');}catch{return [];}});
  const savePreset = ()=>{
    const name = prompt('Name this preset:');
    if(!name||!name.trim()) return;
    const preset = {name:name.trim(), sim, adj:JSON.parse(JSON.stringify(adj))};
    const updated = [...customPresets, preset];
    setCustomPresets(updated);
    try{localStorage.setItem('fuji-darkroom-presets', JSON.stringify(updated));}catch{}
  };
  const applyPreset = p=>{ setSim(p.sim); setAdj(p.adj); };
  const deletePreset = (i,e)=>{ e.stopPropagation(); const updated=customPresets.filter((_,idx)=>idx!==i); setCustomPresets(updated); try{localStorage.setItem('fuji-darkroom-presets',JSON.stringify(updated));}catch{}; };

  useEffect(()=>{
    const l=document.createElement('link');l.href='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,400&family=JetBrains+Mono:wght@300;400&family=Figtree:wght@300;400&display=swap';l.rel='stylesheet';document.head.appendChild(l);
    const s=document.createElement('style');s.textContent=`html,body{margin:0;padding:0;height:100%;overflow:hidden;}*{box-sizing:border-box;}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:11px;height:11px;border-radius:50%;background:#4d8ef0;border:2px solid #0e1218;cursor:pointer;}::-webkit-scrollbar{width:3px;}::-webkit-scrollbar-track{background:#111111;}::-webkit-scrollbar-thumb{background:#1e2a3a;} button{transition:filter .12s ease,box-shadow .12s ease,border-color .12s ease,background .12s ease,color .12s ease;}button:hover{filter:brightness(1.22);box-shadow:0 0 0 1px rgba(255,255,255,0.04);}button:active{filter:brightness(0.92);}`;document.head.appendChild(s);
  },[]);

  const loadImage=useCallback(file=>{
    if(!file)return;
    if(isHEIC(file)){setRaw('loading');setAdj(DEF_ADJ);setSim(null);setTx(DEF_TX);setCrop(null);decodeHEIC(file).then(id=>{setOrig(id);setRaw('');}).catch(e=>setRaw(e.message));return;}
    if(isRAW(file)){setRaw('loading');setAdj(DEF_ADJ);setSim(null);setTx(DEF_TX);setCrop(null);decodeRAW(file).then(id=>{setOrig(id);setRaw('');}).catch(e=>setRaw(e.message));return;}
    if(!file.type.startsWith('image/'))return;
    const url=URL.createObjectURL(file);const img=new Image();
    img.onload=()=>{origImgRef.current=img;const mW=1400,mH=1000;let w=img.naturalWidth,h=img.naturalHeight;if(w>mW||h>mH){const sc=Math.min(mW/w,mH/h);w=Math.round(w*sc);h=Math.round(h*sc);}const tc=document.createElement('canvas');tc.width=w;tc.height=h;tc.getContext('2d').drawImage(img,0,0,w,h);setOrig(tc.getContext('2d').getImageData(0,0,w,h));setAdj(DEF_ADJ);setSim(null);setTx(DEF_TX);setCrop(null);setRaw('');URL.revokeObjectURL(url);};img.src=url;
  },[]);

  useEffect(()=>{
    if(!orig)return;clearTimeout(debRef.current);
    debRef.current=setTimeout(()=>{setBusy(true);setTimeout(()=>{
      let result=process(orig,adj,sim);
      if(adj.noiseReduction>0)result=boxBlur(result,adj.noiseReduction/40);
      if(adj.sharpness>0)result=sharpen(result,adj.sharpness);
      const tmp=document.createElement('canvas');tmp.width=result.width;tmp.height=result.height;
      const tctx=tmp.getContext('2d');tctx.putImageData(result,0,0);
      addVigGrain(tctx,tmp.width,tmp.height,adj.vignette,adj.grain);
      const transformed=applyTransforms(tmp,tx),cropped=cropCanvas(transformed,crop);
      const c=canvasRef.current;if(!c)return;c.width=cropped.width;c.height=cropped.height;c.getContext('2d').drawImage(cropped,0,0);
      processedRef.current=cropped;setBusy(false);
    },0);},180);
  },[orig,adj,sim,tx,crop]);

  useEffect(()=>{if(!orig||!canvasRef.current)return;const c=canvasRef.current;if(comparing){c.width=orig.width;c.height=orig.height;c.getContext('2d').putImageData(orig,0,0);}else if(processedRef.current){const pc=processedRef.current;c.width=pc.width;c.height=pc.height;c.getContext('2d').drawImage(pc,0,0);}},[comparing]);

  const rotate=dir=>setTx(t=>({...t,r:((t.r+dir+4)%4)}));
  const flip=axis=>setTx(t=>axis==='h'?{...t,flipH:!t.flipH}:{...t,flipV:!t.flipV});
  const enterCrop=()=>{setCropDraft(crop||{x:.05,y:.05,w:.9,h:.9});setCropMode(true);setFreeRot(false);setShowResize(false);};
  const confirmCrop=()=>{setCrop(cropDraft);setCropMode(false);};
  const cancelCrop=()=>{setCropMode(false);setCropDraft(null);};

  const exportFull=()=>{
    let src;if(origImgRef.current){const img=origImgRef.current,tc=document.createElement('canvas');tc.width=img.naturalWidth;tc.height=img.naturalHeight;tc.getContext('2d').drawImage(img,0,0);src=tc;}
    else if(orig){const tc=document.createElement('canvas');tc.width=orig.width;tc.height=orig.height;tc.getContext('2d').putImageData(orig,0,0);src=tc;}else return;
    const fullId=src.getContext('2d').getImageData(0,0,src.width,src.height);
    let result=process(fullId,adj,sim);
    if(adj.noiseReduction>0)result=boxBlur(result,adj.noiseReduction/40);
    if(adj.sharpness>0)result=sharpen(result,adj.sharpness);
    src.getContext('2d').putImageData(result,0,0);addVigGrain(src.getContext('2d'),src.width,src.height,adj.vignette,adj.grain);
    let out=applyTransforms(src,tx);out=cropCanvas(out,crop);out=resizeCanvas(out,resizeW?parseInt(resizeW):null,resizeH?parseInt(resizeH):null);
    const a=document.createElement('a');a.download='fuji-darkroom.jpg';a.href=out.toDataURL('image/jpeg',.95);a.click();
  };

  const BS=(active=false,extra={})=>({padding:'0 10px',height:30,fontSize:'9px',background:active?'rgba(77,142,240,0.12)':'transparent',border:`1px solid ${active?'rgba(77,142,240,0.4)':'#333333'}`,color:active?'#4d8ef0':'#606060',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em',whiteSpace:'nowrap',transition:'all .15s',...extra});
  const IB=(icon,fn,active=false,title='')=><button onClick={fn} title={title} style={{...BS(active),padding:'0 10px',fontSize:15,letterSpacing:0}}>{icon}</button>;

  const HR=<div style={{borderTop:'1px solid #282828',margin:'8px 0'}}/>;
  const SL=(label,key,min,max,step=1,unit='')=><Slider label={label} value={adj[key]} min={min} max={max} step={step} unit={unit} onChange={v=>setA(key,v)}/>;

  const tabContent = ()=>{
    switch(activeTab){
      case 'Basic': return <>{SL('Exposure','exposure',-3,3,.05,' EV')}{SL('Brightness','brightness',-100,100)}{SL('Contrast','contrast',-100,100)}</>;
      case 'Tone':  return <>{SL('Highlights','highlights',-100,100)}{SL('Shadows','shadows',-100,100)}{HR}{SL('Whites','whites',-100,100)}{SL('Blacks','blacks',-100,100)}</>;
      case 'Color': return <>{SL('Temperature','temperature',-100,100)}{SL('Tint','tint',-100,100)}</>;
      case 'HSL': return <>
        <div style={{display:'flex',flexWrap:'wrap',gap:3,marginBottom:10}}>
          {HSL_RANGES.map(range=><button key={range.name} onClick={()=>setHslRange(range.name)} style={{padding:'3px 6px',fontSize:'8px',fontFamily:"'JetBrains Mono',monospace",background:hslRange===range.name?`${range.col}22`:'transparent',border:`1px solid ${hslRange===range.name?range.col:'#333333'}`,color:hslRange===range.name?range.col:'#606060',cursor:'pointer',borderRadius:2}}>{range.name.toUpperCase()}</button>)}
        </div>
        {['h','s','l'].map(p=>{
          const labels={h:'Hue',s:'Saturation',l:'Luminance'};
          const range=HSL_RANGES.find(r=>r.name===hslRange);
          return<Slider key={p} label={labels[p]} value={adj.hsl[hslRange][p]} min={p==='h'?-60:p==='s'?-100:-100} max={p==='h'?60:100} onChange={v=>setHSL(hslRange,p,v)} color={range?.col||'#4d8ef0'}/>;
        })}
        <button onClick={()=>setHSL(hslRange,'h',0)||setHSL(hslRange,'s',0)||setHSL(hslRange,'l',0)} style={{width:'100%',padding:'3px',fontSize:'8px',background:'transparent',border:'1px solid #282828',color:'#4a4a4a',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace",marginTop:4}}>RESET RANGE</button>
      </>;
      case 'Curves': return <CurveEditor curves={adj.curves} onChange={setCurve}/>;
      case 'Detail': return <>{SL('Sharpness','sharpness',0,100)}{SL('Noise Reduction','noiseReduction',0,100)}</>;
      case 'Effects': return <>{SL('Vignette','vignette',-100,100)}{SL('Grain','grain',0,100)}</>;
      default: return null;
    }
  };

  return(
    <div style={{display:'flex',width:'100vw',height:'100vh',background:'#111111',color:'#cdd2dc',fontFamily:"'Figtree',sans-serif",overflow:'hidden'}}>

      {/* ── Left: Film Sims ── */}
      <div style={{width:200,flexShrink:0,background:'#1e1e1e',borderRight:'1px solid #282828',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'2px 0 8px rgba(0,0,0,0.35)',zIndex:2}}>
        <div style={{padding:'16px 14px 10px',borderBottom:'1px solid #282828',flexShrink:0}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,fontWeight:600,color:'#dde2ed',letterSpacing:'0.03em'}}>Fuji Darkroom</div>
          <div style={{fontSize:'8px',color:'#4a4a4a',letterSpacing:'0.12em',fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>FILM EDITOR</div>
        </div>
        <div style={{padding:'10px 10px',overflowY:'auto',flex:1}}>
          <div style={{fontSize:'8px',letterSpacing:'0.12em',color:'#4a4a4a',fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>FILM SIMULATION</div>
          {Object.entries(SIMS).map(([name,s])=>(
            <button key={name} onClick={()=>setSim(n=>n===name?null:name)} style={{width:'100%',textAlign:'left',padding:'6px 8px',marginBottom:3,borderRadius:3,cursor:'pointer',background:sim===name?'rgba(77,142,240,0.1)':'transparent',border:`1px solid ${sim===name?'rgba(77,142,240,0.4)':'#2a2a2a'}`,transition:'all .15s'}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:13,color:sim===name?'#4d8ef0':'#cdd2dc',fontWeight:500}}>{name}</div>
              <div style={{fontSize:'7px',color:'#4a4a4a',fontFamily:"'JetBrains Mono',monospace",marginTop:1}}>{s.desc}</div>
            </button>
          ))}
          {sim&&<button onClick={()=>setSim(null)} style={{width:'100%',padding:'3px',fontSize:'8px',background:'transparent',border:'1px solid #282828',color:'#4a4a4a',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>CLEAR</button>}

          {/* Custom Presets */}
          <div style={{borderTop:'1px solid #282828',marginTop:12,paddingTop:10}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:'8px',letterSpacing:'0.12em',color:'#4a4a4a',fontFamily:"'JetBrains Mono',monospace"}}>MY PRESETS</div>
              <button onClick={savePreset} style={{padding:'2px 7px',fontSize:'8px',background:'rgba(77,142,240,0.1)',border:'1px solid rgba(77,142,240,0.3)',color:'#4d8ef0',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.06em'}}>+ SAVE</button>
            </div>
            {customPresets.length===0&&<div style={{fontSize:'8px',color:'#333333',fontFamily:"'JetBrains Mono',monospace",fontStyle:'italic',padding:'4px 0'}}>No saved presets yet</div>}
            {customPresets.map((p,i)=>(
              <div key={i} onClick={()=>applyPreset(p)} style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 8px',marginBottom:3,borderRadius:3,cursor:'pointer',background:'transparent',border:'1px solid #252525',transition:'all .15s'}}>
                <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:13,color:'#cdd2dc',fontWeight:500,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1}}>{p.name}</div>
                <button onClick={e=>deletePreset(i,e)} style={{marginLeft:6,padding:'0 4px',fontSize:11,background:'transparent',border:'none',color:'#4a4a4a',cursor:'pointer',borderRadius:2,flexShrink:0,lineHeight:1}}>✕</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Centre: Canvas ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden',minWidth:0}}>
        {/* Toolbar */}
        <div style={{background:'#1a1a1a',borderBottom:'1px solid #282828',display:'flex',alignItems:'center',padding:'0 8px',gap:4,flexShrink:0,height:44,flexWrap:'nowrap',overflow:'hidden'}}>
          {IB('↺',()=>rotate(-1),false,'Rotate CCW')}
          {IB('↻',()=>rotate(1), false,'Rotate CW')}
          {IB('↔',()=>flip('h'),tx.flipH,'Flip H')}
          {IB('↕',()=>flip('v'),tx.flipV,'Flip V')}
          <div style={{position:'relative'}}>
            <button onClick={()=>{setFreeRot(v=>!v);setShowResize(false);}} style={BS(showFreeRot||tx.freeRot!==0)}>TILT{tx.freeRot?` ${tx.freeRot>0?'+':''}${tx.freeRot}°`:''}</button>
            {showFreeRot&&<div style={{position:'absolute',top:38,left:0,background:'#1a1a1a',border:'1px solid #282828',borderRadius:4,padding:'10px 14px',zIndex:30,width:200,boxShadow:'0 4px 12px rgba(0,0,0,0.4)'}}>
              <Slider label="Angle" value={tx.freeRot} min={-45} max={45} step={0.5} unit="°" onChange={v=>setTx(t=>({...t,freeRot:v}))}/>
              <button onClick={()=>setTx(t=>({...t,freeRot:0}))} style={{width:'100%',padding:'3px',fontSize:'8px',background:'transparent',border:'1px solid #282828',color:'#4a4a4a',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace"}}>RESET</button>
            </div>}
          </div>
          <div style={{width:1,height:18,background:'#333333',margin:'0 2px'}}/>
          <button onClick={enterCrop} style={BS(!!crop||cropMode)}>{crop?'✂ CROP ✓':'✂ CROP'}</button>
          {crop&&<button onClick={()=>setCrop(null)} title="Clear crop" style={BS()}>✕</button>}
          <div style={{position:'relative'}}>
            <button onClick={()=>{setShowResize(v=>!v);setFreeRot(false);}} style={BS(showResize||!!(resizeW||resizeH))}>RESIZE{(resizeW||resizeH)?` ${resizeW||'?'}×${resizeH||'?'}`:''}</button>
            {showResize&&<div style={{position:'absolute',top:38,left:0,background:'#1a1a1a',border:'1px solid #282828',borderRadius:4,padding:'12px 14px',zIndex:30,width:210,boxShadow:'0 4px 12px rgba(0,0,0,0.4)'}}>
              <div style={{fontSize:'9px',color:'#606060',fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>OUTPUT DIMENSIONS (px)</div>
              <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8}}>
                <input type="number" placeholder="W" value={resizeW} onChange={e=>handleResizeW(e.target.value)} style={{flex:1,padding:'4px 6px',background:'#111111',border:'1px solid #282828',color:'#cdd2dc',borderRadius:2,fontSize:'11px',fontFamily:"'JetBrains Mono',monospace",outline:'none'}}/>
                <span style={{color:'#2e2e2e'}}>×</span>
                <input type="number" placeholder="H" value={resizeH} onChange={e=>handleResizeH(e.target.value)} style={{flex:1,padding:'4px 6px',background:'#111111',border:'1px solid #282828',color:'#cdd2dc',borderRadius:2,fontSize:'11px',fontFamily:"'JetBrains Mono',monospace",outline:'none'}}/>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:6,fontSize:'9px',color:'#606060',fontFamily:"'JetBrains Mono',monospace",cursor:'pointer',marginBottom:8}}>
                <input type="checkbox" checked={lockAR} onChange={e=>setLockAR(e.target.checked)} style={{accentColor:'#4d8ef0'}}/>LOCK ASPECT RATIO
              </label>
              <button onClick={()=>{setResizeW('');setResizeH('');}} style={{width:'100%',padding:'3px',fontSize:'8px',background:'transparent',border:'1px solid #282828',color:'#4a4a4a',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace"}}>CLEAR</button>
            </div>}
          </div>
          <div style={{flex:1}}/>
          {busy&&<span style={{fontSize:'9px',color:'#4a4a4a',fontFamily:"'JetBrains Mono',monospace"}}>RENDERING…</span>}
          {orig&&<>
            <button onMouseDown={()=>setCmp(true)} onMouseUp={()=>setCmp(false)} onMouseLeave={()=>setCmp(false)} style={{...BS(comparing),userSelect:'none'}}>{comparing?'ORIGINAL':'COMPARE'}</button>
            <button onClick={exportFull} style={{...BS(),background:'rgba(77,142,240,0.12)',border:'1px solid rgba(77,142,240,0.35)',color:'#4d8ef0'}}>EXPORT JPEG</button>
          </>}
        </div>
        {/* Canvas area */}
        <div style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden',background:dragging?'rgba(200,145,58,0.04)':'transparent',cursor:orig?'default':'pointer'}}
          onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);loadImage(e.dataTransfer.files[0]);}}
          onClick={e=>{if(!orig&&e.target===e.currentTarget)fileRef.current.click();}}>
          {!orig?(
            <div style={{textAlign:'center',pointerEvents:'none'}}>
              <div style={{fontSize:48,marginBottom:16,opacity:0.12}}>⬡</div>
              {rawStatus==='loading'?<div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:'#4d8ef0'}}>Decoding…</div>
               :rawStatus?<><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:'#c05050',marginBottom:8}}>Decode failed</div><div style={{fontSize:'9px',color:'#6a4040',fontFamily:"'JetBrains Mono',monospace"}}>{rawStatus}</div></>
               :<><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:'#606060',marginBottom:8}}>Drop a photo to begin</div><div style={{fontSize:'9px',color:'#2e2e2e',fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.1em'}}>JPG · PNG · WEBP · HEIC · DNG · ORF · CR2 · NEF · ARW</div></>}
            </div>
          ):(
            <div style={{position:'relative',display:'inline-flex',maxWidth:'100%',maxHeight:'100%'}}>
              <canvas ref={canvasRef} style={{maxWidth:'100%',maxHeight:'calc(100vh - 44px)',objectFit:'contain',display:'block'}}/>
              {cropMode&&<CropOverlay crop={cropDraft} onChange={setCropDraft} onConfirm={confirmCrop} onCancel={cancelCrop}/>}
            </div>
          )}
          {orig&&comparing&&<div style={{position:'absolute',top:10,left:'50%',transform:'translateX(-50%)',background:'rgba(0,0,0,0.75)',color:'#4d8ef0',fontSize:'9px',padding:'4px 10px',borderRadius:2,fontFamily:"'JetBrains Mono',monospace",border:'1px solid rgba(77,142,240,0.2)'}}>ORIGINAL</div>}
          {orig&&<button onClick={()=>fileRef.current.click()} style={{position:'absolute',bottom:12,right:12,padding:'4px 10px',fontSize:'9px',background:'rgba(24,24,24,0.85)',border:'1px solid #282828',color:'#4a4a4a',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace"}}>OPEN NEW</button>}
        </div>
      </div>

      {/* ── Right: Adjustments ── */}
      <div style={{width:240,flexShrink:0,background:'#1e1e1e',borderLeft:'1px solid #282828',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'-2px 0 8px rgba(0,0,0,0.35)',zIndex:2}}>
        {/* Tabs */}
        <div style={{display:'flex',flexWrap:'wrap',gap:2,padding:'8px 8px 0',borderBottom:'1px solid #282828',flexShrink:0}}>
          {TABS.map(tab=><button key={tab} onClick={()=>setTab(tab)} style={{padding:'4px 6px',fontSize:'8px',fontFamily:"'JetBrains Mono',monospace",background:activeTab===tab?'rgba(77,142,240,0.1)':'transparent',border:`1px solid ${activeTab===tab?'rgba(77,142,240,0.4)':'transparent'}`,color:activeTab===tab?'#4d8ef0':'#606060',cursor:'pointer',borderRadius:2,marginBottom:6,letterSpacing:'0.06em'}}>{tab.toUpperCase()}</button>)}
        </div>
        {/* Panel content */}
        <div style={{flex:1,overflowY:'auto',padding:'14px 14px'}}>
          {tabContent()}
        </div>
        {/* Reset */}
        <div style={{padding:'8px 14px',borderTop:'1px solid #282828',flexShrink:0}}>
          <button onClick={()=>{setAdj(DEF_ADJ);setTx(DEF_TX);setCrop(null);setResizeW('');setResizeH('');setSim(null);}} style={{width:'100%',padding:'6px',fontSize:'9px',background:'transparent',border:'1px solid #282828',color:'#606060',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.1em'}}>RESET ALL</button>
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*,.heic,.heif,.dng,.orf,.cr2,.nef,.arw,.rw2,.raf" style={{display:'none'}} onChange={e=>loadImage(e.target.files[0])}/>
    </div>
  );
}
