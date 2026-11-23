const {contextBridge,ipcRenderer}=require('electron');
const channels=new Set(['state','add','pause','resume','remove','settings','folder','open','reveal']);
contextBridge.exposeInMainWorld('karim',{call:async(name,arg)=>{if(!channels.has(name))throw Error('Invalid action');const r=await ipcRenderer.invoke(name,arg);if(!r.ok)throw Error(r.error);return r.value;},onState:fn=>ipcRenderer.on('state',(_,state)=>fn(state))});
