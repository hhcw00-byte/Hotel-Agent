(function () {
  var qualityApi = window.electronAPI && window.electronAPI.quality;
  var taskContent = document.getElementById('taskContent');
  var message = document.getElementById('message');
  var taskData = null;
  var fileState = {};

  function init() {
    if (!qualityApi) {
      showMessage('当前页面未在 Electron 应用内打开，无法提交质检任务。', 'error');
      taskContent.innerHTML = '';
      return;
    }

    taskContent.addEventListener('change', onFileChange);
    taskContent.addEventListener('click', onTaskClick);
    loadTask();
  }

  async function loadTask() {
    clearMessage();
    var params = new URLSearchParams(window.location.search);
    var taskId = params.get('taskId') || '';
    var submitToken = params.get('submitToken') || '';
    if (!taskId || !submitToken) {
      showMessage('提交链接缺少必要参数，请从后台重新打开提交页。', 'error');
      taskContent.innerHTML = '';
      return;
    }

    try {
      taskData = await unwrap(qualityApi.getSubmitTask({ taskId: taskId, submitToken: submitToken }));
      renderTask();
      if (taskData.alreadySubmitted || taskData.task.status === 'submitted') {
        showMessage('该任务已提交', 'info');
      }
    } catch (error) {
      showMessage(error.message, 'error');
      taskContent.innerHTML = '';
    }
  }

  function renderTask() {
    var task = taskData.task;
    var submitted = task.status === 'submitted' || taskData.alreadySubmitted;
    var html = '' +
      '<div class="task-summary">' +
        summaryCell('任务名称', escapeHtml(task.taskName)) +
        summaryCell('执行门店', escapeHtml(task.storeName)) +
        summaryCell('截止时间', escapeHtml(formatDate(task.dueAt) || '-')) +
        summaryCell('当前状态', renderStatus(task.status)) +
      '</div>' +
      '<div class="form-row">' +
        '<label>任务说明</label>' +
        '<div class="item-description">' + escapeHtml(task.instructions || '-') + '</div>' +
      '</div>' +
      '<form id="submitForm">' +
        taskData.items.map(function (item, index) { return renderItem(item, index, submitted); }).join('') +
        '<div class="actions">' +
          '<button type="button" class="btn btn-primary" id="submitBtn" ' + (submitted ? 'disabled' : '') + '>提交任务</button>' +
        '</div>' +
      '</form>';
    taskContent.innerHTML = html;
    renderAllFileLists();
  }

  function renderItem(item, index, submitted) {
    return '' +
      '<div class="submit-item" data-item-id="' + escapeAttr(item.id) + '">' +
        '<h3>' + (index + 1) + '. ' + escapeHtml(item.name) +
          (item.requireAttachment ? '<span class="required-mark">需附件</span>' : '') +
          (item.requireRemark ? '<span class="required-mark">需备注</span>' : '') +
        '</h3>' +
        '<div class="item-description">' + escapeHtml(item.description || '-') + '</div>' +
        '<div class="form-row" style="margin-top:12px">' +
          '<label>现场照片/附件</label>' +
          '<input type="file" multiple data-file-input="' + escapeAttr(item.id) + '" ' + (submitted ? 'disabled' : '') + '>' +
          '<div class="upload-list" data-file-list="' + escapeAttr(item.id) + '"></div>' +
        '</div>' +
        '<div class="form-row">' +
          '<label>备注</label>' +
          '<textarea data-remark="' + escapeAttr(item.id) + '" placeholder="填写现场情况、异常说明或处理结果" ' + (submitted ? 'disabled' : '') + '></textarea>' +
        '</div>' +
      '</div>';
  }

  async function onFileChange(event) {
    var input = event.target.closest('[data-file-input]');
    if (!input) return;
    var itemId = input.dataset.fileInput;
    var selected = Array.prototype.slice.call(input.files || []);
    if (!fileState[itemId]) fileState[itemId] = [];
    for (var i = 0; i < selected.length; i++) {
      var file = selected[i];
      var data = await file.arrayBuffer();
      fileState[itemId].push({
        name: file.name,
        type: file.type,
        size: file.size,
        data: data,
      });
    }
    input.value = '';
    renderFileList(itemId);
  }

  async function onTaskClick(event) {
    var removeBtn = event.target.closest('[data-remove-file]');
    if (removeBtn) {
      var itemId = removeBtn.dataset.itemId;
      var index = Number(removeBtn.dataset.removeFile);
      if (fileState[itemId]) {
        fileState[itemId].splice(index, 1);
        renderFileList(itemId);
      }
      return;
    }

    var submitBtn = event.target.closest('#submitBtn');
    if (submitBtn) {
      await submitTask(submitBtn);
    }
  }

  async function submitTask(button) {
    clearMessage();
    var errors = validateBeforeSubmit();
    if (errors.length > 0) {
      showMessage(errors.join('\n'), 'error');
      return;
    }

    button.disabled = true;
    button.textContent = '提交中...';
    try {
      var payload = {
        taskId: taskData.task.id,
        submitToken: taskData.task.submitToken,
        items: taskData.items.map(function (item) {
          var remarkEl = taskContent.querySelector('[data-remark="' + selectorValue(item.id) + '"]');
          return {
            itemId: item.id,
            remark: remarkEl ? remarkEl.value.trim() : '',
            attachments: fileState[item.id] || [],
          };
        }),
      };
      await unwrap(qualityApi.submitTask(payload));
      showMessage('提交成功', 'success');
      await loadTask();
    } catch (error) {
      showMessage(error.message, error.message.indexOf('已提交') >= 0 ? 'info' : 'error');
    } finally {
      button.disabled = false;
      button.textContent = '提交任务';
    }
  }

  function validateBeforeSubmit() {
    var errors = [];
    taskData.items.forEach(function (item, index) {
      var label = '第 ' + (index + 1) + ' 项「' + item.name + '」';
      var remarkEl = taskContent.querySelector('[data-remark="' + selectorValue(item.id) + '"]');
      var remark = remarkEl ? remarkEl.value.trim() : '';
      var attachments = fileState[item.id] || [];
      if (item.requireAttachment && attachments.length === 0) {
        errors.push(label + '缺少现场照片/附件');
      }
      if (item.requireRemark && !remark) {
        errors.push(label + '缺少备注');
      }
    });
    return errors;
  }

  function renderAllFileLists() {
    taskData.items.forEach(function (item) { renderFileList(item.id); });
  }

  function renderFileList(itemId) {
    var list = taskContent.querySelector('[data-file-list="' + selectorValue(itemId) + '"]');
    if (!list) return;
    var files = fileState[itemId] || [];
    if (!files.length) {
      list.innerHTML = '<div class="topbar-subtitle">尚未选择附件</div>';
      return;
    }
    list.innerHTML = files.map(function (file, index) {
      return '' +
        '<span class="file-pill">' +
          '<span title="' + escapeAttr(file.name) + '">' + escapeHtml(file.name) + '</span>' +
          '<button type="button" class="btn btn-sm" data-item-id="' + escapeAttr(itemId) + '" data-remove-file="' + index + '">移除</button>' +
        '</span>';
    }).join('');
  }

  async function unwrap(promise) {
    var result = await promise;
    if (!result || !result.success) {
      throw new Error((result && result.error) || '操作失败');
    }
    return result.data;
  }

  function summaryCell(label, valueHtml) {
    return '<div class="summary-cell"><div class="summary-label">' + label + '</div><div class="summary-value">' + valueHtml + '</div></div>';
  }

  function renderStatus(status) {
    if (status === 'submitted') return '<span class="status status-submitted">已提交</span>';
    return '<span class="status status-pending">待提交</span>';
  }

  function showMessage(text, type) {
    message.textContent = text || '';
    message.className = 'message message-' + (type || 'info') + ' show';
  }

  function clearMessage() {
    message.textContent = '';
    message.className = 'message';
  }

  function formatDate(value) {
    if (!value) return '';
    return String(value).replace('T', ' ').slice(0, 19);
  }

  function selectorValue(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
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
    return escapeHtml(value).replace(/`/g, '&#96;');
  }

  loadTask = async function () {
    clearMessage();
    var params = new URLSearchParams(window.location.search);
    var taskId = params.get('taskId') || '';
    var submitToken = params.get('submitToken') || '';
    if (!taskId || !submitToken) {
      showMessage('\u63d0\u4ea4\u94fe\u63a5\u7f3a\u5c11\u5fc5\u8981\u53c2\u6570\uff0c\u8bf7\u4ece\u540e\u53f0\u91cd\u65b0\u6253\u5f00\u63d0\u4ea4\u9875\u3002', 'error');
      taskContent.innerHTML = '';
      return;
    }

    try {
      taskData = await unwrap(qualityApi.getSubmitTask({ taskId: taskId, submitToken: submitToken }));
      renderTask();
      var status = taskData.task.status;
      var reviewComment = getReviewComment(taskData.submission);
      if (status === 'approved') {
        showMessage('\u8be5\u4efb\u52a1\u5df2\u5ba1\u6838\u901a\u8fc7', 'info');
      } else if (status === 'submitted' || taskData.alreadySubmitted) {
        showMessage('\u8be5\u4efb\u52a1\u5df2\u63d0\u4ea4\uff0c\u7b49\u5f85\u5ba1\u6838', 'info');
      } else if (status === 'rejected') {
        showMessage('\u8be5\u4efb\u52a1\u5df2\u88ab\u9a73\u56de\uff0c\u8bf7\u6839\u636e\u9a73\u56de\u539f\u56e0\u91cd\u65b0\u63d0\u4ea4' + (reviewComment ? '\n' + reviewComment : ''), 'error');
      }
    } catch (error) {
      showMessage(error.message, 'error');
      taskContent.innerHTML = '';
    }
  };

  renderTask = function () {
    var task = taskData.task;
    var readOnly = task.status === 'submitted' || task.status === 'approved' || taskData.alreadySubmitted;
    var reviewComment = getReviewComment(taskData.submission);
    var rejectedHtml = task.status === 'rejected'
      ? '<div class="message message-error show">\u8be5\u4efb\u52a1\u5df2\u88ab\u9a73\u56de\uff0c\u8bf7\u6839\u636e\u9a73\u56de\u539f\u56e0\u91cd\u65b0\u63d0\u4ea4' + (reviewComment ? '<br>' + escapeHtml(reviewComment) : '') + '</div>'
      : '';
    var html = '' +
      '<div class="task-summary">' +
        summaryCell('\u4efb\u52a1\u540d\u79f0', escapeHtml(task.taskName)) +
        summaryCell('\u6267\u884c\u95e8\u5e97', escapeHtml(task.storeName)) +
        summaryCell('\u622a\u6b62\u65f6\u95f4', escapeHtml(formatDate(task.dueAt) || '-')) +
        summaryCell('\u5f53\u524d\u72b6\u6001', renderStatus(task.status)) +
      '</div>' +
      rejectedHtml +
      '<div class="form-row">' +
        '<label>\u4efb\u52a1\u8bf4\u660e</label>' +
        '<div class="item-description">' + escapeHtml(task.instructions || '-') + '</div>' +
      '</div>' +
      '<form id="submitForm">' +
        taskData.items.map(function (item, index) { return renderItem(item, index, readOnly); }).join('') +
        '<div class="actions">' +
          '<button type="button" class="btn btn-primary" id="submitBtn" ' + (readOnly ? 'disabled' : '') + '>\u63d0\u4ea4\u4efb\u52a1</button>' +
        '</div>' +
      '</form>';
    taskContent.innerHTML = html;
    renderAllFileLists();
  };

  renderItem = function (item, index, readOnly) {
    return '' +
      '<div class="submit-item" data-item-id="' + escapeAttr(item.id) + '">' +
        '<h3>' + (index + 1) + '. ' + escapeHtml(item.name) +
          (item.requireAttachment ? '<span class="required-mark">\u9700\u9644\u4ef6</span>' : '') +
          (item.requireRemark ? '<span class="required-mark">\u9700\u5907\u6ce8</span>' : '') +
        '</h3>' +
        '<div class="item-description">' + escapeHtml(item.description || '-') + '</div>' +
        '<div class="form-row" style="margin-top:12px">' +
          '<label>\u73b0\u573a\u7167\u7247/\u9644\u4ef6</label>' +
          '<input type="file" multiple data-file-input="' + escapeAttr(item.id) + '" ' + (readOnly ? 'disabled' : '') + '>' +
          '<div class="upload-list" data-file-list="' + escapeAttr(item.id) + '"></div>' +
        '</div>' +
        '<div class="form-row">' +
          '<label>\u5907\u6ce8</label>' +
          '<textarea data-remark="' + escapeAttr(item.id) + '" placeholder="\u586b\u5199\u73b0\u573a\u60c5\u51b5\u3001\u5f02\u5e38\u8bf4\u660e\u6216\u5904\u7406\u7ed3\u679c" ' + (readOnly ? 'disabled' : '') + '></textarea>' +
        '</div>' +
      '</div>';
  };

  renderStatus = function (status) {
    if (status === 'approved') return '<span class="status status-submitted">\u5df2\u901a\u8fc7</span>';
    if (status === 'rejected') return '<span class="status status-pending">\u5df2\u9a73\u56de / \u5f85\u91cd\u4f20</span>';
    if (status === 'submitted') return '<span class="status status-submitted">\u5df2\u63d0\u4ea4 / \u5f85\u5ba1\u6838</span>';
    return '<span class="status status-pending">\u5f85\u63d0\u4ea4</span>';
  };

  function getReviewComment(submission) {
    if (!submission) return '';
    return String(submission.reviewComment || submission.review_comment || '').trim();
  }

  init();
})();
