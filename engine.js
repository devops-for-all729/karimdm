'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const {EventEmitter} = require('node:events');

class RangeIgnored extends Error {}
function validURL(value) {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('Use an HTTP or HTTPS link without embedded credentials.');
  return u.href;
}
function filename(value) {
  let name = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 170);
  if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(name)) name = 'download-' + name;
  return name;
}
function request(url, headers, signal, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Paused'));
    const req = (url.startsWith('https:') ? https : http).get(url, {headers: {'User-Agent':'KarimDM/1.0', 'Accept-Encoding':'identity', ...headers}, signal}, res => {
      if ([301,302,303,307,308].includes(res.statusCode) && res.headers.location) {
        res.resume();
        if (redirects >= 8) return reject(new Error('Too many redirects.'));
        let next;
        try { next = validURL(new URL(res.headers.location, url).href); } catch(e) { return reject(e); }
        resolve(request(next, headers, signal, redirects + 1));
      } else resolve(res);
    });
    req.setTimeout(30000, () => req.destroy(new Error('Connection timed out. Resume to retry.')));
    req.on('error', reject);
  });
}
async function probe(url, signal) {
  const res = await request(url, {Range:'bytes=0-0'}, signal);
  const h = res.headers;
  const m = /^bytes 0-0\/(\d+)$/.exec(h['content-range'] || '');
  let length = Number(h['content-length']);
  const ranges = res.statusCode === 206 && !!m;
  if (ranges) length = Number(m[1]);
  if (![200,206].includes(res.statusCode)) { res.destroy(); throw new Error('Server returned HTTP ' + res.statusCode); }
  if (res.statusCode === 206 && !ranges) { res.destroy(); throw new Error('Invalid Range response.'); }
  const result = {size:Number.isSafeInteger(length) && length >= 0 ? length : null, ranges,
    etag:h.etag && !h.etag.startsWith('W/') ? h.etag : null, modified:h['last-modified'] || null};
  res.destroy();
  return result;
}
async function atomic(file, data) {
  await fsp.mkdir(path.dirname(file), {recursive:true});
  await fsp.writeFile(file + '.tmp', JSON.stringify(data, null, 2));
  await fsp.rename(file + '.tmp', file);
}
class DownloadManager extends EventEmitter {
  constructor(root) {
    super(); this.root=root; this.jobs=[]; this.active=new Map(); this.maxConcurrent=2; this.segments=4; this.defaultFolder='';
    this.saving=Promise.resolve();
  }
  async init() {
    await fsp.mkdir(this.root,{recursive:true});
    try {
      const data=JSON.parse(await fsp.readFile(path.join(this.root,'queue.json'),'utf8'));
      this.jobs=data.jobs || []; this.maxConcurrent=data.maxConcurrent || 2; this.segments=data.segments || 4; this.defaultFolder=data.defaultFolder || '';
      for (const j of this.jobs) {
        j.speed=0; j.eta=null;
        if (['Downloading','Queued','Checking','Finishing','Pausing'].includes(j.status)) j.status='Paused';
        if (j.status!=='Complete') await this.recount(j);
      }
    } catch(e) { if(e.code!=='ENOENT') throw new Error('Cannot read saved queue: ' + e.message); }
    this.timer=setInterval(()=>this.tick(),500); return this;
  }
  part(j,i) { return path.join(this.root,j.id,i+'.part'); }
  async recount(j) {
    let n=0;
    for(let i=0;i<(j.parts || []).length;i++) {
      try { n+=(await fsp.stat(this.part(j,i))).size; } catch(e) { if(e.code!=='ENOENT') throw e; }
    }
    j.downloaded=n;
  }
  snapshot() { return {jobs:this.jobs.map(j=>({...j,connections:j.parts?.length || 1,parts:undefined})),maxConcurrent:this.maxConcurrent,segments:this.segments,defaultFolder:this.defaultFolder}; }
  save() {
    const data=JSON.parse(JSON.stringify({jobs:this.jobs,maxConcurrent:this.maxConcurrent,segments:this.segments,defaultFolder:this.defaultFolder}));
    this.saving=this.saving.catch(()=>{}).then(()=>atomic(path.join(this.root,'queue.json'),data));
    return this.saving;
  }
  changed() { this.emit('change',this.snapshot()); }
  async add(url,folder,customName) {
    url=validURL(url.trim());
    if(!path.isAbsolute(folder)) throw new Error('Choose a download folder.');
    await fsp.mkdir(folder,{recursive:true}); await fsp.access(folder,fs.constants.W_OK);
    let raw; try {raw=decodeURIComponent(new URL(url).pathname.split('/').pop());} catch {raw='download';}
    const j={id:crypto.randomUUID(),url,folder,name:filename(customName?.trim() || raw || 'download'),status:'Queued',downloaded:0,size:null,speed:0,eta:null,parts:[],error:null,created:Date.now()};
    this.jobs.unshift(j); await this.save(); this.changed(); this.pump(); return j.id;
  }
  async configure(settings) {
    if(settings.maxConcurrent!==undefined) this.maxConcurrent=Math.max(1,Math.min(6,Number(settings.maxConcurrent)||2));
    if(settings.segments!==undefined) this.segments=Math.max(1,Math.min(32,Number(settings.segments)||4));
    if(settings.defaultFolder) this.defaultFolder=settings.defaultFolder;
    await this.save();this.changed();this.pump();
  }
  async pause(id) {
    const j=this.jobs.find(j=>j.id===id); if(!j || j.status==='Complete') return;
    const a=this.active.get(id);
    if(a) {j.status='Pausing'; a.paused=true; a.controller.abort(); this.changed(); await a.done;}
    else {j.status='Paused'; j.speed=0; await this.save();this.changed();}
  }
  async resume(id) {
    const j=this.jobs.find(j=>j.id===id);if(!j || this.active.has(id) || j.status==='Complete') return;
    j.status='Queued';j.error=null;await this.save();this.changed();this.pump();
  }
  async remove(id) {
    await this.pause(id); const j=this.jobs.find(j=>j.id===id); if(!j) return;
    await fsp.rm(path.join(this.root,id),{recursive:true,force:true});
    this.jobs=this.jobs.filter(j=>j.id!==id);await this.save();this.changed();
  }
  pump() {
    if(this.shuttingDown)return;
    while(this.active.size<this.maxConcurrent) {
      const j=this.jobs.find(j=>j.status==='Queued'&&!this.active.has(j.id));if(!j) break;
      const a={controller:new AbortController(),paused:false,lastBytes:j.downloaded,lastTime:Date.now()};
      this.active.set(j.id,a);a.done=this.run(j,a).finally(()=>{this.active.delete(j.id);this.changed();this.pump();});
    }
  }
  tick() {
    for(const [id,a] of this.active) {
      const j=this.jobs.find(j=>j.id===id);if(!j) continue;
      const now=Date.now();j.speed=Math.max(0,(j.downloaded-a.lastBytes)*1000/(now-a.lastTime));a.lastBytes=j.downloaded;a.lastTime=now;
      j.eta=j.size!==null&&j.speed>0?Math.max(0,(j.size-j.downloaded)/j.speed):null;
    }
    this.changed();
  }
  async reset(j,info) {
    await fsp.rm(path.join(this.root,j.id),{recursive:true,force:true});await fsp.mkdir(path.join(this.root,j.id),{recursive:true});
    Object.assign(j,info); j.downloaded=0;
    const count=info.ranges&&info.size>1024*1024?Math.min(this.segments,Math.ceil(info.size/(1024*1024))):1;
    j.parts=Array.from({length:count},(_,i)=>({start:info.ranges?Math.floor(info.size*i/count):0,end:info.ranges?Math.floor(info.size*(i+1)/count)-1:null}));
    await this.save();
  }
  async run(j,a) {
    try {
      j.status='Checking';this.changed();
      const info=await probe(j.url,a.controller.signal);
      const same=j.parts.length&&info.ranges&&j.ranges&&info.size===j.size&&((info.etag&&info.etag===j.etag)||(!info.etag&&info.modified&&info.modified===j.modified));
      if(!same) await this.reset(j,info);
      await this.recount(j);
      if(a.paused) throw new Error('Paused');
      j.status='Downloading';await this.save();this.changed();
      try { await this.transferAll(j,a); }
      catch(e) {
        if(!(e instanceof RangeIgnored)||a.paused) throw e;
        a.controller=new AbortController();await this.reset(j,{...info,ranges:false});
        await this.transferAll(j,a);
      }
      if(a.paused) throw new Error('Paused');
      j.status='Finishing';this.changed();await this.finish(j,a);
      j.status='Complete';j.speed=0;j.eta=0;j.error=null;
      await fsp.rm(path.join(this.root,j.id),{recursive:true,force:true});
    } catch(e) {
      await this.recount(j);
      j.status=a.paused?'Paused':'Error';j.error=a.paused?null:e.message;j.speed=0;j.eta=null;
    }
    await this.save();
  }
  async transferAll(j,a) {
    let firstError;
    await Promise.all(j.parts.map((p,i)=>this.transfer(j,p,i,a).catch(e=>{if(!firstError){firstError=e;a.controller.abort();}})));
    if(firstError) throw firstError;
  }
  async transfer(j,p,i,a) {
    const file=this.part(j,i);let existing=0;
    try {existing=(await fsp.stat(file)).size;} catch(e) {if(e.code!=='ENOENT')throw e;}
    const expected=p.end!==null?p.end-p.start+1:null;
    if(expected!==null && existing===expected) return;
    if(expected!==null&&existing>expected) throw new Error('Partial data is invalid. Remove this download and add it again.');
    const headers={};
    const start=p.start+existing;
    if(j.ranges) { headers.Range=`bytes=${start}-${p.end}`; if(j.etag||j.modified)headers['If-Range']=j.etag||j.modified; }
    const res=await request(j.url,headers,a.controller.signal);
    if(j.ranges && res.statusCode===200) {res.destroy();throw new RangeIgnored('Range ignored');}
    if(j.ranges && (res.statusCode!==206||res.headers['content-range']!==`bytes ${start}-${p.end}/${j.size}`)) {res.destroy();throw new Error('Server sent an invalid byte range.');}
    if(!j.ranges && res.statusCode!==200) {res.destroy();throw new Error('Server returned HTTP '+res.statusCode);}
    if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity') {res.destroy();throw new Error('Server sent encoded data. Cannot safely resume.');}
    if(j.etag&&res.headers.etag&&j.etag!==res.headers.etag) {res.destroy();throw new Error('Remote file changed. Resume to check it again.');}
    const handle=await fsp.open(file,j.ranges?'a':'w');
    let got=existing;
    try {
      for await(const chunk of res) {
        if(a.paused) throw new Error('Paused');
        if(expected!==null&&got+chunk.length>expected) throw new Error('Server sent too much data.');
        let off=0;while(off<chunk.length){const {bytesWritten}=await handle.write(chunk,off,chunk.length-off);if(!bytesWritten)throw new Error('Disk write failed');off+=bytesWritten;}
        got+=chunk.length;j.downloaded+=chunk.length;
      }
      if(expected!==null&&got!==expected)throw new Error('Connection ended early. Resume to retry.');
      if(!j.ranges&&j.size!==null&&got!==j.size)throw new Error('File size did not match. Resume to retry.');
    } finally {res.destroy();await handle.close();}
  }
  async finish(j,a) {
    // Build beside the final file, then hard-link it without ever overwriting an existing file.
    const temp=path.join(j.folder,'.karimdm-'+j.id+'.tmp');
    let out;
    try {
      out=await fsp.open(temp,'w');
      for(let i=0;i<j.parts.length;i++)for await(const chunk of fs.createReadStream(this.part(j,i))){if(a.paused)throw new Error('Paused');let offset=0;while(offset<chunk.length){const {bytesWritten}=await out.write(chunk,offset,chunk.length-offset);if(!bytesWritten)throw new Error("Disk write failed");offset+=bytesWritten;}}
      await out.sync();await out.close();out=null;
      let target=path.join(j.folder,j.name);const ext=path.extname(j.name),base=j.name.slice(0,j.name.length-ext.length);
      for(let n=1;;n++) {
        try {await fsp.link(temp,target);break;} catch(e) {if(e.code!=='EEXIST')throw e;target=path.join(j.folder,`${base} (${n})${ext}`);}
      }
      j.output=target;j.downloaded=(await fsp.stat(target)).size;j.size=j.downloaded;
    } finally {if(out)await out.close();await fsp.rm(temp,{force:true});}
  }
  async close() {this.shuttingDown=true;clearInterval(this.timer); await Promise.all([...this.active.keys()].map(id=>this.pause(id)));await this.save();}
}
module.exports={DownloadManager,validURL,filename};
