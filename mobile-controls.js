// Touch controls share the existing keyboard bindings. Pointer capture keeps
// simultaneous movement/actions held until release, cancellation or app blur.
(() => {
  if (!matchMedia('(any-pointer: coarse)').matches) return;
  const game = document.currentScript.dataset.game;
  document.documentElement.classList.add('touch-game');
  const style = document.createElement('style');
  style.textContent = `
    .touch-game { --touch-height: 148px; }
    .touch-game canvas { touch-action:none; }
    #touch-controls { position:fixed; z-index:100; bottom:0; left:0; right:0;
      height:var(--touch-height); box-sizing:border-box; display:flex; align-items:center;
      justify-content:space-between; padding:6px max(8px,env(safe-area-inset-right)) max(6px,env(safe-area-inset-bottom)) max(8px,env(safe-area-inset-left));
      background:#0b1124; color:white; user-select:none; -webkit-user-select:none; touch-action:none; }
    #touch-controls button { touch-action:none; -webkit-touch-callout:none; border:1px solid #8196be;
      border-radius:12px; background:#1d2a48; color:white; min-width:42px; height:42px;
      font:600 12px system-ui; padding:4px; }
    #touch-controls button.active { background:#466ba6; }
    .touch-dpad { display:grid; grid-template-columns:repeat(3,42px); gap:2px; }
    .touch-actions { display:grid; grid-template-columns:repeat(2,minmax(44px,1fr)); gap:5px; }
    .touch-aim { width:76px; height:76px; border:1px solid #8196be; border-radius:50%;
      display:flex; text-align:center; align-items:center; justify-content:center; font:12px system-ui; touch-action:none; }
    .touch-game main, .touch-game #game-root, .touch-game body > #game {
      height:calc(100dvh - var(--touch-height)); }
    .touch-game #game-root { bottom:var(--touch-height); }
    .touch-game .screen { overflow:auto; }
    @media (orientation:landscape) and (max-height:500px) {
      .touch-game { --touch-height:104px; }
      .touch-dpad { grid-template-columns:repeat(3,44px); }
      #touch-controls button { height:28px; }
    }
  `;
  document.head.appendChild(style);
  const bar = document.createElement('nav'); bar.id='touch-controls'; bar.setAttribute('aria-label','Game touch controls');
  const pad=document.createElement('div'); pad.className='touch-dpad'; bar.appendChild(pad);
  const held=new Map();
  const keyInfo={ArrowUp:['ArrowUp',38],ArrowDown:['ArrowDown',40],ArrowLeft:['ArrowLeft',37],ArrowRight:['ArrowRight',39],Enter:['Enter',13],Escape:['Escape',27],Space:[' ',32],KeyJ:['j',74],KeyX:['x',88]};
  function emit(code,down){const [key,keyCode]=keyInfo[code]; window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',{code,key,keyCode,which:keyCode,bubbles:true,cancelable:true}));}
  function release(id){const item=held.get(id); if(!item)return; held.delete(id); if(![...held.values()].some(x=>x.code===item.code))emit(item.code,false); item.button.classList.remove('active');}
  function button(parent,label,code,column,row){
    const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',label);
    if(column){b.style.gridColumn=column;b.style.gridRow=row;} parent.appendChild(b);
    b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);held.set(e.pointerId,{code,button:b});emit(code,true);b.classList.add('active');});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(event,e=>release(e.pointerId));
  }
  button(pad,'↑','ArrowUp',2,1);button(pad,'←','ArrowLeft',1,2);button(pad,'↓','ArrowDown',2,2);button(pad,'→','ArrowRight',3,2);
  let aimPointer=null;
  function aim(x,y,fire){window.dispatchEvent(new CustomEvent('touch-aim',{detail:{x,y,fire}}));}
  if(game==='canopy'){
    const stick=document.createElement('div');stick.className='touch-aim';stick.textContent='Drag to aim + fire';bar.appendChild(stick);
    const move=e=>{const r=stick.getBoundingClientRect();let x=e.clientX-r.left-r.width/2,y=e.clientY-r.top-r.height/2;const len=Math.hypot(x,y);if(len<8){x=0;y=-1;}else{x/=len;y/=len;}aim(x,y,true);};
    stick.addEventListener('pointerdown',e=>{if(aimPointer!==null)return;e.preventDefault();aimPointer=e.pointerId;stick.setPointerCapture(e.pointerId);move(e);});
    stick.addEventListener('pointermove',e=>{if(e.pointerId===aimPointer)move(e);});
    for(const event of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(event,e=>{if(e.pointerId===aimPointer){aimPointer=null;aim(0,-1,false);}});
  }
  const actions=document.createElement('div');actions.className='touch-actions';bar.appendChild(actions);
  button(actions,'Start','Enter');if(game!=='nova')button(actions,'Pause','Escape');
  if(game==='bubble'){button(actions,'Jump','Space');button(actions,'Bubble','KeyJ');}
  else if(game==='nova'){button(actions,'Fire','Space');button(actions,'Special','KeyX');}
  else button(actions,'Grenade','Space');
  document.body.appendChild(bar);
  const clear=()=>{for(const id of [...held.keys()])release(id);aimPointer=null;aim(0,-1,false);};
  window.addEventListener('blur',clear);document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});
  window.dispatchEvent(new Event('resize'));
})();
