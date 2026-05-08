/**
 * Application Menu - 应用程序菜单
 * 
 * 职责：
 * - 创建应用程序菜单
 * - 处理菜单项点击事件
 * - 提供标准的应用程序功能（退出、复制、粘贴等）
 * - 支持中英文切换
 */

import { Menu, BrowserWindow, app, shell } from 'electron';

type Language = 'zh' | 'en';

interface MenuLabels {
  file: string;
  newWindow: string;
  closeWindow: string;
  quit: string;
  edit: string;
  undo: string;
  redo: string;
  cut: string;
  copy: string;
  paste: string;
  selectAll: string;
  view: string;
  reload: string;
  forceReload: string;
  actualSize: string;
  zoomIn: string;
  zoomOut: string;
  fullscreen: string;
  devTools: string;
  window: string;
  minimize: string;
  zoom: string;
  front: string;
  help: string;
  docs: string;
  reportIssue: string;
  about: string;
  version: string;
}

const labels: Record<Language, MenuLabels> = {
  zh: {
    file: '文件', newWindow: '新建窗口', closeWindow: '关闭窗口', quit: '退出',
    edit: '编辑', undo: '撤销', redo: '重做', cut: '剪切', copy: '复制', paste: '粘贴', selectAll: '全选',
    view: '查看', reload: '重新加载', forceReload: '强制重新加载', actualSize: '实际大小',
    zoomIn: '放大', zoomOut: '缩小', fullscreen: '切换全屏', devTools: '开发者工具',
    window: '窗口', minimize: '最小化', zoom: '缩放', front: '全部置于顶层',
    help: '帮助', docs: '文档', reportIssue: '报告问题', about: '关于', version: '版本',
  },
  en: {
    file: 'File', newWindow: 'New Window', closeWindow: 'Close Window', quit: 'Quit',
    edit: 'Edit', undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select All',
    view: 'View', reload: 'Reload', forceReload: 'Force Reload', actualSize: 'Actual Size',
    zoomIn: 'Zoom In', zoomOut: 'Zoom Out', fullscreen: 'Toggle Fullscreen', devTools: 'Developer Tools',
    window: 'Window', minimize: 'Minimize', zoom: 'Zoom', front: 'Bring All to Front',
    help: 'Help', docs: 'Documentation', reportIssue: 'Report Issue', about: 'About', version: 'Version',
  },
};

/** 当前缓存的主窗口引用，用于 rebuildMenu */
let cachedMainWindow: BrowserWindow | null = null;

/**
 * 创建应用程序菜单
 */
export function createApplicationMenu(mainWindow: BrowserWindow, lang: Language = 'zh'): Menu {
  const isMac = process.platform === 'darwin';
  const l = labels[lang];

  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: l.file,
      submenu: [
        { label: l.newWindow, accelerator: 'CmdOrCtrl+N', click: () => { console.log('New window not implemented yet'); }, enabled: false },
        { type: 'separator' },
        isMac ? { role: 'close', label: l.closeWindow } : { role: 'quit', label: l.quit }
      ]
    },
    {
      label: l.edit,
      submenu: [
        { role: 'undo', label: l.undo },
        { role: 'redo', label: l.redo },
        { type: 'separator' },
        { role: 'cut', label: l.cut },
        { role: 'copy', label: l.copy },
        { role: 'paste', label: l.paste },
        { role: 'selectAll', label: l.selectAll }
      ]
    },
    {
      label: l.view,
      submenu: [
        { role: 'reload', label: l.reload },
        { role: 'forceReload', label: l.forceReload },
        { type: 'separator' },
        { role: 'resetZoom', label: l.actualSize },
        { role: 'zoomIn', label: l.zoomIn },
        { role: 'zoomOut', label: l.zoomOut },
        { type: 'separator' },
        { role: 'togglefullscreen', label: l.fullscreen },
        { type: 'separator' },
        { label: l.devTools, accelerator: isMac ? 'Alt+Command+I' : 'Ctrl+Shift+I', click: () => { mainWindow.webContents.toggleDevTools(); } }
      ]
    },
    ...(isMac ? [{
      label: l.window,
      submenu: [
        { role: 'minimize' as const, label: l.minimize },
        { role: 'zoom' as const, label: l.zoom },
        { type: 'separator' as const },
        { role: 'front' as const, label: l.front }
      ]
    }] : []),
    {
      label: l.help,
      submenu: [
        { label: l.docs, click: async () => { await shell.openExternal('https://github.com'); } },
        { label: l.reportIssue, click: async () => { await shell.openExternal('https://github.com/issues'); } },
        { type: 'separator' },
        {
          label: l.about,
          click: () => {
            const aboutMessage = `Hotel-Agent\n${l.version}: ${app.getVersion()}\nElectron: ${process.versions.electron}\nChrome: ${process.versions.chrome}\nNode.js: ${process.versions.node}\nV8: ${process.versions.v8}`;
            mainWindow.webContents.send('menu:show-about', aboutMessage);
          }
        }
      ]
    }
  ];

  return Menu.buildFromTemplate(template);
}

/**
 * 设置应用程序菜单
 */
export function setApplicationMenu(mainWindow: BrowserWindow, lang: Language = 'zh'): void {
  cachedMainWindow = mainWindow;
  const menu = createApplicationMenu(mainWindow, lang);
  Menu.setApplicationMenu(menu);
  console.log('Application menu set');
}

/**
 * 重建菜单（语言切换时调用）
 */
export function rebuildMenu(lang: Language): void {
  if (cachedMainWindow && !cachedMainWindow.isDestroyed()) {
    setApplicationMenu(cachedMainWindow, lang);
    console.log(`Menu rebuilt for language: ${lang}`);
  }
}
