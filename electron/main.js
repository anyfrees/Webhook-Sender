// ===================================================================================
// Webhook Sender - Main Process Logic
// ===================================================================================

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto'); 

let Store;
let store;

let mainWindow;
let tray = null;
const runningScheduledTimeouts = new Map();
let ipcHandlersRegistered = false;

const shouldStartHidden = process.argv.includes('--hidden');

// --- 密钥和加密函数 ---
// 警告：这个密钥字符串需要您替换为一个自己定义的、足够复杂的字符串。
// 应用将使用这个字符串派生出实际的加密密钥。
const APP_SECRET_STRING = 'nICleddY4Jl5*gD~w3B+dJx+SG3czmL6'; 
// 从密钥字符串派生出32字节的加密密钥 (Buffer)
const APP_ENCRYPTION_KEY = crypto.createHash('sha256').update(APP_SECRET_STRING).digest(); // .digest()默认返回Buffer

const IV_LENGTH = 16; // AES块大小通常是16字节

function encryptText(text) {
    if (text === null || typeof text === 'undefined' || text === '') return text;
    // 避免对已经是 "iv:ciphertext" 格式的文本重复加密 (简单检查)
    if (typeof text === 'string' && text.includes(':') && text.split(':').length === 2) {
        const parts = text.split(':');
        if (parts[0].length === IV_LENGTH * 2 && /^[0-9a-fA-F]+$/.test(parts[0]) && /^[0-9a-fA-F]+$/.test(parts[1])) {
            // console.warn('Attempting to encrypt already encrypted-like string, returning as is:', text.substring(0,50) + "...");
            return text; 
        }
    }

    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const cipher = crypto.createCipheriv('aes-256-cbc', APP_ENCRYPTION_KEY, iv);
        let encrypted = cipher.update(String(text), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return iv.toString('hex') + ':' + encrypted;
    } catch (error) {
        console.error('加密文本失败:', error, '输入:', text);
        return String(text); // 加密失败返回原字符串
    }
}

function decryptText(text) {
    if (!text || typeof text !== 'string' || !text.includes(':') || text.split(':').length !== 2) {
        // console.log('解密文本格式无效或为空，返回原文:', text);
        return text; 
    }
    try {
        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = Buffer.from(parts[1], 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', APP_ENCRYPTION_KEY, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        // console.error('解密文本失败 (可能已经是明文或密钥不匹配):', error, '尝试解密的文本:', text.substring(0, 50) + "..."); 
        return text; 
    }
}

// --- 单实例锁 ---
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    if (mainWindow) {
      if (mainWindow.isMinimized() || !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.restore();
      }
      mainWindow.focus();
    }
  });

  app.whenReady().then(initializeStoreAndApp);

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('activate', () => { 
    if (BrowserWindow.getAllWindows().length === 0) {
      if (store) {
        createWindow();
      } else {
        initializeStoreAndApp().then(() => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        }).catch(err => console.error("[Main] Failed to re-init store on activate:", err));
      }
    } else if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show();
        mainWindow.focus();
    } else if (mainWindow) {
        mainWindow.focus();
    }
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    if (tray) {
      tray.destroy();
    }
  });
}


async function initializeStoreAndApp() {
  try {
    Store = (await import('electron-store')).default;
    store = new Store({
      encryptionKey: APP_ENCRYPTION_KEY, 
      defaults: {
          webhooks: [], 
          webhookUrlTemplates: [], 
          history: {}, 
          scheduledTasks: []
      },
      clearInvalidConfig: true, 
    });
    console.log("[Main] electron-store initialized with encryption.");
    
    if (!ipcHandlersRegistered) {
        registerIpcHandlers();
    }

    const loadedTasksEncryptedInternals = store.get('scheduledTasks', []);
    const loadedTasksDecryptedForScheduler = loadedTasksEncryptedInternals.map(task => ({
        ...task,
        finalUrl: decryptText(task.finalUrl),
        webhookSnapshot: task.webhookSnapshot ? {
            ...task.webhookSnapshot,
            url: decryptText(task.webhookSnapshot.url) 
        } : undefined
    }));

    console.log(`[Main] Loaded ${loadedTasksDecryptedForScheduler.length} tasks for scheduler.`);
    const validTasksForScheduler = [];
    const currentTime = new Date().getTime();
    for (const task of loadedTasksDecryptedForScheduler) { 
        if (new Date(task.scheduledTime).getTime() > currentTime) {
            validTasksForScheduler.push(task);
            scheduleTaskWithTimeout(task); 
        } else {
            console.log(`[Main] Discarding expired task on startup: ${task.webhookSnapshot?.name || task.id}`);
        }
    }
    if (validTasksForScheduler.length < loadedTasksEncryptedInternals.length) {
        const validTasksToStore = validTasksForScheduler.map(task => ({
            ...task, 
            finalUrl: encryptText(task.finalUrl), 
            webhookSnapshot: task.webhookSnapshot ? {
                ...task.webhookSnapshot,
                url: encryptText(task.webhookSnapshot.url) 
            } : undefined
        }));
        store.set('scheduledTasks', validTasksToStore);
    }

    createWindow(); 
    createTray();

  } catch (error) {
    console.error("[Main] Failed to initialize electron-store or app:", error);
    dialog.showErrorBox("应用初始化错误", "加载核心组件或配置文件失败，可能是由于配置文件损坏或加密密钥不匹配。\n\n错误详情: " + error.message + "\n\n您可以尝试删除应用的配置文件后重启应用。配置文件通常位于用户目录下的 AppData\\Roaming\\webhook-sender (Windows) 或 ~/.config/webhook-sender (Linux/macOS)。");
    app.quit();
  }
}


function registerIpcHandlers() {
    if (ipcHandlersRegistered) {
        return;
    }
    
    ipcMain.handle('get-store-data', () => {
        if (!store) return { webhooks: [], webhookUrlTemplates: [], history: {}, scheduledTasks: [] };
        const templatesFromStore = store.get('webhookUrlTemplates', []);
        const tasksFromStore = store.get('scheduledTasks', []);
        const historyFromStore = store.get('history', {});

        const decryptedTemplates = templatesFromStore.map(t => ({...t, url: decryptText(t.url)}));
        const decryptedTasks = tasksFromStore.map(t => ({
            ...t, 
            finalUrl: decryptText(t.finalUrl), 
            webhookSnapshot: t.webhookSnapshot ? {
                ...t.webhookSnapshot, 
                url: decryptText(t.webhookSnapshot.url)
            } : undefined 
        }));
        const decryptedHistory = {};
        for (const webhookId in historyFromStore) {
            decryptedHistory[webhookId] = historyFromStore[webhookId].map(entry => {
                if (entry.request && entry.request.url) {
                    return { ...entry, request: { ...entry.request, url: decryptText(entry.request.url) } };
                }
                return entry;
            });
        }

        return {
            webhooks: store.get('webhooks', []), 
            webhookUrlTemplates: decryptedTemplates,
            history: decryptedHistory,
            scheduledTasks: decryptedTasks
        };
    });

    ipcMain.handle('get-templates', () => {
        if (!store) return [];
        const templatesFromStore = store.get('webhookUrlTemplates', []);
        return templatesFromStore.map(t => ({ ...t, url: decryptText(t.url) }));
    });

    ipcMain.handle('save-templates', (event, templatesToSave ) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        const encryptedTemplates = templatesToSave.map(t => ({
            ...t,
            url: encryptText(t.url) 
        }));
        store.set('webhookUrlTemplates', encryptedTemplates); 
        return { success: true };
    });

    ipcMain.handle('save-webhooks', (event, webhooksToSave) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        store.set('webhooks', webhooksToSave);
        return { success: true };
    });

    ipcMain.handle('send-now', async (event, webhookToSend ) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        if (!webhookToSend || !webhookToSend.url) {
            return { success: false, msg: "无效的 webhook 配置或 URL 为空。" };
        }
        return await sendWebhookRequest(webhookToSend); 
    });

    ipcMain.handle('schedule-explicit-task', (event, taskToSchedule ) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        const encryptedTask = { 
            ...taskToSchedule,
            finalUrl: encryptText(taskToSchedule.finalUrl),
            webhookSnapshot: taskToSchedule.webhookSnapshot ? {
                ...taskToSchedule.webhookSnapshot,
                url: encryptText(taskToSchedule.webhookSnapshot.url) 
            } : undefined
        };
        const allTasksCurrentlyInStore = store.get('scheduledTasks', []); 
        allTasksCurrentlyInStore.push(encryptedTask); 
        store.set('scheduledTasks', allTasksCurrentlyInStore);

        scheduleTaskWithTimeout(taskToSchedule); 
        
        const tasksForRenderer = allTasksCurrentlyInStore.map(t => ({
            ...t, 
            finalUrl: decryptText(t.finalUrl), 
            webhookSnapshot: t.webhookSnapshot ? {
                ...t.webhookSnapshot, 
                url: decryptText(t.webhookSnapshot.url)
            } : undefined 
        }));
        if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer.sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
        }
        return { success: true, taskId: taskToSchedule.id };
    });
    
    ipcMain.handle('backup-config', async () => {
        if (!store) return { success: false, msg: "Store not initialized." };
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
            title: '备份加密配置',
            defaultPath: `webhook-sender-backup-encrypted-${Date.now()}.json`,
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });
        if (canceled || !filePath) {
            return { success: false, msg: "用户取消了备份操作。" };
        }
        try {
            const backupData = {
                webhooks: store.get('webhooks', []), 
                webhookUrlTemplates: store.get('webhookUrlTemplates', []), 
                history: store.get('history', {}), 
                scheduledTasks: store.get('scheduledTasks', []) 
            };
            fs.writeFileSync(filePath, JSON.stringify(backupData, null, 2));
            return { success: true, msg: `加密配置已成功备份到 ${filePath}` };
        } catch (error) {
            console.error('[Backup] 备份失败:', error);
            return { success: false, msg: `备份失败: ${error.message}` };
        }
    });

    ipcMain.handle('restore-config', async () => {
        if (!store) return { success: false, msg: "Store not initialized." };
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
            title: '恢复加密配置',
            properties: ['openFile'],
            filters: [{ name: 'JSON Files', extensions: ['json'] }]
        });
        if (canceled || filePaths.length === 0) {
            return { success: false, msg: "用户取消了恢复操作。" };
        }
        try {
            const filePath = filePaths[0];
            const fileContent = fs.readFileSync(filePath, 'utf-8');
            const restoredDataWithEncryptedUrls = JSON.parse(fileContent); 

            if (typeof restoredDataWithEncryptedUrls.webhooks === 'undefined' || 
                typeof restoredDataWithEncryptedUrls.webhookUrlTemplates === 'undefined') {
                 return { success: false, msg: '文件格式无效，不是一个有效的备份文件。' };
            }
            store.set('webhooks', restoredDataWithEncryptedUrls.webhooks || []);
            store.set('webhookUrlTemplates', restoredDataWithEncryptedUrls.webhookUrlTemplates || []);
            store.set('history', restoredDataWithEncryptedUrls.history || {});
            store.set('scheduledTasks', restoredDataWithEncryptedUrls.scheduledTasks || []);
            
            runningScheduledTimeouts.forEach(timeoutId => clearTimeout(timeoutId));
            runningScheduledTimeouts.clear();
            
            const tasksToRescheduleEncryptedUrls = store.get('scheduledTasks', []); 
            const tasksToRescheduleDecrypted = tasksToRescheduleEncryptedUrls.map(t => ({
                ...t,
                finalUrl: decryptText(t.finalUrl), 
                webhookSnapshot: t.webhookSnapshot ? {
                    ...t.webhookSnapshot,
                    url: decryptText(t.webhookSnapshot.url) 
                } : undefined
            }));

            const currentTime = new Date().getTime();
            const validTasksForReschedule = [];
            for (const task of tasksToRescheduleDecrypted) { 
                if (new Date(task.scheduledTime).getTime() > currentTime) {
                    validTasksForReschedule.push(task); 
                    scheduleTaskWithTimeout(task);    
                }
            }
            if (validTasksForReschedule.length < tasksToRescheduleEncryptedUrls.length) {
                const validTasksToStore = validTasksForReschedule.map(task => ({
                    ...task, 
                    finalUrl: encryptText(task.finalUrl), 
                    webhookSnapshot: task.webhookSnapshot ? {
                        ...task.webhookSnapshot,
                        url: encryptText(task.webhookSnapshot.url) 
                    } : undefined
                }));
                store.set('scheduledTasks', validTasksToStore);
            }

            const dataForRenderer = {
                webhooks: restoredDataWithEncryptedUrls.webhooks || [],
                webhookUrlTemplates: (restoredDataWithEncryptedUrls.webhookUrlTemplates || []).map(t => ({...t, url: decryptText(t.url)})),
                history: {}, 
                scheduledTasks: validTasksForReschedule 
            };
            const historyFromStoreAfterRestore = store.get('history', {}); 
            for (const webhookId in historyFromStoreAfterRestore) {
                dataForRenderer.history[webhookId] = historyFromStoreAfterRestore[webhookId].map(entry => {
                    if (entry.request && entry.request.url) {
                        return { ...entry, request: { ...entry.request, url: decryptText(entry.request.url) } };
                    }
                    return entry;
                });
            }

             if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('scheduled-tasks-update', dataForRenderer.scheduledTasks.sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
            }
            return { success: true, msg: '配置恢复成功！应用将重新加载数据。', data: dataForRenderer };
        } catch (error) {
            console.error('[Restore] 恢复失败:', error);
            return { success: false, msg: `恢复失败: ${error.message}` };
        }
    });
    
    ipcMain.handle('get-startup-setting', () => {
        if (!app.isPackaged) { return false; }
        try {
            const settings = app.getLoginItemSettings({ args: ['--hidden'] });
            return settings.openAtLogin;
        } catch (error) { return false; }
    });

    ipcMain.handle('set-startup-setting', (event, enable) => {
        if (!app.isPackaged) { return { success: true, msg: '开发模式下跳过开机启动设置。' }; }
        try {
            app.setLoginItemSettings({ openAtLogin: enable, openAsHidden: enable, args: enable ? ['--hidden'] : [] });
            return { success: true, msg: enable ? '已设置为开机启动。' : '已取消开机启动。' };
        } catch (error) { return { success: false, msg: `设置开机启动失败: ${error.message}` }; }
    });

    ipcMain.on('window-minimize', () => { if (mainWindow) mainWindow.minimize(); });
    ipcMain.on('window-maximize', () => { if (mainWindow) { if (mainWindow.isMaximized()) { mainWindow.unmaximize(); } else { mainWindow.maximize(); } } });
    ipcMain.on('window-close', () => { if (mainWindow) { if (!app.isQuitting) { mainWindow.hide(); } else { mainWindow.close(); } } });
    ipcMain.on('open-external-link', (event, url) => { if (url && (url.startsWith('http:') || url.startsWith('https:'))) { shell.openExternal(url); } else { console.warn(`[IPC] Attempted to open invalid or insecure link: ${url}`); } });
    ipcMain.handle('get-uuid', () => { return uuidv4(); });

    ipcHandlersRegistered = true;
    console.log("[Main-IPC] IPC Handlers registered.");
}

function createWindow() {
    const iconPath = path.join(__dirname, '..', 'public', 'icon.png');
    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 940, minHeight: 600,
        frame: false, titleBarStyle: 'hidden', backgroundColor: '#171a21',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, },
        icon: iconPath, show: !shouldStartHidden 
    });
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
    mainWindow.on('close', (event) => { if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.on('closed', () => { mainWindow = null; });
    mainWindow.webContents.once('did-finish-load', () => {
        if (store) {
            const tasksEncryptedUrl = store.get('scheduledTasks', []);
            const tasksForRenderer = tasksEncryptedUrl.map(t => ({ ...t, finalUrl: decryptText(t.finalUrl), webhookSnapshot: t.webhookSnapshot ? { ...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url) } : undefined }));
            if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
                 mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer.sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
            }
        }
        if (shouldStartHidden && mainWindow && mainWindow.isVisible()) { mainWindow.hide(); }
    });
}

function createTray() {
    if (tray) { return; }
    let iconPath;
    const iconFileName = 'icon.png';
    if (!app.isPackaged) { iconPath = path.join(__dirname, '..', 'public', iconFileName); } 
    else { iconPath = path.join(process.resourcesPath, 'public', iconFileName); if (!fs.existsSync(iconPath)) { iconPath = path.join(process.resourcesPath, iconFileName); } }
    if (!fs.existsSync(iconPath)) { try { tray = new Tray(nativeImage.createEmpty()); } catch (e) { return; } } 
    else { const icon = nativeImage.createFromPath(iconPath); if (icon.isEmpty()) { return; } tray = new Tray(icon); }
    const contextMenu = Menu.buildFromTemplate([
        { label: '显示/隐藏窗口', click: () => { if (mainWindow) { if (mainWindow.isVisible() && mainWindow.isFocused()) { mainWindow.hide(); } else { mainWindow.show(); mainWindow.focus(); } } else { createWindow(); } } },
        { type: 'separator' }, { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    tray.setToolTip('Webhook Sender'); tray.setContextMenu(contextMenu);
    tray.on('click', () => { if (mainWindow) { if (mainWindow.isVisible()) { mainWindow.focus(); } else { mainWindow.show(); mainWindow.focus(); } } else { createWindow(); } });
    console.log("[Main-Tray] System tray icon created successfully.");
}

async function sendWebhookRequest(payload) { // payload.url is plaintext
    if (!store) return { id: payload.id || uuidv4(), webhookId: payload.originalWebhookId || payload.id, status: 'failure', error: { msg: "Store not ready." }, timestamp: new Date().toISOString() };
    const historyId = uuidv4();
    const { url: urlToSend, method: methodToSend, headers: headersToSend, body: bodyToSend, name, originalWebhookId, webhookSnapshot } = payload;
    const webhookName = name || webhookSnapshot?.name || 'Unnamed Task';
    const idForHistory = originalWebhookId || payload.id;
    const plainBodyForHistory = webhookSnapshot?.plainBody || (typeof bodyToSend === 'string' && bodyToSend.startsWith('{"msg":')) ? JSON.parse(bodyToSend).msg : bodyToSend;

    if (typeof urlToSend !== 'string' || urlToSend.trim() === '') {
        const errEntry = { id: historyId, webhookId: idForHistory, status: 'failure', timestamp: new Date().toISOString(), request: { url: encryptText(String(urlToSend)), method: methodToSend, headers: headersToSend, body: bodyToSend, plainBody: plainBodyForHistory }, error: { message: "URL invalid pre-request" } };
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) { mainWindow.webContents.send('history-updated', { webhookId: errEntry.webhookId, entry: {...errEntry, request: {...errEntry.request, url: String(urlToSend) }} }); }
        const currentErrHistory = store.get(`history.${errEntry.webhookId}`, []); currentErrHistory.unshift(errEntry); store.set(`history.${errEntry.webhookId}`, currentErrHistory.slice(0, 50));
        return errEntry;
    }

    const historyEntryRequestEncrypted = { url: encryptText(urlToSend), method: methodToSend, headers: headersToSend, body: bodyToSend, plainBody: plainBodyForHistory };
    let historyEntry = { id: historyId, webhookId: idForHistory, status: 'pending', timestamp: new Date().toISOString(), request: historyEntryRequestEncrypted };
    
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) { 
        mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: {...historyEntry, request: {...historyEntry.request, url: urlToSend}} }); 
    }

    try {
        let requestData = bodyToSend;
        try { requestData = JSON.parse(bodyToSend); } catch (e) { /* ignore */ }
        const response = await axios({ method: methodToSend, url: urlToSend, headers: (headersToSend || []).reduce((acc, cur) => { if (cur.key) acc[cur.key] = cur.value; return acc; }, {}), data: requestData, timeout: 15000 });
        historyEntry.status = 'success';
        historyEntry.response = { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data };
    } catch (error) {
        historyEntry.status = 'failure';
        if (error.response) { historyEntry.error = { message: error.message, code: error.code, status: error.response.status, headers: error.response.headers, data: error.response.data }; }
        else if (error.request) { historyEntry.error = { message: error.message, code: error.code, requestDetails: "No response"}; }
        else { historyEntry.error = { message: error.message, code: error.code, details: "Setup error" }; }
    }
    const currentHistory = store.get(`history.${idForHistory}`, []); 
    currentHistory.unshift(historyEntry); 
    store.set(`history.${idForHistory}`, currentHistory.slice(0, 50));
    
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
         mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: {...historyEntry, request: {...historyEntry.request, url: urlToSend}} }); 
    }
    return historyEntry; 
}

function scheduleTaskWithTimeout(taskConfig) { // taskConfig URLs are plaintext
    const taskId = taskConfig.id;
    const webhookName = taskConfig.webhookSnapshot?.name || `Task ID ${taskId}`;
    
    if (!taskConfig.finalUrl || typeof taskConfig.finalUrl !== 'string' || taskConfig.finalUrl.trim() === '') {
        console.error(`[Scheduler] Task ${taskId} invalid finalUrl: "${taskConfig.finalUrl}".`); return;
    }
    if (!taskConfig.webhookSnapshot || typeof taskConfig.webhookSnapshot.bodyTemplate !== 'string') {
        console.error(`[Scheduler] Task ${taskId} missing snapshot/bodyTemplate.`); return;
    }

    if (runningScheduledTimeouts.has(taskId)) { clearTimeout(runningScheduledTimeouts.get(taskId)); runningScheduledTimeouts.delete(taskId); }
    
    const delay = new Date(taskConfig.scheduledTime).getTime() - new Date().getTime();
    if (delay > 0) {
        const timerId = setTimeout(async () => {
            const { webhookSnapshot, finalUrl, originalWebhookId, id } = taskConfig;
            const { plainBody, phoneNumber, bodyTemplate, method, headers, name } = webhookSnapshot;
            
            let finalBodyToSend = bodyTemplate.replace(/{phoneNumber}/g, (phoneNumber || "").replace(/"/g, '\\"'))
                                             .replace(/{phone}/g, (phoneNumber || "").replace(/"/g, '\\"'));
            const escapedUserMessage = (plainBody || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
            finalBodyToSend = finalBodyToSend.replace(/{userMessage}/g, escapedUserMessage);

            await sendWebhookRequest({ id, originalWebhookId, url: finalUrl, method, headers, body: finalBodyToSend, name, webhookSnapshot });
            
            const currentTasksEncrypted = store.get('scheduledTasks', []);
            const updatedTasksEncrypted = currentTasksEncrypted.filter(t => t.id !== taskId);
            store.set('scheduledTasks', updatedTasksEncrypted);
            runningScheduledTimeouts.delete(taskId); 
            
            const tasksForRenderer = updatedTasksEncrypted.map(t => ({...t, finalUrl: decryptText(t.finalUrl), webhookSnapshot: t.webhookSnapshot ? {...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url)}: undefined }));
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) { 
                mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer.sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))); 
            }
        }, delay);
        runningScheduledTimeouts.set(taskId, timerId);
    } else {
        console.warn(`[Scheduler] Task "${webhookName}" (ID: ${taskId}) is past. Removing.`);
        const currentTasksEncrypted = store.get('scheduledTasks', []);
        const updatedTasksEncrypted = currentTasksEncrypted.filter(t => t.id !== taskId);
        if (updatedTasksEncrypted.length < currentTasksEncrypted.length) {
            store.set('scheduledTasks', updatedTasksEncrypted);
            const tasksForRenderer = updatedTasksEncrypted.map(t => ({...t, finalUrl: decryptText(t.finalUrl), webhookSnapshot: t.webhookSnapshot ? {...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url)}: undefined }));
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) { 
                mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer.sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime))); 
            } 
        }
    }
}
