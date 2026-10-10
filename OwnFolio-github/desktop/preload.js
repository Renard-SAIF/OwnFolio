'use strict';

// 桥接层：只把必要的几个能力暴露给网页，网页拿不到整个 Node
var electron = require('electron');
var contextBridge = electron.contextBridge;
var ipcRenderer = electron.ipcRenderer;

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  readDeals: function(){ return ipcRenderer.invoke('deals:read'); },
  writeDeals: function(list){ return ipcRenderer.invoke('deals:write', list); },
  saveAttachment: function(dealId, fileName, bytes){
    return ipcRenderer.invoke('attach:save', dealId, fileName, bytes);
  },
  openAttachment: function(rel){ return ipcRenderer.invoke('attach:open', rel); },
  deleteAttachment: function(rel){ return ipcRenderer.invoke('attach:delete', rel); },
  dataRoot: function(){ return ipcRenderer.invoke('data:root'); },
  openDataFolder: function(){ return ipcRenderer.invoke('data:open'); },
  pickDataDir: function(){ return ipcRenderer.invoke('data:pick'); },
  moveData: function(newBase){ return ipcRenderer.invoke('data:move', newBase); },
  llmChat: function(url, headers, body){ return ipcRenderer.invoke('llm:chat', url, headers, body); }
});
