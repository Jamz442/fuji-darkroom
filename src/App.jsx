import { useState, useEffect, useRef, useCallback } from "react";

// ── Helpers ───────────────────────────────────────────────────
const clamp = (v, lo = 0, hi = 255) => Math.max(lo, Math.min(hi, v));
const clamp01 = v => Math.max(0, Math.min(1, v));

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) / 6
        : max === g ? ((b - r) / d + 2) / 6
        :             ((r - g) / d + 4) / 6;
  return [h * 360, s, l];
}
function hslToRgb(h, s, l) {
  h /= 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = t => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1/6 ? p+(q-p)*6*t : t < 1/2 ? q : t < 2/3 ? p+(q-p)*(2/3-t)*6 : p; };
  return [Math.round(f(h+1/3)*255), Math.round(f(h)*255), Math.round(f(h-1/3)*255)];
}
function lut(pts) {
  const s = [...pts].sort((a, b) => a[0] - b[0]), out = new Uint8Array(256);
  for (let x = 0; x < 256; x++) {
    if (x <= s[0][0]) { out[x] = clamp(s[0][1]); continue; }
    if (x >= s[s.length-1][0]) { out[x] = clamp(s[s.length-1][1]); continue; }
    for (let i = 0; i < s.length - 1; i++) {
      if (x >= s[i][0] && x <= s[i+1][0]) {
        const t = (x - s[i][0]) / (s[i+1][0] - s[i][0]);
        out[x] = clamp(s[i][1] + t * (s[i+1][1] - s[i][1])); break;
      }
    }
  }
  return out;
}

// ── Film Simulations ──────────────────────────────────────────
const SIMS = {
  "Classic Chrome":  { desc:"Muted · Cyan shadows · Restrained", sat:0.70, bw:false, r:[[0,8],[128,122],[255,240]], g:[[0,5],[128,128],[255,250]], b:[[0,16],[128,138],[255,253]] },
  "Velvia":          { desc:"Vivid · Rich · High contrast",       sat:1.55, bw:false, r:[[0,0],[128,134],[255,255]], g:[[0,0],[128,130],[255,255]], b:[[0,0],[128,118],[255,246]] },
  "Provia":          { desc:"Natural · Balanced · True colour",   sat:1.00, bw:false, r:[[0,0],[128,130],[255,255]], g:[[0,0],[128,129],[255,254]], b:[[0,0],[128,127],[255,252]] },
  "Eterna Cinema":   { desc:"Flat · Cinematic · Lifted blacks",   sat:0.60, bw:false, r:[[0,26],[128,138],[255,222]], g:[[0,23],[128,136],[255,220]], b:[[0,30],[128,142],[255,227]] },
  "Acros":           { desc:"B&W · Punchy contrast · Film grain", sat:0.00, bw:true,  r:[[0,0],[128,134],[255,255]], g:[[0,0],[128,134],[255,255]], b:[[0,0],[128,134],[255,255]] },
  "Classic Neg":     { desc:"Warm shadows · Faded highlights",    sat:0.82, bw:false, r:[[0,22],[128,162],[255,246]], g:[[0,13],[128,150],[255,241]], b:[[0,8],[128,134],[255,229]] },
  "Nostalgic Neg":   { desc:"Vintage warmth · Hazy · Faded",      sat:0.76, bw:false, r:[[0,36],[128,172],[255,245]], g:[[0,21],[128,154],[255,228]], b:[[0,10],[128,124],[255,198]] },
};

// ── Core Pixel Processing ─────────────────────────────────────
function process(imageData, adj, simKey) {
  const src = imageData.data, n = src.length;
  const out = new Uint8ClampedArray(n);
  const sim = simKey ? SIMS[simKey] : null;
  const rL = sim ? lut(sim.r) : null, gL = sim ? lut(sim.g) : null, bL = sim ? lut(sim.b) : null;
  const expF = Math.pow(2, adj.exposure);
  const cA = adj.contrast * 2.55, cF = (259*(cA+255)) / (255*(259-cA));
  const tR = adj.temperature * 0.22, tB = -adj.temperature * 0.22;

  for (let i = 0; i < n; i += 4) {
    let r = src[i], g = src[i+1], b = src[i+2];
    // White balance
    r = clamp(r + tR); b = clamp(b + tB);
    // Exposure
    r = clamp(r * expF); g = clamp(g * expF); b = clamp(b * expF);
    // Brightness
    if (adj.brightness) { const br = adj.brightness * 1.8; r=clamp(r+br); g=clamp(g+br); b=clamp(b+br); }
    // Contrast
    if (adj.contrast) { r=clamp(cF*(r-128)+128); g=clamp(cF*(g-128)+128); b=clamp(cF*(b-128)+128); }
    // Highlights / Shadows
    const lum = (0.2126*r + 0.7152*g + 0.0722*b) / 255;
    if (adj.highlights) { const w=Math.pow(Math.max(0,lum*2-1),1.5)*adj.highlights*0.5; r=clamp(r+w); g=clamp(g+w); b=clamp(b+w); }
    if (adj.shadows)    { const w=Math.pow(Math.max(0,1-lum*2),1.5)*adj.shadows*0.5;    r=clamp(r+w); g=clamp(g+w); b=clamp(b+w); }
    // Film sim
    if (sim) {
      if (sim.bw) { const gr=clamp(Math.round(0.299*r+0.587*g+0.114*b)); r=rL[gr]; g=gL[gr]; b=bL[gr]; }
      else { r=rL[clamp(r)]; g=gL[clamp(g)]; b=bL[clamp(b)]; if (sim.sat!==1){ const [h,s,l]=rgbToHsl(r,g,b); [r,g,b]=hslToRgb(h,clamp01(s*sim.sat),l); } }
    }
    out[i]=r; out[i+1]=g; out[i+2]=b; out[i+3]=src[i+3];
  }
  return new ImageData(out, imageData.width, imageData.height);
}

function addVigGrain(ctx, w, h, vignette, grain) {
  if (vignette !== 0) {
    const op = Math.abs(vignette) / 100 * 0.85;
    const gr = ctx.createRadialGradient(w/2,h/2,h*0.2,w/2,h/2,h*0.9);
    gr.addColorStop(0,'transparent'); gr.addColorStop(1, vignette>0?`rgba(0,0,0,${op})`:`rgba(255,255,255,${op})`);
    ctx.fillStyle = gr; ctx.fillRect(0,0,w,h);
  }
  if (grain > 0) {
    const id=ctx.getImageData(0,0,w,h), d=id.data, str=grain*0.55;
    for (let i=0;i<d.length;i+=4){ const n=(Math.random()-.5)*str; d[i]=clamp(d[i]+n); d[i+1]=clamp(d[i+1]+n); d[i+2]=clamp(d[i+2]+n); }
    ctx.putImageData(id,0,0);
  }
}

// ── Slider ────────────────────────────────────────────────────
function Slider({ label, value, min, max, step=1, unit='', onChange }) {
  const pct = ((value-min)/(max-min))*100;
  return (
    <div style={{marginBottom:10}}>
      <div style={{display:'flex',justifyContent:'space-between',marginBottom:4}}>
        <span style={{fontSize:'9px',letterSpacing:'0.08em',color:'#6a6055',fontFamily:"'JetBrains Mono',monospace"}}>{label.toUpperCase()}</span>
        <span style={{fontSize:'9px',color:value!==0?'#c8913a':'#332e26',fontFamily:"'JetBrains Mono',monospace",transition:'color .15s'}}>
          {value>0?'+':''}{step<1?value.toFixed(2):value}{unit}
        </span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e=>onChange(parseFloat(e.target.value))}
        style={{width:'100%',height:3,WebkitAppearance:'none',appearance:'none',borderRadius:2,cursor:'pointer',
          background:`linear-gradient(to right,#c8913a ${pct}%,#1e1a12 ${pct}%)`}} />
    </div>
  );
}

// ── RAW Support ───────────────────────────────────────────────
const RAW_EXTS = new Set(['dng','orf','cr2','nef','arw','rw2','raf']);
const isRAW = f => RAW_EXTS.has(f.name.split('.').pop().toLowerCase());

function loadUTIF() {
  return new Promise((resolve, reject) => {
    if (window.UTIF) { resolve(window.UTIF); return; }
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/utif@3.1.0/UTIF.js';
    s.onload = () => resolve(window.UTIF);
    s.onerror = () => reject(new Error('Could not load RAW decoder. Check your connection.'));
    document.head.appendChild(s);
  });
}

async function decodeRAW(file) {
  const UTIF = await loadUTIF();
  const buf = await file.arrayBuffer();
  const ifds = UTIF.decode(buf);
  if (!ifds.length) throw new Error('No image data found in file');

  // Pick the IFD with the largest pixel area (skips thumbnails)
  const main = ifds.reduce((best, ifd) =>
    ((ifd.t256?.[0]||0)*(ifd.t257?.[0]||0)) > ((best.t256?.[0]||0)*(best.t257?.[0]||0)) ? ifd : best
  );
  UTIF.decodeImage(buf, main);

  const W = main.t256?.[0], H = main.t257?.[0];
  if (!W || !H || !main.data) throw new Error('Cannot read pixel data from file');

  const spp  = main.t277?.[0] || 1;   // SamplesPerPixel
  const bps  = main.t258?.[0] || 8;   // BitsPerSample
  const data = main.data;              // Uint8Array
  const maxV = bps <= 8 ? 255 : 65535;

  const scale = Math.min(1, 1400/W, 1000/H);
  const outW = Math.round(W*scale), outH = Math.round(H*scale);
  const out = new ImageData(outW, outH);
  const gamma = v => Math.max(0,Math.min(1, v<=0.0031308 ? v*12.92 : 1.055*v**(1/2.4)-0.055));

  if (spp >= 3) {
    // Already multi-channel (e.g. rendered DNG preview) — sample to output size
    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        const sx = Math.min(W-1, Math.round(ox/scale));
        const sy = Math.min(H-1, Math.round(oy/scale));
        const si = (sy*W+sx)*spp;
        const oi = (oy*outW+ox)*4;
        if (bps > 8) {
          out.data[oi]   = Math.round(gamma((data[si*2]  |data[si*2+1]<<8)/maxV)*255);
          out.data[oi+1] = Math.round(gamma((data[(si+1)*2]|data[(si+1)*2+1]<<8)/maxV)*255);
          out.data[oi+2] = Math.round(gamma((data[(si+2)*2]|data[(si+2)*2+1]<<8)/maxV)*255);
        } else {
          out.data[oi]   = Math.round(gamma(data[si]/maxV)*255);
          out.data[oi+1] = Math.round(gamma(data[si+1]/maxV)*255);
          out.data[oi+2] = Math.round(gamma(data[si+2]/maxV)*255);
        }
        out.data[oi+3] = 255;
      }
    }
  } else {
    // Single-channel Bayer RAW — 2×2 block demosaic
    const cfa    = main.t33422 || [0,1,1,2];               // RGGB default
    const bLevel = (main.t50714?.[0] || 0) / maxV;
    const wLevel = (main.t50717?.[0] || maxV) / maxV;
    const range  = Math.max(0.001, wLevel - bLevel);
    const bW = Math.floor(W/2), bH = Math.floor(H/2);      // Block grid size

    const getP = (x, y) => {
      x = Math.max(0,Math.min(W-1,x)); y = Math.max(0,Math.min(H-1,y));
      const raw = bps > 8 ? (data[2*(y*W+x)] | data[2*(y*W+x)+1]<<8) : data[y*W+x];
      return Math.max(0, Math.min(1, (raw/maxV - bLevel)/range));
    };

    for (let oy = 0; oy < outH; oy++) {
      for (let ox = 0; ox < outW; ox++) {
        const bx = Math.min(bW-1, Math.round(ox*bW/outW));
        const by = Math.min(bH-1, Math.round(oy*bH/outH));
        const x = bx*2, y = by*2;
        const p = [getP(x,y), getP(x+1,y), getP(x,y+1), getP(x+1,y+1)];
        let r=0, g=0, gN=0, b=0;
        for (let ci=0;ci<4;ci++) {
          if (cfa[ci]===0) r=p[ci];
          else if (cfa[ci]===1) { g+=p[ci]; gN++; }
          else b=p[ci];
        }
        g = gN ? g/gN : 0;
        const oi = (oy*outW+ox)*4;
        out.data[oi]=Math.round(gamma(r)*255); out.data[oi+1]=Math.round(gamma(g)*255);
        out.data[oi+2]=Math.round(gamma(b)*255); out.data[oi+3]=255;
      }
    }
  }
  return out;
}

// ── App ───────────────────────────────────────────────────────
const DEF = { exposure:0, brightness:0, contrast:0, highlights:0, shadows:0, temperature:0, vignette:0, grain:0 };

export default function App() {
  const [orig, setOrig]       = useState(null);
  const [adj, setAdj]         = useState(DEF);
  const [sim, setSim]         = useState(null);
  const [comparing, setCmp]   = useState(false);
  const [dragging, setDrag]   = useState(false);
  const [busy, setBusy]       = useState(false);
  const [rawStatus, setRaw]   = useState('');  // '', 'loading', or error string

  const canvasRef             = useRef(null);
  const origImgRef            = useRef(null);
  const processedRef          = useRef(null);
  const debRef                = useRef(null);
  const fileRef               = useRef(null);
  const setA = (k,v) => setAdj(a=>({...a,[k]:v}));

  // Fonts + global styles
  useEffect(()=>{
    const l=document.createElement('link');
    l.href='https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,400&family=JetBrains+Mono:wght@300;400&family=Figtree:wght@300;400&display=swap';
    l.rel='stylesheet'; document.head.appendChild(l);
    const s=document.createElement('style');
    s.textContent=`*{box-sizing:border-box;margin:0;padding:0}input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:12px;height:12px;border-radius:50%;background:#c8913a;border:2px solid #0d0b07;cursor:pointer}::-webkit-scrollbar{width:3px}::-webkit-scrollbar-track{background:#0b0900}::-webkit-scrollbar-thumb{background:#201c12}`;
    document.head.appendChild(s);
  },[]);

  const loadImage = useCallback(file => {
    if (!file) return;
    if (isRAW(file)) {
      setRaw('loading'); setAdj(DEF); setSim(null);
      decodeRAW(file).then(imgData => {
        setOrig(imgData); setRaw('');
      }).catch(e => setRaw(e.message));
      return;
    }
    if (!file.type.startsWith('image/')) return;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      origImgRef.current = img;
      const mW=1400,mH=1000; let w=img.naturalWidth,h=img.naturalHeight;
      if(w>mW||h>mH){const sc=Math.min(mW/w,mH/h);w=Math.round(w*sc);h=Math.round(h*sc);}
      const tc=document.createElement('canvas'); tc.width=w; tc.height=h;
      tc.getContext('2d').drawImage(img,0,0,w,h);
      setOrig(tc.getContext('2d').getImageData(0,0,w,h));
      setAdj(DEF); setSim(null); setRaw(''); URL.revokeObjectURL(url);
    };
    img.src=url;
  },[]);

  // Render
  useEffect(()=>{
    if (!orig) return;
    clearTimeout(debRef.current);
    debRef.current = setTimeout(()=>{
      setBusy(true);
      setTimeout(()=>{
        const result = process(orig, adj, sim);
        const c = canvasRef.current; if(!c) return;
        c.width=result.width; c.height=result.height;
        const ctx=c.getContext('2d');
        ctx.putImageData(result,0,0);
        addVigGrain(ctx,result.width,result.height,adj.vignette,adj.grain);
        processedRef.current = ctx.getImageData(0,0,c.width,c.height);
        setBusy(false);
      },0);
    },180);
  },[orig,adj,sim]);

  // Compare toggle
  useEffect(()=>{
    if(!orig||!canvasRef.current) return;
    const c=canvasRef.current;
    if(comparing){ c.width=orig.width;c.height=orig.height;c.getContext('2d').putImageData(orig,0,0); }
    else if(processedRef.current){ const pd=processedRef.current;c.width=pd.width;c.height=pd.height;c.getContext('2d').putImageData(pd,0,0); }
  },[comparing]);

  const exportFull = () => {
    const img=origImgRef.current; if(!img) return;
    const tc=document.createElement('canvas'); tc.width=img.naturalWidth; tc.height=img.naturalHeight;
    const ctx=tc.getContext('2d'); ctx.drawImage(img,0,0);
    const full=ctx.getImageData(0,0,tc.width,tc.height);
    const result=process(full,adj,sim);
    ctx.putImageData(result,0,0);
    addVigGrain(ctx,tc.width,tc.height,adj.vignette,adj.grain);
    const a=document.createElement('a'); a.download='fuji-darkroom.jpg';
    a.href=tc.toDataURL('image/jpeg',0.95); a.click();
  };

  return (
    <div style={{display:'flex',height:'100vh',background:'#0b0900',color:'#c8c0b0',fontFamily:"'Figtree',sans-serif",overflow:'hidden'}}>

      {/* ── Sidebar ── */}
      <div style={{width:240,flexShrink:0,background:'#0e0c08',borderRight:'1px solid #1a1710',display:'flex',flexDirection:'column',overflowY:'auto'}}>
        {/* Logo */}
        <div style={{padding:'20px 18px 14px',borderBottom:'1px solid #1a1710'}}>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,color:'#e8dcc8',letterSpacing:'0.04em'}}>Fuji Darkroom</div>
          <div style={{fontSize:'9px',color:'#4a4438',letterSpacing:'0.12em',fontFamily:"'JetBrains Mono',monospace",marginTop:3}}>PHASE 1 · FILM EDITOR</div>
        </div>

        {/* Film Sims */}
        <div style={{padding:'14px 14px 10px',borderBottom:'1px solid #1a1710'}}>
          <div style={{fontSize:'9px',letterSpacing:'0.12em',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace",marginBottom:10}}>FILM SIMULATION</div>
          {Object.entries(SIMS).map(([name,s])=>(
            <button key={name} onClick={()=>setSim(n=>n===name?null:name)} style={{
              width:'100%',textAlign:'left',padding:'8px 10px',marginBottom:4,borderRadius:3,cursor:'pointer',
              background:sim===name?'rgba(200,145,58,0.1)':'transparent',
              border:`1px solid ${sim===name?'rgba(200,145,58,0.4)':'#1a1710'}`,
              transition:'all .15s',
            }}>
              <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:14,color:sim===name?'#c8913a':'#c8c0b0',fontWeight:500}}>{name}</div>
              <div style={{fontSize:'8px',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace",marginTop:2,letterSpacing:'0.04em'}}>{s.desc}</div>
            </button>
          ))}
          {sim && <button onClick={()=>setSim(null)} style={{width:'100%',padding:'5px',fontSize:'8px',background:'transparent',border:'1px solid #1a1710',color:'#4a4438',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em'}}>CLEAR SIMULATION</button>}
        </div>

        {/* Sliders */}
        <div style={{padding:'14px 16px',flex:1}}>
          <div style={{fontSize:'9px',letterSpacing:'0.12em',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace",marginBottom:12}}>ADJUSTMENTS</div>
          <Slider label="Exposure"    value={adj.exposure}    min={-3}   max={3}   step={0.05} unit=" EV" onChange={v=>setA('exposure',v)} />
          <Slider label="Brightness"  value={adj.brightness}  min={-100} max={100} onChange={v=>setA('brightness',v)} />
          <Slider label="Contrast"    value={adj.contrast}    min={-100} max={100} onChange={v=>setA('contrast',v)} />
          <div style={{borderTop:'1px solid #1a1710',margin:'10px 0'}}/>
          <Slider label="Highlights"  value={adj.highlights}  min={-100} max={100} onChange={v=>setA('highlights',v)} />
          <Slider label="Shadows"     value={adj.shadows}     min={-100} max={100} onChange={v=>setA('shadows',v)} />
          <div style={{borderTop:'1px solid #1a1710',margin:'10px 0'}}/>
          <Slider label="Temperature" value={adj.temperature} min={-100} max={100} onChange={v=>setA('temperature',v)} />
          <div style={{borderTop:'1px solid #1a1710',margin:'10px 0'}}/>
          <Slider label="Vignette"    value={adj.vignette}    min={-100} max={100} onChange={v=>setA('vignette',v)} />
          <Slider label="Grain"       value={adj.grain}       min={0}    max={100} onChange={v=>setA('grain',v)} />
          <button onClick={()=>setAdj(DEF)} style={{width:'100%',marginTop:14,padding:'7px',fontSize:'9px',background:'transparent',border:'1px solid #1a1710',color:'#6a6055',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.1em'}}>RESET ALL</button>
        </div>
      </div>

      {/* ── Canvas Area ── */}
      <div style={{flex:1,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        {/* Toolbar */}
        <div style={{height:46,background:'#0e0c08',borderBottom:'1px solid #1a1710',display:'flex',alignItems:'center',padding:'0 18px',gap:10,flexShrink:0}}>
          <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:'9px',color:sim?'#c8913a':'#4a4438',letterSpacing:'0.1em',marginRight:'auto'}}>
            {sim?`▸ ${sim.toUpperCase()}`:'NO SIMULATION ACTIVE'}
          </div>
          {busy && <div style={{fontSize:'9px',color:'#4a4438',fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em',animation:'pulse 1s infinite'}}>RENDERING…</div>}
          {orig && <>
            <button onMouseDown={()=>setCmp(true)} onMouseUp={()=>setCmp(false)} onMouseLeave={()=>setCmp(false)}
              style={{padding:'5px 12px',fontSize:'9px',background:'transparent',border:'1px solid #1a1710',color:'#6a6055',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em',userSelect:'none'}}>
              {comparing?'ORIGINAL':'COMPARE'}
            </button>
            <button onClick={exportFull} style={{padding:'5px 14px',fontSize:'9px',background:'rgba(200,145,58,0.12)',border:'1px solid rgba(200,145,58,0.35)',color:'#c8913a',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em'}}>
              EXPORT JPEG
            </button>
          </>}
        </div>

        {/* Canvas / Drop Zone */}
        <div
          style={{flex:1,display:'flex',alignItems:'center',justifyContent:'center',position:'relative',overflow:'hidden',background:dragging?'rgba(200,145,58,0.04)':'transparent',transition:'background .2s',cursor:orig?'default':'pointer'}}
          onDragOver={e=>{e.preventDefault();setDrag(true);}}
          onDragLeave={()=>setDrag(false)}
          onDrop={e=>{e.preventDefault();setDrag(false);loadImage(e.dataTransfer.files[0]);}}
          onClick={()=>!orig&&fileRef.current.click()}
        >
          {!orig ? (
            <div style={{textAlign:'center',pointerEvents:'none'}}>
              <div style={{fontSize:48,marginBottom:16,opacity:0.15}}>⬡</div>
              {rawStatus === 'loading'
                ? <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:'#c8913a'}}>Decoding RAW…</div>
                : rawStatus
                  ? <><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:18,color:'#c05050',marginBottom:8}}>RAW decode failed</div><div style={{fontSize:'9px',color:'#6a4040',fontFamily:"'JetBrains Mono',monospace"}}>{rawStatus}</div></>
                  : <><div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:22,color:'#6a6055',marginBottom:8}}>Drop a photo to begin</div>
                     <div style={{fontSize:'9px',color:'#3a3628',fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.1em'}}>JPG · PNG · WEBP · DNG · ORF · CR2 · NEF · ARW</div></>
              }
            </div>
          ) : (
            <canvas ref={canvasRef} style={{maxWidth:'100%',maxHeight:'100%',objectFit:'contain',display:'block'}} />
          )}
          {orig && comparing && (
            <div style={{position:'absolute',top:12,left:'50%',transform:'translateX(-50%)',background:'rgba(0,0,0,0.7)',color:'#c8913a',fontSize:'9px',padding:'4px 10px',borderRadius:2,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.1em',border:'1px solid rgba(200,145,58,0.2)'}}>
              ORIGINAL
            </div>
          )}
          {orig && (
            <button onClick={()=>fileRef.current.click()} style={{position:'absolute',bottom:14,right:14,padding:'5px 12px',fontSize:'9px',background:'rgba(14,12,8,0.8)',border:'1px solid #1a1710',color:'#4a4438',cursor:'pointer',borderRadius:3,fontFamily:"'JetBrains Mono',monospace",letterSpacing:'0.08em'}}>
              OPEN NEW
            </button>
          )}
        </div>
      </div>

      <input ref={fileRef} type="file" accept="image/*,.dng,.orf,.cr2,.nef,.arw,.rw2,.raf" style={{display:'none'}} onChange={e=>loadImage(e.target.files[0])} />
    </div>
  );
}
