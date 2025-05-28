// 使用 CommonJS 模块导入
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- 从主进程到渲染进程的单向通信 (事件监听) ---
  onHistoryUpdate: (callback) => ipcRenderer.on('history-updated', (_event, value) => callback(value)),
  onScheduledTasksUpdate: (callback) => ipcRenderer.on('scheduled-tasks-update', (_event, tasks) => callback(tasks)),

  // --- 从渲染进程到主进程的双向通信 (调用并等待结果) ---
  getStoreData: () => ipcRenderer.invoke('get-store-data'),
  saveWebhooks: (webhooks) => ipcRenderer.invoke('save-webhooks', webhooks),

  // --- Template Management API ---
  getTemplates: () => ipcRenderer.invoke('get-templates'),
  saveTemplates: (templates) => ipcRenderer.invoke('save-templates', templates),

  sendNow: (webhook) => ipcRenderer.invoke('send-now', webhook),
  getUUID: () => ipcRenderer.invoke('get-uuid'),
  scheduleExplicitTask: (task) => ipcRenderer.invoke('schedule-explicit-task', task),
  cancelExplicitTask: (taskId) => ipcRenderer.invoke('cancel-explicit-task', taskId),
  cancelTasksForWebhook: (webhookId) => ipcRenderer.invoke('cancel-tasks-for-webhook', webhookId),

  // --- 窗口控制 ---
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  // --- 其他功能 ---
  openExternalLink: (url) => ipcRenderer.send('open-external-link', url),

  // --- 备份与恢复API ---
  backupConfig: () => ipcRenderer.invoke('backup-config'),
  restoreConfig: () => ipcRenderer.invoke('restore-config'),

  // =========== 新增：开机启动设置API ===========
  getStartupSetting: () => ipcRenderer.invoke('get-startup-setting'),
  setStartupSetting: (shouldEnable) => ipcRenderer.invoke('set-startup-setting', shouldEnable),
});
