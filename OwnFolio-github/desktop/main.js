'use strict';

var electron = require('electron');

// 环境里若带了 ELECTRON_RUN_AS_NODE，Electron 会被当成普通 Node 跑，接口全拿不到
if(typeof electron === 'string'){
  console.error('启动方式不对：环境里 ELECTRON_RUN_AS_NODE=1，Electron 被当成普通 Node 执行了。');
  console.error('在命令行先执行 unset ELECTRON_RUN_AS_NODE（Windows: set ELECTRON_RUN_AS_NODE=）再启动。');
  process.exit(1);
}

var app = electron.app;
var BrowserWindow = electron.BrowserWindow;
var ipcMain = electron.ipcMain;
var shell = electron.shell;

var path = require('path');
var fs = require('fs');
var store = require('./app/storage');

var baseDir = null;

// 用户在设置里自己选过的位置记在这个文件里，下次打开还用它
var CUSTOM_FILE = 'data-dir.json';

function customDirFile(){
  try{ return path.join(app.getPath('userData'), CUSTOM_FILE); }catch(e){ return null; }
}

function readCustomDir(){
  var f = customDirFile();
  if(!f) return '';
  try{
    if(!fs.existsSync(f)) return '';
    var o = JSON.parse(fs.readFileSync(f, 'utf8'));
    // 记过的位置要是被删了或拔了移动硬盘，就当没设过，退回默认位置
    return (o && o.dir && fs.existsSync(o.dir)) ? o.dir : '';
  }catch(e){ return ''; }
}

function writeCustomDir(dir){
  var f = customDirFile();
  if(!f) return false;
  try{
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, JSON.stringify({ dir: dir }), 'utf8');
    return true;
  }catch(e){ return false; }
}

// 数据根目录：用户自选的位置 > 环境变量（测试用）> 「文档」 > 应用数据目录
function getBase(){
  if(baseDir) return baseDir;
  var c = readCustomDir();
  if(c){ baseDir = c; return baseDir; }
  if(process.env.DEALLOG_DATA_DIR){ baseDir = process.env.DEALLOG_DATA_DIR; return baseDir; }
  try{
    var d = app.getPath('documents');
    if(d && fs.existsSync(d)){ baseDir = d; return baseDir; }
  }catch(e){}
  baseDir = app.getPath('userData');
  return baseDir;
}

var gotLock = app.requestSingleInstanceLock();
if(!gotLock){
  app.quit();
}else{
  app.on('second-instance', function(){
    var wins = BrowserWindow.getAllWindows();
    if(wins.length){
      if(wins[0].isMinimized()) wins[0].restore();
      wins[0].focus();
    }
  });
}

function createWindow(){
  var win = new BrowserWindow({
    width: 1180,
    height: 840,
    minWidth: 420,
    minHeight: 560,
    title: '投资项目记录台',
    icon: path.join(__dirname, 'icon.ico'),
    backgroundColor: '#f6f7f9',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'index.html'));
  win.once('ready-to-show', function(){ win.show(); });
}

app.whenReady().then(function(){
  createWindow();
  app.on('activate', function(){
    if(BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function(){
  if(process.platform !== 'darwin') app.quit();
});

require('./app/ipc')(ipcMain, shell, getBase, {
  dialog: electron.dialog,
  writeCustomDir: writeCustomDir,
  setBase: function(d){ baseDir = d; }
});
