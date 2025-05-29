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
const APP_SECRET_STRING = 'nICleddY4Jl5*gD~w3B+dJx+SG3czmL6';
const APP_ENCRYPTION_KEY = crypto.createHash('sha256').update(APP_SECRET_STRING).digest();

const IV_LENGTH = 16;

function encryptText(text) {
    if (text === null || typeof text === 'undefined' || text === '') return text;
    if (typeof text === 'string' && text.includes(':') && text.split(':').length === 2) {
        const parts = text.split(':');
        if (parts[0].length === IV_LENGTH * 2 && /^[0-9a-fA-F]+$/.test(parts[0]) && /^[0-9a-fA-F]+$/.test(parts[1])) {
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
        return String(text);
    }
}

function decryptText(text) {
    if (!text || typeof text !== 'string' || !text.includes(':') || text.split(':').length !== 2) {
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
        return text;
    }
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
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
      defaults: { webhooks: [], webhookUrlTemplates: [], history: {}, scheduledTasks: [] },
      clearInvalidConfig: true,
    });
    console.log("[Main] electron-store initialized with encryption.");

    if (!ipcHandlersRegistered) registerIpcHandlers();

    const loadedTasks = store.get('scheduledTasks', []).map(task => ({
        ...task,
        finalUrl: decryptText(task.finalUrl),
        webhookSnapshot: task.webhookSnapshot ? { ...task.webhookSnapshot, url: decryptText(task.webhookSnapshot.url) } : undefined
    }));

    console.log(`[Main] Loaded ${loadedTasks.length} tasks for scheduler.`);
    const validTasks = [];
    const currentTime = Date.now();
    for (const task of loadedTasks) {
        if (new Date(task.scheduledTime).getTime() > currentTime) {
            validTasks.push(task);
            scheduleTaskWithTimeout(task);
        } else {
            console.log(`[Main] Discarding expired task on startup: ${task.webhookSnapshot?.name || task.id}`);
        }
    }
    if (validTasks.length < loadedTasks.length) {
        store.set('scheduledTasks', validTasks.map(task => ({
            ...task,
            finalUrl: encryptText(task.finalUrl),
            webhookSnapshot: task.webhookSnapshot ? { ...task.webhookSnapshot, url: encryptText(task.webhookSnapshot.url) } : undefined
        })));
    }

    createWindow();
    createTray();

  } catch (error) {
    console.error("[Main] Failed to initialize electron-store or app:", error);
    dialog.showErrorBox("应用初始化错误", `加载核心组件或配置文件失败: ${error.message}`);
    app.quit();
  }
}

function registerIpcHandlers() {
    if (ipcHandlersRegistered) return;
    ipcMain.handle('get-store-data', () => {
        if (!store) return { webhooks: [], webhookUrlTemplates: [], history: {}, scheduledTasks: [] };
        const templates = store.get('webhookUrlTemplates', []).map(t => ({ ...t, url: decryptText(t.url) }));
        const tasks = store.get('scheduledTasks', []).map(t => ({
            ...t,
            finalUrl: decryptText(t.finalUrl),
            webhookSnapshot: t.webhookSnapshot ? { ...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url) } : undefined
        }));
        const hist = {};
        const storedHistory = store.get('history', {});
        for (const id in storedHistory) {
            hist[id] = storedHistory[id].map(entry => entry.request?.url ? { ...entry, request: { ...entry.request, url: decryptText(entry.request.url) } } : entry);
        }
        return { webhooks: store.get('webhooks', []), webhookUrlTemplates: templates, history: hist, scheduledTasks: tasks };
    });
    ipcMain.handle('get-templates', () => store ? store.get('webhookUrlTemplates', []).map(t => ({ ...t, url: decryptText(t.url) })) : []);
    ipcMain.handle('save-templates', (event, templates) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        store.set('webhookUrlTemplates', templates.map(t => ({ ...t, url: encryptText(t.url) })));
        return { success: true };
    });
    ipcMain.handle('save-webhooks', (event, webhooks) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        store.set('webhooks', webhooks);
        return { success: true };
    });
    ipcMain.handle('send-now', async (event, webhook) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        if (!webhook || !webhook.url) return { success: false, msg: "无效的 webhook 配置或 URL 为空。" };
        return sendWebhookRequest(webhook);
    });
    ipcMain.handle('schedule-explicit-task', (event, task) => {
        if (!store) return { success: false, msg: "Store not initialized." };
        const encryptedTask = {
            ...task,
            finalUrl: encryptText(task.finalUrl),
            webhookSnapshot: task.webhookSnapshot ? { ...task.webhookSnapshot, url: encryptText(task.webhookSnapshot.url) } : undefined
        };
        const tasks = store.get('scheduledTasks', []);
        tasks.push(encryptedTask);
        store.set('scheduledTasks', tasks);
        scheduleTaskWithTimeout(task);
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('scheduled-tasks-update', tasks.map(t_1 => ({ ...t_1, finalUrl: decryptText(t_1.finalUrl), webhookSnapshot: t_1.webhookSnapshot ? { ...t_1.webhookSnapshot, url: decryptText(t_1.webhookSnapshot.url) } : undefined })).sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
        }
        return { success: true, taskId: task.id };
    });
    ipcMain.handle('backup-config', async () => {
        if (!store) return { success: false, msg: "Store not initialized." };
        const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, { title: '备份加密配置', defaultPath: `webhook-sender-backup-encrypted-${Date.now()}.json`, filters: [{ name: 'JSON Files', extensions: ['json'] }] });
        if (canceled || !filePath) return { success: false, msg: "用户取消了备份操作。" };
        try {
            fs.writeFileSync(filePath, JSON.stringify({ webhooks: store.get('webhooks', []), webhookUrlTemplates: store.get('webhookUrlTemplates', []), history: store.get('history', {}), scheduledTasks: store.get('scheduledTasks', []) }, null, 2));
            return { success: true, msg: `加密配置已成功备份到 ${filePath}` };
        } catch (error) {
            console.error('[Backup] 备份失败:', error);
            return { success: false, msg: `备份失败: ${error.message}` };
        }
    });
    ipcMain.handle('restore-config', async () => {
        if (!store) return { success: false, msg: "Store not initialized." };
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: '恢复加密配置', properties: ['openFile'], filters: [{ name: 'JSON Files', extensions: ['json'] }] });
        if (canceled || !filePaths?.length) return { success: false, msg: "用户取消了恢复操作。" };
        try {
            const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
            if (typeof data.webhooks === 'undefined' || typeof data.webhookUrlTemplates === 'undefined') return { success: false, msg: '文件格式无效。' };
            store.set('webhooks', data.webhooks || []);
            store.set('webhookUrlTemplates', data.webhookUrlTemplates || []);
            store.set('history', data.history || {});
            store.set('scheduledTasks', data.scheduledTasks || []);
            runningScheduledTimeouts.forEach(clearTimeout);
            runningScheduledTimeouts.clear();
            const tasks = store.get('scheduledTasks', []).map(t => ({ ...t, finalUrl: decryptText(t.finalUrl), webhookSnapshot: t.webhookSnapshot ? { ...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url) } : undefined }));
            const currentTime = Date.now();
            const validTasks = [];
            for (const task of tasks) {
                if (new Date(task.scheduledTime).getTime() > currentTime) {
                    validTasks.push(task);
                    scheduleTaskWithTimeout(task);
                }
            }
            if (validTasks.length < tasks.length) store.set('scheduledTasks', validTasks.map(t_1 => ({ ...t_1, finalUrl: encryptText(t_1.finalUrl), webhookSnapshot: t_1.webhookSnapshot ? { ...t_1.webhookSnapshot, url: encryptText(t_1.webhookSnapshot.url) } : undefined })));
            const rendererData = {
                webhooks: data.webhooks || [],
                webhookUrlTemplates: (data.webhookUrlTemplates || []).map(t_2 => ({ ...t_2, url: decryptText(t_2.url) })),
                history: {},
                scheduledTasks: validTasks
            };
            const restoredHistory = store.get('history', {});
            for (const id in restoredHistory) {
                rendererData.history[id] = restoredHistory[id].map(entry => entry.request?.url ? { ...entry, request: { ...entry.request, url: decryptText(entry.request.url) } } : entry);
            }
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('scheduled-tasks-update', rendererData.scheduledTasks.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
            }
            return { success: true, msg: '配置恢复成功！', data: rendererData };
        } catch (error) {
            console.error('[Restore] 恢复失败:', error);
            return { success: false, msg: `恢复失败: ${error.message}` };
        }
    });
    ipcMain.handle('get-startup-setting', () => app.isPackaged ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : false);
    ipcMain.handle('set-startup-setting', (event, enable) => {
        if (!app.isPackaged) return { success: true, msg: '开发模式下跳过。' };
        try {
            app.setLoginItemSettings({ openAtLogin: enable, openAsHidden: enable, args: enable ? ['--hidden'] : [] });
            return { success: true, msg: enable ? '已设置开机启动。' : '已取消开机启动。' };
        } catch (error) { return { success: false, msg: `设置失败: ${error.message}` }; }
    });
    ipcMain.on('window-minimize', () => mainWindow?.minimize());
    ipcMain.on('window-maximize', () => mainWindow && (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
    ipcMain.on('window-close', () => mainWindow && (!app.isQuitting ? mainWindow.hide() : mainWindow.close()));
    ipcMain.on('open-external-link', (event, url) => (url?.startsWith('http:') || url?.startsWith('https:')) && shell.openExternal(url));
    ipcMain.handle('get-uuid', uuidv4);
    ipcHandlersRegistered = true;
    console.log("[Main-IPC] IPC Handlers registered.");
}

// 用于主窗口图标和HTML内嵌图标 (从asar加载icon.png)
function getAppIconPath() {
    const basePath = app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
    return path.join(basePath, 'icon.png');
}

// 新增：专门用于获取托盘图标路径 (.ico 文件，作为 extraResource)
function getDedicatedTrayIconPath(iconFilename = 'tray_icon.ico') {
    if (app.isPackaged) {
        // process.resourcesPath 指向打包后应用的 resources 目录
        // "to": "app_icons/tray_icon.ico" (在 package.json extraResources 中定义)
        return path.join(process.resourcesPath, 'app_icons', iconFilename);
    } else {
        // 开发环境下，假设图标位于项目根目录下的 assets/tray_icons/
        // 并且 main.js 位于 electron/ 文件夹内
        return path.join(__dirname, '..', 'assets', 'tray_icons', iconFilename);
    }
}

function createWindow() {
    const windowIconPath = getAppIconPath(); // 主窗口继续使用 app.asar 内的 icon.png
    console.log(`[Main-Window] Attempting to load window icon from: ${windowIconPath}`);
    if (!fs.existsSync(windowIconPath)) console.error(`[Main-Window] Window icon file NOT FOUND at: ${windowIconPath}`);
    else console.log(`[Main-Window] Window icon file FOUND at: ${windowIconPath}`);

    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 940, minHeight: 600,
        frame: false, titleBarStyle: 'hidden', backgroundColor: '#171a21',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
        icon: windowIconPath,
        show: !shouldStartHidden
    });
    // mainWindow.webContents.openDevTools(); // 需要时取消注释以调试主进程
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
    mainWindow.on('close', (event) => { if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.on('closed', () => mainWindow = null);
    mainWindow.webContents.once('did-finish-load', () => {
        if (store) {
            const tasks = store.get('scheduledTasks', []).map(t => ({ ...t, finalUrl: decryptText(t.finalUrl), webhookSnapshot: t.webhookSnapshot ? { ...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url) } : undefined }));
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                 mainWindow.webContents.send('scheduled-tasks-update', tasks.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
            }
        }
        if (shouldStartHidden && mainWindow?.isVisible()) mainWindow.hide();
    });
}

function createTray() {
    if (tray) return;
    // 使用新的函数获取专用托盘图标路径
    const trayIconPath = getDedicatedTrayIconPath('tray_icon.ico'); // 确保文件名与您实际使用的匹配
    console.log(`[Main-Tray] Attempting to load dedicated tray icon from: ${trayIconPath}`);

    if (!fs.existsSync(trayIconPath)) {
        console.error(`[Main-Tray] Dedicated Tray Icon file NOT FOUND at: ${trayIconPath}. Tray will not be created.`);
        return;
    }
    console.log(`[Main-Tray] Dedicated Tray Icon file FOUND at: ${trayIconPath}`);

    let iconImage;
    try {
        // 对于 .ico 文件，通常直接从路径创建更稳定
        iconImage = nativeImage.createFromPath(trayIconPath);
        console.log(`[Main-Tray] Successfully created nativeImage from path for dedicated tray icon. Path: ${trayIconPath}. Is empty: ${iconImage.isEmpty()}`);
    } catch (error) {
        console.error(`[Main-Tray] Error creating nativeImage from path for dedicated tray icon: ${trayIconPath}`, error);
        return;
    }

    if (iconImage.isEmpty()) {
        console.error(`[Main-Tray] Loaded dedicated tray icon is empty. Path: ${trayIconPath}.`);
        return;
    }

    try {
        tray = new Tray(iconImage);
    } catch (error) {
        console.error(`[Main-Tray] Error creating Tray object with dedicated icon from: ${trayIconPath}`, error);
        return;
    }

    const contextMenu = Menu.buildFromTemplate([
        { label: '显示/隐藏窗口', click: () => { if (mainWindow) { mainWindow.isVisible() && mainWindow.isFocused() ? mainWindow.hide() : (mainWindow.show(), mainWindow.focus()); } else { createWindow(); } } },
        { type: 'separator' },
        { label: '退出', click: () => { app.isQuitting = true; app.quit(); } },
    ]);
    tray.setToolTip('Webhook Sender');
    tray.setContextMenu(contextMenu);
    tray.on('click', () => { if (mainWindow) { mainWindow.isVisible() ? mainWindow.focus() : (mainWindow.show(), mainWindow.focus()); } else { createWindow(); } });
    console.log("[Main-Tray] System tray icon created successfully with dedicated icon.");
}

async function sendWebhookRequest(payload) {
    if (!store) return { id: payload.id || uuidv4(), webhookId: payload.originalWebhookId || payload.id, status: 'failure', error: { msg: "Store not ready." }, timestamp: new Date().toISOString() };
    const historyId = uuidv4();
    const { url, method, headers, body, name, originalWebhookId, webhookSnapshot } = payload;
    const webhookName = name || webhookSnapshot?.name || 'Unnamed Task';
    const idForHistory = originalWebhookId || payload.id;
    const plainBody = webhookSnapshot?.plainBody || (typeof body === 'string' && body.startsWith('{"msg":')) ? JSON.parse(body).msg : body;

    if (typeof url !== 'string' || !url.trim()) {
        const errEntry = { id: historyId, webhookId: idForHistory, status: 'failure', timestamp: new Date().toISOString(), request: { url: encryptText(String(url)), method, headers, body, plainBody }, error: { message: "URL invalid pre-request" } };
        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('history-updated', { webhookId: errEntry.webhookId, entry: { ...errEntry, request: { ...errEntry.request, url: String(url) } } });
        const hist = store.get(`history.${errEntry.webhookId}`, []); hist.unshift(errEntry); store.set(`history.${errEntry.webhookId}`, hist.slice(0, 50));
        return errEntry;
    }

    const encryptedRequest = { url: encryptText(url), method, headers, body, plainBody };
    let entry = { id: historyId, webhookId: idForHistory, status: 'pending', timestamp: new Date().toISOString(), request: encryptedRequest };
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: { ...entry, request: { ...entry.request, url } } });

    try {
        const response = await axios({ method, url, headers: (headers || []).reduce((acc, cur) => cur.key ? (acc[cur.key] = cur.value, acc) : acc, {}), data: (typeof body === 'string' ? (body.startsWith('{') || body.startsWith('[')) ? JSON.parse(body) : body : body), timeout: 15000 });
        entry.status = 'success';
        entry.response = { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data };
    } catch (error) {
        entry.status = 'failure';
        if (error.response) entry.error = { message: error.message, code: error.code, status: error.response.status, headers: error.response.headers, data: error.response.data };
        else if (error.request) entry.error = { message: error.message, code: error.code, requestDetails: "No response" };
        else entry.error = { message: error.message, code: error.code, details: "Setup error" };
    }
    const hist_1 = store.get(`history.${idForHistory}`, []); hist_1.unshift(entry); store.set(`history.${idForHistory}`, hist_1.slice(0, 50));
    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: { ...entry, request: { ...entry.request, url } } });
    return entry;
}

function scheduleTaskWithTimeout(taskConfig) {
    const { id, webhookSnapshot, finalUrl, scheduledTime, originalWebhookId } = taskConfig;
    const webhookName = webhookSnapshot?.name || `Task ID ${id}`;

    if (!finalUrl || typeof finalUrl !== 'string' || !finalUrl.trim()) { console.error(`[Scheduler] Task ${id} invalid finalUrl: "${finalUrl}".`); return; }
    if (!webhookSnapshot?.bodyTemplate || typeof webhookSnapshot.bodyTemplate !== 'string') { console.error(`[Scheduler] Task ${id} missing snapshot/bodyTemplate.`); return; }

    if (runningScheduledTimeouts.has(id)) { clearTimeout(runningScheduledTimeouts.get(id)); runningScheduledTimeouts.delete(id); }

    const delay = new Date(scheduledTime).getTime() - Date.now();
    if (delay > 0) {
        const timerId = setTimeout(async () => {
            const { plainBody, phoneNumber, bodyTemplate, method, headers, name } = webhookSnapshot;
            let finalBody = bodyTemplate.replace(/{phoneNumber}|{phone}/g, (phoneNumber || "").replace(/"/g, '\\"'));
            finalBody = finalBody.replace(/{userMessage}/g, (plainBody || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
            await sendWebhookRequest({ id, originalWebhookId, url: finalUrl, method, headers, body: finalBody, name, webhookSnapshot });
            const tasks = store.get('scheduledTasks', []).filter(t => t.id !== id);
            store.set('scheduledTasks', tasks);
            runningScheduledTimeouts.delete(id);
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('scheduled-tasks-update', tasks.map(t_1 => ({ ...t_1, finalUrl: decryptText(t_1.finalUrl), webhookSnapshot: t_1.webhookSnapshot ? { ...t_1.webhookSnapshot, url: decryptText(t_1.webhookSnapshot.url) } : undefined })).sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
            }
        }, delay);
        runningScheduledTimeouts.set(id, timerId);
    } else {
        console.warn(`[Scheduler] Task "${webhookName}" (ID: ${id}) is past. Removing.`);
        const tasks_1 = store.get('scheduledTasks', []).filter(t => t.id !== id);
        if (tasks_1.length < store.get('scheduledTasks', []).length) {
            store.set('scheduledTasks', tasks_1);
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('scheduled-tasks-update', tasks_1.map(t_2 => ({ ...t_2, finalUrl: decryptText(t_2.finalUrl), webhookSnapshot: t_2.webhookSnapshot ? { ...t_2.webhookSnapshot, url: decryptText(t_2.webhookSnapshot.url) } : undefined })).sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
            }
        }
    }
}
