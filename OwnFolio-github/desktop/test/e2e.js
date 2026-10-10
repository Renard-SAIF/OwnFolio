// 数据落盘的端到端测试。不需要 Electron 界面，node test/e2e.js 就能跑。
// 做法：用假的 ipcMain 和 shell 把 app/ipc.js 登记起来，然后直接调它。

const path = require('path');
const fs = require('fs');
const os = require('os');
const store = require(path.join(__dirname, '..', 'app', 'storage.js'));

const root = path.join(os.tmpdir(), 'deallog-e2e-' + Date.now());

// 假的主进程接口
const handlers = {};
const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn; } };
const shell = { openPath: p => { shell.lastOpened = p; return ''; }, showItemInFolder: p => { shell.lastShown = p; } };

// 假的文件夹选择框：pickNext 决定这一次返回什么
let pickNext = null;
let baseDir = root;
const fakeDialog = {
  showOpenDialog: () => Promise.resolve(
    pickNext ? { canceled: false, filePaths: [pickNext] } : { canceled: true, filePaths: [] }
  )
};
let customWritten = null;
require(path.join(__dirname, '..', 'app', 'ipc.js'))(ipcMain, shell, () => baseDir, {
  dialog: fakeDialog,
  writeCustomDir: d => { customWritten = d; return true; },
  setBase: d => { baseDir = d; }
});

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? '  PASS  ' : '  FAIL  ') + msg); if (!cond) fails++; };
const fp = () => path.join(baseDir, store.APP_DIR, store.DEALS_FILE);

(async () => {
  console.log('数据目录:', root);

  console.log('\n[1] 空库读取');
  let r = await handlers['deals:read']();
  ok(Array.isArray(r) && r.length === 0, '首次读取返回空数组');

  console.log('\n[2] 写入并回读');
  const d1 = { id: 'd1', company: '示例·某量子公司', sector: '量子计算', note: '测试"引号"与<尖括号>' };
  ok(handlers['deals:write'](null, [d1]) === fp(), '写入返回落盘路径');
  r = await handlers['deals:read']();
  ok(r.length === 1 && r[0].company === '示例·某量子公司', '回读一条且公司名正确');
  ok(r[0].note === '测试"引号"与<尖括号>', '中文与特殊字符原样保留');
  ok(fs.existsSync(fp()), '文件真实存在');

  console.log('\n[3] 原子写（不留 .tmp 垃圾）');
  const leftovers = fs.readdirSync(path.dirname(fp())).filter(f => f.startsWith('.tmp') || f.endsWith('.tmp'));
  ok(leftovers.length === 0, '无 .tmp 残留 ' + JSON.stringify(leftovers));

  console.log('\n[4] 损坏文件容错');
  fs.writeFileSync(fp(), '{坏掉的 json', 'utf8');
  r = await handlers['deals:read']();
  ok(Array.isArray(r) && r.length === 0, '损坏文件返回空数组而不是崩溃');

  console.log('\n[5] 兼容 {deals:[]} 结构');
  fs.writeFileSync(fp(), JSON.stringify({ deals: [{ id: 'd9', company: '旧格式公司' }] }), 'utf8');
  r = await handlers['deals:read']();
  ok(r.length === 1 && r[0].company === '旧格式公司', '识别 {deals:[...]} 旧结构');

  console.log('\n[6] 附件保存 / 读取 / 删除');
  const bytes = Array.from(Buffer.from('BP内容测试', 'utf8'));
  const rel = await handlers['attach:save'](null, 'd1', '商业计划书.pdf', bytes);
  ok(typeof rel === 'string' && rel.length > 0, '保存返回相对路径: ' + rel);
  ok(rel.indexOf('\\') < 0, '路径用正斜杠（跨平台）');
  const abs = store.resolveAttachment(baseDir, rel);
  ok(fs.existsSync(abs), '附件真实落盘');
  ok(fs.readFileSync(abs, 'utf8') === 'BP内容测试', '附件内容一致');

  console.log('\n[7] 恶意文件名清洗');
  const evil = await handlers['attach:save'](null, 'd1', '../../evil/坏名:*.pdf', bytes);
  ok(evil.indexOf('..') < 0, '不含 .. 穿越: ' + evil);
  ok(!/[<>:"|?*]/.test(evil), '非法字符已清洗');
  const evilAbs = store.resolveAttachment(baseDir, evil);
  ok(evilAbs && evilAbs.indexOf(baseDir) === 0, '解析后仍在数据目录内');

  console.log('\n[8] 打开附件');
  const openRes = await handlers['attach:open'](null, rel);
  ok(openRes && openRes.ok === true, '打开附件返回 ok');
  ok(shell.lastOpened === abs, '交给系统打开的路径正确');

  console.log('\n[9] 删除附件');
  ok(handlers['attach:delete'](null, rel) === true, '删除返回 true');
  ok(!fs.existsSync(abs), '文件已真实删除');

  console.log('\n[10] 数据目录');
  ok(handlers['data:root']() === path.join(baseDir, store.APP_DIR), 'data:root 正确');
  await handlers['data:open']();
  ok(!!shell.lastOpened, '打开了数据目录');

  console.log('\n[11] llm:chat 走主进程（本地假接口）');
  const http = require('http');
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { content: 'OK' } }] }));
  });
  await new Promise(r2 => srv.listen(0, '127.0.0.1', r2));
  const port = srv.address().port;
  const out = await handlers['llm:chat'](null, 'http://127.0.0.1:' + port + '/v1/chat/completions',
    { 'Content-Type': 'application/json' }, { model: 'm', messages: [] });
  ok(out.status === 200, '主进程 fetch 通，HTTP ' + out.status);
  ok(JSON.parse(out.body).choices[0].message.content === 'OK', '能取回接口返回内容');
  srv.close();

  console.log('\n[12] llm:chat 网络失败不抛出');
  const bad = await handlers['llm:chat'](null, 'http://127.0.0.1:1/x', {}, {});
  ok(bad.status === 0, '断网返回 status 0 而不是抛异常');

  // --- 以下是「改数据存放位置」的测试 ---
  console.log('\n[13] 选文件夹：取消');
  pickNext = null;
  ok(await handlers['data:pick']() === null, '用户取消时返回 null');

  console.log('\n[14] 选文件夹：选中');
  const newBase = path.join(os.tmpdir(), 'deallog-moved-' + Date.now());
  pickNext = newBase;
  ok(await handlers['data:pick']() === newBase, '返回用户选的路径');

  console.log('\n[15] 换存放位置：记录和附件一起搬走');
  // 先造一条记录和两个附件
  await handlers['deals:write'](null, [{ id: 'x1', company: '搬家公司', industry: '具身智能' }]);
  await handlers['attach:save'](null, 'x1', 'BP.pdf', bytes);
  await handlers['attach:save'](null, 'x2', '财务模型.xlsx', bytes);
  const oldRoot = path.join(baseDir, store.APP_DIR);
  const mv = await handlers['data:move'](null, newBase);
  ok(mv && mv.ok === true, '迁移成功');
  ok(mv.moved >= 3, '记录和附件都搬了，共 ' + mv.moved + ' 个文件');
  ok(baseDir === newBase, '后续读写改用新位置');
  ok(fs.existsSync(path.join(newBase, store.APP_DIR, store.DEALS_FILE)), '新位置有 deals.json');
  r = await handlers['deals:read']();
  ok(r.length === 1 && r[0].company === '搬家公司', '新位置能读回记录');
  ok(fs.existsSync(path.join(newBase, store.APP_DIR, '附件', 'x1', 'BP.pdf')), '附件跟着搬过来了');
  ok(customWritten === newBase, '新位置已记住，下次打开还用它');

  console.log('\n[16] 换存放位置：原来的文件保留，不删用户数据');
  ok(fs.existsSync(path.join(oldRoot, store.DEALS_FILE)), '原位置的 deals.json 还在');
  ok(fs.existsSync(path.join(oldRoot, '附件', 'x1', 'BP.pdf')), '原位置的附件还在');

  console.log('\n[17] 换到同一个位置：不折腾');
  const same = await handlers['data:move'](null, newBase);
  ok(same.ok === true && same.unchanged === true, '识别为同一位置，直接返回');

  console.log('\n[18] 新位置建不了文件夹时给出可读错误');
  const denied = await handlers['data:move'](null, 'Z:\\不存在的盘符\\绝对写不了');
  ok(denied.ok === false && !!denied.reason, '返回可读错误: ' + denied.reason);
  ok(baseDir === newBase, '失败时不切换位置，还留在能用的地方');

  console.log('\n[19] 空位置不切换');
  const empty = await handlers['data:move'](null, '   ');
  ok(empty.ok === false, '空路径直接拒绝');

  console.log('\n失败数:', fails);
  process.exitCode = fails ? 1 : 0;
})().catch(e => { console.error('测试自身出错:', e); process.exitCode = 2; });
