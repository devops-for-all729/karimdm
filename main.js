const {app,BrowserWindow,ipcMain,dialog,shell}=require('electron');
const path=require('node:path');const fs=require('node:fs').promises;
const {DownloadManager}=require('./engine');
let manager,win,quitting=false;
app.setName('KarimDM');
const lock=app.requestSingleInstanceLock();if(!lock)app.quit();
app.on('second-instance',()=>{if(win){win.show();win.focus();}});
function wrap(name,fn){ipcMain.handle(name,async(event,...args)=>{if(event.sender!==win.webContents)throw Error('Invalid sender');try{return {ok:true,value:await fn(...args)};}catch(e){return {ok:false,error:e.message};}});}
app.whenReady().then(async()=>{
 try {
  manager=await new DownloadManager(process.env.KARIMDM_DATA||path.join(app.getPath('userData'),'downloads')).init();
  if(!manager.defaultFolder)await manager.configure({defaultFolder:app.getPath('downloads')});
  win=new BrowserWindow({width:1160,height:780,minWidth:880,minHeight:640,backgroundColor:'#0c1018',title:'KarimDM',icon:path.join(__dirname,'icon.png'),webPreferences:{preload:path.join(__dirname,'preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  win.setMenuBarVisibility(false);win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
  wrap('state',()=>manager.snapshot());wrap('add',v=>manager.add(v.url,v.folder,v.name));wrap('pause',id=>manager.pause(id));wrap('resume',id=>manager.resume(id));wrap('remove',id=>manager.remove(id));wrap('settings',v=>manager.configure(v));
  wrap('folder',async()=>{const r=await dialog.showOpenDialog(win,{title:'Choose download folder',defaultPath:manager.defaultFolder,properties:['openDirectory','createDirectory']});return r.canceled?null:r.filePaths[0];});
  wrap('open',async id=>{const j=manager.jobs.find(j=>j.id===id);if(j?.status!=='Complete')throw Error('Download is not complete.');await fs.access(j.output);return shell.openPath(j.output);});
  wrap('reveal',id=>{const j=manager.jobs.find(j=>j.id===id);if(j?.output)shell.showItemInFolder(j.output);else if(j)shell.openPath(j.folder);});
  manager.on('change',s=>{if(win&&!win.isDestroyed()){win.webContents.send('state',s);const a=s.jobs.filter(j=>j.status==='Downloading');win.setProgressBar(a.length&&a[0].size?a[0].downloaded/a[0].size:-1);}});
  await win.loadFile('index.html');
  if(process.argv.includes('--self-test') && process.env.KARIMDM_TEST_REPORT){try{await require('./self-test')({win,DownloadManager,report:process.env.KARIMDM_TEST_REPORT});app.exit(0);}catch(e){console.error(e);app.exit(1);}}
 }catch(e){dialog.showErrorBox('KarimDM',e.message);app.quit();}
});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',e=>{if(manager&&!quitting){e.preventDefault();quitting=true;manager.close().finally(()=>app.quit());}});
