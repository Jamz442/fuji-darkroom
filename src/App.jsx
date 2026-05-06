import { useState, useEffect, useRef, useCallback } from "react";

// ── Helpers ───────────────────────────────────────────────────
const clamp = (v, lo=0, hi=255) => Math.max(lo, Math.min(hi, v));
const clamp01 = v => Math.max(0, Math.min(1, v));
function rgbToHsl(r,g,b){r/=255;g/=255;b/=255;const max=Math.max(r,g,b),min=Math.min(r,g,b),l=(max+min)/2;if(max===min)return[0,0,l];const d=max-min,s=l>.5?d/(2-max-min):d/(max+min);let h=max===r?((g-b)/d+(g<b?6:0))/6:max===g?((b-r)/d+2)/6:((r-g)/d+4)/6;return[h*360,s,l];}
function hslToRgb(h,s,l){h/=360;if(s===0){const v=Math.round(l*255);return[v,v,v];}const q=l<.5?l*(1+s):l+s-l*s,p=2*l-q;const f=t=>{if(t<0)t+=1;if(t>1)t-=1;return t<1/6?p+(q-p)*6*t:t<1/2?q:t<2/3?p+(q-p)*(2/3-t)*6:p;};return[Math.round(f(h+1/3)*255),Math.round(f(h)*255),Math.round(f(h-1/3)*255)];}
function lut(pts){const s=[...pts].sort((a,b)=>a[0]-b[0]),out=new Uint8Array(256);for(let x=0;x<256;x++){if(x<=s[0][0]){out[x]=clamp(s[0][1]);continue;}if(x>=s[s.length-1][0]){out[x]=clamp(s[s.length-1][1]);continue;}for(let i=0;i<s.length-1;i++){if(x>=s[i][0]&&x<=s[i+1][0]){const t=(x-s[i][0])/(s[i+1][0]-s[i][0]);out[x]=clamp(s[i][1]+t*(s[i+1][1]-s[i][1]));break;}}}return out;}

// ── Film Simulations ──────────────────────────────────────────
const SIMS = {
  "Classic Chrome":{desc:"Muted · Cyan shadows · Restrained",sat:.70,bw:false,r:[[0,8],[128,122],[255,240]],g:[[0,5],[128,128],[255,250]],b:[[0,16],[128,138],[255,253]]},
  "Velvia":        {desc:"Vivid · Rich · High contrast",     sat:1.55,bw:false,r:[[0,0],[128,134],[255,255]],g:[[0,0],[128,130],[255,255]],b:[[0,0],[128,118],[255,246]]},
  "Provia":        {desc:"Natural · Balanced · True colour", sat:1.00,bw:false,r:[[0,0],[128,130],[255,255]],g:[[0,0],[128,129],[255,254]],b:[[0,0],[128,127],[255,252]]},
  "Eterna Cinema": {desc:"Flat · Cinematic · Lifted blacks", sat:.60, bw:false,r:[[0,26],[128,138],[255,222]],g:[[0,23],[128,136],[255,220]],b:[[0,30],[128,142],[255,227]]},
  "Acros":         {desc:"B&W · Punchy contrast · Film grain",sat:0,  bw:true, r:[[0,0],[128,134],[255,255]],g:[[0,0],[128,134],[255,255]],b:[[0,0],[128,134],[255,255]]},
  "Classic Neg":   {desc:"Warm shadows · Faded highlights",  sat:.82, bw:false,r:[[0,22],[128,162],[255,246]],g:[[0,13],[128,150],[255,241]],b:[[0,8],[128,134],[255,229]]},
  "Nostalgic Neg": {desc:"Vintage warmth · Hazy · Faded",   sat:.76, bw:false,r:[[0,36],[128,172],[255,245]],g:[[0,21],[128,154],[255,228]],b:[[0,10],[128,124],[255,198]]},
};

// ── Pixel Processing ──────────────────────────────────────────
function process(imageData,adj,simKey){
  const src=imageData.data,n=src.length,out=new Uint8ClampedArray(n);
  const sim=simKey?SIMS[simKey]:null;
  const rL=sim?lut(sim.r):null,gL=sim?lut(sim.g):null,bL=sim?lut(sim.b):null;
  const expF=Math.pow(2,adj.exposure),cA=adj.contrast*2.55,cF=(259*(cA+255))/(255*(259-cA));
  const tR=adj.temperature*.22,tB=-adj.temperature*.22;
  for(let i=0;i<n;i+=4){
    let r=src[i],g=src[i+1],b=src[i+2];
    r=clamp(r+tR);b=clamp(b+tB);
    r=clamp(r*expF);g=clamp(g*expF);b=clamp(b*expF);
    if(adj.brightness){const br=adj.brightness*1.8;r=clamp(r+br);g=clamp(g+br);b=clamp(b+br);}
    if(adj.contrast){r=clamp(cF*(r-128)+128);g=clamp(cF*(g-128)+128);b=clamp(cF*(b-128)+128);}
    const lum=(0.2126*r+0.7152*g+0.0722*b)/255;
    if(adj.highlights){const w=Math.pow(Math.max(0,lum*2-1),1.5)*adj.highlights*.5;r=clamp(r+w);g=clamp(g+w);b=clamp(b+w);}
    if(adj.shadows){const w=Math.pow(Math.max(0,1-lum*2),1.5)*adj.shadows*.5;r=clamp(r+w);g=clamp(g+w);b=clamp(b+w);}
    if(sim){if(sim.bw){const gr=clamp(Math.round(.299*r+.587*g+.114*b));r=rL[gr];g=gL[gr];b=bL[gr];}
    else{r=rL[clamp(r)];g=gL[clamp(g)];b=bL[clamp(b)];if(sim.sat!==1){const[h,s,l]=rgbToHsl(r,g,b);[r,g,b]=hslToRgb(h,clamp01(s*sim.sat),l);}}}
    out[i]=r;out[i+1]=g;out[i+2]=b;out[i+3]=src[i+3];
  }
  return new ImageData(out,imageData.width,imageData.height);
}
function addVigGrain(ctx,w,h,vignette,grain){
  if(vignette!==0){const op=Math.abs(vignette)/100*.85,gr=ctx.createRadialGradient(w/2,h/2,h*.2,w/2,h/2,h*.9);gr.addColorStop(0,'transparent');gr.addColorStop(1,vignette>0?`rgba(0,0,0,${op})`:`rgba(255,255,255,${op})`);ctx.fillStyle=gr;ctx.fillRect(0,0,w,h);}
  if(grain>0){const id=ctx.getImageData(0,0,w,h),d=id.data,str=grain*.55;for(let i=0;i<d.length;i+=4){const n=(Math.random()-.5)*str;d[i]=clamp(d[i]+n);d[i+1]=clamp(d[i+1]+n);d[i+2]=clamp(d[i+2]+n);}ctx.putImageData(id,0,0);}
}

// ── RAW Support ───────────────────────────────────────────────
const RAW_EXTS=new Set(['dng','orf','cr2','nef','arw','rw2','raf']);
const isRAW=f=>RAW_EXTS.has(f.name.split('.').pop().toLowerCase());
function loadUTIF(){return new Promise((res,rej)=>{if(window.UTIF){res(window.UTIF);return;}const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';s.onload=()=>res(window.UTIF);s.onerror=()=>rej(new Error('Could not load RAW decoder'));document.head.appendChild(s);});}
async function decodeRAW(file){
  const UTIF=await loadUTIF(),buf=await file.arrayBuffer(),ifds=UTIF.decode(buf);
  if(!ifds.length)throw new Error('No image data found');
  const main=ifds.reduce((b,ifd)=>((ifd.t256?.[0]||0)*(ifd.t257?.[0]||0))>((b.t256?.[0]||0)*(b.t257?.[0]||0))?ifd:b);
  UTIF.decodeImage(buf,main);
  const W=main.t256?.[0],H=main.t257?.[0];
  if(!W||!H||!main.data)throw new Error('Cannot read pixel data');
  const spp=main.t277?.[0]||1,bps=main.t258?.[0]||8,data=main.data,maxV=bps<=8?255:65535;
  const scale=Math.min(1,1400/W,1000/H),outW=Math.round(W*scale),outH=Math.round(H*scale);
  const out=new ImageData(outW,outH);
  const gamma=v=>Math.max(0,Math.min(1,v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055));
  if(spp>=3){for(let oy=0;oy<outH;oy++){for(let ox=0;ox<outW;ox++){const sx=Math.min(W-1,Math.round(ox/scale)),sy=Math.min(H-1,Math.round(oy/scale)),si=(sy*W+sx)*spp,oi=(oy*outW+ox)*4;if(bps>8){out.data[oi]=Math.round(gamma((data[si*2]|data[si*2+1]<<8)/maxV)*255);out.data[oi+1]=Math.round(gamma((data[(si+1)*2]|data[(si+1)*2+1]<<8)/maxV)*255);out.data[oi+2]=Math.round(gamma((data[(si+2)*2]|data[(si+2)*2+1]<<8)/maxV)*255);}else{out.data[oi]=Math.round(gamma(data[si]/maxV)*255);out.data[oi+1]=Math.round(gamma(data[si+1]/maxV)*255);out.data[oi+2]=Math.round(gamma(data[si+2]/maxV)*255);}out.data[oi+3]=255;}}}
  else{const cfa=main.t33422||[0,1,1,2],bLevel=(main.t50714?.[0]||0)/maxV,wLevel=(main.t50717?.[0]||maxV)/maxV,range=Math.max(.001,wLevel-bLevel),bW=Math.floor(W/2),bH=Math.floor(H/2);const getP=(x,y)=>{x=Math.max(0,Math.min(W-1,x));y=Math.max(0,Math.min(H-1,y));const raw=bps>8?(data[2*(y*W+x)]|data[2*(y*W+x)+1]<<8):data[y*W+x];return Math.max(0,Math.min(1,(raw/maxV-bLevel)/range));};for(let oy=0;oy<outH;oy++){for(let ox=0;ox<outW;ox++){const bx=Math.min(bW-1,Math.round(ox*bW/outW)),by=Math.min(bH-1,Math.round(oy*bH/outH)),x=bx*2,y=by*2,p=[getP(x,y),getP(x+1,y),getP(x,y+1),getP(x+1,y+1)];let r=0,g=0,gN=0,b=0;for(let ci=0;ci<4;ci++){if(cfa[ci]===0)r=p[ci];else if(cfa[ci]===1){g+=p[ci];gN++;}else b=p[ci];}g=gN?g/gN:0;const oi=(oy*outW+ox)*4;out.data[oi]=Math.round(gamma(r)*255);out.data[oi+1]=Math.round(gamma(g)*255);out.data[oi+2]=Math.round(gamma(b)*255);out.data[oi+3]=255;}}}
  return out;
}

// ── Transform Helpers ─────────────────────────────────────────
function applyTransforms(srcCanvas, tx) {
  const { r, flipH, flipV, freeRot } = tx;
  if (!r && !flipH && !flipV && !freeRot) return srcCanvas;
  const sw=srcCanvas.width, sh=srcCanvas.height, is90=r%2!==0;
  const dw=is90?sh:sw, dh=is90?sw:sh;
  const tc=document.createElement('canvas'); tc.width=dw; tc.height=dh;
  const ctx=tc.getContext('2d');
  ctx.translate(dw/2, dh/2);
  ctx.rotate((r*90+freeRot)*Math.PI/180);
  ctx.scale(flipH?-1:1, flipV?-1:1);
  ctx.drawImage(srcCanvas, -sw/2, -sh/2);
  return tc;
}
function cropCanvas(srcCanvas, crop) {
  if (!crop) return srcCanvas;
  const {x,y,w,h}=crop, pw=Math.max(1,Math.round(w*srcCanvas.width)), ph=Math.max(1,Math.round(h*srcCanvas.height));
  const tc=document.createElement('canvas'); tc.width=pw; tc.height=ph;
  tc.getContext('2d').drawImage(srcCanvas, -Math.round(x*srcCanvas.width), -Math.round(y*srcCanvas.height));
  return tc;
}
function resizeCanvas(srcCanvas, targetW, targetH) {
  if (!targetW && !targetH) return srcCanvas;
  const ar=srcCanvas.width/srcCanvas.height;
  const w=targetW||Math.round(targetH*ar), h=targetH||Math.round(targetW/ar);
  const tc=document.createElement('canvas'); tc.width=w; tc.height=h;
  tc.getContext('2d').drawImage(srcCanvas,0,0,w,h);
  return tc;
}

// ── Crop Overlay ──────────────────────────────────────────────
function CropOverlay({ crop, onChange, onConfirm, onCancel }) {
  const drag = useRef(null);
  const el   = useRef(null);
  const CR   = crop || { x:.1, y:.1, w:.8, h:.8 };

  const getRelPos = e => {
    const rect = el.current.getBoundingClientRect();
    return { px: (e.clientX-rect.left)/rect.width, py: (e.clientY-rect.top)/rect.height };
  };
  const startDrag = (e, type) => {
    e.preventDefault(); e.stopPropagation();
    drag.current = { type, start: getRelPos(e), crop: {...CR} };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  const onMove = useCallback(e => {
    if (!drag.current) return;
    const {px,py} = getRelPos(e);
    const dx=px-drag.current.start.px, dy=py-drag.current.start.py;
    const c={...drag.current.crop}, t=drag.current.type;
    if (t==='move') { c.x=Math.max(0,Math.min(1-c.w,c.x+dx)); c.y=Math.max(0,Math.min(1-c.h,c.y+dy)); }
    else {
      if(t.includes('e')) c.w=Math.max(.05,Math.min(1-c.x,c.w+dx));
      if(t.includes('s')) c.h=Math.max(.05,Math.min(1-c.y,c.h+dy));
      if(t.includes('w')){const nw=Math.max(.05,c.w-dx);c.x=Math.max(0,c.x+c.w-nw);c.w=nw;}
      if(t.includes('n')){const nh=Math.max(.05,c.h-dy);c.y=Math.max(0,c.y+c.h-nh);c.h=nh;}
    }
    drag.current.start={px,py}; drag.current.crop=c; onChange(c);
  }, []);
  const onUp = useCallback(() => { drag.current=null; window.removeEventListener('mousemove',onMove); window.removeEventListener('mouseup',onUp); }, []);

  const {x,y,w,h}=CR, P=v=>`${(v*100).toFixed(2)}%`;
  const corners = [['nw',x,y,'nw-resize'],['ne',x+w,y,'ne-resize'],['sw',x,y+h,'sw-resize'],['se',x+w,y+h,'se-resize']];

  return (
    <div ref={el} style={{position:'absolute',inset:0,zIndex:10,userSelect:'none'}}>
      <div style={{position:'absolute',top:0,left:0,right:0,height:P(y),background:'rgba(0,0,0,0.6)'}}/>
      <div style={{position:'absolute',top:P(y),left:0,width:P(x),height:P(h),background:'rgba(0,0,0,0.6)'}}/>
      <div style={{position:'absolute',top:P(y),left:P(x+w),right:0,height:P(h),background:'rgba(0,0,0,0.6)'}}/>
      <div style={{position:'absolute',top:P(y+h),left:0,right:0,bottom:0,background:'rgba(0,0,0,0.6)'}}/>
      <div onMouseDown={e=>startDrag(e,'move')} style={{position:'absolute',top:P(y),left:P(x),width:P(w),height:P(h),border:'1.5px solid #c8913a',cursor:'move',boxSizing:'border-box'}}>
        {[1,2].map(i=><div key={`v${i}`} style={{position:'absolute',top:0,bottom:0,left:`${i/3*100}%`,width:1,background:'rgba(200,145,58,0.35)'}}/>)}
        {[1,2].map(i=><div key={`h${i}`} style={{position:'absolute',left:0,right:0,top:`${i/3*100}%`,height:1,background:'rgba(200,145,58,0.35)'}}/>)}
      </div>
      {corners.map(([id,cx,cy,cur])=>(
        <div key={id} onMouseDown={e=>startDrag(e,id)} style={{position:'absolute',top:P(cy),left:P(cx),width:12,height:12,background:'#c8913a',borderRadius:1,transform:'translate(-50%,-50%)',cursor:cur,zIndex:11}}/>
      ))}
      <div style={{position:'absolute',bottom:14,left:'50%',transform:'translateX(-50%)',display:'flex',gap:8,zIndex:12}}>
        <button onClick={onCancel} style={{padding:'5px 14px',fontSize:'9px',background:'rgba(14,12,8,0.92)',border:'1px solid #2a2518',color:'#6a6055',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em'}}>CANCEL</button>
        <button onClick={onConfirm} style={{padding:'5px 14px',fontSize:'9px',background:'rgba(200,145,58,0.15)',border:'1px solid rgba(200,145,58,0.5)',color:'#c8913a',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em'}}>APPLY CROP</button>
      </div>
    </div>
  );
}

// ── Slider ────────────────────────────────────────────────────
function Slider({label,value,min,max,step=1,unit='',onChange}){
  const pct=((value-min)/(max-min))*100;
  return(<div style={{marginBottom:10}}><div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}><span style={{fontSize:'9px',letterSpacing:'0.08em',color:'#6a6055',fontFamily:"'JetBrains Mono',monospace"}}>{label.toUpperCase()}</span><span style={{fontSize:'9px',color:value!==0?'#c8913a':'#332e26',fontFamily:"'JetBrains Mono',monospace",transition:'color .15s'}}>{value>0?'+':''}{step<1?value.toFixed(2):value}{unit}</span></div><input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))} style={{width:'100%',height:3,WebkitAppearance:'none',appearance:'none',borderRadius:2,cursor:'pointer',background:`linear-gradient(to right,#c8913a ${pct}%,#1e1a12 ${pct}%)`}}/></div>);
}

// ── App ───────────────────────────────────────────────────────
const DEF_ADJ = { exposure:0, brightness:0, contrast:0, highlights:0, shadows:0, temperature:0, vignette:0, grain:0 };
const DEF_TX  = { r:0, flipH:false, flipV:false, freeRot:0 };

export default function App() {
  const [orig, setOrig]             = useState(null);
  const [adj, setAdj]               = useState(DEF_ADJ);
  const [sim, setSim]               = useState(null);
  const [tx, setTx]                 = useState(DEF_TX);
  const [crop, setCrop]             = useState(null);
  const [cropDraft, setCropDraft]   = useState(null);
  const [cropMode, setCropMode]     = useState(false);
  const [showFreeRot, setFreeRot]   = useState(false);
  const [showResize, setShowResize] = useState(false);
  const [resizeW, setResizeW]       = useState('');
  const [resizeH, setResizeH]       = useState('');
  const [lockAR, setLockAR]         = useState(true);
  const [comparing, setCmp]         = useState(false);
  const [dragging, setDrag]         = useState(false);
  const [busy, setBusy]             = useState(false);
  const [rawStatus, setRaw]         = useState('');
  const canvasRef    = useRef(null);
  const origImgRef   = useRef(null);
  const processedRef = useRef(null);
  const debRef       = useRef(null);
  const fileRef      = useRef(null);
  const setA = (k,v) => setAdj(a=>({...a,[k]:v}));

  useEffect(()=>{
    const l=document.createElement('link');l.href='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,400&family=JetBrains+Mono:wght@300;400&family=Figtree:wght@300;400&display=swap';l.rel='stylesheet';document.head.appendChild(l);
    const s=document.createElement('style');s.textContent=`*{box-sizing:border-box;margin:0;padding:0}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#c8913a;border:2px solid #0d0b07;cursor:pointer}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#0b0900}::-webkit-scrollbar-thumb{background:#201c12}`;document.head.appendChild(s);
  },[]);

  const origAR = orig ? orig.width/orig.height : 1;
  const handleResizeW = v => { setResizeW(v); if(lockAR&&v) setResizeH(String(Math.round(parseInt(v)/origAR))); };
  const handleResizeH = v => { setResizeH(v); if(lockAR&&v) setResizeW(String(Math.round(parseInt(v)*origAR))); };

  const loadImage = useCallback(file => {
    if (!file) return;
    if (isRAW(file)) {
      setRaw('loading'); setAdj(DEF_ADJ); setSim(null); setTx(DEF_TX); setCrop(null);
      decodeRAW(file).then(id=>{setOrig(id);setRaw('');}).catch(e=>setRaw(e.message));
      return;
    }
    if (!file.type.startsWith('image/')) return;
    const url=URL.createObjectURL(file);
    const img=new Image();
    img.onload=()=>{
      origImgRef.current=img;
      const mW=1400,mH=1000;let w=img.naturalWidth,h=img.naturalHeight;
      if(w>mW||h>mH){const sc=Math.min(mW/w,mH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
      const tc=document.createElement('canvas');tc.width=w;tc.height=h;
      tc.getContext('2d').drawImage(img,0,0,w,h);
      setOrig(tc.getContext('2d').getImageData(0,0,w,h));
      setAdj(DEF_ADJ);setSim(null);setTx(DEF_TX);setCrop(null);setRaw('');URL.revokeObjectURL(url);
    };img.src=url;
  },[]);

  useEffect(()=>{
    if(!orig) return;
    clearTimeout(debRef.current);
    debRef.current=setTimeout(()=>{
      setBusy(true);
      setTimeout(()=>{
        const result=process(orig,adj,sim);
        const tmp=document.createElement('canvas');tmp.width=result.width;tmp.height=result.height;
        const tctx=tmp.getContext('2d');tctx.putImageData(result,0,0);
        addVigGrain(tctx,tmp.width,tmp.height,adj.vignette,adj.grain);
        const transformed=applyTransforms(tmp,tx);
        const cropped=cropCanvas(transformed,crop);
        const c=canvasRef.current;if(!c)return;
        c.width=cropped.width;c.height=cropped.height;
        c.getContext('2d').drawImage(cropped,0,0);
        processedRef.current=cropped;
        setBusy(false);
      },0);
    },180);
  },[orig,adj,sim,tx,crop]);

  useEffect(()=>{
    if(!orig||!canvasRef.current)return;
    const c=canvasRef.current;
    if(comparing){c.width=orig.width;c.height=orig.height;c.getContext('2d').putImageData(orig,0,0);}
    else if(processedRef.current){const pc=processedRef.current;c.width=pc.width;c.height=pc.height;c.getContext('2d').drawImage(pc,0,0);}
  },[comparing]);

  const rotate = dir => setTx(t=>({...t,r:((t.r+dir+4)%4)}));
  const flip   = axis => setTx(t=>axis==='h'?{...t,flipH:!t.flipH}:{...t,flipV:!t.flipV});
  const enterCrop  = () => { setCropDraft(crop||{x:.05,y:.05,w:.9,h:.9}); setCropMode(true); setFreeRot(false); setShowResize(false); };
  const confirmCrop= () => { setCrop(cropDraft); setCropMode(false); };
  const cancelCrop = () => { setCropMode(false); setCropDraft(null); };

  const exportFull = () => {
    let src;
    if (origImgRef.current) {
      const img=origImgRef.current,tc=document.createElement('canvas');
      tc.width=img.naturalWidth;tc.height=img.naturalHeight;
      tc.getContext('2d').drawImage(img,0,0);src=tc;
    } else if (orig) {
      const tc=document.createElement('canvas');tc.width=orig.width;tc.height=orig.height;
      tc.getContext('2d').putImageData(orig,0,0);src=tc;
    } else return;
    const fullId=src.getContext('2d').getImageData(0,0,src.width,src.height);
    const result=process(fullId,adj,sim);
    src.getContext('2d').putImageData(result,0,0);
    addVigGrain(src.getContext('2d'),src.width,src.height,adj.vignette,adj.grain);
    let out=applyTransforms(src,tx);
    out=cropCanvas(out,crop);
    out=resizeCanvas(out,resizeW?parseInt(resizeW):null,resizeH?parseInt(resizeH):null);
    const a=document.createElement('a');a.download='fuji-darkroom.jpg';a.href=out.toDataURL('image/jpeg',.95);a.click();
  };

  const BS = (active=false,extra={}) => ({padding:'0 10px',height:30,fontSize:'9px',background:active?'rgba(200,145,58,0.12)':'transparent',border:`1px solid ${active?'rgba(200,145,58,0.4)':'#1e1a12'}`,color:active?'#c8913a':'#6a6055',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em',whiteSpace:'nowrap',transition:'all .15s',...extra});
  const IB = (icon,fn,active=false,title='') => <button onClick={fn} title={title} style={{...BS(active),padding:'0 10px',fontSize:15,letterSpacing:0}}>{icon}</button>;

  return (
    <div style={{display:'flex',height:'100vh',background:'#0b0900',color:'#c8c0b0',fontFamily:"'Figtree',sans-serif",overflow:'hidden'}}>

      {/* Sidebar */}
      <div style={{width:238,flexShrink:0,background:'#0e0c08',borderRight:'1px solid #1a1710',display:'flex',flexDirection:'column',overflowY:'auto'}}>
        <div style={{padding:'18px 18px 12px',borderBottom:'1px solid #1a1710'}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,color:'#e8dcc8',letterSpacing:'0.04em'}}>Fuji Darkroom</div>
          <div style={{fontSize:'9px',color:'#4a4438',letterSpacing:'0.12em',fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>PHASE 1 · FILM EDITOR</div>
        </div>
        <div style={{padding:'12px 14px 10px',borderBottom:'1px solid #1a1710'}}>
          <div style={{fontSize:'9px',letterSpacing:'0.12em',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace",marginBottom:8}}>FILM SIMULATION</div>
          {Object.entries(SIMS).map(([name,s])=>(
            <button key={name} onClick={()=>setSim(n=>n===name?null:name)} style={{width:'100%',textAlign:'left',padding:'7px 10px',marginBottom:3,borderRadius:3,cursor:'pointer',background:sim===name?'rgba(200,145,58,0.1)':'transparent',border:`1px solid ${sim===name?'rgba(200,145,58,0.4)':'#1a1710'}`,transition:'all .15s'}}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:13,color:sim===name?'#c8913a':'#c8c0b0',fontWeight:500}}>{name}</div>
              <div style={{fontSize:'8px',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace",marginTop:1}}>{s.desc}</div>
            </button>
          ))}
          {sim&&<button onClick={()=>setSim(null)} style={{width:'100%',padding:'4px',fontSize:'8px',background:'transparent',border:'1px solid #1a1710',color:'#4a4438',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",marginTop:2}}>CLEAR</button>}
        </div>
        <div style={{padding:'12px 16px',flex:1}}>
          <div style={{fontSize:'9px',letterSpacing:'0.12em',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>ADJUSTMENTS</div>
          <Slider label="Exposure"    value={adj.exposure}    min={-3}   max={3}   step={0.05} unit=" EV" onChange={v=>setA('exposure',v)}/>
          <Slider label="Brightness"  value={adj.brightness}  min={-100} max={100} onChange={v=>setA('brightness',v)}/>
          <Slider label="Contrast"    value={adj.contrast}    min={-100} max={100} onChange={v=>setA('contrast',v)}/>
          <div style={{borderTop:'1px solid #1a1710',margin:'8px 0'}}/>
          <Slider label="Highlights"  value={adj.highlights}  min={-100} max={100} onChange={v=>setA('highlights',v)}/>
          <Slider label="Shadows"     value={adj.shadows}     min={-100} max={100} onChange={v=>setA('shadows',v)}/>
          <div style={{borderTop:'1px solid #1a1710',margin:'8px 0'}}/>
          <Slider label="Temperature" value={adj.temperature} min={-100} max={100} onChange={v=>setA('temperature',v)}/>
          <div style={{borderTop:'1px solid #1a1710',margin:'8px 0'}}/>
          <Slider label="Vignette"    value={adj.vignette}    min={-100} max={100} onChange={v=>setA('vignette',v)}/>
          <Slider label="Grain"       value={adj.grain}       min={0}    max={100} onChange={v=>setA('grain',v)}/>
          <button onClick={()=>{setAdj(DEF_ADJ);setTx(DEF_TX);setCrop(null);setResizeW('');setResizeH('');}} style={{width:'100%',marginTop:12,padding:'6px',fontSize:'9px',background:'transparent',border:'1px solid #1a1710',color:'#6a6055',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.1em'}}>RESET ALL</button>
        </div>
      </div>

      {/* Right panel */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {/* Toolbar */}
        <div style={{background:'#0e0c08',borderBottom:'1px solid #1a1710',display:'flex',alignItems:'center',padding:'0 10px',gap:5,flexShrink:0,minHeight:46,flexWrap:'wrap'}}>
          {IB('↺',()=>rotate(-1),false,'Rotate 90° CCW')}
          {IB('↻',()=>rotate(1), false,'Rotate 90° CW')}
          {IB('↔',()=>flip('h'),tx.flipH,'Flip Horizontal')}
          {IB('↕',()=>flip('v'),tx.flipV,'Flip Vertical')}
          <div style={{position:'relative'}}>
            <button onClick={()=>{setFreeRot(v=>!v);setShowResize(false);}} style={BS(showFreeRot||tx.freeRot!==0)}>
              TILT{tx.freeRot?` ${tx.freeRot>0?'+':''}${tx.freeRot}°`:''}
            </button>
            {showFreeRot&&(
              <div style={{position:'absolute',top:36,left:0,background:'#0e0c08',border:'1px solid #1e1a12',borderRadius:4,padding:'10px 14px',zIndex:30,width:210,boxShadow:'0 8px 24px rgba(0,0,0,0.6)'}}>
                <Slider label="Angle" value={tx.freeRot} min={-45} max={45} step={0.5} unit="°" onChange={v=>setTx(t=>({...t,freeRot:v}))}/>
                <button onClick={()=>setTx(t=>({...t,freeRot:0}))} style={{width:'100%',padding:'3px',fontSize:'8px',background:'transparent',border:'1px solid #1a1710',color:'#4a4438',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace"}}>RESET</button>
              </div>
            )}
          </div>
          <div style={{width:1,height:20,background:'#1e1a12',margin:'0 2px'}}/>
          <button onClick={enterCrop} style={BS(!!crop||cropMode)}>
            {crop?'✂ CROP ✓':'✂ CROP'}
          </button>
          {crop&&<button onClick={()=>setCrop(null)} style={BS()} title="Clear crop">✕</button>}
          <div style={{position:'relative'}}>
            <button onClick={()=>{setShowResize(v=>!v);setFreeRot(false);}} style={BS(showResize||!!(resizeW||resizeH))}>
              RESIZE{(resizeW||resizeH)?` ${resizeW||'?'}×${resizeH||'?'}px`:''}
            </button>
            {showResize&&(
              <div style={{position:'absolute',top:36,left:0,background:'#0e0c08',border:'1px solid #1e1a12',borderRadius:4,padding:'12px 14px',zIndex:30,width:220,boxShadow:'0 8px 24px rgba(0,0,0,0.6)'}}>
                <div style={{fontSize:'9px',color:'#6a6055',fontFamily:"'JetBrains Mono',monospace",marginBottom:8,letterSpacing:'0.08em'}}>OUTPUT DIMENSIONS</div>
                <div style={{display:'flex',gap:6,alignItems:'center',marginBottom:8}}>
                  <input type="number" placeholder="Width" value={resizeW} onChange={e=>handleResizeW(e.target.value)} style={{flex:1,padding:'4px 6px',background:'#0b0900',border:'1px solid #1a1710',color:'#c8c0b0',borderRadius:2,fontSize:'11px',fontFamily:"'JetBrains Mono',monospace",outline:'none'}}/>
                  <span style={{color:'#3a3428',fontSize:11}}>×</span>
                  <input type="number" placeholder="Height" value={resizeH} onChange={e=>handleResizeH(e.target.value)} style={{flex:1,padding:'4px 6px',background:'#0b0900',border:'1px solid #1a1710',color:'#c8c0b0',borderRadius:2,fontSize:'11px',fontFamily:"'JetBrains Mono',monospace",outline:'none'}}/>
                </div>
                <label style={{display:'flex',alignItems:'center',gap:6,fontSize:'9px',color:'#6a6055',fontFamily:"'JetBrains Mono',monospace",cursor:'pointer',marginBottom:8}}>
                  <input type="checkbox" checked={lockAR} onChange={e=>setLockAR(e.target.checked)} style={{accentColor:'#c8913a'}}/>LOCK ASPECT RATIO
                </label>
                <button onClick={()=>{setResizeW('');setResizeH('');}} style={{width:'100%',padding:'3px',fontSize:'8px',background:'transparent',border:'1px solid #1a1710',color:'#4a4438',cursor:'pointer',borderRadius:2,fontFamily:"'JetBrains Mono',monospace"}}>CLEAR</button>
              </div>
            )}
          </div>
          <div style={{flex:1}}/>
          {busy&&<span style={{fontSize:'9px',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace"}}>RENDERING…</span>}
          {orig&&<>
            <button onMouseDown={()=>setCmp(true)} onMouseUp={()=>setCmp(false)} onMouseLeave={()=>setCmp(false)} style={{...BS(comparing),userSelect:'none'}}>{comparing?'ORIGINAL':'COMPARE'}</button>
            <button onClick={exportFull} style={{...BS(),background:'rgba(200,145,58,0.12)',border:'1px solid rgba(200,145,58,0.35)',color:'#c8913a'}}>EXPORT JPEG</button>
          </>}
        </div>

        {/* Canvas */}
        <div
          style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden',background:dragging?'rgba(200,145,58,0.04)':'transparent',cursor:orig?'default':'pointer'}}
          onDragOver={e=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);loadImage(e.dataTransfer.files[0]);}}
          onClick={e=>{if(!orig&&e.target===e.currentTarget)fileRef.current.click();}}
        >
          {!orig ? (
            <div style={{textAlign:'center',pointerEvents:'none'}}>
              <div style={{fontSize:48,marginBottom:16,opacity:0.15}}>⬡</div>
              {rawStatus==='loading'
                ?<div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:'#c8913a'}}>Decoding RAW…</div>
                :rawStatus
                  ?<><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:'#c05050',marginBottom:8}}>RAW decode failed</div><div style={{fontSize:'9px',color:'#6a4040',fontFamily:"'JetBrains Mono',monospace"}}>{rawStatus}</div></>
                  :<><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:'#6a6055',marginBottom:8}}>Drop a photo to begin</div><div style={{fontSize:'9px',color:'#3a3628',fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.1em'}}>JPG · PNG · WEBP · DNG · ORF · CR2 · NEF · ARW</div></>
              }
            </div>
          ) : (
            <div style={{position:'relative',display:'inline-flex',maxWidth:'100%',maxHeight:'100%'}}>
              <canvas ref={canvasRef} style={{maxWidth:'100%',maxHeight:'calc(100vh - 100px)',objectFit:'contain',display:'block'}}/>
              {cropMode&&<CropOverlay crop={cropDraft} onChange={setCropDraft} onConfirm={confirmCrop} onCancel={cancelCrop}/>}
            </div>
          )}
          {orig&&comparing&&<div style={{position:'absolute',top:12,left:'50%',transform:'translateX(-50%)',background:'rgba(0,0,0,0.75)',color:'#c8913a',fontSize:'9px',padding:'4px 10px',borderRadius:2,fontFamily:"'JetBrains Mono',monospace",border:'1px solid rgba(200,145,58,0.2)'}}>ORIGINAL</div>}
          {orig&&<button onClick={()=>fileRef.current.click()} style={{position:'absolute',bottom:14,right:14,padding:'5px 12px',fontSize:'9px',background:'rgba(14,12,8,0.85)',border:'1px solid #1a1710',color:'#4a4438',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace"}}>OPEN NEW</button>}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*,.dng,.orf,.cr2,.nef,.arw,.rw2,.raf" style={{display:'none'}} onChange={e=>loadImage(e.target.files[0])}/>
    </div>
  );
}
