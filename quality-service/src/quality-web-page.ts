export function renderQualitySubmitPage(apiBaseUrl = ''): string {
  const apiBaseUrlJson = JSON.stringify(String(apiBaseUrl || '').replace(/\/+$/, ''));
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Quality Task Submission</title>
  <style>
    :root {
      color-scheme: light;
      --bg: #f5f7fb;
      --panel: #ffffff;
      --line: #d9e1ec;
      --text: #1f2937;
      --muted: #667085;
      --primary: #2563eb;
      --danger: #c2410c;
      --success: #047857;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.5;
    }
    .page {
      width: min(960px, 100%);
      margin: 0 auto;
      padding: 20px 14px 36px;
    }
    .header, .card {
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 16px;
      margin-bottom: 14px;
    }
    .header-top {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 10px;
    }
    .language-switch {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      color: var(--muted);
      font-size: 13px;
      white-space: nowrap;
    }
    .language-switch select {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font: inherit;
      padding: 6px 8px;
    }
    h1 {
      margin: 0;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 17px;
      letter-spacing: 0;
    }
    .task-title {
      margin: 0 0 10px;
      font-size: 18px;
      font-weight: 700;
      word-break: break-word;
    }
    .instructions {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      background: #fbfcfe;
      margin-top: 10px;
      word-break: break-word;
    }
    .meta {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 8px;
      margin-top: 12px;
    }
    .meta-item {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 10px;
      background: #fbfcfe;
    }
    .label {
      display: block;
      font-size: 12px;
      color: var(--muted);
      margin-bottom: 4px;
    }
    .status {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      padding: 2px 9px;
      border-radius: 999px;
      font-size: 13px;
      border: 1px solid var(--line);
      color: var(--muted);
      background: #f8fafc;
    }
    .status-submitted { color: #1d4ed8; background: #eff6ff; border-color: #bfdbfe; }
    .status-approved { color: var(--success); background: #ecfdf5; border-color: #a7f3d0; }
    .status-rejected { color: var(--danger); background: #fff7ed; border-color: #fed7aa; }
    .message {
      display: none;
      border-radius: 6px;
      padding: 10px 12px;
      margin: 12px 0;
      border: 1px solid var(--line);
      background: #fff;
      white-space: pre-wrap;
    }
    .message.show { display: block; }
    .message-error { color: #991b1b; background: #fef2f2; border-color: #fecaca; }
    .message-success { color: #065f46; background: #ecfdf5; border-color: #a7f3d0; }
    .message-info { color: #1e3a8a; background: #eff6ff; border-color: #bfdbfe; }
    .requirements {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 10px 0;
      color: var(--muted);
      font-size: 13px;
    }
    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 2px 8px;
      background: #fbfcfe;
    }
    .field {
      display: grid;
      gap: 6px;
      margin-top: 10px;
    }
    textarea {
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: #fff;
      color: var(--text);
      font: inherit;
    }
    textarea {
      min-height: 86px;
      resize: vertical;
      padding: 9px 10px;
    }
    .native-file-input {
      position: absolute;
      width: 1px;
      height: 1px;
      opacity: 0;
      overflow: hidden;
      pointer-events: none;
    }
    .file-picker-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }
    .file-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 8px 12px;
      background: #fff;
      color: var(--text);
      cursor: pointer;
      user-select: none;
    }
    .file-list {
      color: var(--muted);
      font-size: 13px;
      word-break: break-all;
    }
    .actions {
      position: sticky;
      bottom: 0;
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 0 0;
      background: linear-gradient(180deg, rgba(245,247,251,0), var(--bg) 35%);
    }
    button {
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 9px 14px;
      font: inherit;
      background: #fff;
      color: var(--text);
      cursor: pointer;
    }
    button.primary {
      border-color: var(--primary);
      background: var(--primary);
      color: #fff;
    }
    button:disabled {
      opacity: .55;
      cursor: not-allowed;
    }
    .empty {
      color: var(--muted);
      text-align: center;
      padding: 28px 10px;
    }
    @media (max-width: 520px) {
      .header-top { align-items: stretch; }
      .language-switch { justify-content: flex-end; }
    }
  </style>
</head>
<body>
  <main class="page">
    <section id="taskHeader" class="header">
      <div class="header-top">
        <h1 data-i18n="pageTitle">Quality Task Submission</h1>
        <label class="language-switch">
          <span data-i18n="language">Language</span>
          <select id="langSelect" aria-label="Language">
            <option value="en">English</option>
            <option value="zh">中文</option>
          </select>
        </label>
      </div>
      <div class="empty" data-i18n="loading">Loading...</div>
    </section>
    <div id="message" class="message"></div>
    <section id="items"></section>
    <div id="actions" class="actions"></div>
  </main>
  <script>
    window.__QUALITY_API_BASE_URL__ = ${apiBaseUrlJson};
    (function () {
      var I18N = {
        en: {
          pageTitle: 'Quality Task Submission',
          language: 'Language',
          loading: 'Loading...',
          taskLoadFailed: 'Task loading failed',
          missingParams: 'The submission link is missing required parameters. Please get a new link from the admin page.',
          taskName: 'Task Name',
          store: 'Store',
          dueTime: 'Due Time',
          status: 'Status',
          instructions: 'Instructions',
          noInstructions: 'No instructions',
          checkItem: 'Check Item',
          noItems: 'No check items',
          noItemDescription: 'No check item description',
          attachmentRequired: 'Attachment Required',
          attachmentOptional: 'Attachment Optional',
          remarkRequired: 'Remark Required',
          remarkOptional: 'Remark Optional',
          uploadAttachment: 'Upload Photo/Attachment',
          remark: 'Remark',
          remarkPlaceholder: 'Enter on-site notes or explanation',
          chooseFile: 'Choose File',
          noFileSelected: 'No file selected',
          filesSelected: '{count} files selected',
          submit: 'Submit',
          submitting: 'Submitting...',
          notSubmittable: 'Cannot submit again',
          submitSuccess: 'Submitted Successfully',
          submittedAwaitingReview: 'Submitted, awaiting review',
          approvedNotice: 'Approved',
          rejectedNotice: 'Rejected, please resubmit according to the rejection reason',
          rejectedNoticeWithReason: 'Rejected, please resubmit according to the rejection reason\\nRejection Reason: {reason}',
          rejectionReason: 'Rejection Reason',
          pendingStatus: 'Pending',
          submittedStatus: 'Submitted, awaiting review',
          approvedStatus: 'Approved',
          rejectedStatus: 'Rejected, awaiting resubmission',
          pleaseUploadRequired: 'Please upload required attachments',
          pleaseFillRequired: 'Please fill in required remarks',
          missingAttachmentNamed: '{name}: Please upload required attachments',
          missingRemarkNamed: '{name}: Please fill in required remarks',
          uploadFailed: 'Upload failed. Please check file size or try again later',
          nonJson: 'Unexpected server response. Please check the network or try again later.',
          invalidFile: '{name}: invalid file',
          fileTooLarge: '{name}: exceeds 10MB',
          unsupportedFile: '{name}: unsupported type. Only jpg/jpeg/png/webp/pdf is allowed'
        },
        zh: {
          pageTitle: '质检任务提交',
          language: '语言',
          loading: '加载中...',
          taskLoadFailed: '任务加载失败',
          missingParams: '提交链接缺少必要参数，请从后台重新获取提交链接。',
          taskName: '任务名称',
          store: '执行门店',
          dueTime: '截止时间',
          status: '当前状态',
          instructions: '任务说明',
          noInstructions: '无任务说明',
          checkItem: '检查项',
          noItems: '暂无检查项',
          noItemDescription: '无检查项说明',
          attachmentRequired: '必须上传附件',
          attachmentOptional: '附件选填',
          remarkRequired: '必须填写备注',
          remarkOptional: '备注选填',
          uploadAttachment: '上传现场照片/附件',
          remark: '备注',
          remarkPlaceholder: '填写现场情况或说明',
          chooseFile: '选择文件',
          noFileSelected: '未选择任何文件',
          filesSelected: '已选择 {count} 个文件',
          submit: '提交任务',
          submitting: '提交中...',
          notSubmittable: '不可重复提交',
          submitSuccess: '提交成功',
          submittedAwaitingReview: '该任务已提交，等待审核',
          approvedNotice: '该任务已审核通过',
          rejectedNotice: '该任务已被驳回，请根据驳回原因重新提交',
          rejectedNoticeWithReason: '该任务已被驳回，请根据驳回原因重新提交\\n驳回原因：{reason}',
          rejectionReason: '驳回原因',
          pendingStatus: '待提交',
          submittedStatus: '已提交，待审核',
          approvedStatus: '已通过',
          rejectedStatus: '已驳回，待重传',
          pleaseUploadRequired: '请上传必填附件',
          pleaseFillRequired: '请填写必填备注',
          missingAttachmentNamed: '{name}：请上传必填附件',
          missingRemarkNamed: '{name}：请填写必填备注',
          uploadFailed: '上传失败，请检查图片大小或稍后重试',
          nonJson: '接口返回非 JSON，请检查网络或稍后重试。',
          invalidFile: '{name}：附件无效',
          fileTooLarge: '{name}：超过 10MB',
          unsupportedFile: '{name}：类型不支持，仅支持 jpg/jpeg/png/webp/pdf'
        }
      };

      var params = new URLSearchParams(window.location.search);
      var taskId = params.get('taskId') || '';
      var submitToken = params.get('submitToken') || '';
      var apiBaseUrl = String(window.__QUALITY_API_BASE_URL__ || window.location.origin).replace(/\\/+$/, '');
      var currentLang = getCurrentLang();
      var currentMessage = null;
      var state = { taskData: null, filesByItem: {} };
      var header = document.getElementById('taskHeader');
      var itemsEl = document.getElementById('items');
      var actionsEl = document.getElementById('actions');
      var messageEl = document.getElementById('message');
      var maxFileSize = 10 * 1024 * 1024;
      var allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];

      setLang(currentLang, false);
      document.addEventListener('change', function (event) {
        var select = event.target.closest('#langSelect');
        if (select) setLang(select.value, true);
      });

      if (!taskId || !submitToken) {
        showMessageKey('missingParams', 'error');
        renderMissingTask();
        return;
      }

      loadTask();

      itemsEl.addEventListener('change', function (event) {
        var input = event.target.closest('input[type="file"][data-item-id]');
        if (!input) return;
        var itemId = input.dataset.itemId;
        state.filesByItem[itemId] = Array.prototype.slice.call(input.files || []);
        renderFileList(itemId);
      });

      actionsEl.addEventListener('click', async function (event) {
        var btn = event.target.closest('button[data-action="submit"]');
        if (!btn) return;
        event.preventDefault();
        await submitTask(btn);
      });

      function getCurrentLang() {
        var urlLang = normalizeLang(params.get('lang'));
        if (urlLang) {
          try { localStorage.setItem('quality_lang', urlLang); } catch (error) {}
          return urlLang;
        }
        try {
          var stored = normalizeLang(localStorage.getItem('quality_lang'));
          if (stored) return stored;
        } catch (error) {}
        var browserLang = normalizeLang(navigator.language || '');
        return browserLang || 'en';
      }

      function setLang(lang, shouldPersist) {
        currentLang = normalizeLang(lang) || 'en';
        document.documentElement.lang = currentLang === 'zh' ? 'zh-CN' : 'en';
        if (shouldPersist) {
          try { localStorage.setItem('quality_lang', currentLang); } catch (error) {}
          updateUrlLang(currentLang);
        }
        renderText();
      }

      function normalizeLang(lang) {
        lang = String(lang || '').toLowerCase();
        if (lang.indexOf('zh') === 0) return 'zh';
        if (lang.indexOf('en') === 0) return 'en';
        return '';
      }

      function updateUrlLang(lang) {
        try {
          var url = new URL(window.location.href);
          url.searchParams.set('lang', lang);
          window.history.replaceState({}, '', url.toString());
        } catch (error) {}
      }

      function t(key, vars) {
        var langDict = I18N[currentLang] || I18N.en;
        var text = langDict[key] || I18N.en[key] || key;
        vars = vars || {};
        Object.keys(vars).forEach(function (name) {
          text = text.replace(new RegExp('\\\\{' + name + '\\\\}', 'g'), String(vars[name]));
        });
        return text;
      }

      function renderText() {
        document.title = t('pageTitle');
        var currentSelect = document.getElementById('langSelect');
        if (currentSelect) currentSelect.value = currentLang;

        Array.prototype.forEach.call(document.querySelectorAll('[data-i18n]'), function (el) {
          el.textContent = t(el.dataset.i18n);
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-i18n-placeholder]'), function (el) {
          el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-status]'), function (el) {
          el.innerHTML = renderStatus(el.dataset.status || 'pending');
        });
        Array.prototype.forEach.call(document.querySelectorAll('[data-file-list]'), function (el) {
          renderFileList(el.dataset.itemId);
        });
        if (currentMessage) {
          applyCurrentMessage();
        }
      }

      async function loadTask() {
        clearMessage();
        try {
          var url = apiBaseUrl + '/quality/submit-task?taskId=' + encodeURIComponent(taskId) + '&submitToken=' + encodeURIComponent(submitToken);
          var response = await fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
          var result = await readJsonResponse(response);
          if (!result || !result.success) {
            throw new Error((result && result.error) || t('taskLoadFailed'));
          }
          state.taskData = result.data;
          renderTask();
        } catch (error) {
          showMessageText(error.message || t('taskLoadFailed'), 'error');
          renderMissingTask();
        }
      }

      function renderMissingTask() {
        header.innerHTML = renderHeaderTop() + '<div class="empty" data-i18n="taskLoadFailed">' + escapeHtml(t('taskLoadFailed')) + '</div>';
        itemsEl.innerHTML = '';
        actionsEl.innerHTML = '';
        renderText();
      }

      function renderTask() {
        var data = state.taskData || {};
        var task = data.task || {};
        var submission = data.submission || null;
        var status = String(task.status || 'pending');
        var readOnly = status === 'submitted' || status === 'approved';
        var reviewComment = getReviewComment(submission);

        header.innerHTML = '' +
          renderHeaderTop() +
          '<div class="task-title">' + escapeHtml(task.taskName || '-') + '</div>' +
          '<div class="instructions">' +
            '<span class="label" data-i18n="instructions">' + escapeHtml(t('instructions')) + '</span>' +
            '<div>' + escapeHtml(task.instructions || t('noInstructions')) + '</div>' +
          '</div>' +
          '<div class="meta">' +
            metaCell('taskName', escapeHtml(task.taskName || '-')) +
            metaCell('store', escapeHtml(task.storeName || '-')) +
            metaCell('dueTime', escapeHtml(formatDate(task.dueAt) || '-')) +
            metaCell('status', '<span data-status="' + escapeAttr(status) + '">' + renderStatus(status) + '</span>') +
          '</div>';

        if (status === 'approved') {
          showMessageKey('approvedNotice', 'info');
        } else if (status === 'submitted') {
          showMessageKey('submittedAwaitingReview', 'info');
        } else if (status === 'rejected') {
          if (reviewComment) {
            showMessageKey('rejectedNoticeWithReason', 'error', { reason: reviewComment });
          } else {
            showMessageKey('rejectedNotice', 'error');
          }
        }

        var items = Array.isArray(data.items) ? data.items : [];
        itemsEl.innerHTML = items.length
          ? items.map(function (item, index) { return renderItem(item, index, readOnly); }).join('')
          : '<section class="card empty" data-i18n="noItems">' + escapeHtml(t('noItems')) + '</section>';

        actionsEl.innerHTML = readOnly
          ? '<button type="button" disabled data-i18n="notSubmittable">' + escapeHtml(t('notSubmittable')) + '</button>'
          : '<button type="button" class="primary" data-action="submit" data-i18n="submit">' + escapeHtml(t('submit')) + '</button>';

        renderText();
      }

      function renderHeaderTop() {
        return '' +
          '<div class="header-top">' +
            '<h1 data-i18n="pageTitle">' + escapeHtml(t('pageTitle')) + '</h1>' +
            '<label class="language-switch">' +
              '<span data-i18n="language">' + escapeHtml(t('language')) + '</span>' +
              '<select id="langSelect" aria-label="Language">' +
                '<option value="en">English</option>' +
                '<option value="zh">中文</option>' +
              '</select>' +
            '</label>' +
          '</div>';
      }

      function renderItem(item, index, readOnly) {
        var itemName = item.name || item.itemName || t('checkItem');
        var itemDesc = item.description || item.itemDesc || t('noItemDescription');
        var fileInputId = 'file-input-' + String(item.id || index).replace(/[^a-zA-Z0-9_-]/g, '-');
        var fileInput = readOnly ? '' : '' +
          '<div class="field">' +
            '<label data-i18n="uploadAttachment">' + escapeHtml(t('uploadAttachment')) + '</label>' +
            '<div class="file-picker-row">' +
              '<input id="' + escapeAttr(fileInputId) + '" class="native-file-input" type="file" multiple data-item-id="' + escapeAttr(item.id) + '" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf">' +
              '<label class="file-button" for="' + escapeAttr(fileInputId) + '" data-i18n="chooseFile">' + escapeHtml(t('chooseFile')) + '</label>' +
              '<div class="file-list" data-file-list data-item-id="' + escapeAttr(item.id) + '">' + escapeHtml(t('noFileSelected')) + '</div>' +
            '</div>' +
          '</div>';
        var textarea = readOnly
          ? '<div class="field"><label data-i18n="remark">' + escapeHtml(t('remark')) + '</label><div>' + escapeHtml(item.remark || '-') + '</div></div>'
          : '<div class="field"><label data-i18n="remark">' + escapeHtml(t('remark')) + '</label><textarea data-remark-item-id="' + escapeAttr(item.id) + '" data-i18n-placeholder="remarkPlaceholder" placeholder="' + escapeAttr(t('remarkPlaceholder')) + '"></textarea></div>';

        return '' +
          '<section class="card" data-item-card="' + escapeAttr(item.id) + '">' +
            '<h2>' + (index + 1) + '. ' + escapeHtml(itemName) + '</h2>' +
            '<div>' + escapeHtml(itemDesc) + '</div>' +
            '<div class="requirements">' +
              '<span class="pill" data-i18n="' + (item.requireAttachment ? 'attachmentRequired' : 'attachmentOptional') + '">' + escapeHtml(t(item.requireAttachment ? 'attachmentRequired' : 'attachmentOptional')) + '</span>' +
              '<span class="pill" data-i18n="' + (item.requireRemark ? 'remarkRequired' : 'remarkOptional') + '">' + escapeHtml(t(item.requireRemark ? 'remarkRequired' : 'remarkOptional')) + '</span>' +
            '</div>' +
            fileInput +
            textarea +
          '</section>';
      }

      async function submitTask(btn) {
        clearMessage();
        var data = state.taskData || {};
        var items = Array.isArray(data.items) ? data.items : [];
        var payloadItems = [];
        var errors = [];

        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var itemName = item.name || item.itemName || t('checkItem');
          var files = state.filesByItem[item.id] || [];
          var remark = getRemarkValue(item.id);

          if (item.requireAttachment && files.length === 0) {
            errors.push(t('missingAttachmentNamed', { name: itemName }));
          }
          if (item.requireRemark && !remark) {
            errors.push(t('missingRemarkNamed', { name: itemName }));
          }
          for (var j = 0; j < files.length; j++) {
            var fileError = validateFile(files[j]);
            if (fileError) errors.push(fileError);
          }
          payloadItems.push({ itemId: item.id, remark: remark });
        }

        if (errors.length) {
          showMessageText(errors.join('\\n'), 'error');
          return;
        }

        btn.disabled = true;
        btn.textContent = t('submitting');
        try {
          var form = new FormData();
          form.append('taskId', taskId);
          form.append('submitToken', submitToken);
          form.append('items', JSON.stringify(payloadItems));
          for (var itemIndex = 0; itemIndex < items.length; itemIndex++) {
            var currentItem = items[itemIndex];
            var currentFiles = state.filesByItem[currentItem.id] || [];
            for (var fileIndex = 0; fileIndex < currentFiles.length; fileIndex++) {
              form.append('file:' + currentItem.id, currentFiles[fileIndex], currentFiles[fileIndex].name);
            }
          }

          var response = await fetch(apiBaseUrl + '/quality/submit', { method: 'POST', body: form });
          var result = await readJsonResponse(response);
          if (!result || !result.success) {
            throw new Error((result && result.error) || t('uploadFailed'));
          }
          showMessageKey('submitSuccess', 'success');
          state.filesByItem = {};
          await loadTask();
        } catch (error) {
          showMessageText(error.message || t('uploadFailed'), 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = t('submit');
        }
      }

      function validateFile(file) {
        if (!file || !file.name) return t('invalidFile', { name: t('checkItem') });
        if (file.size > maxFileSize) return t('fileTooLarge', { name: file.name });
        var ext = String(file.name).split('.').pop().toLowerCase();
        if (allowedExtensions.indexOf(ext) === -1) {
          return t('unsupportedFile', { name: file.name });
        }
        return '';
      }

      async function readJsonResponse(response) {
        var contentType = response.headers.get('content-type') || '';
        if (contentType.toLowerCase().indexOf('application/json') === -1) {
          await response.text();
          throw new Error(t('nonJson'));
        }
        return response.json();
      }

      function renderStatus(status) {
        if (status === 'approved') return '<span class="status status-approved">' + escapeHtml(t('approvedStatus')) + '</span>';
        if (status === 'rejected') return '<span class="status status-rejected">' + escapeHtml(t('rejectedStatus')) + '</span>';
        if (status === 'submitted') return '<span class="status status-submitted">' + escapeHtml(t('submittedStatus')) + '</span>';
        return '<span class="status">' + escapeHtml(t('pendingStatus')) + '</span>';
      }

      function metaCell(labelKey, valueHtml) {
        return '<div class="meta-item"><span class="label" data-i18n="' + escapeAttr(labelKey) + '">' + escapeHtml(t(labelKey)) + '</span><div>' + valueHtml + '</div></div>';
      }

      function renderFileList(itemId) {
        var list = findFileList(itemId);
        if (!list) return;
        var files = state.filesByItem[itemId] || [];
        if (files.length === 0) {
          list.textContent = t('noFileSelected');
          return;
        }
        list.textContent = files.length === 1 ? files[0].name : t('filesSelected', { count: files.length });
      }

      function findFileList(itemId) {
        var lists = document.querySelectorAll('[data-file-list]');
        for (var i = 0; i < lists.length; i++) {
          if (String(lists[i].dataset.itemId) === String(itemId)) return lists[i];
        }
        return null;
      }

      function getRemarkValue(itemId) {
        var inputs = document.querySelectorAll('[data-remark-item-id]');
        for (var i = 0; i < inputs.length; i++) {
          if (String(inputs[i].dataset.remarkItemId) === String(itemId)) return inputs[i].value.trim();
        }
        return '';
      }

      function getReviewComment(submission) {
        if (!submission) return '';
        return String(submission.reviewComment || submission.review_comment || '').trim();
      }

      function formatDate(value) {
        return value ? String(value).replace('T', ' ').slice(0, 19) : '';
      }

      function showMessageKey(key, type, vars) {
        currentMessage = { key: key, type: type || 'info', vars: vars || null };
        applyCurrentMessage();
      }

      function showMessageText(text, type) {
        currentMessage = { text: text || '', type: type || 'info' };
        applyCurrentMessage();
      }

      function applyCurrentMessage() {
        if (!currentMessage) return;
        var text = currentMessage.key ? t(currentMessage.key, currentMessage.vars) : currentMessage.text;
        messageEl.textContent = text || '';
        messageEl.className = 'message message-' + (currentMessage.type || 'info') + ' show';
      }

      function clearMessage() {
        currentMessage = null;
        messageEl.textContent = '';
        messageEl.className = 'message';
      }

      function escapeHtml(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function escapeAttr(value) {
        return escapeHtml(value).replace(new RegExp(String.fromCharCode(96), 'g'), '&#96;');
      }
    })();
  </script>
</body>
</html>`;
}
