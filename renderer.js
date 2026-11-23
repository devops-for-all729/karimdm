const $=id=>document.getElementById(id);let state,filter='All';
const call=(name,arg)=>window.karim.call(name,arg);
const bytes=n=>{if(n===null||n===undefined)return 'Unknown size';const u=['B','KB','MB','GB','TB'];let i=0;while(n>=1024&&i<4){n/=1024;i++;}return (i?n.toFixed(1):Math.round(n))+' '+u[i];};
const duration=s=>s===null?'--':s<60?Math.ceil(s)+'s':s<3600?Math.ceil(s/60)+'m':(s/3600).toFixed(1)+'h';
let toastTimer;function toast(m){$('toast').textContent=m;$('toast').style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').style.display='none',7000);}
function el(tag,cls,text){const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
function button(text,title,action){const b=el('button','icon',text);b.title=title;b.setAttribute('aria-label',title);b.onclick=()=>Promise.resolve(action()).catch(e=>toast(e.message));return b;}
const active=j=>['Downloading','Checking','Finishing','Pausing'].includes(j.status);
function render(s){state=s;const a=s.jobs.filter(active),done=s.jobs.filter(j=>j.status==='Complete');$('allCount').textContent=s.jobs.length;$('activeCount').textContent=a.length;$('doneCount').textContent=done.length;$('speed').textContent=bytes(a.reduce((n,j)=>n+j.speed,0))+'/s';$('running').replaceChildren(document.createTextNode(a.length+' '),el('em','',`/ ${s.maxConcurrent} slots`));$('completed').replaceChildren(document.createTextNode(done.length+' '),el('em','','files'));$('status').textContent=a.length?'Transfers in progress':'Ready when you are';
 const jobs=s.jobs.filter(j=>(filter==='All'||filter==='Active'&&(active(j)||j.status==='Queued')||j.status===filter)&&j.name.toLowerCase().includes($('search').value.toLowerCase()));
 $('queueCount').textContent=jobs.length;$('empty').style.display=jobs.length?'none':'block';$('list').replaceChildren();
 for(const j of jobs){
  const row=el('div','row');row.dataset.id=j.id;const ext=j.name.includes('.')?j.name.split('.').pop().slice(0,4).toUpperCase():'FILE';row.append(el('div','file-icon',ext));
  const info=el('div','file-info'),top=el('div','file-top'),name=el('span','file-name',j.name);name.title=j.name;top.append(name,el('span','state '+j.status,j.status));
  let host;try{host=new URL(j.url).hostname;}catch{host='Direct download';}info.append(top,el('div','file-source',host+' · '+(j.connections>1?j.connections+' connections':j.ranges?'Resume supported':'Direct link')));
  const pct=j.size?Math.min(100,j.downloaded/j.size*100):j.status==='Complete'?100:0;const bar=el('div','progress'),fill=el('div');fill.style.width=pct+'%';bar.append(fill);info.append(bar);
  const bottom=el('div','file-bottom');bottom.append(el('span','',bytes(j.downloaded)+' / '+bytes(j.size)),el('span','',j.status==='Complete'?'Saved to your folder':j.status==='Downloading'?bytes(j.speed)+'/s · '+duration(j.eta)+' left · '+pct.toFixed(1)+'%':j.status==='Paused'?'Partial data saved':j.status==='Queued'?'Waiting for a free slot':''));info.append(bottom);if(j.error)info.append(el('div','error',j.error));
  const actions=el('div','row-actions');if(j.status==='Complete'){actions.append(button('↗','Open file',()=>call('open',j.id)),button('▱','Show in folder',()=>call('reveal',j.id)));}else if(active(j)||j.status==='Queued')actions.append(button('Ⅱ','Pause download',()=>call('pause',j.id)));else actions.append(button('▷','Resume download',()=>call('resume',j.id)));
  actions.append(button('✕','Remove from list',()=>{if(confirm(j.status==='Complete'?'Remove from list? The downloaded file will stay.':'Remove this download and delete its partial data?'))return call('remove',j.id);}));row.append(info,actions);$('list').append(row);
 }
}
function showAdd(url=''){if(!state)return;$('url').value=url;$('fileName').value='';$('folder').value=state.defaultFolder;$('addDialog').showModal();$('url').focus();}
$('addBtn').onclick=()=>showAdd();$('emptyAdd').onclick=()=>showAdd();document.querySelectorAll('.close').forEach(b=>b.onclick=()=>b.closest('dialog').close());
$('addForm').onsubmit=async e=>{e.preventDefault();const b=e.submitter;b.disabled=true;try{await call('add',{url:$('url').value,folder:$('folder').value,name:$('fileName').value});$('addDialog').close();}catch(e){toast(e.message);}finally{b.disabled=false;}};
$('browse').onclick=async()=>{try{const f=await call('folder');if(f)$('folder').value=f;}catch(e){toast(e.message);}};
$('settingsBtn').onclick=()=>{$('concurrent').value=state.maxConcurrent;$('segments').value=state.segments;$('defaultFolder').value=state.defaultFolder;$('settingsDialog').showModal();};
$('defaultBrowse').onclick=async()=>{try{const f=await call('folder');if(f)$('defaultFolder').value=f;}catch(e){toast(e.message);}};
$('settingsForm').onsubmit=async e=>{e.preventDefault();try{await call('settings',{maxConcurrent:Number($('concurrent').value),segments:Number($('segments').value),defaultFolder:$('defaultFolder').value});$('settingsDialog').close();}catch(e){toast(e.message);}};
$('search').oninput=()=>render(state);document.querySelectorAll('.nav').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('.nav').forEach(x=>x.classList.toggle('active',x===b));$('heading').textContent=filter==='All'?'All downloads':filter==='Active'?'In progress':filter==='Complete'?'Completed':'Paused';render(state);});
document.addEventListener('paste',e=>{if(['INPUT','TEXTAREA'].includes(document.activeElement.tagName))return;const v=e.clipboardData.getData('text').trim();if(/^https?:\/\//i.test(v)){e.preventDefault();showAdd(v);}});
document.addEventListener('dragover',e=>{e.preventDefault();document.body.classList.add('dragging');});document.addEventListener('dragleave',e=>{if(!e.relatedTarget)document.body.classList.remove('dragging');});document.addEventListener('drop',e=>{e.preventDefault();document.body.classList.remove('dragging');const v=(e.dataTransfer.getData('text/uri-list')||e.dataTransfer.getData('text/plain')).split('\n').find(v=>/^https?:\/\//i.test(v.trim()));if(v)showAdd(v.trim());else toast('Drop a direct HTTP or HTTPS link, not a local file.');});
window.karim.onState(render);call('state').then(render).catch(e=>toast(e.message));
