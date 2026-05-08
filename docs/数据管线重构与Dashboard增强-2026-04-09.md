# 数据管线重构 & Dashboard 增强 & 打包修复（2026-04-09）

## 一、本次改动概述

在 2026-04-02 API-First 流程基础上，完成了四大模块的升级：

1. **Co-located Adapter 模式** — 每个 `scripts/api-xxx/` 目录自带 `adapter.js`，替代中心化 ADAPTER_MAP
2. **数据库 Schema 升级** — price_snapshots / room_snapshots 新增字段，新建 room_type_mapping 表
3. **Dashboard 分区重构** — 按业务维度（携程/美团/PMS/Booking）分 Tab，各 Tab 显示对应面板
4. **打包配置修复** — 补全 extraResources、清理硬编码路径、排除运行时数据

---

## 二、Co-located Adapter 模式

### 2.1 设计

```
scripts/
  api-ctrip-public-price/
    index.js          ← API 抓取脚本
    adapter.js         ← 数据适配器（新增）
  api-meituan-realtime-status/
    index.js
    adapter.js         ← 全新 PMS 房态适配器
  data-store/
    index.js           ← findAdapter() 优先查 co-located，fallback LEGACY_MAP
```

### 2.2 findAdapter() 查找逻辑

```javascript
// scripts/data-store/index.js & scripts/data-cleaner/index.js
function findAdapter(source) {
  const colocated = path.join(__dirname, '..', source, 'adapter.js');
  if (fs.existsSync(colocated)) return require(colocated);
  const legacy = LEGACY_MAP[source];
  if (legacy) return require(legacy);
  return null;
}
```

### 2.3 Adapter 清单与状态

| Adapter | platform 值 | 关键改动 | 记录数(测试) |
|---------|------------|---------|-------------|
| api-ctrip-public-price | `ctrip-public` | 新增 sourceType='public'，容器解析修复 | 3 |
| api-trip-public-price | `trip-public` | **重写**：改用 saleRoomMap，currency='USD' | 4 |
| api-ctrip-backend-price | `ctrip-backend` | 多日价格遍历，含 cost/planName/breakfast | 13 |
| api-meituan-backend-price | `meituan-backend` | 多日价格遍历，分→元转换 | 14 |
| api-meituan-realtime-status | `meituan-pms` | **全新**：7房型×31天，含 occupancyRate/adr/revpar | 217 |
| api-booking-public-price | `booking-public` | 迁移，暂缓 | - |

### 2.4 Adapter 输出标准

```javascript
{
  platform: 'ctrip-backend',
  data: [{
    roomName, date?, price?, originalPrice?, cost?, currency?,
    breakfast?, available?, planName?,
    totalRooms?, availableRooms?, occupancyRate?, adr?, revpar?,
    sourceType?  // 'public' | 'backend'
  }]
}
```

---

## 三、数据库 Schema 升级

### 3.1 price_snapshots 新增列

| 列名 | 类型 | 说明 |
|------|------|------|
| date | DATE | 价格生效日期（支持多日价格） |
| plan_name | VARCHAR(200) | 房型方案名（如"含早大床房"） |
| cost | DECIMAL(10,2) | 底价/成本价 |
| breakfast | VARCHAR(100) | 早餐信息 |
| available | TINYINT(1) | 是否可售 |
| source_type | VARCHAR(50) | 数据来源类型（public/backend） |

### 3.2 room_snapshots 新增列

| 列名 | 类型 | 说明 |
|------|------|------|
| occupancy_rate | DECIMAL(5,2) | 入住率（%） |
| adr | DECIMAL(10,2) | 平均房价 |
| revpar | DECIMAL(10,2) | 每间可售房收入 |

### 3.3 新建 room_type_mapping 表

```sql
CREATE TABLE IF NOT EXISTS room_type_mapping (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  platform VARCHAR(50) NOT NULL,
  raw_room_name VARCHAR(200) NOT NULL,
  canonical_name VARCHAR(200),
  confidence DECIMAL(3,2) DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_user_platform_room (user_id, platform, raw_room_name)
)
```

用途：跨平台房型名称映射。HeartbeatManager 在 data-store 入库后调用 `resolveRoomMappings()`，通过 LLM 一次性匹配未映射的房型名。

### 3.4 迁移方式

ALTER TABLE + try-catch 忽略 errno 1060/1061，实现幂等迁移。

---

## 四、Dashboard 分区重构

### 4.1 Tab 结构

| Tab | 包含的 DB platform 值 | 显示面板 |
|-----|----------------------|----------|
| 全部 | 不过滤 | 价格日历 + 房态日历 + 趋势图 |
| 携程 | ctrip-backend, ctrip-public, trip-public | 价格日历 + 趋势图 |
| 美团 | meituan-backend | 价格日历 + 趋势图 |
| PMS | meituan-pms | 房态预测（专用渲染） |
| Booking | booking-public | 价格日历 + 趋势图 |

### 4.2 核心配置对象

```javascript
// Tab → DB platform 映射
var TAB_PLATFORMS = {
  'all':     null,
  'ctrip':   ['ctrip-backend', 'ctrip-public', 'trip-public'],
  'meituan': ['meituan-backend'],
  'pms':     ['meituan-pms'],
  'booking': ['booking-public']
};

// Tab → 面板可见性
var TAB_PANELS = {
  'all':     { priceCalendar: true,  roomCalendar: true,  trend: true  },
  'ctrip':   { priceCalendar: true,  roomCalendar: false, trend: true  },
  'meituan': { priceCalendar: true,  roomCalendar: false, trend: true  },
  'pms':     { priceCalendar: false, roomCalendar: true,  trend: false },
  'booking': { priceCalendar: true,  roomCalendar: false, trend: true  }
};

// Sub-row 简短标签（同 Tab 内区分数据来源）
var PLATFORM_SHORT_LABEL = {
  'ctrip-backend': '携程后台',
  'ctrip-public':  '携程公网',
  'trip-public':   'Trip.com公网',
  'meituan-backend': '后台价格',
  'meituan-pms':   'PMS(别样红)',
  'booking-public': '公网价格'
};
```

### 4.3 PMS 专用渲染 `renderPmsForecast()`

每个房型占 4 行：可用房/总房 → 入住率（带色标） → ADR → RevPAR。
入住率色标：>=80% 红、>=50% 黄、<50% 绿。

### 4.4 IPC 新增通道

| Channel | 方法 | 说明 |
|---------|------|------|
| DASHBOARD_PRICE_CALENDAR | getPriceCalendar(start, end) | 价格日历数据，LEFT JOIN room_type_mapping |
| DASHBOARD_ROOM_CALENDAR | getRoomCalendar(start, end) | 房态日历数据 |
| DASHBOARD_ROOM_MAPPING | getRoomMappings() | 房型映射列表 |

---

## 五、打包配置修复

### 5.1 修复项

| 问题 | 修复 |
|------|------|
| `api-meituan-realtime-status` 未在 extraResources | 已添加 |
| `data/api-results/` 历史文件被打包 | extraResources filter 排除 `!api-results/**` |
| crawler-orchestrator 硬编码 `D:\PycharmProjects\...` | 改为 `process.cwd()` |
| data-store 遗留诊断日志 | 已移除 |
| database/test-conn.js 测试文件 | 已删除 |

### 5.2 打包产物验证

```
release/
  Hotel AI Browser Setup 1.0.0.exe   (118MB)
  win-unpacked/
    resources/
      scripts/
        api-ctrip-public-price/     ✓ index.js + adapter.js
        api-trip-public-price/      ✓ index.js + adapter.js
        api-ctrip-backend-price/    ✓ index.js + adapter.js
        api-meituan-backend-price/  ✓ index.js + adapter.js
        api-meituan-realtime-status/✓ index.js + adapter.js（新增）
        api-booking-public-price/   ✓ index.js + adapter.js
        data-store/                 ✓ index.js
        data-cleaner/               ✓ index.js + adapters/
        api-runtime/                ✓ index.js
      database/
        dist/                       ✓ database-manager.js
        node_modules/               ✓ mysql2
```

### 5.3 子进程路径解析（打包后）

```
data-store/index.js
  require('../../database/dist/database-manager')
  → resources/database/dist/database-manager.js  ✓

database-manager.js
  require('mysql2/promise')
  → Node walk-up: resources/database/node_modules/mysql2  ✓

findAdapter('api-ctrip-public-price')
  path.join(__dirname, '..', source, 'adapter.js')
  → resources/scripts/api-ctrip-public-price/adapter.js  ✓
```

---

## 六、涉及文件清单

| 文件 | 改动类型 |
|------|---------|
| `scripts/api-ctrip-public-price/adapter.js` | 新建 |
| `scripts/api-trip-public-price/adapter.js` | 新建（重写） |
| `scripts/api-ctrip-backend-price/adapter.js` | 新建 |
| `scripts/api-meituan-backend-price/adapter.js` | 新建 |
| `scripts/api-meituan-realtime-status/adapter.js` | 新建 |
| `scripts/api-booking-public-price/adapter.js` | 新建（迁移） |
| `scripts/data-store/index.js` | 改：findAdapter + 新字段传递 |
| `scripts/data-cleaner/index.js` | 改：findAdapter |
| `database/database-manager.ts` | 改：Schema + 新方法 |
| `src/main/heartbeat/heartbeat-manager.ts` | 改：resolveRoomMappings |
| `src/shared/types.ts` | 改：3 个 IPC channel |
| `src/preload/index.ts` | 改：3 个 dashboard bridge |
| `src/main/ipc-handler.ts` | 改：3 个 handler |
| `src/renderer/pages/hotel-admin.html` | 改：Dashboard 全面重构 |
| `agent/prompts/api-first-instruction.md` | 改：adapter 生成模板 |
| `agent/prompts/recovery.md` | 改：策略B 含 adapter |
| `scripts/ai-web-crawler/src/crawler-orchestrator.ts` | 改：移除硬编码路径 |
| `package.json` | 改：extraResources 补全 |

---

## 七、已知限制 & 后续目标

### 7.1 已知限制

- **skills/ 目录在 ASAR 内只读**：Agent recovery 创建新 skill 时会写 `skills/` 目录，打包后 ASAR 内不可写。需要将运行时 skill 存储迁移到 `app.getPath('userData')` 下的可写目录。
- **Booking adapter 暂缓**：booking-public 已迁移但未实际测试，API 返回 301 重定向需要处理。
- **房型映射依赖 LLM**：resolveRoomMappings 需要 LLM API 可用，离线环境下无法自动映射。

### 7.2 后续目标

1. **skills 可写目录迁移** — 让 Agent recovery 在打包后也能创建/修改 skill
2. **Booking adapter 完善** — 处理 301 重定向，完成数据接入
3. **Dashboard 交互增强** — 价格差异高亮（后台 vs 公网）、房型映射管理界面
4. **数据导出** — 支持 Excel/CSV 导出价格日历和房态数据
5. **多酒店支持** — 基于 user_id 的数据隔离已就绪，需要前端切换入口

