'use strict';

// 桌面版的数据落盘层：不依赖 electron，可以用普通 Node 直接测试
var fs = require('fs');
var path = require('path');
var os = require('os');

var APP_DIR = '投资项目记录台';
var DEALS_FILE = 'deals.json';
var ATTACH_DIR = '附件';

function baseDir(documents){
  return documents || os.homedir();
}

function dataRoot(documents){
  return path.join(baseDir(documents), APP_DIR);
}

function dealsPath(documents){
  return path.join(dataRoot(documents), DEALS_FILE);
}

function attachRoot(documents){
  return path.join(dataRoot(documents), ATTACH_DIR);
}

// Windows 上这几个名字是系统设备名，不能当普通文件/文件夹用，撞上了就加个尾巴
var RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

// 把用户给的文件名洗成安全的本机文件名。
// 四道清洗：① 路径分隔符和 Windows 非法字符换成下划线，杜绝目录穿越；
// ② 连续的点并成一个，不留 ".." 这种东西；③ 去掉首尾的点和空格，避免隐藏文件与 Windows 尾部点报错；
// ④ 撞上系统保留名就加个下划线
function safeName(n){
  var s = String(n || 'file')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 120);
  if(RESERVED.test(s.split('.')[0])) s = '_' + s;
  return s || 'file';
}

// 项目 id 用作附件子文件夹名，同样收紧
function safeId(id){
  var s = String(id || 'deal')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 60);
  if(RESERVED.test(s.split('.')[0])) s = '_' + s;
  return s || 'deal';
}

function ensure(p){
  fs.mkdirSync(p, { recursive: true });
}

// 读取项目记录。兼容两种格式：纯数组，或导出备份的 {deals:[...]}
function readDeals(documents){
  var f = dealsPath(documents);
  try{
    if(!fs.existsSync(f)) return [];
    var data = JSON.parse(fs.readFileSync(f, 'utf8'));
    if(Array.isArray(data)) return data;
    if(data && Array.isArray(data.deals)) return data.deals;
    return [];
  }catch(e){
    return [];
  }
}

// 写入项目记录。先写临时文件再改名，避免写到一半断电把文件写坏
function writeDeals(documents, list){
  var root = dataRoot(documents);
  ensure(root);
  var f = dealsPath(documents);
  var tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
  fs.renameSync(tmp, f);
  return f;
}

// 保存附件，返回相对于数据根目录的路径（换电脑时整文件夹拷走就能用）
function saveAttachment(documents, dealId, fileName, buf){
  var dir = path.join(attachRoot(documents), safeId(dealId));
  ensure(dir);
  var target = path.join(dir, safeName(fileName));
  fs.writeFileSync(target, buf);
  return path.relative(dataRoot(documents), target).split(path.sep).join('/');
}

// 把相对路径或绝对路径还原成本机绝对路径；文件不存在返回 null
function resolveAttachment(documents, p){
  if(!p) return null;
  var abs = path.isAbsolute(p) ? p : path.join(dataRoot(documents), p);
  return fs.existsSync(abs) ? abs : null;
}

function deleteAttachment(documents, p){
  var abs = resolveAttachment(documents, p);
  if(!abs) return false;
  try{ fs.unlinkSync(abs); return true; }catch(e){ return false; }
}

module.exports = {
  APP_DIR: APP_DIR,
  DEALS_FILE: DEALS_FILE,
  ATTACH_DIR: ATTACH_DIR,
  dataRoot: dataRoot,
  dealsPath: dealsPath,
  attachRoot: attachRoot,
  safeName: safeName,
  safeId: safeId,
  readDeals: readDeals,
  writeDeals: writeDeals,
  saveAttachment: saveAttachment,
  resolveAttachment: resolveAttachment,
  deleteAttachment: deleteAttachment
};
