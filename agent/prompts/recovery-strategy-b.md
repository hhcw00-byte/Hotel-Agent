## 你的任务：本地修复脚本或 adapter

当前错误表明 API 脚本能正常获取数据，问题出在 adapter.js 缺失/映射错误，或脚本有小 bug（日期硬编码、isRSC 等）。
**禁止调用爬虫（ai-web-crawler）。所有修复必须通过读写本地文件完成。**

## 执行步骤

### 第1步：读取脚本
用 file-operations readFile 读取 scripts/{{skill}}/index.js，检查以下问题并修复：
- **日期硬编码** → 改为 new Date() 动态计算（最常见问题）
- **isRSC: true** → 改为 false
- **hotelId 写死了错误值** → 修正
- **URL 明显错误** → 参考同平台脚本修复

### 第2步：检查 adapter.js
用 file-operations 检查 scripts/{{skill}}/adapter.js 是否存在：
- **不存在** →
  1. 用 file-operations listDir 列出 data/api-results/ 找到该 skill 的 JSON 文件
  2. 用 file-operations readFile 读取**最新**文件前 200 行，判断是否为失败响应（存在以下任一标记即为失败响应，不要用来写 adapter）：
     - `"success": false` 或存在 `"error"` 字段
     - `"code"` 字段 >= 400（如 `{"code": 400, "message": "Initial Parameter Error"}`）
     - 存在 `"htlSpiderActionErrorCode"`（携程系反爬标记）
     - `"data": null` 或 `"data": {}` 且顶层有 `"ResponseStatus"`
  3. 如果最新文件是失败响应：
     - 先从 listDir 结果往前翻**更早的**成功样本（`success:true` 且有业务字段），优先用成功样本写 adapter
     - 如果所有历史文件都是失败响应 → **立即停止策略B**（本地无有效样本可参考）。本次修复应由 Recovery 上层机制升级到策略A重新拦截 API 刷新样本；你只需在答复中说明"无有效成功样本，需升级策略A"
  4. 基于成功样本数据结构，参照末尾的「脚本参考示例」中对应平台的 adapter 模板
  5. 用 file-operations writeFile 生成 adapter.js
- **存在但映射错误** → 读取 adapter.js 和最新**成功**数据文件，对照实际结构修复字段路径。如果最新文件是失败响应，同样按上述规则翻更早的成功样本

### 第3步：执行验证
调用 {{skill}} 验证修复结果，确认 success:true 且数据非空。

### 第4步：入库
调用 data-store({ source: "{{skill}}" }) 入库。

## adapter 输出格式
```js
function adapt(rawData) {
  return { platform: 'xxx', data: [{ roomName, date?, price?, originalPrice?, cost?, currency?, breakfast?, available?, planName?, totalRooms?, availableRooms?, occupancyRate?, adr?, revpar?, sourceType? }] };
}
module.exports = { adapt };
```

**availableRooms 铁律**：公网 API 必须将 `availableRooms` 设为 `null`。后台 API 可映射，但 >= 999 设为 null。

## 脚本修复铁律
- 日期必须动态计算，禁止硬编码
- isRSC 必须为 false
- **adapter.js 必须基于 data/api-results/ 下的真实数据结构编写，不要猜测字段路径**
- **酒店标识参数（hotelId、hotelSlug、poiId、partnerId）禁止写默认值。** 必须用以下模式：
```javascript
// ✅ 正确写法：缺少参数直接报错
const poiId = params.poiId;
if (!poiId) return runtime.outputError('MISSING_PARAM', 'poiId is required');

// ❌ 错误写法：写了默认值，换酒店就坏
const poiId = params.poiId || '1432564683';
```
即使你在数据文件或脚本中看到了具体的 hotelId/poiId/partnerId 值，也**绝对不能**把它写成默认值。
- **美团后台参数类型**：`poiId` 必须是字符串（`String(params.poiId)`），`partnerId` 必须是数字（`Number(params.partnerId)`）。类型不对会导致美团 API 返回 403。

{{dataSample}}

{{scriptExamples}}
