"use strict";
/* celebrate.js — foto real → pixel art → cada builder festeja por separado.
   Determinista: todo es f(t) con rng seedeado.
   CELEBRATE.mount(canvas, {hint, interactive, assetsBase, at}) → {poke, stop} */
window.CELEBRATE = (() => {

const PHOTO_SRC = "assets/photos/orig/xbh-benja-1.jpg";
const PIXEL_SRC = "assets/pixel-art/xbh-group/sheet.png";
const UNDER_SRC = "assets/pixel-art/xbh-group/underlay.png"; // arte blurreado p/ huecos

const T_AUTO   = 4.0;    // auto-arranque de la transición (s)
const T_TRANS  = 3.6;    // duración foto→pixel art (s)
const WAVE_T   = 3.1;    // período de la ola de festejo (s)
const SEED     = 0xC0FFEE;

/* Segmentos de builders (fracciones de la imagen pixel-art 432×243):
   {x,y,w,h, tag} — x,y = esquina sup-izq; el tile pivota en su base. */
const SEGMENTS = [
  // fila de atrás (cabezas sobre el techo de la casa)
  {x:.366,y:.383,w:.102,h:.148},  // par: barba + pelo oscuro
  {x:.468,y:.379,w:.102,h:.152},  // par: navy + camisa rust
  // segunda fila (caras entre parados)
  {x:.340,y:.440,w:.083,h:.185},  // gorra+lentes & rubio
  {x:.424,y:.449,w:.076,h:.185},  // lentes & gorra beige
  {x:.546,y:.449,w:.081,h:.202},  // hoodie navy & joven
  // fila delantera parados
  {x:.181,y:.461,w:.056,h:.395},  // negro, borde izq
  {x:.229,y:.465,w:.074,h:.391},  // camiseta Argentina
  {x:.303,y:.519,w:.067,h:.206},  // sweater beige
  {x:.370,y:.498,w:.067,h:.202},  // remera negra barba
  {x:.438,y:.519,w:.065,h:.222},  // camiseta blanca
  {x:.502,y:.473,w:.076,h:.288},  // camisa a cuadros (grande)
  {x:.623,y:.457,w:.067,h:.387},  // mujer top negro
  {x:.683,y:.432,w:.056,h:.350},  // hoodie GAP blanco
  {x:.725,y:.449,w:.083,h:.490},  // mujer campera denim
  // agachados frente
  {x:.269,y:.658,w:.088,h:.272},  // musculosa negra + cadena
  {x:.356,y:.646,w:.079,h:.272},  // campera teal + gorra
  {x:.433,y:.671,w:.079,h:.255},  // hoodie negro
  {x:.507,y:.638,w:.097,h:.296,tag:"hype"}, // poncho naranja
  {x:.602,y:.597,w:.081,h:.313},  // campera gris
];

const CONF_COLORS = ["#ffd23f","#ff5d8f","#4cc9f0","#7bf1a8","#f5f5f5","#ff9f1c","#b892ff"];

// ---------- utils ----------
function mulberry32(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296}}
const clamp=(v,a,b)=>v<a?a:v>b?b:v;

function load(src){return new Promise((res,rej)=>{const i=new Image();i.onload=()=>res(i);i.onerror=rej;i.src=src})}
function cover(c,img,dw,dh){
  const s=Math.max(dw/img.width,dh/img.height),sw=dw/s,sh=dh/s;
  c.imageSmoothingEnabled=true;c.drawImage(img,(img.width-sw)/2,(img.height-sh)/2,sw,sh,0,0,dw,dh);
}

function mount(cv, opts = {}) {
  const ctx = cv.getContext("2d");
  const hint = opts.hint || null;
  const base = opts.assetsBase || "";
  const at = (opts.at !== undefined) ? opts.at
           : parseFloat(new URLSearchParams(location.search).get("at") || "0");
  let t0 = performance.now()/1000 - at;  // origen del tiempo simulado
  let Tstart = T_AUTO;                   // cuándo arranca la transición (auto o click)
  let dpr = 1, vw = 0, vh = 0;
  let running = true, raf = 0;

  function now(){return performance.now()/1000-t0}
  function resize(){
    dpr=Math.min(2,devicePixelRatio||1);vw=innerWidth;vh=innerHeight;
    cv.width=vw*dpr;cv.height=vh*dpr;cv.style.width=vw+"px";cv.style.height=vh+"px";
  }
  addEventListener("resize",resize);resize();

  function poke(){
    const t=now();
    if(t<Tstart){Tstart=t;if(hint)hint.style.opacity=0;}                 // adelanta la transición
    else if(t>Tstart+T_TRANS+1.5){t0=performance.now()/1000;Tstart=T_AUTO;if(hint)hint.style.opacity=1;} // replay
  }
  const onKey = e=>{if(e.key===" "||e.key==="Enter"){e.preventDefault();poke()}};
  if(opts.interactive){cv.addEventListener("click",poke);addEventListener("keydown",onKey);}

  let ready = Promise.all([
    load(base+PHOTO_SRC), load(base+PIXEL_SRC), load(base+UNDER_SRC)
  ]).then(([photo,pix,under])=>{
    if(!running)return;
    const W=pix.width,H=pix.height;
    const scene=document.createElement("canvas");scene.width=W;scene.height=H;
    const sc=scene.getContext("2d");

    // base: arte con los rectángulos de builders recortados (holes)
    const base=document.createElement("canvas");base.width=W;base.height=H;
    const bc=base.getContext("2d");
    bc.drawImage(pix,0,0);
    const segs=SEGMENTS.map((s,i)=>{
      const b={x:Math.round(s.x*W),y:Math.round(s.y*H),w:Math.round(s.w*W),h:Math.round(s.h*H),tag:s.tag,i};
      bc.clearRect(b.x,b.y,b.w,b.h);           // hole
      // rng por builder: fases, amplitudes (determinista)
      const r=mulberry32(SEED^ (i*7919));
      b.cx=b.x+b.w/2;b.base=b.y+b.h;
      b.bobA=0.8+r()*1.6;b.bobF=1.1+r()*0.9;b.bobP=r()*6.28;
      b.swayA=0.015+r()*0.03;b.swayF=0.8+r()*0.9;b.swayP=r()*6.28;
      b.hopA=4+r()*4.5;b.hype=(s.tag==="hype");if(b.hype)b.hopA*=1.9;
      // fila por profundidad: los tiles de solo-cabeza (base alta) están
      // apretados atrás → saltan menos; cuerpo completo festeja full
      b.rowF=b.base<H*0.56?0.45:(b.base<H*0.72?0.7:1.0);
      return b;
    }).sort((a,b)=>a.y-b.y);                   // back-to-front por fila

    // mosaicos de la foto para el "resolve" chunk antes del flip
    const mosaic=[2,4,8].map(ps=>{
      const tw=Math.max(1,Math.round(W/ps)),th=Math.max(1,Math.round(H/ps));
      const t=document.createElement("canvas");t.width=tw;t.height=th;
      cover(t.getContext("2d"),photo,tw,th);
      const m=document.createElement("canvas");m.width=W;m.height=H;
      const mc=m.getContext("2d");
      mc.imageSmoothingEnabled=false;mc.drawImage(t,0,0,W,H);
      return m;
    });
    // rect cover de la foto (crisp) dentro del rect de escena
    const pcS=Math.max(W/photo.width,H/photo.height);
    const photoCover={sx:(photo.width-W/pcS)/2,sy:(photo.height-H/pcS)/2,sw:W/pcS,sh:H/pcS};

    // umbrales de dissolve por celda (barrido izq→der + ruido seedeado)
    const CS=8,COLS=Math.ceil(W/CS),ROWS=Math.ceil(H/CS);
    const thr=new Float32Array(COLS*ROWS);
    {const r=mulberry32(SEED^0xBEEF);const nz=[];for(let i=0;i<COLS*ROWS;i++)nz[i]=r();
     for(let y=0;y<ROWS;y++)for(let x=0;x<COLS;x++){
       const u=x/(COLS-1),v=y/(ROWS-1);
       thr[y*COLS+x]=clamp(0.62*u+0.30*nz[y*COLS+x]+0.08*v,0,0.98);
     }}
    // cuándo se resuelve la zona de cada builder = umbral de su celda central
    for(const b of segs){
      const cc=clamp(Math.floor(b.cx/CS),0,COLS-1),cr=clamp(Math.floor((b.y+b.h/2)/CS),0,ROWS-1);
      b.thr=thr[cr*COLS+cc];
    }

    // confetti: puro f(t) — posición analítica con wrap
    const conf=[];{const r=mulberry32(SEED^0xCAFE);
      for(let i=0;i<120;i++)conf.push({x:r()*(W+40)-20,y:-8-r()*H,vy:9+r()*20,
        sa:r()*3.2,sf:0.6+r()*2.2,sp:r()*6.28,s:[1,1,2,2,3][r()*5|0],
        c:CONF_COLORS[r()*CONF_COLORS.length|0]});
    }

    // ---------- animación de un builder ----------
    function segPose(b,t){
      const tcel=Tstart+T_TRANS;
      const tr=Tstart+T_TRANS*b.thr;                     // cuándo se resolvió SU zona
      const amp=clamp((t-tr)/0.9,0,1);                   // ramp post-reveal
      const bob=Math.round(b.bobA*Math.sin(6.2832*b.bobF*t+b.bobP))*amp;
      // ola: frente que recorre el grupo izq→der cada WAVE_T
      const xf=((t-tcel)*(W+140)/WAVE_T)%(W+140)-70;
      const d=xf-b.cx, WL=Math.max(60,W*0.22);
      let hop=0,sk=1;
      if(d>0&&d<WL){const ph=Math.PI*d/WL;hop=b.hopA*Math.sin(ph);
        sk=1+0.10*Math.sin(2*ph);}                       // stretch en subida/bajada
      const rot=b.swayA*Math.sin(6.2832*b.swayF*t+b.swayP)*amp;
      return{y:bob*b.rowF-hop*amp*b.rowF,rot:rot*(1+hop*0.08),sk};
    }

    function renderScene(t){
      const tcel=Tstart+T_TRANS;
      sc.clearRect(0,0,W,H);
      sc.drawImage(under,0,0);
      sc.drawImage(base,0,0);
      for(const b of segs){
        const p=segPose(b,t);
        sc.save();sc.translate(b.cx,b.base+p.y);sc.rotate(p.rot);sc.scale(1,p.sk);
        sc.drawImage(pix,b.x,b.y,b.w,b.h,-b.w/2,-b.h,b.w,b.h);sc.restore();
      }
      if(t>tcel){                                        // confetti solo celebrando
        const tc=t-tcel;
        for(const f of conf){
          const y=((f.y+f.vy*tc)%(H+60)+(H+60))%(H+60)-30;
          const x=f.x+f.sa*Math.sin(6.2832*f.sf*tc+f.sp);
          sc.fillStyle=f.c;sc.fillRect(Math.round(x),Math.round(y),f.s,f.s);
        }
      }
    }

    // ---------- loop ----------
    function frame(){
      if(!running)return;
      const t=now();
      const dw=Math.min(vw,vh*(W/H)),dh=dw/(W/H);
      const dx=(vw-dw)/2,dy=(vh-dh)/2;                   // rect "contain" en pantalla
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.fillStyle="#050505";ctx.fillRect(0,0,vw,vh);

      if(t<Tstart){                                      // FOTO
        ctx.imageSmoothingEnabled=true;
        ctx.drawImage(photo,photoCover.sx,photoCover.sy,photoCover.sw,photoCover.sh,dx,dy,dw,dh);
      }else if(t<Tstart+T_TRANS){                        // TRANSICIÓN
        const p=(t-Tstart)/T_TRANS;
        renderScene(t);
        ctx.imageSmoothingEnabled=true;
        ctx.drawImage(photo,photoCover.sx,photoCover.sy,photoCover.sw,photoCover.sh,dx,dy,dw,dh);
        ctx.imageSmoothingEnabled=false;
        const win=0.10;
        for(let cy=0;cy<ROWS;cy++)for(let cx=0;cx<COLS;cx++){
          const th=thr[cy*COLS+cx],sx=cx*CS,sy=cy*CS;
          const sw=Math.min(CS,W-sx),sh=Math.min(CS,H-sy);
          const ddx=dx+sx/W*dw,ddy=dy+sy/H*dh,ddw=sw/W*dw,ddh=sh/H*dh;
          if(p>=th){                                     // ya pixel-art
            ctx.drawImage(scene,sx,sy,sw,sh,ddx,ddy,ddw,ddh);
          }else if(th-p<win){                            // resolve chunk previo
            const lev=clamp(1-(th-p)/win,0.05,0.99);
            ctx.drawImage(mosaic[Math.min(2,lev*3|0)],sx,sy,sw,sh,ddx,ddy,ddw,ddh);
          }
        }
      }else{                                             // CELEBRANDO
        renderScene(t);
        ctx.imageSmoothingEnabled=false;
        ctx.drawImage(scene,0,0,W,H,dx,dy,dw,dh);
      }
      if(hint&&t>Tstart+0.4)hint.style.opacity=0;
      raf=requestAnimationFrame(frame);
    }
    raf=requestAnimationFrame(frame);
  });

  return {
    poke,
    ready,
    stop(){
      running=false;cancelAnimationFrame(raf);
      removeEventListener("resize",resize);
      if(opts.interactive){cv.removeEventListener("click",poke);removeEventListener("keydown",onKey);}
    },
  };
}

return { mount };
})();
