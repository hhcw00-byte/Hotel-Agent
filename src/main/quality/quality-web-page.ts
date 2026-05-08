export function renderQualitySubmitPage(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>质检任务提交</title>
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
    h1 {
      margin: 0 0 8px;
      font-size: 22px;
      line-height: 1.25;
      letter-spacing: 0;
    }
    h2 {
      margin: 0 0 10px;
      font-size: 17px;
      letter-spacing: 0;
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
    textarea, input[type="file"] {
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
    input[type="file"] {
      padding: 8px;
    }
    .file-list {
      color: var(--muted);
      font-size: 13px;
      margin-top: 4px;
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
  </style>
</head>
<body>
  <main class="page">
    <section id="taskHeader" class="header">
      <h1>质检任务提交</h1>
      <div class="empty">加载中...</div>
    </section>
    <div id="message" class="message"></div>
    <section id="items"></section>
    <div id="actions" class="actions"></div>
  </main>
  <script>
    (function () {
      var params = new URLSearchParams(window.location.search);
      var taskId = params.get('taskId') || '';
      var submitToken = params.get('submitToken') || '';
      var state = { taskData: null, filesByItem: {} };
      var header = document.getElementById('taskHeader');
      var itemsEl = document.getElementById('items');
      var actionsEl = document.getElementById('actions');
      var messageEl = document.getElementById('message');
      var maxFileSize = 10 * 1024 * 1024;
      var allowedExtensions = ['jpg', 'jpeg', 'png', 'webp', 'pdf'];

      if (!taskId || !submitToken) {
        showMessage('提交链接缺少必要参数，请从后台重新获取局域网链接。', 'error');
        header.innerHTML = '<h1>质检任务提交</h1><div class="empty">链接参数不完整</div>';
        return;
      }

      loadTask();

      itemsEl.addEventListener('change', function (event) {
        var input = event.target.closest('input[type="file"][data-item-id]');
        if (!input) return;
        var itemId = input.dataset.itemId;
        var files = Array.prototype.slice.call(input.files || []);
        state.filesByItem[itemId] = files;
        var list = input.parentElement.querySelector('[data-file-list]');
        if (list) {
          list.textContent = files.length ? files.map(function (file) { return file.name; }).join('、') : '未选择附件';
        }
      });

      actionsEl.addEventListener('click', async function (event) {
        var btn = event.target.closest('button[data-action="submit"]');
        if (!btn) return;
        event.preventDefault();
        await submitTask(btn);
      });

      async function loadTask() {
        clearMessage();
        try {
          var url = '/api/quality/task?taskId=' + encodeURIComponent(taskId) + '&submitToken=' + encodeURIComponent(submitToken);
          var response = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
          var result = await response.json();
          if (!result || !result.success) {
            throw new Error((result && result.error) || '任务加载失败');
          }
          state.taskData = result.data;
          renderTask();
        } catch (error) {
          showMessage(error.message || '任务加载失败', 'error');
          header.innerHTML = '<h1>质检任务提交</h1><div class="empty">任务加载失败</div>';
        }
      }

      function renderTask() {
        var data = state.taskData || {};
        var task = data.task || {};
        var submission = data.submission || null;
        var status = String(task.status || 'pending');
        var readOnly = status === 'submitted' || status === 'approved';
        var reviewComment = getReviewComment(submission);

        header.innerHTML = '' +
          '<h1>' + escapeHtml(task.taskName || '质检任务') + '</h1>' +
          '<div>' + escapeHtml(task.instructions || '无任务说明') + '</div>' +
          '<div class="meta">' +
            metaCell('执行门店', escapeHtml(task.storeName || '-')) +
            metaCell('截止时间', escapeHtml(formatDate(task.dueAt) || '-')) +
            metaCell('当前状态', renderStatus(status)) +
          '</div>';

        if (status === 'approved') {
          showMessage('该任务已审核通过，不能重复提交。', 'info');
        } else if (status === 'submitted') {
          showMessage('该任务已提交，等待审核。', 'info');
        } else if (status === 'rejected') {
          showMessage('该任务已被驳回，请根据驳回原因重新提交。' + (reviewComment ? '\\n驳回理由：' + reviewComment : ''), 'error');
        }

        var items = Array.isArray(data.items) ? data.items : [];
        itemsEl.innerHTML = items.length
          ? items.map(function (item, index) { return renderItem(item, index, readOnly); }).join('')
          : '<section class="card empty">暂无检查项</section>';

        actionsEl.innerHTML = readOnly
          ? '<button type="button" disabled>不可重复提交</button>'
          : '<button type="button" class="primary" data-action="submit">提交任务</button>';
      }

      function renderItem(item, index, readOnly) {
        var fileInput = readOnly ? '' : '' +
          '<div class="field">' +
            '<label>现场照片/附件</label>' +
            '<input type="file" multiple data-item-id="' + escapeAttr(item.id) + '" accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf">' +
            '<div class="file-list" data-file-list>未选择附件</div>' +
          '</div>';
        var textarea = readOnly
          ? '<div class="field"><label>备注</label><div>' + escapeHtml(item.remark || '-') + '</div></div>'
          : '<div class="field"><label>备注</label><textarea data-remark-item-id="' + escapeAttr(item.id) + '" placeholder="填写现场情况或说明"></textarea></div>';
        return '' +
          '<section class="card" data-item-card="' + escapeAttr(item.id) + '">' +
            '<h2>' + (index + 1) + '. ' + escapeHtml(item.name || '检查项') + '</h2>' +
            '<div>' + escapeHtml(item.description || '无检查项说明') + '</div>' +
            '<div class="requirements">' +
              '<span class="pill">' + (item.requireAttachment ? '必须上传附件' : '附件选填') + '</span>' +
              '<span class="pill">' + (item.requireRemark ? '必须填写备注' : '备注选填') + '</span>' +
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
          var files = state.filesByItem[item.id] || [];
          var remarkEl = document.querySelector('[data-remark-item-id="' + cssEscape(item.id) + '"]');
          var remark = remarkEl ? remarkEl.value.trim() : '';

          if (item.requireAttachment && files.length === 0) {
            errors.push((item.name || '检查项') + ' 缺少现场照片/附件');
          }
          if (item.requireRemark && !remark) {
            errors.push((item.name || '检查项') + ' 缺少备注');
          }
          for (var j = 0; j < files.length; j++) {
            var fileError = validateFile(files[j]);
            if (fileError) errors.push((item.name || '检查项') + '：' + fileError);
          }
          payloadItems.push({ itemId: item.id, remark: remark });
        }

        if (errors.length) {
          showMessage(errors.join('\\n'), 'error');
          return;
        }

        btn.disabled = true;
        btn.textContent = '提交中...';
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

          var response = await fetch('/api/quality/submit', { method: 'POST', body: form });
          var result = await response.json();
          if (!result || !result.success) {
            throw new Error((result && result.error) || '提交失败');
          }
          showMessage('提交成功，等待后台审核。', 'success');
          state.filesByItem = {};
          await loadTask();
        } catch (error) {
          showMessage(error.message || '提交失败', 'error');
        } finally {
          btn.disabled = false;
          btn.textContent = '提交任务';
        }
      }

      function validateFile(file) {
        if (!file || !file.name) return '附件无效';
        if (file.size > maxFileSize) return file.name + ' 超过 10MB';
        var ext = file.name.split('.').pop().toLowerCase();
        if (allowedExtensions.indexOf(ext) === -1) {
          return file.name + ' 类型不支持，仅支持 jpg/jpeg/png/webp/pdf';
        }
        return '';
      }

      function renderStatus(status) {
        if (status === 'approved') return '<span class="status status-approved">已通过</span>';
        if (status === 'rejected') return '<span class="status status-rejected">已驳回 / 待重传</span>';
        if (status === 'submitted') return '<span class="status status-submitted">已提交 / 待审核</span>';
        return '<span class="status">待提交</span>';
      }

      function metaCell(label, valueHtml) {
        return '<div class="meta-item"><span class="label">' + escapeHtml(label) + '</span><div>' + valueHtml + '</div></div>';
      }

      function getReviewComment(submission) {
        if (!submission) return '';
        return String(submission.reviewComment || submission.review_comment || '').trim();
      }

      function formatDate(value) {
        return value ? String(value).replace('T', ' ').slice(0, 19) : '';
      }

      function showMessage(text, type) {
        messageEl.textContent = text || '';
        messageEl.className = 'message message-' + (type || 'info') + ' show';
      }

      function clearMessage() {
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
        return escapeHtml(value).replace(/\\x60/g, '&#96;');
      }

      function cssEscape(value) {
        if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(value));
        return String(value).replace(/"/g, '\\"');
      }
    })();
  </script>
</body>
</html>`;
}
