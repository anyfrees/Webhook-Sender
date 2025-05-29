// ===================================================================================
// Webhook Sender - 渲染器进程逻辑 (集成企业微信支持)
// ===================================================================================

// --- 全局状态变量 ---
let webhooks = []; // 发送配置列表
let webhookUrlTemplates = []; // 地址模板列表
let history = {}; // 发送历史记录
let scheduledTasks = []; // 定时任务列表
let currentView = 'sender'; // 当前视图: 'sender' 或 'templates'
let selectedWebhookId = null; // 当前选中的发送配置ID
let selectedTemplateId = null; // 当前选中的模板ID
let isSending = false; // 是否正在发送
let currentActiveTab = 'body'; // 发送配置编辑器中的默认标签页: 'body', 'headers', 'schedule', 'history'

// --- DOM 元素引用 ---
const minimizeBtn = document.getElementById('minimize-btn');
const maximizeBtn = document.getElementById('maximize-btn');
const closeBtn = document.getElementById('close-btn');
const navSenderViewBtn = document.getElementById('nav-sender-view');
const navTemplateViewBtn = document.getElementById('nav-template-view');

const sidebarContentSender = document.getElementById('sidebar-content-sender');
const sidebarContentTemplates = document.getElementById('sidebar-content-templates');

const senderView = document.getElementById('sender-view');
const templateManagerView = document.getElementById('template-manager-view');

const welcomeScreen = document.getElementById('welcome-screen');
const welcomeTitle = document.getElementById('welcome-title');
const welcomeMessage = document.getElementById('welcome-message');

const webhookListEl = document.getElementById('webhook-list');
const newWebhookBtn = document.getElementById('new-webhook-btn');
const webhookEditorEl = document.getElementById('webhook-editor');
const webhookNameInput = document.getElementById('webhook-name');
const sendNowBtn = document.getElementById('send-now-btn');
const templateSelect = document.getElementById('template-select');
const selectedTemplateUrlContainer = document.getElementById('selected-template-url-container');
const phoneNumberInput = document.getElementById('phone-number-input'); // 也用于企业微信的 touser
const phoneNumberSection = document.getElementById('phone-number-section');
const recipientLabel = document.getElementById('recipient-label'); // 手机号码/接收者标签

const editorTabs = document.querySelectorAll('.editor-tab');
const tabContentBody = document.getElementById('tab-content-body');
const webhookBodyTextarea = document.getElementById('webhook-body');
const tabContentHeaders = document.getElementById('tab-content-headers');
const headersListEl = document.getElementById('headers-list');
const addHeaderBtn = document.getElementById('add-header-btn');
const tabContentSchedule = document.getElementById('tab-content-schedule');
const scheduleDatetimeInput = document.getElementById('schedule-datetime');
const saveTaskBtn = document.getElementById('save-task-btn');
const scheduledTaskListEl = document.getElementById('scheduled-task-list');

const tabContentHistory = document.getElementById('tab-content-history');
const historyLogListEl = document.getElementById('history-log-list');

const templateListEl = document.getElementById('template-list');
const newTemplateBtn = document.getElementById('new-template-btn');
const templateEditorEl = document.getElementById('template-editor');
const templateNameInput = document.getElementById('template-name-input');
const saveTemplateBtn = document.getElementById('save-template-btn');

// 新增：模板类型和企业微信相关字段的DOM引用
const templateTypeSelect = document.getElementById('template-type-select');
const workweixinFieldsContainer = document.getElementById('workweixin-fields-container');
const workweixinCorpidInput = document.getElementById('workweixin-corpid-input');
const workweixinCorpsecretInput = document.getElementById('workweixin-corpsecret-input');
const workweixinAgentidInput = document.getElementById('workweixin-agentid-input');
const workweixinMsgtypeSelect = document.getElementById('workweixin-msgtype-select');
const templateBodyLabel = document.getElementById('template-body-label');
const templateUrlContainer = document.getElementById('template-url-container'); // 包裹URL输入框和Method选择的div

const templateMethodSelect = document.getElementById('template-method-select');
const templateUrlInput = document.getElementById('template-url-input');
const templateHeadersListEl = document.getElementById('template-headers-list');
const addTemplateHeaderBtn = document.getElementById('add-template-header-btn');
const templateBodyInput = document.getElementById('template-body-input');


const backupBtn = document.getElementById('backup-btn');
const restoreBtn = document.getElementById('restore-btn');
const startupCheckbox = document.getElementById('startup-checkbox');
const titlebarAboutBtn = document.getElementById('titlebar-about-btn');
const aboutView = document.getElementById('about-view');
const devBlogLink = document.getElementById('dev-blog-link');
const closeAboutViewBtn = document.getElementById('close-about-view-btn');

// 图标SVG (用于URL显/隐切换)
const eyeIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path stroke-linecap="round" stroke-linejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>`;
const eyeSlashIconSVG = `<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>`;


// ===================================================================================
// SECTION: 工具函数 (Utilities)
// ===================================================================================

function formatDate(isoString) {
    if (!isoString) return 'N/A';
    return new Date(isoString).toLocaleString('zh-CN', { hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function maskAndMarkUrl(url, isWorkWeixin = false) {
    if (isWorkWeixin) {
        return "企业微信接口 (自动处理)";
    }
    if (!url || url.trim() === '') return '';
    try {
        const urlObj = new URL(url);
        if (urlObj.pathname !== '/' || urlObj.search || urlObj.hash) {
            return `${urlObj.protocol}//${urlObj.host}/... (已保存)`;
        }
        return url;
    } catch (e) {
        return url;
    }
}

// ===================================================================================
// SECTION: 自定义对话框管理 (Custom Dialog Management)
// ===================================================================================
const dialogOverlay = document.getElementById('custom-dialog-overlay');
const dialogTitleEl = document.getElementById('dialog-title');
const dialogMessageEl = document.getElementById('dialog-message');
const dialogButtonsEl = document.getElementById('dialog-buttons');

function showDialog(title, message, buttons) {
    return new Promise(resolve => {
        if (!dialogOverlay || !dialogTitleEl || !dialogMessageEl || !dialogButtonsEl) {
            console.error("对话框元素未在DOM中找到。");
            resolve(window.confirm(`${title}\n\n${message}`)); // Fallback
            return;
        }
        dialogTitleEl.textContent = title;
        dialogMessageEl.textContent = message;
        dialogButtonsEl.innerHTML = '';
        buttons.forEach(btnInfo => {
            const button = document.createElement('button');
            button.textContent = btnInfo.text;
            button.className = `px-4 py-2 rounded text-sm font-semibold text-white focus:outline-none shadow-md hover:shadow-lg transition-shadow ${btnInfo.class}`;
            button.onclick = () => {
                dialogOverlay.classList.add('hidden');
                dialogOverlay.classList.remove('flex');
                resolve(btnInfo.value);
            };
            dialogButtonsEl.appendChild(button);
        });
        dialogOverlay.classList.remove('hidden');
        dialogOverlay.classList.add('flex');
    });
}

function customConfirm(message, title = '请确认') {
    const buttons = [
        { text: '取消', value: false, class: 'bg-gray-600 hover:bg-gray-700' },
        { text: '确定', value: true, class: 'bg-red-600 hover:bg-red-700' }
    ];
    return showDialog(title, message, buttons);
}

function customAlert(message, title = '提示') {
    const buttons = [
        { text: '好的', value: true, class: 'bg-indigo-500 hover:bg-indigo-600' }
    ];
    return showDialog(title, message, buttons);
}

// ===================================================================================
// SECTION: 视图管理 (View Management)
// ===================================================================================

function showView(viewName, isAboutView = false) {
    if (!isAboutView) {
        currentView = viewName;
    }

    const mainViews = {
        sender: { main: senderView, sidebar: sidebarContentSender, nav: navSenderViewBtn, color: 'indigo' },
        templates: { main: templateManagerView, sidebar: sidebarContentTemplates, nav: navTemplateViewBtn, color: 'teal' }
    };

    Object.values(mainViews).forEach(v => {
        if (v.main) { v.main.classList.add('hidden'); v.main.classList.remove('flex'); }
        if (v.sidebar) { v.sidebar.classList.add('hidden'); v.sidebar.classList.remove('flex'); }
        if (v.nav) {
            v.nav.classList.remove(`bg-${v.color}-500`, 'text-white');
            v.nav.classList.add('bg-transparent');
        }
    });

    if (welcomeScreen) { welcomeScreen.classList.add('hidden'); welcomeScreen.classList.remove('flex');}
    if (aboutView) { aboutView.classList.add('hidden'); aboutView.classList.remove('flex'); }
    if (webhookEditorEl) { webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex'); }
    if (templateEditorEl) { templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex'); }


    if (isAboutView) {
        if (aboutView) {
            aboutView.classList.remove('hidden');
            aboutView.classList.add('flex');
             Object.values(mainViews).forEach(v => {
                if (v.nav) {
                    v.nav.classList.remove(`bg-${v.color}-500`, 'text-white');
                    v.nav.classList.add('bg-transparent');
                }
            });
        }
    } else if (mainViews[viewName]) {
        const selectedMainView = mainViews[viewName];
        if (selectedMainView.main && selectedMainView.sidebar && selectedMainView.nav) {
            selectedMainView.main.classList.remove('hidden');
            selectedMainView.main.classList.add('flex');
            selectedMainView.sidebar.classList.remove('hidden');
            selectedMainView.sidebar.classList.add('flex');
            selectedMainView.nav.classList.add(`bg-${selectedMainView.color}-500`, 'text-white');
            selectedMainView.nav.classList.remove('bg-transparent');
        }

        if (viewName === 'sender') {
            if (selectedWebhookId && webhooks.some(w => w.id === selectedWebhookId)) {
                showEditor('webhook-editor');
                // renderWebhookEditor(); // renderWebhookEditor is called by handleSelectWebhook if selectedWebhookId changes
            } else {
                showWelcomeScreen('发送配置', '请从左侧列表选择一个，或点击“新建配置”。');
            }
        } else if (viewName === 'templates') {
            if (selectedTemplateId && webhookUrlTemplates.some(t => t.id === selectedTemplateId)) {
                showEditor('template-editor');
                // renderTemplateEditor(); // renderTemplateEditor is called by handleSelectTemplate if selectedTemplateId changes
            } else {
                showWelcomeScreen('地址模板', '请从左侧列表选择一个，或点击“新建模板”。');
            }
        }
    } else {
         showWelcomeScreen('任何项目', '从左侧选择一个项目，或创建一个新的。');
    }
}


function showEditor(editorId) {
    if(webhookEditorEl) { webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex'); }
    if(templateEditorEl) { templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex'); }
    if (aboutView) { aboutView.classList.add('hidden'); aboutView.classList.remove('flex'); }

    if (editorId === 'webhook-editor' && webhookEditorEl) {
        webhookEditorEl.classList.remove('hidden');
        webhookEditorEl.classList.add('flex');
    } else if (editorId === 'template-editor' && templateEditorEl) {
        templateEditorEl.classList.remove('hidden');
        templateEditorEl.classList.add('flex');
    }
    if(welcomeScreen) { welcomeScreen.classList.add('hidden'); welcomeScreen.classList.remove('flex'); }
}

function showWelcomeScreen(viewContextName, message) {
    if(welcomeTitle) welcomeTitle.textContent = `没有选择${viewContextName}`;
    if(welcomeMessage) welcomeMessage.textContent = message;
    if(welcomeScreen) { welcomeScreen.classList.remove('hidden'); welcomeScreen.classList.add('flex'); }
    if(webhookEditorEl) { webhookEditorEl.classList.add('hidden'); webhookEditorEl.classList.remove('flex'); }
    if(templateEditorEl) { templateEditorEl.classList.add('hidden'); templateEditorEl.classList.remove('flex'); }
    if (aboutView) { aboutView.classList.add('hidden'); aboutView.classList.remove('flex'); }
}

// ===================================================================================
// SECTION: 模板管理 (Template Management) - 集成企业微信
// ===================================================================================

function updateTemplateEditorUIForType(currentType) {
    console.log('[Renderer-Debug] updateTemplateEditorUIForType called with type:', currentType);
    const isWorkWeixin = currentType === 'workweixin';
    console.log('[Renderer-Debug] isWorkWeixin:', isWorkWeixin);

    if(workweixinFieldsContainer) {
        workweixinFieldsContainer.classList.toggle('hidden', !isWorkWeixin);
        console.log('[Renderer-Debug] workweixinFieldsContainer hidden status:', workweixinFieldsContainer.classList.contains('hidden'));
    }
    if(templateUrlContainer) {
        templateUrlContainer.classList.toggle('hidden', isWorkWeixin);
        console.log('[Renderer-Debug] templateUrlContainer hidden status:', templateUrlContainer.classList.contains('hidden'));
    }
    if(templateHeadersListEl) {
        const headersContainer = templateHeadersListEl.parentElement;
        if (headersContainer) {
            headersContainer.classList.toggle('hidden', isWorkWeixin);
            console.log('[Renderer-Debug] Headers container hidden status:', headersContainer.classList.contains('hidden'));
        }
    }

    if (isWorkWeixin) {
        if(templateBodyLabel) templateBodyLabel.textContent = "消息内容模板 (企业微信):";
        if(templateBodyInput) {
            templateBodyInput.placeholder = "例如: 您的消息: {userMessage}";
        }
    } else {
        if(templateBodyLabel) templateBodyLabel.textContent = "请求体模板 (通用JSON, 可用 {phoneNumber} 和 {userMessage}):";
        if(templateBodyInput) {
            templateBodyInput.placeholder = '例如: {"msgtype":"text","text":{"content":"{userMessage}"},"touser":"{phoneNumber}"}';
        }
        if(templateUrlInput) {
            templateUrlInput.placeholder = 'https://api.example.com/send/KEY_HERE?target={phoneNumber}';
        }
        if(templateMethodSelect) templateMethodSelect.value = 'POST';
        if(templateHeadersListEl) renderHeaders([], templateHeadersListEl, 'template-header-key', 'template-header-value', 'remove-template-header-btn', 'teal');
    }
}


function renderTemplateList() {
    if(!templateListEl) return;
    templateListEl.innerHTML = '';
    if (webhookUrlTemplates.length === 0) {
        templateListEl.innerHTML = '<li class="text-center text-gray-500 py-4">无可用模板</li>';
        return;
    }
    webhookUrlTemplates.forEach(template => {
        const li = document.createElement('li');
        li.dataset.id = template.id;
        const typeIndicator = template.type === 'workweixin' ? '[企微] ' : '';
        li.className = `flex justify-between items-center px-3 py-2 my-1 rounded text-sm cursor-pointer hover:bg-gray-700/80 transition-colors ${template.id === selectedTemplateId ? 'bg-teal-600 shadow-md' : 'bg-gray-700/50'}`;
        li.innerHTML = `<span class="truncate text-gray-100">${typeIndicator}${template.name || '未命名模板'}</span><button data-delete-id="${template.id}" class="delete-template-btn text-gray-400 hover:text-red-500 ml-2 text-xs focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>`;
        templateListEl.appendChild(li);
    });
}

function renderTemplateEditor() {
    const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);

    if (!template && selectedTemplateId === null && templateEditorEl && !templateEditorEl.classList.contains('hidden')) {
        console.log('[Renderer-Debug] renderTemplateEditor for NEW template (selectedTemplateId is null).');
        if(templateNameInput) templateNameInput.value = `新模板 ${webhookUrlTemplates.length + 1}`;

        const currentDropdownType = templateTypeSelect ? templateTypeSelect.value : 'generic';
        if(templateTypeSelect) templateTypeSelect.value = currentDropdownType;

        updateTemplateEditorUIForType(currentDropdownType);

        if (currentDropdownType === 'workweixin') {
            if(workweixinCorpidInput) workweixinCorpidInput.value = '';
            if(workweixinCorpsecretInput) workweixinCorpsecretInput.value = '';
            if(workweixinAgentidInput) workweixinAgentidInput.value = '';
            if(workweixinMsgtypeSelect) workweixinMsgtypeSelect.value = 'text';
            if(templateBodyInput) templateBodyInput.value = '{userMessage}';
        } else {
            if(templateUrlInput) templateUrlInput.value = '';
            if(templateMethodSelect) templateMethodSelect.value = 'POST';
            if(templateBodyInput) templateBodyInput.value = JSON.stringify({ msgtype: "text", text: { content: "{userMessage}" } }, null, 2);
            if(templateHeadersListEl) renderHeaders([], templateHeadersListEl, 'template-header-key', 'template-header-value', 'remove-template-header-btn', 'teal');
        }
        return;
    }


    if (!template) {
        showWelcomeScreen('地址模板', '请从左侧重新选择或新建一个模板。');
        return;
    }

    showEditor('template-editor');
    console.log('[Renderer-Debug] renderTemplateEditor for existing template:', JSON.parse(JSON.stringify(template)));

    if(templateNameInput) templateNameInput.value = template.name || '';

    const templateTypeToRender = template.type || 'generic';
    if(templateTypeSelect) {
      console.log(`[Renderer-Debug] Setting templateTypeSelect.value to: ${templateTypeToRender} (from loaded template object)`);
      templateTypeSelect.value = templateTypeToRender;
    }

    updateTemplateEditorUIForType(templateTypeToRender);

    if (templateTypeToRender === 'workweixin') {
        if(workweixinCorpidInput) workweixinCorpidInput.value = template.workweixin_corpid || '';
        if(workweixinCorpsecretInput) workweixinCorpsecretInput.value = template.workweixin_corpsecret || '';
        if(workweixinAgentidInput) workweixinAgentidInput.value = template.workweixin_agentid || '';
        if(workweixinMsgtypeSelect) workweixinMsgtypeSelect.value = template.workweixin_msgtype || 'text';
        if(templateBodyInput) templateBodyInput.value = template.bodyTemplate || '{userMessage}';
    } else {
        if(templateUrlInput) {
            templateUrlInput.value = maskAndMarkUrl(template.url || '');
             if (!template.url && templateUrlInput) {
                templateUrlInput.placeholder = 'https://api.example.com/send/KEY_HERE?target={phoneNumber}';
            } else if (templateUrlInput) {
                templateUrlInput.placeholder = '地址已保存，输入新地址以替换';
            }
        }
        if(templateMethodSelect) templateMethodSelect.value = template.method || 'POST';
        if(templateBodyInput) templateBodyInput.value = template.bodyTemplate || JSON.stringify({ msgtype: "text", text: { content: "{userMessage}" } }, null, 2);
        if(templateHeadersListEl) {
             renderHeaders(template.headers, templateHeadersListEl, 'template-header-key', 'template-header-value', 'remove-template-header-btn', 'teal');
        }
    }
}


async function handleNewTemplate() {
    if (selectedTemplateId) await saveCurrentTemplateChanges();
    selectedTemplateId = null;

    if(templateTypeSelect) templateTypeSelect.value = 'generic';
    showEditor('template-editor');
    renderTemplateEditor();
}

async function handleSelectTemplate(templateId) {
    if (selectedTemplateId === templateId && currentView === 'templates' && templateEditorEl && !templateEditorEl.classList.contains('hidden')) {
        return;
    }
    if (selectedTemplateId) await saveCurrentTemplateChanges();
    selectedTemplateId = templateId;
    showView('templates');
    renderTemplateList();
    renderTemplateEditor();
}

async function saveCurrentTemplateChanges() {
    let templateToSave;
    let isNewTemplate = false;

    if (!selectedTemplateId) {
        isNewTemplate = true;
        const newId = await window.electronAPI.getUUID();
        templateToSave = { id: newId };
        selectedTemplateId = newId;
    } else {
        const index = webhookUrlTemplates.findIndex(t => t.id === selectedTemplateId);
        if (index === -1) {
            console.error("Error: Trying to save non-existent template.");
            return;
        }
        templateToSave = { ...webhookUrlTemplates[index] };
    }

    templateToSave.name = templateNameInput.value.trim() || (isNewTemplate ? `新模板 ${webhookUrlTemplates.length + 1}`: '未命名模板');
    templateToSave.type = templateTypeSelect.value;

    if (templateToSave.type === 'workweixin') {
        templateToSave.url = "WORKWEIXIN_APP_MESSAGE_API";
        templateToSave.method = "POST";
        templateToSave.workweixin_corpid = workweixinCorpidInput.value.trim();
        const secretInputVal = workweixinCorpsecretInput.value.trim();
        const originalTemplateForSecret = isNewTemplate ? {} : webhookUrlTemplates.find(t => t.id === selectedTemplateId) || {};

        if (secretInputVal && secretInputVal !== '********') {
            templateToSave.workweixin_corpsecret = secretInputVal;
        } else if (secretInputVal === '********' && !isNewTemplate) {
            templateToSave.workweixin_corpsecret = originalTemplateForSecret.workweixin_corpsecret;
        } else {
            templateToSave.workweixin_corpsecret = undefined;
        }
        templateToSave.workweixin_agentid = workweixinAgentidInput.value.trim();
        templateToSave.workweixin_msgtype = workweixinMsgtypeSelect.value;
        templateToSave.bodyTemplate = templateBodyInput.value.trim() || "{userMessage}";
        templateToSave.headers = [];
    } else {
        const originalUrl = isNewTemplate ? '' : (webhookUrlTemplates.find(t => t.id === selectedTemplateId)?.url || '');
        let uiUrl = templateUrlInput.value.trim();
        if (uiUrl === maskAndMarkUrl(originalUrl) || uiUrl.endsWith('... (已保存)')) {
            templateToSave.url = originalUrl;
        } else {
            templateToSave.url = uiUrl;
        }
        templateToSave.method = templateMethodSelect.value;
        templateToSave.bodyTemplate = templateBodyInput.value.trim();
        templateToSave.headers = [];
        if(templateHeadersListEl) {
            templateHeadersListEl.querySelectorAll('.header-item').forEach(div => {
                const keyInput = div.querySelector('.template-header-key');
                const valueInput = div.querySelector('.template-header-value');
                if (keyInput && valueInput) {
                    const key = keyInput.value.trim();
                    const value = valueInput.value.trim();
                    if (key) templateToSave.headers.push({ key, value });
                }
            });
        }
        delete templateToSave.workweixin_corpid;
        delete templateToSave.workweixin_corpsecret;
        delete templateToSave.workweixin_agentid;
        delete templateToSave.workweixin_msgtype;
    }

    if (isNewTemplate) {
        webhookUrlTemplates.unshift(templateToSave);
    } else {
        const index = webhookUrlTemplates.findIndex(t => t.id === selectedTemplateId);
        webhookUrlTemplates[index] = templateToSave;
    }

    await window.electronAPI.saveTemplates(webhookUrlTemplates);
    const updatedTemplatesFromServer = await window.electronAPI.getTemplates();
    webhookUrlTemplates = updatedTemplatesFromServer;

    renderTemplateList();
    renderTemplateEditor();
}


async function handleDeleteTemplate(templateId) {
    const template = webhookUrlTemplates.find(t => t.id === templateId);
    if (!template) return;
    const usedBy = webhooks.filter(wh => wh.templateId === templateId);
    let confirmMessage = `确定要删除模板 "${template.name}" 吗？`;
    if (usedBy.length > 0) confirmMessage += `\n\n警告：有 ${usedBy.length} 个发送配置正在使用此模板，删除后它们的地址将失效！`;

    if (await customConfirm(confirmMessage, `删除模板 "${template.name}"`)) {
        webhookUrlTemplates = webhookUrlTemplates.filter(t => t.id !== templateId);
        await window.electronAPI.saveTemplates(webhookUrlTemplates);
        let webhooksModified = false;
        webhooks.forEach(wh => {
            if (wh.templateId === templateId) {
                wh.templateId = null;
                webhooksModified = true;
            }
        });
        if (webhooksModified) await window.electronAPI.saveWebhooks(webhooks);
        if (selectedTemplateId === templateId) {
            selectedTemplateId = null;
            if (webhookUrlTemplates.length > 0) {
                handleSelectTemplate(webhookUrlTemplates[0].id);
            } else {
                showView('templates');
            }
        }
        renderTemplateList();
    }
}

// ===================================================================================
// SECTION: 发送配置管理 (Webhook/Sender Config Management) - 集成企业微信
// ===================================================================================
function isPhoneNumberRequired(template) {
    if (!template || template.type === 'workweixin') return false;
    const placeholder1 = "{phoneNumber}";
    const placeholder2 = "{phone}";

    const urlRequires = (template.url && (template.url.includes(placeholder1) || template.url.includes(placeholder2)));
    const bodyRequires = (template.bodyTemplate && (template.bodyTemplate.includes(placeholder1) || template.bodyTemplate.includes(placeholder2)));

    return urlRequires || bodyRequires;
}

function renderWebhookList() {
    if(!webhookListEl) return;
    webhookListEl.innerHTML = '';
    if (webhooks.length === 0) {
        webhookListEl.innerHTML = '<li class="text-center text-gray-500 py-4">无可用模板</li>';
        return;
    }
    webhooks.forEach(wh => {
        const li = document.createElement('li');
        li.dataset.id = wh.id;
        li.className = `flex justify-between items-center px-3 py-2 my-1 rounded text-sm cursor-pointer hover:bg-gray-700/80 transition-colors ${wh.id === selectedWebhookId ? 'bg-indigo-600 shadow-md' : 'bg-gray-700/50'}`;
        li.innerHTML = `<span class="truncate text-gray-100">${wh.name || '未命名配置'}</span><button data-delete-id="${wh.id}" class="delete-webhook-btn text-gray-400 hover:text-red-500 ml-2 text-xs focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>`;
        webhookListEl.appendChild(li);
    });
}

function renderWebhookEditor() {
    const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
    if (!webhook) {
        showWelcomeScreen('发送配置', '请从左侧重新选择。');
        return;
    }
    showEditor('webhook-editor');
    if(webhookNameInput) webhookNameInput.value = webhook.name || '';

    if(templateSelect) {
        templateSelect.innerHTML = '<option value="">-- 请选择一个地址模板 --</option>';
        webhookUrlTemplates.forEach(template => {
            const option = document.createElement('option');
            option.value = template.id;
            const typePrefix = template.type === 'workweixin' ? '[企微] ' : '';
            option.textContent = typePrefix + template.name;
            if (template.id === webhook.templateId) option.selected = true;
            templateSelect.appendChild(option);
        });
    }

    const selectedTemplate = webhookUrlTemplates.find(t => t.id === webhook.templateId);
    const isWW = selectedTemplate && selectedTemplate.type === 'workweixin';

    if(phoneNumberSection) phoneNumberSection.classList.toggle('hidden', !isWW && !isPhoneNumberRequired(selectedTemplate));
    if(recipientLabel) recipientLabel.textContent = isWW ? "接收者 (touser/@all):" : "手机号码:";
    if(phoneNumberInput) {
        phoneNumberInput.value = webhook.phone || (isWW ? '@all' : '');
        phoneNumberInput.placeholder = isWW ? "例: UserID1|UserID2 或 @all" : "请输入目标手机号码";
    }
    if(webhookBodyTextarea) {
        webhookBodyTextarea.value = webhook.plainBody || '';
        webhookBodyTextarea.placeholder = isWW ? "输入企业微信消息内容..." : "输入纯文本消息 (将替换模板中的 {userMessage})";
    }


    updateSelectedTemplateUrlDisplay(webhook.templateId, isWW);
    renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
    if (addHeaderBtn && addHeaderBtn.parentElement) {
      addHeaderBtn.parentElement.classList.toggle('hidden', isWW);
    }


    renderHistoryLog(selectedWebhookId);
    setActiveTab(currentActiveTab, true);
}


function updateSelectedTemplateUrlDisplay(templateId, isWorkWeixinTemplate = false) {
    if (!selectedTemplateUrlContainer) return;
    const urlDisplayEl = document.getElementById('selected-template-url-display');
    const toggleBtn = document.getElementById('toggle-url-visibility-btn');

    if (!urlDisplayEl || !toggleBtn) return;


    if (!templateId) {
        selectedTemplateUrlContainer.classList.add('hidden');
        return;
    }
    const template = webhookUrlTemplates.find(t => t.id === templateId);
    if (!template) {
        selectedTemplateUrlContainer.classList.add('hidden');
        return;
    }

    if (isWorkWeixinTemplate) {
        urlDisplayEl.textContent = "企业微信应用消息接口 (自动处理)";
        urlDisplayEl.dataset.fullUrl = "企业微信应用消息接口 (自动处理)";
        toggleBtn.classList.add('hidden');
    } else {
        const maskedUrl = maskAndMarkUrl(template.url || '');
        urlDisplayEl.textContent = maskedUrl;
        urlDisplayEl.dataset.fullUrl = template.url || '';
        urlDisplayEl.dataset.isMasked = 'true';
        toggleBtn.innerHTML = eyeIconSVG;
        toggleBtn.classList.remove('hidden');
    }
    selectedTemplateUrlContainer.classList.remove('hidden');
}


async function handleNewWebhook() {
    if (selectedWebhookId) await saveCurrentWebhookChanges();
    const newId = await window.electronAPI.getUUID();
    const newWebhook = {
        id: newId,
        name: `新发送配置 ${webhooks.length + 1}`,
        templateId: webhookUrlTemplates.length > 0 ? webhookUrlTemplates[0].id : null,
        phone: '',
        plainBody: "来自Webhook Sender的测试消息",
        headers: []
    };
    webhooks.unshift(newWebhook);
    await window.electronAPI.saveWebhooks(webhooks);
    handleSelectWebhook(newId);
}

async function handleSelectWebhook(webhookId) {
    if (selectedWebhookId === webhookId && currentView === 'sender' && webhookEditorEl && !webhookEditorEl.classList.contains('hidden')) {
        return;
    }
    if (selectedWebhookId) await saveCurrentWebhookChanges();
    selectedWebhookId = webhookId;
    currentActiveTab = 'body';
    showView('sender');
    renderWebhookList();
    renderWebhookEditor();
}

async function saveCurrentWebhookChanges() {
    if (!selectedWebhookId) return;
    const index = webhooks.findIndex(wh => wh.id === selectedWebhookId);
    if (index === -1) return;
    const webhook = webhooks[index];

    if (!webhookNameInput || !templateSelect || !phoneNumberInput || !webhookBodyTextarea) {
        console.error("保存失败：一个或多个编辑器DOM元素未找到。");
        return;
    }

    webhook.name = webhookNameInput.value.trim();
    webhook.templateId = templateSelect.value || null;
    webhook.phone = phoneNumberInput.value.trim();
    webhook.plainBody = webhookBodyTextarea.value;

    const selectedTemplate = webhookUrlTemplates.find(t => t.id === webhook.templateId);
    if (selectedTemplate && selectedTemplate.type === 'workweixin') {
        webhook.headers = [];
    } else {
        webhook.headers = [];
        if (headersListEl) {
            headersListEl.querySelectorAll('.header-item').forEach(div => {
                const keyInput = div.querySelector('.header-key-input');
                const valueInput = div.querySelector('.header-value-input');
                if (keyInput && valueInput) {
                    const key = keyInput.value.trim();
                    const value = valueInput.value.trim();
                    if (key) webhook.headers.push({ key, value });
                }
            });
        }
    }
    renderWebhookList();
    await window.electronAPI.saveWebhooks(webhooks);
}

async function handleDeleteWebhook(webhookId) {
    if (await customConfirm('确定要删除这个发送配置吗？', '删除发送配置')) {
        webhooks = webhooks.filter(wh => wh.id !== webhookId);
        await window.electronAPI.saveWebhooks(webhooks);
        await window.electronAPI.cancelTasksForWebhook(webhookId);

        if (selectedWebhookId === webhookId) {
            selectedWebhookId = null;
            if (webhooks.length > 0) {
                handleSelectWebhook(webhooks[0].id);
            } else {
                showView('sender');
            }
        }
        renderWebhookList();
    }
}

// ===================================================================================
// SECTION: 核心功能 (Core Features - Sending, Scheduling, Tabs, Tasks) - 集成企业微信
// ===================================================================================
async function buildRequestPayload(webhookConfig, template, recipientOrPhone, userMessageText) {
    if (!template) {
        await customAlert('构建请求失败：地址模板无效。');
        return null;
    }

    if (template.type === 'workweixin') {
        if (!template.workweixin_corpid || !template.workweixin_agentid) {
            await customAlert('构建请求失败：所选企业微信模板缺少 CorpID 或 AgentID。');
            return null;
        }
        return {
            id: webhookConfig.id,
            name: webhookConfig.name,
            templateType: 'workweixin',
            workweixinConfig: {
                corpid: template.workweixin_corpid,
                agentid: template.workweixin_agentid,
                touser: recipientOrPhone,
                msgtype: template.workweixin_msgtype || 'text',
            },
            body: userMessageText,
            webhookSnapshot: {
                name: webhookConfig.name,
                templateId: template.id,
                plainBody: userMessageText,
                touser: recipientOrPhone,
                workweixin_msgtype: template.workweixin_msgtype || 'text',
            }
        };
    } else {
        if (!template.url || template.url.trim() === '') {
            await customAlert('构建请求失败：所选地址模板没有有效的URL。请编辑模板并设置URL。');
            return null;
        }
        let finalUrl = template.url || "";
        finalUrl = finalUrl.replace(/{phoneNumber}/g, recipientOrPhone.replace(/"/g, '\\"'));
        finalUrl = finalUrl.replace(/{phone}/g, recipientOrPhone.replace(/"/g, '\\"'));

        const combinedHeaders = [...(template.headers || [])];
        (webhookConfig.headers || []).forEach(specificHeader => {
            const index = combinedHeaders.findIndex(h => h.key.toLowerCase() === specificHeader.key.toLowerCase());
            if (index > -1) combinedHeaders[index] = specificHeader;
            else combinedHeaders.push(specificHeader);
        });

        let finalBody = template.bodyTemplate || `{"msg":"{userMessage}"}`;
        finalBody = finalBody.replace(/{phoneNumber}/g, recipientOrPhone.replace(/"/g, '\\"'));
        finalBody = finalBody.replace(/{phone}/g, recipientOrPhone.replace(/"/g, '\\"'));
        const escapedUserMessage = userMessageText.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t');
        finalBody = finalBody.replace(/{userMessage}/g, escapedUserMessage);

        return {
            id: webhookConfig.id,
            name: webhookConfig.name,
            templateType: 'generic',
            method: template.method,
            url: finalUrl,
            headers: combinedHeaders,
            body: finalBody,
            webhookSnapshot: {
                name: webhookConfig.name,
                templateId: template.id,
                method: template.method,
                headers: combinedHeaders,
                plainBody: userMessageText,
                phoneNumber: recipientOrPhone,
                bodyTemplate: template.bodyTemplate,
                url: template.url
            }
        };
    }
}

async function handleSendNow() {
    if (!selectedWebhookId || isSending) return;
    const webhookConfig = webhooks.find(wh => wh.id === selectedWebhookId);
    if (!webhookConfig) { await customAlert('未找到选定的发送配置！'); return; }
    const template = webhookUrlTemplates.find(t => t.id === webhookConfig.templateId);
    if (!template) { await customAlert('发送配置未关联有效的地址模板！'); return; }

    const recipientOrPhone = phoneNumberInput.value.trim();
    const messageContent = webhookBodyTextarea.value.trim();

    if (template.type === 'workweixin') {
        if (!recipientOrPhone) {
            await customAlert('企业微信模板需要接收者 (touser/@all)，请输入。');
            phoneNumberInput.focus();
            return;
        }
        if (!messageContent && (template.workweixin_msgtype === 'text' || template.workweixin_msgtype === 'markdown')) {
             await customAlert('请输入消息内容。');
             webhookBodyTextarea.focus();
             return;
        }
    } else {
        if (!template.url || template.url.trim() === '') {
            await customAlert('无法发送：所选地址模板没有有效的URL。请编辑模板并设置URL。');
            return;
        }
        if (isPhoneNumberRequired(template) && !recipientOrPhone) {
            await customAlert('当前模板需要手机号码，请输入手机号码！');
            phoneNumberInput.focus();
            return;
        }
    }

    let confirmed = false;

    if (template.type === 'generic' && isPhoneNumberRequired(template) && recipientOrPhone) {
        const webhookName = webhookConfig.name || '当前配置';
        const confirmRecipientText = `手机号码 "${recipientOrPhone}"`;
        const confirmMessage = `确定要向 ${confirmRecipientText} 发送消息吗？\n\n配置名称: ${webhookName}\n消息内容预览: ${messageContent.substring(0, 30)}${messageContent.length > 30 ? '...' : ''}`;
        confirmed = await customConfirm(confirmMessage, '发送确认');
    } else {
        confirmed = true;
    }

    if (!confirmed) {
        return;
    }

    isSending = true;
    if(sendNowBtn) { sendNowBtn.textContent = '发送中...'; sendNowBtn.disabled = true; }

    const webhookToSend = await buildRequestPayload(webhookConfig, template, recipientOrPhone, messageContent);
    if (!webhookToSend) {
        isSending = false;
        if(sendNowBtn) { sendNowBtn.textContent = '立即发送'; sendNowBtn.disabled = false; }
        return;
    }

    try {
        await window.electronAPI.sendNow(webhookToSend);
        setActiveTab('history', true);
    } catch (error) {
        console.error('发送失败 (渲染进程):', error);
        await customAlert(`发送失败: ${error.message || '未知错误'}`);
    } finally {
        isSending = false;
        if(sendNowBtn) {
            sendNowBtn.textContent = '立即发送';
            sendNowBtn.disabled = false;
        }
    }
}

async function handleSaveTask() {
    if (!selectedWebhookId) { await customAlert("请先选择一个发送配置。"); return; }
    const webhookConfig = webhooks.find(wh => wh.id === selectedWebhookId);
    const template = webhookUrlTemplates.find(t => t.id === webhookConfig.templateId);
    if (!template) { await customAlert("请为此发送配置选择一个有效的地址模板。"); return; }

    const scheduledDateTimeValue = scheduleDatetimeInput.value;
    if (!scheduledDateTimeValue) { await customAlert("请选择一个发送日期和时间。"); scheduleDatetimeInput.focus(); return; }
    const scheduledTime = new Date(scheduledDateTimeValue);
    if (isNaN(scheduledTime.getTime()) || scheduledTime <= new Date()) { await customAlert("请选择一个有效的未来时间点。"); scheduleDatetimeInput.focus(); return; }

    const recipientOrPhone = phoneNumberInput.value.trim();
    const messageContent = webhookBodyTextarea.value.trim();

    if (template.type === 'workweixin') {
        if (!recipientOrPhone) {
            await customAlert('企业微信模板需要接收者 (touser/@all) 以创建定时任务。');
            phoneNumberInput.focus();
            return;
        }
         if (!messageContent && (template.workweixin_msgtype === 'text' || template.workweixin_msgtype === 'markdown')) {
             await customAlert('请输入消息内容以创建定时任务。');
             webhookBodyTextarea.focus();
             return;
        }
    } else {
        if (!template.url || template.url.trim() === '') {
            await customAlert('无法创建定时任务：所选地址模板没有有效的URL。请编辑模板并设置URL。');
            return;
        }
        if (isPhoneNumberRequired(template) && !recipientOrPhone) {
            await customAlert('当前模板需要手机号码，请输入手机号码以创建定时任务。');
            phoneNumberInput.focus();
            return;
        }
    }

    const payloadForSnapshot = await buildRequestPayload(webhookConfig, template, recipientOrPhone, messageContent);
    if (!payloadForSnapshot) { return; }

    const taskId = await window.electronAPI.getUUID();
    const newTask = {
        id: taskId,
        originalWebhookId: selectedWebhookId,
        scheduledTime: scheduledTime.toISOString(),
        templateType: template.type,
        finalUrl: template.type === 'workweixin' ? "WORKWEIXIN_API_SEND" : payloadForSnapshot.url,
        webhookSnapshot: payloadForSnapshot.webhookSnapshot,
    };

    if (template.type === 'workweixin') {
        newTask.workweixinConfig = {
            touser: recipientOrPhone,
            msgtype: template.workweixin_msgtype || 'text'
        };
    }

    console.log('[Renderer-SaveTask] 正在创建新的定时任务:', JSON.stringify(newTask, null, 2));

    const result = await window.electronAPI.scheduleExplicitTask(newTask);
    if (result && result.success) {
        await customAlert(`定时任务已保存！\n计划时间: ${formatDate(newTask.scheduledTime)}`);
        if(scheduleDatetimeInput) scheduleDatetimeInput.value = '';
    } else {
        await customAlert(`保存定时任务失败: ${result ? result.msg : '未知错误'}`);
    }
}


function renderHeaders(headers, listEl, keyClass, valueClass, removeClass, focusColor = 'indigo') {
    if (!listEl) return;
    listEl.innerHTML = '';
    (headers || []).forEach((header, index) => {
        const div = document.createElement('div');
        div.className = 'flex items-center space-x-2 mb-2 header-item';
        div.innerHTML = `<input type="text" value="${header.key || ''}" placeholder="Key" class="${keyClass} w-1/3 bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-${focusColor}-500 focus:ring-1 focus:ring-${focusColor}-500"><input type="text" value="${header.value || ''}" placeholder="Value" class="${valueClass} flex-grow bg-[#1a1d24] border border-gray-600 rounded px-3 py-1.5 text-white focus:outline-none focus:border-${focusColor}-500 focus:ring-1 focus:ring-${focusColor}-500"><button data-header-index="${index}" class="${removeClass} text-red-500 hover:text-red-400 focus:outline-none p-1 rounded hover:bg-red-500/20 transition-colors">&#x2715;</button>`;
        listEl.appendChild(div);
    });
}

function renderHistoryLog(webhookIdToRender) {
    if (!historyLogListEl || !webhookIdToRender) {
        if(historyLogListEl) historyLogListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">请先选择一个发送配置以查看历史。</p>';
        return;
    }
    historyLogListEl.innerHTML = '';
    const logs = history[webhookIdToRender] || [];
    if (logs.length === 0) {
        historyLogListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">还没有发送记录</p>';
        return;
    }
    logs.forEach(entry => {
        const div = document.createElement('div');
        div.className = 'bg-[#1a1d24] p-3 rounded shadow-sm border border-gray-700/50';
        let sClass = 'text-yellow-400', sText = '发送中...';
        if (entry.status === 'success') { sClass = 'text-green-400'; sText = `成功 (${entry.response?.status || entry.response?.data?.errcode === 0 ? (entry.response?.data?.errcode === 0 ? '企业微信OK' : entry.response?.status) : 'N/A'})`; }
        else if (entry.status === 'failure') { sClass = 'text-red-400'; sText = `失败 (${entry.error?.code || entry.error?.data?.errcode || entry.error?.response?.status || 'N/A'})`; }

        const webhookForName = webhooks.find(wh => wh.id === entry.webhookId);
        const taskName = webhookForName?.name || 'N/A';

        let plainBodyContent = entry.request?.plainBody;
        if (typeof plainBodyContent === 'undefined' && entry.request?.body) {
            if (entry.request.templateType === 'workweixin' && typeof entry.request.body === 'object') {
                if (entry.request.body.text && typeof entry.request.body.text.content === 'string') {
                    plainBodyContent = entry.request.body.text.content;
                } else if (entry.request.body.markdown && typeof entry.request.body.markdown.content === 'string') {
                    plainBodyContent = entry.request.body.markdown.content;
                } else {
                     plainBodyContent = '(企业微信消息体)';
                }
            } else if (typeof entry.request.body === 'string') {
                try {
                    const bodyObj = JSON.parse(entry.request.body);
                    if (typeof bodyObj.msg === 'string') plainBodyContent = bodyObj.msg;
                    else if (bodyObj.text && typeof bodyObj.text.content === 'string') plainBodyContent = bodyObj.text.content;
                    else if (bodyObj.text && typeof bodyObj.text === 'string') plainBodyContent = bodyObj.text;
                    else if (bodyObj.content && typeof bodyObj.content === 'string') plainBodyContent = bodyObj.content;
                    else plainBodyContent = '(无法从JSON Body自动提取消息)';
                } catch (e) {
                    plainBodyContent = entry.request.body;
                }
            } else {
                 plainBodyContent = '(请求体非文本或解析失败)';
            }
        }
        if (typeof plainBodyContent === 'undefined') plainBodyContent = '(未记录纯文本)';


        const messagePreview = typeof plainBodyContent === 'string'
            ? (plainBodyContent.length > 20 ? plainBodyContent.substring(0, 20) + '...' : plainBodyContent)
            : '(非文本内容)';


        let requestSnapshot = entry.request || {};
        if (requestSnapshot.templateType === 'workweixin') {
            requestSnapshot = {
                ...requestSnapshot,
                url: `企业微信 API (类型: ${requestSnapshot.workweixinConfig?.msgtype || 'N/A'})`,
            };
        } else if (requestSnapshot.url) {
            requestSnapshot = {
                ...requestSnapshot,
                url: maskAndMarkUrl(requestSnapshot.url)
            };
        }
        const responseSnapshot = entry.response || entry.error || {};

        div.innerHTML = `
            <div class="flex justify-between items-center cursor-pointer history-log-header">
                <div class="flex items-center flex-grow min-w-0">
                    <span class="font-semibold text-sm ${sClass} flex-shrink-0">● ${sText}</span>
                    <span class="ml-2 text-xs text-gray-400 truncate" style="max-width: 200px;" title="${typeof plainBodyContent === 'string' ? plainBodyContent : '(非文本内容)'}">${messagePreview}</span>
                </div>
                <div class="flex items-center flex-shrink-0 ml-2">
                    <span class="text-xs text-gray-500">${formatDate(entry.timestamp)}</span>
                    <span class="text-xs text-gray-500 transform transition-transform duration-200 history-arrow ml-2">&#x25BC;</span>
                </div>
            </div>
            <div class="history-details mt-3 pt-3 border-t border-gray-700 hidden bg-black/20 p-2 rounded max-h-96 overflow-y-auto">
                <p class="text-xs text-gray-400 mb-1">任务名称: <span class="text-gray-200">${taskName}</span></p>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">发送的纯文本内容:</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap mb-2 bg-[#1e2128] p-1.5 rounded">${typeof plainBodyContent === 'string' ? plainBodyContent : '(非文本内容)'}</pre>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">完整请求快照 (Request):</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap mb-2 bg-[#1e2128] p-1.5 rounded">${JSON.stringify(requestSnapshot, null, 2)}</pre>
                <h4 class="font-semibold mb-1 text-gray-300 text-xs mt-2">响应/错误详情 (Response/Error):</h4>
                <pre class="text-xs text-gray-400 whitespace-pre-wrap bg-[#1e2128] p-1.5 rounded">${JSON.stringify(responseSnapshot, null, 2)}</pre>
            </div>`;
        historyLogListEl.appendChild(div);
    });
}


async function handleCancelTask(taskId) {
    if (await customConfirm("确定要取消这个定时任务吗？", "取消定时任务")) {
        const result = await window.electronAPI.cancelExplicitTask(taskId);
        if (result && result.success) {
            await customAlert("定时任务已取消。");
        } else {
            await customAlert(`取消任务失败: ${result ? result.msg : '未知错误'}`);
        }
    }
}


function renderScheduledTaskList() {
    if (!scheduledTaskListEl) return;
    scheduledTaskListEl.innerHTML = '';
    if (scheduledTasks.length === 0) {
        scheduledTaskListEl.innerHTML = '<p class="text-center text-gray-400 py-8 text-sm">当前没有待执行的定时任务</p>';
        return;
    }
    [...scheduledTasks].sort((a, b) => new Date(a.scheduledTime) - new Date(b.scheduledTime)).forEach(task => {
        const div = document.createElement('div');
        div.className = 'bg-[#1a1d24] p-3 rounded shadow-sm border border-gray-700/50 flex justify-between items-center mb-2';
        const taskInfo = document.createElement('div');
        taskInfo.className = 'flex-grow mr-2 min-w-0';

        const configName = task.webhookSnapshot?.name || '未知配置';
        let displayIdentifier = '';
        let contentPreview = task.webhookSnapshot?.plainBody || '(空)';

        if (task.templateType === 'workweixin') {
            displayIdentifier = `企微消息 (类型: ${task.workweixinConfig?.msgtype || 'N/A'}) 给 ${task.workweixinConfig?.touser || '未知接收者'}`;
        } else {
            displayIdentifier = `URL: ${maskAndMarkUrl(task.finalUrl)}`;
        }


        taskInfo.innerHTML = `
            <p class="text-sm text-gray-200 font-semibold truncate" title="基于配置: ${configName}">发送到: <span class="font-normal">${configName}</span></p>
            <p class="text-xs text-indigo-300 truncate" title="${task.templateType === 'workweixin' ? '企业微信任务' : task.finalUrl}">目标: <span class="font-normal text-gray-400">${displayIdentifier}</span></p>
            <p class="text-xs text-gray-400">计划时间: ${formatDate(task.scheduledTime)}</p>
            <p class="text-xs text-gray-500 truncate" title="${contentPreview}">内容: ${contentPreview.substring(0,30)}${contentPreview.length > 30 ? '...' : ''}</p>`;

        const cancelButton = document.createElement('button');
        cancelButton.dataset.taskId = task.id;
        cancelButton.className = 'cancel-task-btn bg-red-600 hover:bg-red-700 text-white text-xs font-bold py-1 px-3 rounded focus:outline-none transition-colors flex-shrink-0';
        cancelButton.textContent = '取消';

        div.appendChild(taskInfo);
        div.appendChild(cancelButton);
        scheduledTaskListEl.appendChild(div);
    });
}


function setActiveTab(tabName, forceRender = false) {
    if (currentActiveTab === tabName && !forceRender && editorTabs && editorTabs.length > 0) {
        const currentActiveButton = Array.from(editorTabs).find(tab => tab.dataset.tab === tabName);
        if (currentActiveButton && currentActiveButton.classList.contains('text-white')) {
            return;
        }
    }
    currentActiveTab = tabName;
    if(editorTabs) {
        editorTabs.forEach(tab => {
            const isTabActive = tab.dataset.tab === tabName;
            tab.classList.toggle('border-indigo-500', isTabActive);
            tab.classList.toggle('text-white', isTabActive);
            tab.classList.toggle('text-gray-400', !isTabActive);
            tab.classList.toggle('border-transparent', !isTabActive);
        });
    }
    const paneMap = { body: tabContentBody, headers: tabContentHeaders, schedule: tabContentSchedule, history: tabContentHistory };
    Object.values(paneMap).forEach(pane => { if (pane) pane.classList.add('hidden'); });

    if (paneMap[tabName]) {
        paneMap[tabName].classList.remove('hidden');
        paneMap[tabName].classList.add('flex', 'flex-col');
        if (tabName === 'body' || tabName === 'headers' || tabName === 'history' || tabName === 'schedule' ) {
            paneMap[tabName].classList.add('flex-grow');
        }
        if (tabName === 'history') renderHistoryLog(selectedWebhookId);
        if (tabName === 'schedule') renderScheduledTaskList();
    }
}

// ===================================================================================
// SECTION: 应用初始化 (App Initialization)
// ===================================================================================
async function initApp() {
    console.log("[App] 初始化渲染器...");

    if(minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
    if(maximizeBtn) maximizeBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
    if(closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
    if(navSenderViewBtn) navSenderViewBtn.addEventListener('click', () => showView('sender'));
    if(navTemplateViewBtn) navTemplateViewBtn.addEventListener('click', () => showView('templates'));

    if(templateTypeSelect) {
        templateTypeSelect.addEventListener('change', () => {
            const newTypeSelectedInDropdown = templateTypeSelect.value;
            console.log('[Renderer-Debug] templateTypeSelect CHANGED by user to:', newTypeSelectedInDropdown);

            if (selectedTemplateId) {
                const templateToUpdate = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
                if (templateToUpdate) {
                    console.log(`[Renderer-Debug] Updating in-memory template (ID: ${selectedTemplateId}) from type '${templateToUpdate.type}' to '${newTypeSelectedInDropdown}'`);
                    templateToUpdate.type = newTypeSelectedInDropdown;

                    if (newTypeSelectedInDropdown === 'workweixin') {
                        templateToUpdate.url = "WORKWEIXIN_APP_MESSAGE_API";
                        templateToUpdate.method = "POST";
                        templateToUpdate.headers = [];
                        templateToUpdate.workweixin_corpid = templateToUpdate.workweixin_corpid || '';
                        templateToUpdate.workweixin_corpsecret = templateToUpdate.workweixin_corpsecret || '';
                        templateToUpdate.workweixin_agentid = templateToUpdate.workweixin_agentid || '';
                        templateToUpdate.workweixin_msgtype = templateToUpdate.workweixin_msgtype || 'text';
                        try { JSON.parse(templateToUpdate.bodyTemplate); templateToUpdate.bodyTemplate = '{userMessage}'; }
                        catch(e) { if (!templateToUpdate.bodyTemplate || templateToUpdate.bodyTemplate.trim() === '') templateToUpdate.bodyTemplate = '{userMessage}';}

                    } else {
                        if (templateToUpdate.url === "WORKWEIXIN_APP_MESSAGE_API") templateToUpdate.url = '';
                        templateToUpdate.method = templateToUpdate.method || 'POST';
                        if (templateToUpdate.bodyTemplate === '{userMessage}') {
                             templateToUpdate.bodyTemplate = JSON.stringify({ msgtype: "text", text: { content: "{userMessage}" } }, null, 2);
                        }
                        delete templateToUpdate.workweixin_corpid;
                        delete templateToUpdate.workweixin_corpsecret;
                        delete templateToUpdate.workweixin_agentid;
                        delete templateToUpdate.workweixin_msgtype;
                    }
                }
            }
            renderTemplateEditor();
        });
    }


    // 模板管理事件
    if(newTemplateBtn) newTemplateBtn.addEventListener('click', handleNewTemplate);
    if(templateListEl) templateListEl.addEventListener('click', e => {
        const deleteBtn = e.target.closest('.delete-template-btn');
        const listItem = e.target.closest('li[data-id]');
        if (deleteBtn) { e.stopPropagation(); handleDeleteTemplate(deleteBtn.dataset.deleteId); }
        else if (listItem) { handleSelectTemplate(listItem.dataset.id); }
    });
    if(saveTemplateBtn) saveTemplateBtn.addEventListener('click', saveCurrentTemplateChanges);


    [templateNameInput, workweixinCorpidInput, workweixinCorpsecretInput, workweixinAgentidInput, workweixinMsgtypeSelect, templateBodyInput, templateMethodSelect].forEach(el => {
        if(el) el.addEventListener('input', () => { /* 实时校验或标记未保存 */ });
    });


    if (templateUrlInput) {
        templateUrlInput.addEventListener('focus', () => {
            if (!selectedTemplateId) return;
            const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
            if (template && template.type === 'generic') {
                templateUrlInput.value = template.url || '';
                templateUrlInput.placeholder = '输入新地址以替换';
            }
        });
        templateUrlInput.addEventListener('blur', async () => {
            if (!selectedTemplateId) return;
            const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
            if (!template || template.type !== 'generic') return;
            renderTemplateEditor();
        });
    }


    if(addTemplateHeaderBtn) addTemplateHeaderBtn.addEventListener('click', async () => {
         const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
         if(template && template.type === 'generic') {
            if(!template.headers) template.headers = [];
            template.headers.push({key: '', value: ''});
            renderTemplateEditor();
        }
    });
    if(templateHeadersListEl) templateHeadersListEl.addEventListener('click', async e => {
        const btn = e.target.closest('.remove-template-header-btn');
        if (btn) {
            const index = btn.dataset.headerIndex;
            const template = webhookUrlTemplates.find(t => t.id === selectedTemplateId);
            if (template && template.type === 'generic' && template.headers) {
                template.headers.splice(index, 1);
                renderTemplateEditor();
            }
        }
    });


    // 发送配置事件
    if(newWebhookBtn) newWebhookBtn.addEventListener('click', handleNewWebhook);
    if(webhookListEl) webhookListEl.addEventListener('click', e => {
        const deleteBtn = e.target.closest('.delete-webhook-btn');
        const listItem = e.target.closest('li[data-id]');
        if (deleteBtn) { e.stopPropagation(); handleDeleteWebhook(deleteBtn.dataset.deleteId); }
        else if (listItem) { handleSelectWebhook(listItem.dataset.id); }
    });
    if(templateSelect) templateSelect.addEventListener('change', async () => {
        if (selectedWebhookId) {
            const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
            if (webhook) {
                webhook.templateId = templateSelect.value || null;
                await saveCurrentWebhookChanges();
                renderWebhookEditor();
            }
        }
    });

    [webhookNameInput, phoneNumberInput, webhookBodyTextarea].forEach(el => {
        if(el) el.addEventListener('input', () => { /* 标记未保存等 */ });
    });


    if(sendNowBtn) sendNowBtn.addEventListener('click', handleSendNow);
    if(editorTabs) editorTabs.forEach(tab => tab.addEventListener('click', () => setActiveTab(tab.dataset.tab)));

    if(addHeaderBtn) addHeaderBtn.addEventListener('click', async () => {
         const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
         const template = webhookUrlTemplates.find(t => t.id === webhook?.templateId);
         if(webhook && (!template || template.type === 'generic')) {
            if(!webhook.headers) webhook.headers = [];
            webhook.headers.push({key: '', value: ''});
            renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
        }
    });
    if(headersListEl) headersListEl.addEventListener('click', async e => {
        const btn = e.target.closest('.remove-header-btn');
        if (btn) {
            const index = btn.dataset.headerIndex;
            const webhook = webhooks.find(wh => wh.id === selectedWebhookId);
             const template = webhookUrlTemplates.find(t => t.id === webhook?.templateId);
            if (webhook && (!template || template.type === 'generic') && webhook.headers) {
                webhook.headers.splice(index, 1);
                renderHeaders(webhook.headers, headersListEl, 'header-key-input', 'header-value-input', 'remove-header-btn', 'indigo');
            }
        }
    });
    if(historyLogListEl) historyLogListEl.addEventListener('click', e => {
        const header = e.target.closest('.history-log-header');
        if (header && header.nextElementSibling) {
            header.nextElementSibling.classList.toggle('hidden');
            const arrow = header.querySelector('.history-arrow');
            if(arrow) arrow.classList.toggle('rotate-180');
        }
    });
    if(saveTaskBtn) saveTaskBtn.addEventListener('click', handleSaveTask);
    if(scheduledTaskListEl) scheduledTaskListEl.addEventListener('click', (e) => {
        const cancelButton = e.target.closest('.cancel-task-btn');
        if (cancelButton && cancelButton.dataset.taskId) {
            handleCancelTask(cancelButton.dataset.taskId);
        }
    });

    if (backupBtn) {
        backupBtn.addEventListener('click', async () => {
            if(currentView === 'sender' && selectedWebhookId) await saveCurrentWebhookChanges();
            if(currentView === 'templates' && selectedTemplateId) await saveCurrentTemplateChanges();
            const result = await window.electronAPI.backupConfig();
            await customAlert(result.msg, result.success ? '备份成功' : '备份失败');
        });
    }

    if (restoreBtn) {
        restoreBtn.addEventListener('click', async () => {
            const confirmed = await customConfirm(
                '恢复配置将会覆盖所有当前设置，且无法撤销。确定要继续吗？',
                '警告'
            );
            if (!confirmed) return;

            const result = await window.electronAPI.restoreConfig();
            if (result.success) {
                const restoredData = result.data;
                webhooks = restoredData.webhooks || [];
                webhookUrlTemplates = restoredData.webhookUrlTemplates || [];
                history = restoredData.history || {};
                scheduledTasks = restoredData.scheduledTasks || [];

                renderWebhookList();
                renderTemplateList();

                selectedWebhookId = null;
                selectedTemplateId = null;
                if (webhooks.length > 0) {
                    handleSelectWebhook(webhooks[0].id);
                } else if (webhookUrlTemplates.length > 0) {
                     handleSelectTemplate(webhookUrlTemplates[0].id);
                } else {
                    showView('sender');
                    showWelcomeScreen('任何项目', '从左侧选择一个项目，或创建一个新的。');
                }
            }
            await customAlert(result.msg, result.success ? '恢复成功' : '恢复失败');
        });
    }

    if (startupCheckbox) {
        try {
            const isStartupEnabled = await window.electronAPI.getStartupSetting();
            startupCheckbox.checked = isStartupEnabled;
        } catch (error) {
            console.error("获取开机启动设置失败:", error);
            await customAlert("获取开机启动设置失败，请稍后重试。", "错误");
        }

        startupCheckbox.addEventListener('change', async (event) => {
            const enable = event.target.checked;
            try {
                await window.electronAPI.setStartupSetting(enable);
                await customAlert(enable ? "已设置为开机启动。" : "已取消开机启动。", "设置成功");
            } catch (error) {
                console.error("设置开机启动失败:", error);
                await customAlert("设置开机启动失败，请检查应用权限或稍后重试。", "错误");
                startupCheckbox.checked = !enable;
            }
        });
    }

    if (titlebarAboutBtn) {
        titlebarAboutBtn.addEventListener('click', () => {
            showView(currentView, true);
        });
    }
    if (devBlogLink) {
        devBlogLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.electronAPI.openExternalLink(devBlogLink.href);
        });
    }
    if (closeAboutViewBtn) {
        closeAboutViewBtn.addEventListener('click', () => {
            showView(currentView);
        });
    }

    window.electronAPI.onScheduledTasksUpdate(tasksFromServer => {
        console.log('[Renderer] 收到定时任务更新:', tasksFromServer);
        scheduledTasks = tasksFromServer || [];
        if (currentView === 'sender' && currentActiveTab === 'schedule' && webhookEditorEl && webhookEditorEl.classList.contains('flex')) {
             renderScheduledTaskList();
        }
    });
    window.electronAPI.onHistoryUpdate(({ webhookId, entry }) => {
        console.log('[Renderer] 收到历史记录更新:', webhookId, entry);
        if (!history[webhookId]) history[webhookId] = [];
        const index = history[webhookId].findIndex(e => e.id === entry.id);
        if (index !== -1) history[webhookId][index] = entry;
        else history[webhookId].unshift(entry);

        if (history[webhookId].length > 50) {
            history[webhookId] = history[webhookId].slice(0, 50);
        }

        if (selectedWebhookId === webhookId && currentActiveTab === 'history' && webhookEditorEl && webhookEditorEl.classList.contains('flex')) {
            renderHistoryLog(webhookId);
        }
    });

    try {
        const data = await window.electronAPI.getStoreData();
        webhooks = data.webhooks || [];
        webhookUrlTemplates = data.webhookUrlTemplates || [];
        history = data.history || {};
        scheduledTasks = data.scheduledTasks || [];
        console.log("[App] 初始数据已加载。", { webhooks, webhookUrlTemplates, scheduledTasks, history });
    } catch (error) { console.error("加载初始数据失败:", error); }

    renderWebhookList();
    renderTemplateList();

    if (webhooks.length > 0) {
        handleSelectWebhook(webhooks[0].id);
    } else if (webhookUrlTemplates.length > 0) {
        handleSelectTemplate(webhookUrlTemplates[0].id);
    } else {
        showView('sender');
        showWelcomeScreen('发送配置', '请从左侧列表选择一个，或点击“新建配置”。');
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
} else {
    initApp();
}
