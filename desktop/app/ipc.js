'use strict';

// 渲染进程和主进程之间的所有接口都登记在这里
var fs = require('fs');
var path = require('path');
var store = require('./storage');

function copyRecursive(src, dst){
  var st = fs.statSync(src);
  if(st.isDirectory()){
    fs.mkdirSync(dst, { recursive: true });
    var items = fs.readdirSync(src);
    for(var i=0;i<items.length;i++) copyRecursive(path.join(src, items[i]), path.join(dst, items[i]));
  }else{
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, fs.readFileSync(src));
  }
}

module.exports = function registerIpc(ipcMain, shell, getBase, ext){
  var dialog = ext && ext.dialog;
  var writeCustomDir = ext && ext.writeCustomDir;
  var setBase = ext && ext.setBase;
  ipcMain.handle('deals:read', function(){
    return store.readDeals(getBase());
  });

  ipcMain.handle('deals:write', function(_e, list){
    return store.writeDeals(getBase(), list);
  });

  ipcMain.handle('attach:save', function(_e, dealId, fileName, bytes){
    return store.saveAttachment(getBase(), dealId, fileName, Buffer.from(bytes));
  });

  ipcMain.handle('attach:open', function(_e, rel){
    var abs = store.resolveAttachment(getBase(), rel);
    if(!abs) return { ok: false, reason: '文件不在数据文件夹里' };
    var err = shell.openPath(abs);
    return { ok: !err, reason: err || '' };
  });

  ipcMain.handle('attach:delete', function(_e, rel){
    return store.deleteAttachment(getBase(), rel);
  });

  ipcMain.handle('data:root', function(){
    return store.dataRoot(getBase());
  });

  ipcMain.handle('data:open', function(){
    return shell.openPath(store.dataRoot(getBase()));
  });

  // 弹系统文件夹选择框，返回用户选的路径；取消返回 null
  ipcMain.handle('data:pick', function(){
    if(!dialog) return Promise.resolve(null);
    return dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
      title: '选一个文件夹放项目记录'
    }).then(function(res){
      if(res.canceled || !res.filePaths || !res.filePaths.length) return null;
      return res.filePaths[0];
    }).catch(function(){ return null; });
  });

  // 换数据存放位置：把记录和附件复制到新位置，原位置的文件原样保留
  ipcMain.handle('data:move', function(_e, newBase){
    newBase = String(newBase || '').trim();
    if(!newBase) return { ok: false, reason: '没给新位置' };
    var oldBase = getBase();
    var srcRoot = store.dataRoot(oldBase);
    var dstRoot = store.dataRoot(newBase);
    if(path.resolve(srcRoot) === path.resolve(dstRoot)){
      return { ok: true, root: dstRoot, moved: 0, unchanged: true };
    }
    try{
      fs.mkdirSync(dstRoot, { recursive: true });
    }catch(e){
      return { ok: false, reason: '这个位置建不了文件夹，换一个试试' };
    }
    var moved = 0;
    try{
      var srcDeals = path.join(srcRoot, store.DEALS_FILE);
      var dstDeals = path.join(dstRoot, store.DEALS_FILE);
      if(fs.existsSync(srcDeals) && !fs.existsSync(dstDeals)){
        fs.writeFileSync(dstDeals, fs.readFileSync(srcDeals));
        moved++;
      }
      var srcAtt = path.join(srcRoot, store.ATTACH_DIR);
      var dstAtt = path.join(dstRoot, store.ATTACH_DIR);
      if(fs.existsSync(srcAtt)){
        fs.mkdirSync(dstAtt, { recursive: true });
        var deals = fs.readdirSync(srcAtt);
        for(var i=0;i<deals.length;i++){
          var sd = path.join(srcAtt, deals[i]);
          if(!fs.statSync(sd).isDirectory()) continue;
          var files = fs.readdirSync(sd);
          for(var j=0;j<files.length;j++){
            var sf = path.join(sd, files[j]);
            var df = path.join(dstAtt, deals[i], files[j]);
            if(fs.existsSync(df)) continue;
            fs.mkdirSync(path.dirname(df), { recursive: true });
            fs.writeFileSync(df, fs.readFileSync(sf));
            moved++;
          }
        }
      }
    }catch(e){
      return { ok: false, reason: '复制过程中出错：' + (e && e.message ? e.message : '未知错误') };
    }
    if(writeCustomDir) writeCustomDir(newBase);
    if(setBase) setBase(newBase);
    return { ok: true, root: dstRoot, moved: moved };
  });

  // 模型接口：从主进程发出去，不受浏览器跨域限制
  ipcMain.handle('llm:chat', function(_e, url, headers, body){
    return fetch(url, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(body)
    }).then(function(res){
      return res.text().then(function(txt){
        return { status: res.status, body: txt };
      });
    }).catch(function(err){
      return { status: 0, body: String(err && err.message ? err.message : err) };
    });
  });
};
