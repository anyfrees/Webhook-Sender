// ===================================================================================
// Webhook Sender - Main Process Logic (with WorkWeixin Support & Token Cache Fix)
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
const APP_SECRET_STRING = 'nICleddY4Jl5*gD~w3B+dJx+SG3czmL6'; // 请确保这是一个强密钥并在生产中妥善保管
const APP_ENCRYPTION_KEY = crypto.createHash('sha256').update(APP_SECRET_STRING).digest();

const IV_LENGTH = 16; // For AES, this is always 16

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


// --- 企业微信 Token 缓存 ---
const workweixinTokenCache = new Map(); // 缓存结构: { cacheKey: { token: 'xxx', expiresAt: timestamp } }

async function getWorkWeixinToken(corpid, encryptedCorpSecret) {
    if (!corpid || !encryptedCorpSecret) {
        throw new Error('获取企业微信Token需要CorpID和CorpSecret。');
    }
    const plainCorpSecret = decryptText(encryptedCorpSecret);

    if (!plainCorpSecret) { // 如果解密后为空字符串或null/undefined
        console.error('[Main-WorkWeixin] CorpSecret为空或解密失败，无法获取Token。Encrypted Secret (start):', encryptedCorpSecret ? encryptedCorpSecret.substring(0,10) + "..." : "N/A");
        throw new Error('CorpSecret为空或解密失败，无法获取Token。');
    }
    // 如果解密后和原来一样（且不是空），说明可能没加密或者解密密钥不对/IV不对
    if (plainCorpSecret === encryptedCorpSecret && plainCorpSecret !== '') {
         console.error('[Main-WorkWeixin] CorpSecret解密失败或格式不正确。Encrypted Secret (start):', encryptedCorpSecret.substring(0,10) + "...");
         throw new Error('CorpSecret解密失败或格式不正确。');
    }


    // 使用 corpid 和 plainCorpSecret 的哈希作为缓存键，确保唯一性
    const cacheKey = `${corpid}_${crypto.createHash('md5').update(plainCorpSecret).digest('hex')}`;

    const cached = workweixinTokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
        console.log(`[Main-WorkWeixin] 使用缓存的Token (CacheKey: ${cacheKey})`);
        return cached.token;
    }

    console.log(`[Main-WorkWeixin] 正在为 CacheKey: ${cacheKey} (CorpID: ${corpid}) 获取新的Token...`);
    try {
        const response = await axios.get(`https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${corpid}&corpsecret=${plainCorpSecret}`);
        if (response.data && response.data.access_token) {
            const token = response.data.access_token;
            const expiresIn = response.data.expires_in || 7200;
            workweixinTokenCache.set(cacheKey, {
                token: token,
                expiresAt: Date.now() + (expiresIn - 300) * 1000
            });
            console.log(`[Main-WorkWeixin] CacheKey: ${cacheKey} 的新Token获取成功并已缓存。`);
            return token;
        } else {
            const errorMsg = `获取企业微信Token失败: ${response.data.errmsg || '未知错误'} (错误码: ${response.data.errcode})`;
            console.error(errorMsg, response.data);
            throw new Error(errorMsg);
        }
    } catch (error) {
        const errorMessage = error.response ? JSON.stringify(error.response.data) : error.message;
        console.error('[Main-WorkWeixin] 获取Token时发生错误:', errorMessage);
        throw new Error(`获取企业微信Token时发生错误: ${errorMessage}`);
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
        }).catch(err => console.error("[Main] 在activate事件中重新初始化store失败:", err));
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
    console.log("[Main] electron-store 初始化成功 (带加密)。");

    if (!ipcHandlersRegistered) registerIpcHandlers();

    const loadedTasks = store.get('scheduledTasks', []).map(task => {
        const decryptedTask = {
            ...task,
            finalUrl: decryptText(task.finalUrl),
            webhookSnapshot: task.webhookSnapshot ? { ...task.webhookSnapshot, url: decryptText(task.webhookSnapshot.url) } : undefined
        };
        if (task.templateType === 'workweixin' && task.workweixinConfig) {
            decryptedTask.workweixinConfig = {
                ...task.workweixinConfig, // corpsecret 保持加密状态
                corpid: decryptText(task.workweixinConfig.corpid),
                agentid: decryptText(task.workweixinConfig.agentid),
            };
        }
        return decryptedTask;
    });


    console.log(`[Main] 加载了 ${loadedTasks.length} 个任务进行调度。`);
    const validTasks = [];
    const currentTime = Date.now();
    for (const task of loadedTasks) {
        if (new Date(task.scheduledTime).getTime() > currentTime) {
            validTasks.push(task);
            scheduleTaskWithTimeout(task);
        } else {
            console.log(`[Main] 启动时丢弃过期任务: ${task.webhookSnapshot?.name || task.id}`);
        }
    }
    if (validTasks.length < loadedTasks.length) {
        store.set('scheduledTasks', validTasks.map(task => {
            const taskToStore = {
                ...task,
                finalUrl: encryptText(task.finalUrl),
                webhookSnapshot: task.webhookSnapshot ? { ...task.webhookSnapshot, url: encryptText(task.webhookSnapshot.url) } : undefined
            };
            if (task.templateType === 'workweixin' && task.workweixinConfig) {
                taskToStore.workweixinConfig = {
                    ...task.workweixinConfig,
                    corpid: encryptText(task.workweixinConfig.corpid),
                    agentid: encryptText(task.workweixinConfig.agentid),
                };
            }
            return taskToStore;
        }));
    }

    createWindow();
    createTray();

  } catch (error) {
    console.error("[Main] 初始化 electron-store 或应用失败:", error);
    dialog.showErrorBox("应用初始化错误", `加载核心组件或配置文件失败: ${error.message}`);
    app.quit();
  }
}

function registerIpcHandlers() {
    if (ipcHandlersRegistered) return;

    ipcMain.handle('get-store-data', () => {
        if (!store) return { webhooks: [], webhookUrlTemplates: [], history: {}, scheduledTasks: [] };

        const templates = store.get('webhookUrlTemplates', []).map(t => ({
            id: t.id, name: t.name, type: t.type, url: decryptText(t.url), method: t.method, bodyTemplate: t.bodyTemplate, headers: t.headers,
            workweixin_corpid: (t.type === 'workweixin' && t.corpid) ? decryptText(t.corpid) : undefined,
            workweixin_corpsecret: (t.type === 'workweixin' && t.corpsecret) ? '********' : undefined,
            workweixin_agentid: (t.type === 'workweixin' && t.agentid) ? decryptText(t.agentid) : undefined,
            workweixin_msgtype: (t.type === 'workweixin') ? t.workweixin_msgtype : undefined,
        }));

        const tasks = store.get('scheduledTasks', []).map(t => {
            const tDec = {
                ...t,
                finalUrl: decryptText(t.finalUrl),
                webhookSnapshot: t.webhookSnapshot ? { ...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url) } : undefined
            };
            if (t.templateType === 'workweixin' && t.workweixinConfig) {
                tDec.workweixinConfig = {
                    corpid: decryptText(t.workweixinConfig.corpid),
                    corpsecret: '********',
                    agentid: decryptText(t.workweixinConfig.agentid),
                    touser: t.workweixinConfig.touser,
                    msgtype: t.workweixinConfig.msgtype,
                };
            }
            return tDec;
        });

        const hist = {};
        const storedHistory = store.get('history', {});
        for (const id in storedHistory) {
            hist[id] = storedHistory[id].map(entry => {
                const entryDec = {...entry};
                if (entryDec.request) {
                     entryDec.request.url = decryptText(entryDec.request.url);
                     if (entryDec.request.templateType === 'workweixin') {
                        try { entryDec.request.body = JSON.parse(decryptText(entryDec.request.body)); } catch(e) { entryDec.request.body = decryptText(entryDec.request.body); }
                        if (entryDec.request.workweixinConfig) {
                            entryDec.request.workweixinConfig.corpid = decryptText(entryDec.request.workweixinConfig.corpid);
                            entryDec.request.workweixinConfig.corpsecret = "********";
                            entryDec.request.workweixinConfig.agentid = decryptText(entryDec.request.workweixinConfig.agentid);
                        }
                     } else if (typeof entryDec.request.body === 'string' && entryDec.request.body.includes(':')) {
                         entryDec.request.body = decryptText(entryDec.request.body);
                     }
                }
                return entryDec;
            });
        }
        return { webhooks: store.get('webhooks', []), webhookUrlTemplates: templates, history: hist, scheduledTasks: tasks };
    });

    ipcMain.handle('get-templates', () => {
        if (!store) return [];
        return store.get('webhookUrlTemplates', []).map(t => ({
            id: t.id, name: t.name, type: t.type, url: decryptText(t.url), method: t.method, bodyTemplate: t.bodyTemplate, headers: t.headers,
            workweixin_corpid: (t.type === 'workweixin' && t.corpid) ? decryptText(t.corpid) : undefined,
            workweixin_corpsecret: (t.type === 'workweixin' && t.corpsecret) ? '********' : undefined,
            workweixin_agentid: (t.type === 'workweixin' && t.agentid) ? decryptText(t.agentid) : undefined,
            workweixin_msgtype: (t.type === 'workweixin') ? t.workweixin_msgtype : undefined,
        }));
    });

    ipcMain.handle('save-templates', (event, templatesFromRenderer) => {
        if (!store) return { success: false, msg: "Store未初始化。" };
        const currentStoredTemplates = store.get('webhookUrlTemplates', []);

        const newTemplatesToStore = templatesFromRenderer.map(tNew => {
            const tCurrent = currentStoredTemplates.find(tc => tc.id === tNew.id);
            let finalEncryptedSecret = tNew.workweixin_corpsecret;

            if (tNew.type === 'workweixin') {
                if (tNew.workweixin_corpsecret === '********' && tCurrent && tCurrent.corpsecret) {
                    finalEncryptedSecret = tCurrent.corpsecret;
                } else if (tNew.workweixin_corpsecret && tNew.workweixin_corpsecret !== '********') {
                    finalEncryptedSecret = encryptText(tNew.workweixin_corpsecret);
                } else if (!tNew.workweixin_corpsecret && tCurrent && tCurrent.corpsecret) {
                     finalEncryptedSecret = undefined;
                } else if (!tNew.workweixin_corpsecret && !tCurrent) {
                     finalEncryptedSecret = undefined;
                } else if (tNew.workweixin_corpsecret === '********' && !tCurrent) {
                    finalEncryptedSecret = undefined;
                }
            }

            return {
                id: tNew.id,
                name: tNew.name,
                type: tNew.type,
                url: encryptText(tNew.url),
                method: tNew.method,
                bodyTemplate: tNew.bodyTemplate,
                headers: tNew.headers,
                corpid: (tNew.type === 'workweixin' && tNew.workweixin_corpid) ? encryptText(tNew.workweixin_corpid) : undefined,
                corpsecret: finalEncryptedSecret,
                agentid: (tNew.type === 'workweixin' && tNew.workweixin_agentid) ? encryptText(tNew.workweixin_agentid) : undefined,
                workweixin_msgtype: (tNew.type === 'workweixin') ? tNew.workweixin_msgtype : undefined,
            };
        });
        store.set('webhookUrlTemplates', newTemplatesToStore);
        return { success: true };
    });


    ipcMain.handle('save-webhooks', (event, webhooks) => {
        if (!store) return { success: false, msg: "Store未初始化。" };
        store.set('webhooks', webhooks);
        return { success: true };
    });

    ipcMain.handle('send-now', async (event, webhookPayload) => {
        if (!store) return { success: false, msg: "Store未初始化。" };
        if (!webhookPayload) return { success: false, msg: "无效的 webhook 配置。" };
        return sendWebhookRequest(webhookPayload);
    });

    ipcMain.handle('schedule-explicit-task', (event, taskFromRenderer) => {
        if (!store) return { success: false, msg: "Store未初始化。" };

        const { id, originalWebhookId, scheduledTime, webhookSnapshot, templateType } = taskFromRenderer;
        let finalEncryptedTask;

        if (templateType === 'workweixin') {
            const allTemplates = store.get('webhookUrlTemplates', []);
            const associatedTemplate = allTemplates.find(t => t.id === webhookSnapshot.templateId);

            if (!associatedTemplate) {
                return { success: false, msg: "调度时未找到关联的企业微信模板。" };
            }
            finalEncryptedTask = {
                id, originalWebhookId, scheduledTime, templateType,
                finalUrl: encryptText("WORKWEIXIN_API_SEND"),
                webhookSnapshot: {
                    ...webhookSnapshot,
                    url: encryptText(associatedTemplate.url),
                },
                workweixinConfig: { // 这些是从模板中获取的，已经是加密的
                    corpid: associatedTemplate.corpid,
                    corpsecret: associatedTemplate.corpsecret,
                    agentid: associatedTemplate.agentid,
                    touser: taskFromRenderer.workweixinConfig.touser, // 这个来自渲染器
                    msgtype: associatedTemplate.workweixin_msgtype || taskFromRenderer.workweixinConfig.msgtype, // 优先用模板的
                }
            };
        } else {
            finalEncryptedTask = {
                id, originalWebhookId, scheduledTime, templateType,
                finalUrl: encryptText(taskFromRenderer.finalUrl),
                webhookSnapshot: taskFromRenderer.webhookSnapshot ? { ...taskFromRenderer.webhookSnapshot, url: encryptText(taskFromRenderer.webhookSnapshot.url) } : undefined,
            };
        }

        const tasks = store.get('scheduledTasks', []);
        tasks.push(finalEncryptedTask);
        store.set('scheduledTasks', tasks);

        // 为调度器准备任务对象 (解密 corpid 和 agentid, corpsecret 保持加密)
        const taskForScheduler = {
            ...finalEncryptedTask,
            finalUrl: decryptText(finalEncryptedTask.finalUrl),
            webhookSnapshot: finalEncryptedTask.webhookSnapshot ? { ...finalEncryptedTask.webhookSnapshot, url: decryptText(finalEncryptedTask.webhookSnapshot.url) } : undefined,
        };
        if (finalEncryptedTask.templateType === 'workweixin' && finalEncryptedTask.workweixinConfig) {
            taskForScheduler.workweixinConfig = {
                ...finalEncryptedTask.workweixinConfig, // corpsecret 保持加密
                corpid: decryptText(finalEncryptedTask.workweixinConfig.corpid),
                agentid: decryptText(finalEncryptedTask.workweixinConfig.agentid),
            };
        }

        scheduleTaskWithTimeout(taskForScheduler);

        const tasksForRenderer = tasks.map(t_1 => {
            const tDec = {
                ...t_1,
                finalUrl: decryptText(t_1.finalUrl),
                webhookSnapshot: t_1.webhookSnapshot ? { ...t_1.webhookSnapshot, url: decryptText(t_1.webhookSnapshot.url) } : undefined
            };
            if (t_1.templateType === 'workweixin' && t_1.workweixinConfig) {
                tDec.workweixinConfig = {
                    ...t_1.workweixinConfig, // 仅为渲染器解密corpid/agentid，掩码secret
                    corpid: decryptText(t_1.workweixinConfig.corpid),
                    corpsecret: '********',
                    agentid: decryptText(t_1.workweixinConfig.agentid),
                };
            }
            return tDec;
        }).sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer);
        }
        return { success: true, taskId: id };
    });

    ipcMain.handle('cancel-explicit-task', (event, taskId) => {
        if (!store) return { success: false, msg: "Store未初始化。" };
        if (runningScheduledTimeouts.has(taskId)) {
            clearTimeout(runningScheduledTimeouts.get(taskId));
            runningScheduledTimeouts.delete(taskId);
        }
        let tasks = store.get('scheduledTasks', []);
        const initialLength = tasks.length;
        tasks = tasks.filter(t => t.id !== taskId);
        if (tasks.length < initialLength) {
            store.set('scheduledTasks', tasks);
            const tasksForRenderer = tasks.map(t_1 => {
                 const tDec = {
                    ...t_1,
                    finalUrl: decryptText(t_1.finalUrl),
                    webhookSnapshot: t_1.webhookSnapshot ? { ...t_1.webhookSnapshot, url: decryptText(t_1.webhookSnapshot.url) } : undefined
                };
                if (t_1.templateType === 'workweixin' && t_1.workweixinConfig) {
                    tDec.workweixinConfig = {
                        ...t_1.workweixinConfig,
                        corpid: decryptText(t_1.workweixinConfig.corpid),
                        corpsecret: '********',
                        agentid: decryptText(t_1.workweixinConfig.agentid),
                    };
                }
                return tDec;
            }).sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer);
            }
            return { success: true, msg: "定时任务已取消。" };
        }
        return { success: false, msg: "未找到要取消的任务。" };
    });


    ipcMain.handle('backup-config', async () => {
        if (!store) return { success: false, msg: "Store未初始化。" };
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
        if (!store) return { success: false, msg: "Store未初始化。" };
        const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: '恢复加密配置', properties: ['openFile'], filters: [{ name: 'JSON Files', extensions: ['json'] }] });
        if (canceled || !filePaths?.length) return { success: false, msg: "用户取消了恢复操作。" };
        try {
            const data = JSON.parse(fs.readFileSync(filePaths[0], 'utf-8'));
            if (typeof data.webhooks === 'undefined' || typeof data.webhookUrlTemplates === 'undefined') {
                 return { success: false, msg: '文件格式无效。可能不是一个有效的备份文件。' };
            }
            store.set('webhooks', data.webhooks || []);
            store.set('webhookUrlTemplates', data.webhookUrlTemplates || []);
            store.set('history', data.history || {});
            store.set('scheduledTasks', data.scheduledTasks || []);

            runningScheduledTimeouts.forEach(clearTimeout);
            runningScheduledTimeouts.clear();

            const tasksFromStore = store.get('scheduledTasks', []);
            const currentTime = Date.now();
            const validTasksForScheduler = [];
            const validTasksForStorage = [];

            for (const task of tasksFromStore) {
                const taskForScheduler = {
                    ...task,
                    finalUrl: decryptText(task.finalUrl),
                    webhookSnapshot: task.webhookSnapshot ? { ...task.webhookSnapshot, url: decryptText(task.webhookSnapshot.url) } : undefined,
                };
                 if (task.templateType === 'workweixin' && task.workweixinConfig) {
                    taskForScheduler.workweixinConfig = {
                        ...task.workweixinConfig,
                        corpid: decryptText(task.workweixinConfig.corpid),
                        agentid: decryptText(task.workweixinConfig.agentid),
                    };
                }

                if (new Date(taskForScheduler.scheduledTime).getTime() > currentTime) {
                    validTasksForScheduler.push(taskForScheduler);
                    validTasksForStorage.push(task);
                    scheduleTaskWithTimeout(taskForScheduler);
                }
            }
             if (validTasksForStorage.length < tasksFromStore.length) {
                store.set('scheduledTasks', validTasksForStorage);
            }


            const rendererData = {
                webhooks: store.get('webhooks', []),
                webhookUrlTemplates: store.get('webhookUrlTemplates', []).map(t => ({
                    ...t, url: decryptText(t.url),
                    workweixin_corpid: (t.type === 'workweixin' && t.corpid) ? decryptText(t.corpid) : undefined,
                    workweixin_corpsecret: (t.type === 'workweixin' && t.corpsecret) ? '********' : undefined,
                    workweixin_agentid: (t.type === 'workweixin' && t.agentid) ? decryptText(t.agentid) : undefined,
                })),
                history: {},
                scheduledTasks: validTasksForStorage.map(t => {
                    const tDec = {
                        ...t,
                        finalUrl: decryptText(t.finalUrl),
                        webhookSnapshot: t.webhookSnapshot ? { ...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url) } : undefined
                    };
                    if (t.templateType === 'workweixin' && t.workweixinConfig) {
                        tDec.workweixinConfig = {
                            corpid: decryptText(t.workweixinConfig.corpid),
                            corpsecret: '********',
                            agentid: decryptText(t.workweixinConfig.agentid),
                            touser: t.workweixinConfig.touser,
                            msgtype: t.workweixinConfig.msgtype,
                        };
                    }
                    return tDec;
                })
            };
            const restoredHistory = store.get('history', {});
             for (const id in restoredHistory) {
                rendererData.history[id] = restoredHistory[id].map(entry => {
                    const entryDec = {...entry};
                    if(entryDec.request) {
                        entryDec.request.url = decryptText(entryDec.request.url);
                        if (entryDec.request.templateType === 'workweixin') {
                            try { entryDec.request.body = JSON.parse(decryptText(entryDec.request.body)); } catch(e) { entryDec.request.body = decryptText(entryDec.request.body); }
                            if (entryDec.request.workweixinConfig) {
                                entryDec.request.workweixinConfig.corpid = decryptText(entryDec.request.workweixinConfig.corpid);
                                entryDec.request.workweixinConfig.corpsecret = "********";
                                entryDec.request.workweixinConfig.agentid = decryptText(entryDec.request.workweixinConfig.agentid);
                            }
                        } else if (typeof entryDec.request.body === 'string' && entryDec.request.body.includes(':')) {
                            entryDec.request.body = decryptText(entryDec.request.body);
                        }
                    }
                    return entryDec;
                });
            }


            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                mainWindow.webContents.send('scheduled-tasks-update', rendererData.scheduledTasks.sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)));
            }
            return { success: true, msg: '配置恢复成功！应用将使用新配置。', data: rendererData };
        } catch (error) {
            console.error('[Restore] 恢复失败:', error);
            return { success: false, msg: `恢复失败: ${error.message}. 请确保文件是有效的备份文件。` };
        }
    });


    ipcMain.handle('get-startup-setting', () => app.isPackaged ? app.getLoginItemSettings({ args: ['--hidden'] }).openAtLogin : false);
    ipcMain.handle('set-startup-setting', (event, enable) => {
        if (!app.isPackaged) return { success: true, msg: '开发模式下跳过。' };
        try {
            app.setLoginItemSettings({ openAtLogin: enable, openAsHidden: enable, args: enable ? ['--hidden'] : [] });
            return { success: true, msg: enable ? '已设置为开机启动。' : '已取消开机启动。' };
        } catch (error) { return { success: false, msg: `设置失败: ${error.message}` }; }
    });

    ipcMain.on('window-minimize', () => mainWindow?.minimize());
    ipcMain.on('window-maximize', () => mainWindow && (mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()));
    ipcMain.on('window-close', () => mainWindow && (!app.isQuitting ? mainWindow.hide() : mainWindow.close()));
    ipcMain.on('open-external-link', (event, url) => (url?.startsWith('http:') || url?.startsWith('https:')) && shell.openExternal(url));
    ipcMain.handle('get-uuid', uuidv4);

    ipcHandlersRegistered = true;
    console.log("[Main-IPC] IPC处理器已注册。");
}

function getAppIconPath() {
    const basePath = app.isPackaged ? app.getAppPath() : path.join(__dirname, '..');
    return path.join(basePath, 'icon.png');
}

function getDedicatedTrayIconPath(iconFilename = 'tray_icon.ico') {
    if (app.isPackaged) {
        return path.join(process.resourcesPath, 'app_icons', iconFilename);
    } else {
        return path.join(__dirname, '..', 'assets', 'tray_icons', iconFilename);
    }
}

function createWindow() {
    const windowIconPath = getAppIconPath();
    console.log(`[Main-Window] 尝试从以下路径加载窗口图标: ${windowIconPath}`);
    if (!fs.existsSync(windowIconPath)) console.error(`[Main-Window] 窗口图标文件未找到: ${windowIconPath}`);
    else console.log(`[Main-Window] 窗口图标文件已找到: ${windowIconPath}`);

    mainWindow = new BrowserWindow({
        width: 1200, height: 800, minWidth: 940, minHeight: 600,
        frame: false, titleBarStyle: 'hidden', backgroundColor: '#171a21',
        webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
        icon: windowIconPath,
        show: !shouldStartHidden
    });
    // mainWindow.webContents.openDevTools();
    mainWindow.loadFile(path.join(__dirname, '..', 'index.html'));
    mainWindow.on('close', (event) => { if (!app.isQuitting) { event.preventDefault(); mainWindow.hide(); } });
    mainWindow.on('closed', () => mainWindow = null);
    mainWindow.webContents.once('did-finish-load', () => {
        if (store) {
            const tasks = store.get('scheduledTasks', []).map(t => {
                const tDec = {
                    ...t,
                    finalUrl: decryptText(t.finalUrl),
                    webhookSnapshot: t.webhookSnapshot ? { ...t.webhookSnapshot, url: decryptText(t.webhookSnapshot.url) } : undefined
                };
                if (t.templateType === 'workweixin' && t.workweixinConfig) {
                    tDec.workweixinConfig = {
                        corpid: decryptText(t.workweixinConfig.corpid),
                        corpsecret: '********',
                        agentid: decryptText(t.workweixinConfig.agentid),
                        touser: t.workweixinConfig.touser,
                        msgtype: t.workweixinConfig.msgtype,
                    };
                }
                return tDec;
            }).sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));

            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                 mainWindow.webContents.send('scheduled-tasks-update', tasks);
            }
        }
        if (shouldStartHidden && mainWindow?.isVisible()) mainWindow.hide();
    });
}

function createTray() {
    if (tray) return;
    const trayIconPath = getDedicatedTrayIconPath('tray_icon.ico');
    console.log(`[Main-Tray] 尝试从以下路径加载专用托盘图标: ${trayIconPath}`);

    if (!fs.existsSync(trayIconPath)) {
        console.error(`[Main-Tray] 专用托盘图标文件未找到: ${trayIconPath}. 托盘将不会创建。`);
        return;
    }
    console.log(`[Main-Tray] 专用托盘图标文件已找到: ${trayIconPath}`);

    let iconImage;
    try {
        iconImage = nativeImage.createFromPath(trayIconPath);
        console.log(`[Main-Tray] 成功从路径创建nativeImage用于专用托盘图标。路径: ${trayIconPath}. 是否为空: ${iconImage.isEmpty()}`);
    } catch (error) {
        console.error(`[Main-Tray] 从路径为专用托盘图标创建nativeImage时出错: ${trayIconPath}`, error);
        return;
    }

    if (iconImage.isEmpty()) {
        console.error(`[Main-Tray] 加载的专用托盘图标为空。路径: ${trayIconPath}.`);
        return;
    }

    try {
        tray = new Tray(iconImage);
    } catch (error) {
        console.error(`[Main-Tray] 使用专用图标创建Tray对象时出错: ${trayIconPath}`, error);
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
    console.log("[Main-Tray] 系统托盘图标已使用专用图标成功创建。");
}

async function sendWebhookRequest(payload) {
    if (!store) return { id: payload.id || uuidv4(), webhookId: payload.originalWebhookId || payload.id, status: 'failure', error: { msg: "Store未就绪。" }, timestamp: new Date().toISOString() };

    const historyId = uuidv4();
    const { templateType, workweixinConfig: wwConfigFromPayload, id: payloadId, originalWebhookId } = payload;
    const idForHistory = originalWebhookId || payloadId;
    let entry = { id: historyId, webhookId: idForHistory, status: 'pending', timestamp: new Date().toISOString(), request: {} };

    if (templateType === 'workweixin') {
        let effectiveWorkweixinConfig = { ...(wwConfigFromPayload || {}) };

        if (!payload.isScheduledTask) { // 对于立即发送，需要从store获取完整配置
            const templateIdForSecret = payload.webhookSnapshot?.templateId;
            if (templateIdForSecret) {
                const allTemplates = store.get('webhookUrlTemplates', []);
                const associatedTemplate = allTemplates.find(t => t.id === templateIdForSecret && t.type === 'workweixin');
                if (associatedTemplate && associatedTemplate.corpsecret && associatedTemplate.corpid && associatedTemplate.agentid) {
                    effectiveWorkweixinConfig.corpsecret = associatedTemplate.corpsecret;
                    effectiveWorkweixinConfig.corpid = decryptText(associatedTemplate.corpid);
                    effectiveWorkweixinConfig.agentid = decryptText(associatedTemplate.agentid);
                    effectiveWorkweixinConfig.touser = wwConfigFromPayload.touser; // 来自渲染器的 payload
                    effectiveWorkweixinConfig.msgtype = wwConfigFromPayload.msgtype; // 来自渲染器的 payload
                } else {
                    console.error(`[Main-SendWW] 无法为模板ID ${templateIdForSecret} 找到关联的企业微信模板或其完整配置。`);
                }
            }
        }
        // 对于定时任务, wwConfigFromPayload 已经包含了从模板复制的加密密钥和解密的corpid/agentid

        if (!effectiveWorkweixinConfig || !effectiveWorkweixinConfig.corpid || !effectiveWorkweixinConfig.corpsecret || !effectiveWorkweixinConfig.agentid) {
            entry.status = 'failure';
            entry.error = { message: "企业微信配置 (corpid, corpsecret, agentid) 缺失或无法从模板获取。" };
            const hist_err = store.get(`history.${idForHistory}`, []); hist_err.unshift(entry); store.set(`history.${idForHistory}`, hist_err.slice(0, 50));
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: { ...entry, request: { url: '企业微信 API 错误', ...entry.request } } });
            return entry;
        }

        try {
            const accessToken = await getWorkWeixinToken(effectiveWorkweixinConfig.corpid, effectiveWorkweixinConfig.corpsecret);
            const sendMessageUrl = `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${accessToken}`;

            let messagePayload;
            const recipient = effectiveWorkweixinConfig.touser || "@all";
            const agentIdInt = parseInt(effectiveWorkweixinConfig.agentid, 10);

            if (effectiveWorkweixinConfig.msgtype === 'text') {
                messagePayload = {
                    touser: recipient,
                    msgtype: "text",
                    agentid: agentIdInt,
                    text: { content: payload.body },
                    safe: effectiveWorkweixinConfig.safe || 0,
                };
            } else if (effectiveWorkweixinConfig.msgtype === 'markdown') {
                messagePayload = {
                    touser: recipient,
                    msgtype: "markdown",
                    agentid: agentIdInt,
                    markdown: { content: payload.body },
                };
            } else {
                throw new Error(`不支持的企业微信消息类型: ${effectiveWorkweixinConfig.msgtype}`);
            }

            const requestForHistory = {
                url: encryptText(sendMessageUrl.split('?')[0] + `?access_token=DYNAMIC_TOKEN`),
                method: 'POST',
                body: encryptText(JSON.stringify(messagePayload)),
                templateType: 'workweixin',
                workweixinConfig: {
                    corpid: encryptText(effectiveWorkweixinConfig.corpid),
                    corpsecret: effectiveWorkweixinConfig.corpsecret,
                    agentid: encryptText(effectiveWorkweixinConfig.agentid),
                    touser: effectiveWorkweixinConfig.touser,
                    msgtype: effectiveWorkweixinConfig.msgtype
                }
            };
            entry.request = requestForHistory;

            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                const requestForDisplay = JSON.parse(JSON.stringify(requestForHistory));
                requestForDisplay.url = sendMessageUrl.split('?')[0] + `?access_token=USED_TOKEN`;
                try { requestForDisplay.body = JSON.parse(decryptText(requestForHistory.body));} catch(e) { requestForDisplay.body = "加密的载荷";};
                requestForDisplay.workweixinConfig.corpsecret = "********";
                requestForDisplay.workweixinConfig.corpid = decryptText(requestForDisplay.workweixinConfig.corpid);
                requestForDisplay.workweixinConfig.agentid = decryptText(requestForDisplay.workweixinConfig.agentid);
                mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: { ...entry, request: requestForDisplay }});
            }

            const response = await axios.post(sendMessageUrl, messagePayload, { timeout: 15000 });

            if (response.data.errcode === 0) {
                entry.status = 'success';
                entry.response = { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data };
            } else {
                entry.status = 'failure';
                entry.error = { message: `企业微信 API 错误: ${response.data.errmsg}`, code: response.data.errcode, data: response.data };
            }
        } catch (error) {
            entry.status = 'failure';
            const errMessage = error.response ? JSON.stringify(error.response.data) : error.message;
            entry.error = { message: errMessage, code: error.code || (error.response ? error.response.status : 'N/A'), details: "企业微信请求期间出错" };
            console.error("[Main-SendWW] Error during WorkWeixin request:", error);
        }
    } else { // 通用 Webhook
        const { url, method, headers, body, name, webhookSnapshot } = payload;
        const plainBodyForHistory = webhookSnapshot?.plainBody || (typeof body === 'string' && body.startsWith('{"msg":')) ? JSON.parse(body).msg : body;

        if (typeof url !== 'string' || !url.trim()) {
            const errEntry = { id: historyId, webhookId: idForHistory, status: 'failure', timestamp: new Date().toISOString(), request: { url: encryptText(String(url)), method, headers, body: encryptText(body), plainBody: plainBodyForHistory }, error: { message: "请求前URL无效" } };
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('history-updated', { webhookId: errEntry.webhookId, entry: { ...errEntry, request: { ...errEntry.request, url: String(url), body:body } } });
            const hist_err = store.get(`history.${errEntry.webhookId}`, []); hist_err.unshift(errEntry); store.set(`history.${errEntry.webhookId}`, hist_err.slice(0, 50));
            return errEntry;
        }
        const encryptedGenericRequest = { url: encryptText(url), method, headers, body: encryptText(body), plainBody: plainBodyForHistory };
        entry.request = encryptedGenericRequest;

        if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: { ...entry, request: { ...entry.request, url:url, body:body } } });

        try {
            const response = await axios({ method, url, headers: (headers || []).reduce((acc, cur) => cur.key ? (acc[cur.key] = cur.value, acc) : acc, {}), data: (typeof body === 'string' && (body.startsWith('{') || body.startsWith('['))) ? JSON.parse(body) : body, timeout: 15000 });
            entry.status = 'success';
            entry.response = { status: response.status, statusText: response.statusText, headers: response.headers, data: response.data };
        } catch (error) {
            entry.status = 'failure';
            if (error.response) entry.error = { message: error.message, code: error.code, status: error.response.status, headers: error.response.headers, data: error.response.data };
            else if (error.request) entry.error = { message: error.message, code: error.code, requestDetails: "无响应" };
            else entry.error = { message: error.message, code: error.code, details: "设置错误" };
        }
    }

    const hist_1 = store.get(`history.${idForHistory}`, []);
    hist_1.unshift(entry);
    store.set(`history.${idForHistory}`, hist_1.slice(0, 50));

    const entryForRenderer = JSON.parse(JSON.stringify(entry));
    if (entryForRenderer.request) {
        entryForRenderer.request.url = decryptText(entryForRenderer.request.url);
        if (entryForRenderer.request.templateType === 'workweixin') {
            try { entryForRenderer.request.body = JSON.parse(decryptText(entryForRenderer.request.body)); } catch (e) { entryForRenderer.request.body = decryptText(entryForRenderer.request.body); }
            if (entryForRenderer.request.workweixinConfig) {
                entryForRenderer.request.workweixinConfig.corpid = decryptText(entryForRenderer.request.workweixinConfig.corpid);
                entryForRenderer.request.workweixinConfig.corpsecret = "********";
                entryForRenderer.request.workweixinConfig.agentid = decryptText(entryForRenderer.request.workweixinConfig.agentid);
            }
        } else {
             entryForRenderer.request.body = decryptText(entryForRenderer.request.body);
        }
    }

    if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('history-updated', { webhookId: idForHistory, entry: entryForRenderer });
    return entry;
}


function scheduleTaskWithTimeout(taskConfig) {
    const { id, webhookSnapshot, finalUrl, scheduledTime, originalWebhookId, templateType, workweixinConfig: wwConfigFromTask } = taskConfig;
    const webhookName = webhookSnapshot?.name || `任务 ID ${id}`;

    if (templateType !== 'workweixin' && (!finalUrl || typeof finalUrl !== 'string' || !finalUrl.trim())) {
        console.error(`[Scheduler] 任务 ${id} 的 finalUrl 无效: "${finalUrl}".`);
        return;
    }
    if (templateType === 'workweixin' && (!wwConfigFromTask || !wwConfigFromTask.corpid || !wwConfigFromTask.corpsecret || !wwConfigFromTask.agentid)) {
        console.error(`[Scheduler] 企业微信任务 ${id} 缺少配置 (corpid, corpsecret(encrypted), agentid)。 wwConfigFromTask:`, wwConfigFromTask);
        return;
    }


    if (runningScheduledTimeouts.has(id)) {
        clearTimeout(runningScheduledTimeouts.get(id));
        runningScheduledTimeouts.delete(id);
    }

    const delay = new Date(scheduledTime).getTime() - Date.now();
    if (delay > 0) {
        const timerId = setTimeout(async () => {
            let payloadToSend;
            if (templateType === 'workweixin') {
                // 对于定时任务，wwConfigFromTask 已经包含了从模板复制的加密密钥和解密的corpid/agentid
                // sendWebhookRequest 会进一步处理，确保 getWorkWeixinToken 拿到正确的参数
                payloadToSend = {
                    id, originalWebhookId, templateType: 'workweixin',
                    workweixinConfig: wwConfigFromTask,
                    body: webhookSnapshot.plainBody,
                    name: webhookSnapshot?.name || `任务 ID ${id}`,
                    webhookSnapshot,
                    isScheduledTask: true
                };
            } else { // 通用 Webhook
                const { method, headers, bodyTemplate, plainBody, phoneNumber, name: snapshotName } = webhookSnapshot;
                let actualBody = bodyTemplate.replace(/{phoneNumber}|{phone}/g, (phoneNumber || "").replace(/"/g, '\\"'));
                actualBody = actualBody.replace(/{userMessage}/g, (plainBody || "").replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t'));
                payloadToSend = {
                    id, originalWebhookId, url: finalUrl, method, headers, body: actualBody,
                    name: snapshotName || `任务 ID ${id}`,
                    webhookSnapshot,
                    isScheduledTask: true
                };
            }

            await sendWebhookRequest(payloadToSend);

            const tasks = store.get('scheduledTasks', []).filter(t => t.id !== id);
            store.set('scheduledTasks', tasks);
            runningScheduledTimeouts.delete(id);

            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                 const tasksForRenderer = tasks.map(t_1 => {
                    const tDec = {
                        ...t_1,
                        finalUrl: decryptText(t_1.finalUrl),
                        webhookSnapshot: t_1.webhookSnapshot ? { ...t_1.webhookSnapshot, url: decryptText(t_1.webhookSnapshot.url) } : undefined
                    };
                    if (t_1.templateType === 'workweixin' && t_1.workweixinConfig) {
                        tDec.workweixinConfig = {
                            ...t_1.workweixinConfig,
                            corpid: decryptText(t_1.workweixinConfig.corpid),
                            corpsecret: '********',
                            agentid: decryptText(t_1.workweixinConfig.agentid),
                        };
                    }
                    return tDec;
                }).sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
                mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer);
            }
        }, delay);
        runningScheduledTimeouts.set(id, timerId);
    } else {
        console.warn(`[Scheduler] 任务 "${webhookName}" (ID: ${id}) 已过期。正在移除。`);
        const tasks_1 = store.get('scheduledTasks', []).filter(t => t.id !== id);
        if (tasks_1.length < store.get('scheduledTasks', []).length) {
            store.set('scheduledTasks', tasks_1);
            if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
                 const tasksForRenderer = tasks_1.map(t_2 => {
                    const tDec = {
                        ...t_2,
                        finalUrl: decryptText(t_2.finalUrl),
                        webhookSnapshot: t_2.webhookSnapshot ? { ...t_2.webhookSnapshot, url: decryptText(t_2.webhookSnapshot.url) } : undefined
                    };
                    if (t_2.templateType === 'workweixin' && t_2.workweixinConfig) {
                        tDec.workweixinConfig = {
                            ...t_2.workweixinConfig,
                            corpid: decryptText(t_2.workweixinConfig.corpid),
                            corpsecret: '********',
                            agentid: decryptText(t_2.workweixinConfig.agentid),
                        };
                    }
                    return tDec;
                }).sort((a,b) => new Date(a.scheduledTime) - new Date(b.scheduledTime));
                mainWindow.webContents.send('scheduled-tasks-update', tasksForRenderer);
            }
        }
    }
}
