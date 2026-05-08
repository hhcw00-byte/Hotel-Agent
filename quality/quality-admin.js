(function () {
  // ==================== i18n ====================
  var LANG_KEY = 'app-language';
  var lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh';

  var I18N = {
    'page.title':            { zh: '质检任务', en: 'Quality Tasks' },
    'page.subtitle':         { zh: '发布门店执行任务，复制提交链接并查看提交结果', en: 'Create tasks for stores, copy submit links and review results' },
    'btn.refresh':           { zh: '刷新', en: 'Refresh' },
    'section.create':        { zh: '发布任务', en: 'Create Task' },
    'label.taskName':        { zh: '任务名称', en: 'Task Name' },
    'ph.taskName':           { zh: '例：客房卫生每日质检', en: 'e.g. Daily Room Hygiene Check' },
    'label.storeName':       { zh: '执行门店', en: 'Store' },
    'ph.storeName':          { zh: '例：上海人民广场店', en: "e.g. Shanghai People's Square" },
    'label.dueAt':           { zh: '截止时间', en: 'Due Date' },
    'label.instructions':    { zh: '任务说明', en: 'Instructions' },
    'ph.instructions':       { zh: '说明执行要求、拍照标准或注意事项', en: 'Describe requirements, photo standards or notes' },
    'label.checkItems':      { zh: '检查项', en: 'Check Items' },
    'btn.addItem':           { zh: '新增检查项', en: 'Add Item' },
    'btn.createTask':        { zh: '发布任务', en: 'Create Task' },
    'section.taskList':      { zh: '任务列表', en: 'Task List' },
    'section.result':        { zh: '提交结果', en: 'Submission Result' },
    'empty.loading':         { zh: '加载中...', en: 'Loading...' },
    'empty.selectTask':      { zh: '选择任务查看结果', en: 'Select a task to view result' },
    'empty.noTasks':         { zh: '暂无质检任务', en: 'No quality tasks yet' },
    'item.title':            { zh: '检查项', en: 'Item' },
    'item.name':             { zh: '名称', en: 'Name' },
    'item.namePh':           { zh: '例：前台台面整洁', en: 'e.g. Front desk cleanliness' },
    'item.desc':             { zh: '说明', en: 'Description' },
    'item.descPh':           { zh: '补充检查标准', en: 'Additional check criteria' },
    'item.requireAttach':    { zh: '必须上传附件', en: 'Attachment required' },
    'item.requireRemark':    { zh: '必须填写备注', en: 'Remark required' },
    'btn.delete':            { zh: '删除', en: 'Delete' },
    'th.task':               { zh: '任务', en: 'Task' },
    'th.store':              { zh: '门店', en: 'Store' },
    'th.dueAt':              { zh: '截止时间', en: 'Due Date' },
    'th.status':             { zh: '状态', en: 'Status' },
    'th.submittedAt':        { zh: '提交时间', en: 'Submitted' },
    'th.actions':            { zh: '操作', en: 'Actions' },
    'btn.copyLink':          { zh: '复制提交链接', en: 'Copy Link' },
    'btn.openSubmit':        { zh: '打开提交页', en: 'Open Submit' },
    'btn.viewResult':        { zh: '查看结果', en: 'View Result' },
    'status.pending':        { zh: '待提交', en: 'Pending' },
    'status.submitted':      { zh: '已提交 / 待审核', en: 'Submitted / Pending Review' },
    'status.approved':       { zh: '已通过', en: 'Approved' },
    'status.rejected':       { zh: '已驳回 / 待重传', en: 'Rejected / Resubmit' },
    'review.notSubmitted':   { zh: '未提交', en: 'Not Submitted' },
    'review.pending':        { zh: '待审核', en: 'Pending Review' },
    'review.approved':       { zh: '已通过', en: 'Approved' },
    'review.rejected':       { zh: '已驳回', en: 'Rejected' },
    'result.taskStatus':     { zh: '任务状态', en: 'Task Status' },
    'result.submittedAt':    { zh: '提交时间', en: 'Submitted At' },
    'result.reviewStatus':   { zh: '审核状态', en: 'Review Status' },
    'result.store':          { zh: '执行门店', en: 'Store' },
    'result.dueAt':          { zh: '截止时间', en: 'Due Date' },
    'result.rejectReason':   { zh: '驳回理由', en: 'Reject Reason' },
    'result.notSubmitted':   { zh: '该任务尚未提交。', en: 'This task has not been submitted yet.' },
    'btn.approve':           { zh: '审核通过', en: 'Approve' },
    'btn.reject':            { zh: '驳回重传', en: 'Reject' },
    'btn.confirmReject':     { zh: '确认驳回', en: 'Confirm Reject' },
    'btn.cancel':            { zh: '取消', en: 'Cancel' },
    'label.rejectReason':    { zh: '驳回理由', en: 'Reject Reason' },
    'ph.rejectReason':       { zh: '请填写驳回理由', en: 'Please enter reject reason' },
    'label.remark':          { zh: '备注', en: 'Remark' },
    'label.attachments':     { zh: '附件', en: 'Attachments' },
    'noAttachments':         { zh: '无附件', en: 'No attachments' },
    'btn.open':              { zh: '打开', en: 'Open' },
    'nItems':                { zh: ' 个检查项', en: ' items' },
    'msg.taskCreated':       { zh: '任务已发布。', en: 'Task created.' },
    'msg.taskCreatedLink':   { zh: '任务已发布，公网提交链接已复制。', en: 'Task created, submit link copied.' },
    'msg.linkCopied':        { zh: '提交链接已复制', en: 'Submit link copied' },
    'msg.approved':          { zh: '审核已通过', en: 'Approved' },
    'msg.rejected':          { zh: '已驳回，等待门店重传', en: 'Rejected, waiting for resubmission' },
    'msg.cancelReject':      { zh: '已取消驳回', en: 'Reject cancelled' },
    'msg.prepareReject':     { zh: '准备驳回任务，请填写驳回理由', en: 'Preparing to reject, please enter reason' },
    'err.fillRequired':      { zh: '请填写任务名称和执行门店。', en: 'Please fill in task name and store.' },
    'err.needItem':          { zh: '至少需要一个检查项。', en: 'At least one check item is required.' },
    'err.noLink':            { zh: '提交链接不存在，请刷新任务列表', en: 'Submit link not found, please refresh' },
    'err.notHttps':          { zh: '提交链接不是公网 HTTPS 链接，请检查 Quality Service 返回值', en: 'Submit link is not HTTPS, check Quality Service response' },
    'err.noTaskId':          { zh: '任务 ID 缺失，无法审核', en: 'Task ID missing' },
    'err.noRejectReason':    { zh: '请填写驳回理由', en: 'Please enter reject reason' },
    'err.noReviewArea':      { zh: '未找到审核操作区，无法驳回', en: 'Review area not found' },
    'err.copyFail':          { zh: '复制失败，请手动复制提交链接', en: 'Copy failed, please copy manually' },
    'err.noUrl':             { zh: '链接不存在', en: 'Link not found' },
    'err.openFail':          { zh: '打开链接失败，请先复制链接后手动打开', en: 'Failed to open link, please copy and open manually' },
    'file':                  { zh: '文件', en: 'File' },
  };

  function t(key) {
    var entry = I18N[key];
    return entry ? entry[lang] : key;
  }

  function setLang(newLang) {
    lang = newLang;
    try { localStorage.setItem(LANG_KEY, lang); } catch (e) {}
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    applyStaticI18n();
    renderItemEditor();
    renderTaskList();
    // 通知主进程
    if (window.electronAPI && window.electronAPI.config && window.electronAPI.config.setLanguage) {
      window.electronAPI.config.setLanguage(lang).catch(function () {});
    }
  }

  function applyStaticI18n() {
    setText('pageTitle', t('page.title'));
    setText('pageSubtitle', t('page.subtitle'));
    setText('refreshBtn', t('btn.refresh'));
    setText('sectionCreateTitle', t('section.create'));
    setText('labelTaskName', t('label.taskName'));
    setPlaceholder('taskName', t('ph.taskName'));
    setText('labelStoreName', t('label.storeName'));
    setPlaceholder('storeName', t('ph.storeName'));
    setText('labelDueAt', t('label.dueAt'));
    setText('labelInstructions', t('label.instructions'));
    setPlaceholder('instructions', t('ph.instructions'));
    setText('labelCheckItems', t('label.checkItems'));
    setText('addItemBtn', t('btn.addItem'));
    setText('createTaskBtn', t('btn.createTask'));
    setText('sectionTaskListTitle', t('section.taskList'));
    setText('sectionResultTitle', t('section.result'));
    var langBtn = document.getElementById('langToggleBtn');
    if (langBtn) langBtn.textContent = lang === 'zh' ? 'EN' : '中文';
    document.title = t('page.title');
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }

  function setPlaceholder(id, text) {
    var el = document.getElementById(id);
    if (el) el.placeholder = text;
  }

  // ==================== Config & State ====================
  var QUALITY_SERVICE_BASE_URL = 'https://www.intent-computing.com/hotel-agent/api';
  var qualityApi = window.electronAPI && window.electronAPI.quality;
  var tasks = [];
  var draftItems = [
    { name: '', description: '', requireAttachment: true, requireRemark: false },
  ];

  var form = document.getElementById('taskForm');
  var itemEditor = document.getElementById('itemEditor');
  var taskList = document.getElementById('taskList');
  var resultContent = document.getElementById('resultContent');
  var formMessage = document.getElementById('formMessage');
  var imageModal = document.getElementById('imageModal');
  var previewImage = document.getElementById('previewImage');
  var cachedQualityUserId = null;

  // ==================== Init ====================
  function init() {
    applyStaticI18n();
    taskList.innerHTML = '<div class="empty">' + escapeHtml(t('empty.loading')) + '</div>';
    resultContent.innerHTML = '<div class="empty">' + escapeHtml(t('empty.selectTask')) + '</div>';
    bindEvents();
    renderItemEditor();
    loadTasks();
  }

  function bindEvents() {
    document.getElementById('refreshBtn').addEventListener('click', loadTasks);
    document.getElementById('langToggleBtn').addEventListener('click', function () {
      setLang(lang === 'zh' ? 'en' : 'zh');
    });

    document.getElementById('addItemBtn').addEventListener('click', function () {
      draftItems.push({ name: '', description: '', requireAttachment: false, requireRemark: false });
      renderItemEditor();
    });

    form.addEventListener('submit', async function (event) {
      event.preventDefault();
      await createTask();
    });

    itemEditor.addEventListener('input', syncDraftItems);
    itemEditor.addEventListener('change', syncDraftItems);
    itemEditor.addEventListener('click', function (event) {
      var btn = event.target.closest('[data-remove-item]');
      if (!btn) return;
      syncDraftItems();
      draftItems.splice(Number(btn.dataset.removeItem), 1);
      if (draftItems.length === 0) {
        draftItems.push({ name: '', description: '', requireAttachment: false, requireRemark: false });
      }
      renderItemEditor();
    });

    taskList.addEventListener('click', async function (event) {
      var actionBtn = event.target.closest('button[data-action]');
      if (actionBtn) {
        event.preventDefault();
        var action = actionBtn.dataset.action;
        var taskId = actionBtn.dataset.taskId;
        if (action === 'copy-submit-link') { await copySubmitLink(taskId); return; }
        if (action === 'open-submit-link') { await openSubmitPage(taskId); return; }
      }
      var resultBtn = event.target.closest('[data-view-result]');
      if (resultBtn) { await viewResult(resultBtn.dataset.viewResult); }
    });

    resultContent.addEventListener('click', async function (event) {
      var actionBtn = event.target.closest('button[data-action]');
      if (actionBtn) {
        event.preventDefault();
        var action = actionBtn.dataset.action;
        var taskId = actionBtn.dataset.taskId;
        if (action === 'approve-submission') { await approveSubmission(taskId); return; }
        if (action === 'reject-submission') { showRejectPanel(taskId); return; }
        if (action === 'confirm-reject-submission') { await rejectSubmission(taskId); return; }
        if (action === 'cancel-reject-submission') { removeRejectPanels(); showMessage(formMessage, t('msg.cancelReject'), 'info'); return; }
      }
      var preview = event.target.closest('[data-preview-image]');
      if (preview) { previewImage.src = preview.dataset.previewImage; imageModal.classList.add('show'); return; }
      var openBtn = event.target.closest('[data-open-attachment]');
      if (openBtn) { await openUrl(openBtn.dataset.openAttachment); }
    });

    imageModal.addEventListener('click', function () {
      imageModal.classList.remove('show');
      previewImage.removeAttribute('src');
    });
  }

  // ==================== HTTP Request ====================
  async function qualityRequest(path, options) {
    options = options || {};

    // Electron: IPC proxy (file:// cannot fetch https://)
    if (qualityApi && typeof qualityApi.httpRequest === 'function') {
      var method = options.method || (options.body != null ? 'POST' : 'GET');
      var body = options.body;
      if (body != null && typeof body !== 'string' && !(typeof FormData !== 'undefined' && body instanceof FormData)) {
        // already object
      } else if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) {}
      }
      var result = await qualityApi.httpRequest(method, path, body);
      if (!result || result.success === false) {
        throw new Error((result && result.error) || 'Request failed');
      }
      return result.data;
    }

    // Browser: direct fetch
    var url = buildServiceUrl(path);
    var headers = Object.assign({ Accept: 'application/json' }, options.headers || {});
    var fetchOptions = Object.assign({}, options, { headers: headers });
    var hasBody = Object.prototype.hasOwnProperty.call(options, 'body');
    var fetchBody = options.body;
    var isFormData = typeof FormData !== 'undefined' && fetchBody instanceof FormData;

    if (hasBody && fetchBody != null && !isFormData && typeof fetchBody !== 'string') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json; charset=utf-8';
      fetchOptions.body = JSON.stringify(fetchBody);
    } else if (hasBody && fetchBody != null) {
      fetchOptions.body = fetchBody;
      if (!isFormData) { headers['Content-Type'] = headers['Content-Type'] || 'application/json; charset=utf-8'; }
    }
    if (!fetchOptions.method && hasBody) { fetchOptions.method = 'POST'; }

    var response = await fetch(url, fetchOptions);
    var contentType = String(response.headers.get('content-type') || '').toLowerCase();
    if (contentType.indexOf('application/json') === -1) {
      var text = await response.text();
      throw new Error('Non-JSON response. HTTP ' + response.status + ' ' + text.slice(0, 160));
    }
    var payload = await response.json();
    if (!response.ok || !payload || payload.success === false) {
      throw new Error((payload && payload.error) || ('HTTP ' + response.status));
    }
    return payload.data;
  }

  function buildServiceUrl(path) {
    var baseUrl = QUALITY_SERVICE_BASE_URL.replace(/\/+$/, '');
    var normalizedPath = String(path || '').replace(/^\/+/, '');
    return baseUrl + '/' + normalizedPath;
  }

  // ==================== CRUD ====================
  async function createTask() {
    syncDraftItems();
    clearMessage(formMessage);

    var input = {
      taskName: document.getElementById('taskName').value.trim(),
      storeName: document.getElementById('storeName').value.trim(),
      dueAt: normalizeDueAt(document.getElementById('dueAt').value),
      instructions: document.getElementById('instructions').value.trim(),
      items: draftItems.map(function (item, index) {
        return { itemName: item.name.trim(), itemDesc: item.description.trim(), requireAttachment: item.requireAttachment, requireRemark: item.requireRemark, sortOrder: index + 1 };
      }).filter(function (item) { return item.itemName; }),
    };

    if (!input.taskName || !input.storeName) { showMessage(formMessage, t('err.fillRequired'), 'error'); return; }
    if (input.items.length === 0) { showMessage(formMessage, t('err.needItem'), 'error'); return; }

    var btn = document.getElementById('createTaskBtn');
    btn.disabled = true;
    try {
      var created = await qualityRequest('/quality/tasks', { method: 'POST', body: input });
      var submitUrl = created && (created.submitUrl || created.submitLink);
      if (submitUrl) { await copyText(submitUrl); }
      showMessage(formMessage, submitUrl ? t('msg.taskCreatedLink') : t('msg.taskCreated'), 'success');
      form.reset();
      draftItems = [{ name: '', description: '', requireAttachment: true, requireRemark: false }];
      renderItemEditor();
      await loadTasks();
    } catch (error) { showMessage(formMessage, error.message, 'error'); }
    finally { btn.disabled = false; }
  }

  async function loadTasks() {
    taskList.innerHTML = '<div class="empty">' + escapeHtml(t('empty.loading')) + '</div>';
    try {
      var data = await qualityRequest('/quality/tasks');
      tasks = Array.isArray(data) ? data : [];
      renderTaskList();
    } catch (error) {
      taskList.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
      showMessage(formMessage, error.message, 'error');
    }
  }

  async function viewResult(taskId) {
    resultContent.innerHTML = '<div class="empty">' + escapeHtml(t('empty.loading')) + '</div>';
    try {
      var result = await qualityRequest('/quality/tasks/' + encodeURIComponent(taskId) + '/result');
      renderResult(result);
    } catch (error) {
      resultContent.innerHTML = '<div class="empty">' + escapeHtml(error.message) + '</div>';
      showMessage(formMessage, error.message, 'error');
    }
  }

  async function approveSubmission(taskId) {
    try {
      if (!taskId) throw new Error(t('err.noTaskId'));
      await qualityRequest('/quality/tasks/' + encodeURIComponent(taskId) + '/approve', { method: 'POST', body: {} });
      showMessage(formMessage, t('msg.approved'), 'success');
      await viewResult(taskId);
      await loadTasks();
    } catch (error) { showMessage(formMessage, error.message, 'error'); }
  }

  async function rejectSubmission(taskId) {
    try {
      if (!taskId) throw new Error(t('err.noTaskId'));
      var panel = findRejectPanel(taskId);
      var reasonEl = panel && panel.querySelector('[data-reject-reason]');
      var reason = reasonEl ? reasonEl.value.trim() : '';
      if (!reason) { showMessage(formMessage, t('err.noRejectReason'), 'error'); if (reasonEl) reasonEl.focus(); return; }
      await qualityRequest('/quality/tasks/' + encodeURIComponent(taskId) + '/reject', { method: 'POST', body: { reason: reason } });
      showMessage(formMessage, t('msg.rejected'), 'success');
      removeRejectPanels();
      await viewResult(taskId);
      await loadTasks();
    } catch (error) { showMessage(formMessage, error.message, 'error'); }
  }

  async function copySubmitLink(taskId) {
    try {
      var task = findTask(taskId);
      var link = getTaskSubmitLink(task);
      if (!link) throw new Error(t('err.noLink'));
      if (link.indexOf('https://') !== 0) throw new Error(t('err.notHttps'));
      await copyText(link);
      showMessage(formMessage, t('msg.linkCopied'), 'success');
    } catch (error) { showMessage(formMessage, error.message, 'error'); }
  }

  async function openSubmitPage(taskId) {
    try {
      var task = findTask(taskId);
      var link = getTaskSubmitLink(task);
      if (!link) throw new Error(t('err.noLink'));
      await openUrl(link);
    } catch (error) { showMessage(formMessage, error.message, 'error'); }
  }

  // ==================== Renderers ====================
  function renderTaskList() {
    if (!tasks.length) { taskList.innerHTML = '<div class="empty">' + escapeHtml(t('empty.noTasks')) + '</div>'; return; }
    taskList.innerHTML = '' +
      '<div style="overflow-x:auto"><table class="task-table"><thead><tr>' +
        '<th>' + escapeHtml(t('th.task')) + '</th><th>' + escapeHtml(t('th.store')) + '</th><th>' + escapeHtml(t('th.dueAt')) + '</th><th>' + escapeHtml(t('th.status')) + '</th><th>' + escapeHtml(t('th.submittedAt')) + '</th><th>' + escapeHtml(t('th.actions')) + '</th>' +
      '</tr></thead><tbody>' + tasks.map(renderTaskRow).join('') + '</tbody></table></div>';
  }

  function renderTaskRow(task) {
    var taskId = getTaskId(task);
    return '<tr>' +
      '<td><strong>' + escapeHtml(task.taskName || '-') + '</strong><div class="topbar-subtitle">' + Number(task.itemCount || 0) + t('nItems') + '</div></td>' +
      '<td>' + escapeHtml(task.storeName || '-') + '</td>' +
      '<td>' + escapeHtml(formatDate(task.dueAt) || '-') + '</td>' +
      '<td>' + renderStatus(task.status) + '</td>' +
      '<td>' + escapeHtml(formatDate(task.submittedAt) || '-') + '</td>' +
      '<td><div class="actions">' +
        '<button type="button" class="btn btn-sm" data-action="copy-submit-link" data-task-id="' + escapeAttr(taskId) + '">' + escapeHtml(t('btn.copyLink')) + '</button>' +
        '<button type="button" class="btn btn-sm" data-action="open-submit-link" data-task-id="' + escapeAttr(taskId) + '">' + escapeHtml(t('btn.openSubmit')) + '</button>' +
        '<button type="button" class="btn btn-sm" data-view-result="' + escapeAttr(taskId) + '">' + escapeHtml(t('btn.viewResult')) + '</button>' +
      '</div></td></tr>';
  }

  function renderItemEditor() {
    itemEditor.innerHTML = draftItems.map(function (item, index) {
      return '' +
        '<div class="item-card" data-item-index="' + index + '">' +
          '<div class="item-card-header">' +
            '<div class="item-card-title">' + escapeHtml(t('item.title')) + ' ' + (index + 1) + '</div>' +
            '<button type="button" class="btn btn-danger btn-sm" data-remove-item="' + index + '">' + escapeHtml(t('btn.delete')) + '</button>' +
          '</div>' +
          '<div class="form-row"><label>' + escapeHtml(t('item.name')) + '</label><input data-item-field="name" value="' + escapeAttr(item.name) + '" placeholder="' + escapeAttr(t('item.namePh')) + '"></div>' +
          '<div class="form-row"><label>' + escapeHtml(t('item.desc')) + '</label><textarea data-item-field="description" placeholder="' + escapeAttr(t('item.descPh')) + '">' + escapeHtml(item.description) + '</textarea></div>' +
          '<div class="checks">' +
            '<label><input type="checkbox" data-item-field="requireAttachment" ' + (item.requireAttachment ? 'checked' : '') + '> ' + escapeHtml(t('item.requireAttach')) + '</label>' +
            '<label><input type="checkbox" data-item-field="requireRemark" ' + (item.requireRemark ? 'checked' : '') + '> ' + escapeHtml(t('item.requireRemark')) + '</label>' +
          '</div>' +
        '</div>';
    }).join('');
  }

  function renderResult(result) {
    var task = result.task || {};
    var submission = result.submission || null;
    var reviewComment = getReviewComment(submission);
    var html = '' +
      '<div class="task-summary">' +
        summaryCell(t('result.taskStatus'), renderStatus(task.status)) +
        summaryCell(t('result.submittedAt'), escapeHtml(formatDate(task.submittedAt) || '-')) +
        summaryCell(t('result.reviewStatus'), renderReviewStatus(submission, task.status)) +
        summaryCell(t('result.store'), escapeHtml(task.storeName || '-')) +
        summaryCell(t('result.dueAt'), escapeHtml(formatDate(task.dueAt) || '-')) +
        (reviewComment ? summaryCell(t('result.rejectReason'), escapeHtml(reviewComment)) : '') +
      '</div>';

    if (!submission) {
      html += '<div class="message message-info show">' + escapeHtml(t('result.notSubmitted')) + '</div>';
    } else if (task.status === 'submitted') {
      html += '<div class="actions" style="margin:12px 0 16px" data-review-actions>' +
        '<button type="button" class="btn btn-primary" data-action="approve-submission" data-task-id="' + escapeAttr(task.id) + '">' + escapeHtml(t('btn.approve')) + '</button>' +
        '<button type="button" class="btn btn-danger" data-action="reject-submission" data-task-id="' + escapeAttr(task.id) + '">' + escapeHtml(t('btn.reject')) + '</button>' +
      '</div>';
    }

    html += (result.items || []).map(function (item, index) {
      return '<div class="submit-item">' +
        '<h3>' + (index + 1) + '. ' + escapeHtml(item.name || item.itemName || '-') + '</h3>' +
        '<div class="item-description">' + escapeHtml(item.description || item.itemDesc || '-') + '</div>' +
        '<div class="form-row" style="margin-top:10px"><label>' + escapeHtml(t('label.remark')) + '</label><div>' + escapeHtml(item.remark || '-') + '</div></div>' +
        '<div class="form-row"><label>' + escapeHtml(t('label.attachments')) + '</label>' + renderAttachments(item.attachments || []) + '</div>' +
      '</div>';
    }).join('');

    resultContent.innerHTML = html;
  }

  function renderAttachments(attachments) {
    if (!attachments.length) return '<div class="topbar-subtitle">' + escapeHtml(t('noAttachments')) + '</div>';
    return '<div class="attachment-grid">' + attachments.map(function (file) {
      var url = buildAttachmentUrl(file);
      var name = file.originalName || file.fileName || file.name || t('file');
      var isImage = Boolean(file.isImage) || /\.(jpe?g|png|webp)$/i.test(name) || /\.(jpe?g|png|webp)(?:\?|$)/i.test(url);
      var preview = isImage && url
        ? '<img class="attachment-thumb" src="' + escapeAttr(url) + '" data-preview-image="' + escapeAttr(url) + '" alt="' + escapeAttr(name) + '">'
        : '<div class="attachment-thumb" style="display:flex;align-items:center;justify-content:center;color:#667085;">' + escapeHtml(t('file')) + '</div>';
      return '<div class="attachment-card">' + preview +
        '<div class="attachment-name">' + escapeHtml(name) + '</div>' +
        '<button type="button" class="btn btn-sm" style="margin-top:6px;width:100%" data-open-attachment="' + escapeAttr(url) + '"' + (url ? '' : ' disabled') + '>' + escapeHtml(t('btn.open')) + '</button>' +
      '</div>';
    }).join('') + '</div>';
  }

  function renderStatus(status) {
    if (status === 'approved') return '<span class="status status-submitted">' + escapeHtml(t('status.approved')) + '</span>';
    if (status === 'rejected') return '<span class="status status-pending">' + escapeHtml(t('status.rejected')) + '</span>';
    if (status === 'submitted') return '<span class="status status-submitted">' + escapeHtml(t('status.submitted')) + '</span>';
    return '<span class="status status-pending">' + escapeHtml(t('status.pending')) + '</span>';
  }

  function renderReviewStatus(submission, taskStatus) {
    if (!submission) return '<span class="status status-pending">' + escapeHtml(t('review.notSubmitted')) + '</span>';
    if (submission.reviewStatus === 'approved' || taskStatus === 'approved') return '<span class="status status-submitted">' + escapeHtml(t('review.approved')) + '</span>';
    if (submission.reviewStatus === 'rejected' || taskStatus === 'rejected') return '<span class="status status-pending">' + escapeHtml(t('review.rejected')) + '</span>';
    return '<span class="status status-submitted">' + escapeHtml(t('review.pending')) + '</span>';
  }

  // ==================== Reject Panel ====================
  function showRejectPanel(taskId) {
    if (!taskId) { showMessage(formMessage, t('err.noTaskId'), 'error'); return; }
    removeRejectPanels();
    var actions = resultContent.querySelector('[data-review-actions]');
    if (!actions) { showMessage(formMessage, t('err.noReviewArea'), 'error'); return; }
    actions.insertAdjacentHTML('afterend', '' +
      '<div class="submit-item" data-reject-panel="' + escapeAttr(taskId) + '" style="margin-top:12px">' +
        '<div class="form-row"><label>' + escapeHtml(t('label.rejectReason')) + '</label><textarea data-reject-reason placeholder="' + escapeAttr(t('ph.rejectReason')) + '"></textarea></div>' +
        '<div class="actions">' +
          '<button type="button" class="btn btn-danger" data-action="confirm-reject-submission" data-task-id="' + escapeAttr(taskId) + '">' + escapeHtml(t('btn.confirmReject')) + '</button>' +
          '<button type="button" class="btn btn-sm" data-action="cancel-reject-submission" data-task-id="' + escapeAttr(taskId) + '">' + escapeHtml(t('btn.cancel')) + '</button>' +
        '</div>' +
      '</div>');
    showMessage(formMessage, t('msg.prepareReject'), 'info');
    var reasonEl = findRejectPanel(taskId).querySelector('[data-reject-reason]');
    if (reasonEl) reasonEl.focus();
  }

  function removeRejectPanels() {
    var panels = resultContent.querySelectorAll('[data-reject-panel]');
    Array.prototype.forEach.call(panels, function (panel) { panel.remove(); });
  }

  function findRejectPanel(taskId) {
    var panels = resultContent.querySelectorAll('[data-reject-panel]');
    for (var i = 0; i < panels.length; i++) {
      if (String(panels[i].dataset.rejectPanel) === String(taskId)) return panels[i];
    }
    return null;
  }

  // ==================== Helpers ====================
  function syncDraftItems() {
    var cards = itemEditor.querySelectorAll('.item-card');
    draftItems = Array.prototype.map.call(cards, function (card) {
      return {
        name: getFieldValue(card, 'name'),
        description: getFieldValue(card, 'description'),
        requireAttachment: getFieldChecked(card, 'requireAttachment'),
        requireRemark: getFieldChecked(card, 'requireRemark'),
      };
    });
  }

  function getTaskSubmitLink(task) {
    if (!task) return '';
    var link = task.submitUrl || task.submitLink || task.submit_url || task.submit_link || '';
    if (link) return String(link);
    var taskId = getTaskId(task);
    var submitToken = task.submitToken || task.submit_token || '';
    if (!taskId || !submitToken) return '';
    return buildServiceUrl('/quality/submit?taskId=' + encodeURIComponent(taskId) + '&submitToken=' + encodeURIComponent(submitToken));
  }

  function buildAttachmentUrl(file) {
    if (!file) return '';
    var value = file.fileUrl || file.url || file.href || file.relativePath || file.path || '';
    if (!value) return '';
    value = String(value);
    if (/^https?:\/\//i.test(value)) return value;
    return buildServiceUrl(value);
  }

  async function copyText(text) {
    if (qualityApi && typeof qualityApi.copyText === 'function') {
      var result = await qualityApi.copyText(text);
      if (!result || result.success !== false) return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try { await navigator.clipboard.writeText(text); return; } catch (e) {}
    }
    var textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', 'readonly');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();
    var ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    if (!ok) throw new Error(t('err.copyFail'));
  }

  async function openUrl(url) {
    if (!url) throw new Error(t('err.noUrl'));
    if (window.electronAPI && window.electronAPI.tabs && typeof window.electronAPI.tabs.create === 'function') {
      await window.electronAPI.tabs.create(url);
      return;
    }
    var opened = window.open(url, '_blank', 'noopener');
    if (!opened) throw new Error(t('err.openFail'));
  }

  function findTask(taskId) {
    for (var i = 0; i < tasks.length; i++) {
      if (String(getTaskId(tasks[i])) === String(taskId)) return tasks[i];
    }
    return null;
  }

  function getTaskId(task) { return task && (task.id || task.taskId || ''); }
  function getFieldValue(card, field) { var el = card.querySelector('[data-item-field="' + field + '"]'); return el ? el.value : ''; }
  function getFieldChecked(card, field) { var el = card.querySelector('[data-item-field="' + field + '"]'); return !!(el && el.checked); }

  function normalizeDueAt(value) {
    if (!value) return null;
    var normalized = String(value).replace('T', ' ');
    return normalized.length === 16 ? normalized + ':00' : normalized;
  }

  function getReviewComment(submission) {
    if (!submission) return '';
    return String(submission.reviewComment || submission.review_comment || '').trim();
  }

  function summaryCell(label, valueHtml) {
    return '<div class="summary-cell"><div class="summary-label">' + escapeHtml(label) + '</div><div class="summary-value">' + valueHtml + '</div></div>';
  }

  function showMessage(el, text, type) {
    el.textContent = text || '';
    el.className = 'message message-' + (type || 'info') + ' show';
  }

  function clearMessage(el) { el.textContent = ''; el.className = 'message'; }

  function formatDate(value) {
    if (!value) return '';
    return String(value).replace('T', ' ').slice(0, 19);
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#96;'); }

  init();
})();
