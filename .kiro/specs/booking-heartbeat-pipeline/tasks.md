# Implementation Plan: Booking 心跳链路数据解析流程

## Overview

打通 Booking 平台在心跳系统中的完整数据采集链路。新增 `api-booking-hotel-search` skill（酒店名 → slug），并适配 `heartbeat-manager.ts` 使竞品采集支持 Booking 的 slug 参数。已有的 `api-booking-public-price` skill 无需修改。

实现基于已验证的测试脚本 `scripts/test-booking-slug-resolve.js`，正式 skill 是其清理版本。

## Tasks

- [x] 1. 新增 api-booking-hotel-search skill 脚本
  - [x] 1.1 创建 `scripts/api-booking-hotel-search/index.js`
    - 基于 `scripts/test-booking-slug-resolve.js` 中已验证的逻辑，清理为正式 skill 脚本
    - 使用 `APIRuntime` 的 `fetch`、`output`、`outputError` 方法，与 `scripts/api-ctrip-hotel-search/index.js` 风格对齐
    - 实现流程：参数校验 → GraphQL AutoComplete 调用 → 筛选 HOTEL 类型 → 构造搜索结果页 URL → 正则提取 slug → 降级提取
    - 错误码：`MISSING_PARAM`、`NO_HOTEL_RESULTS`、`WAF_BLOCKED`、`NO_SLUG_FOUND`、`EXCEPTION`
    - check-in/check-out 日期动态计算（今天/明天），不硬编码
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 6.1, 6.3_

  - [ ]* 1.2 编写 slug 提取逻辑的属性测试
    - **Property 2: Slug 提取与格式不变性** — 对任意包含 `/hotel/{cc}/{slug}.xxx` 格式链接的 HTML，提取结果要么匹配 `/^[a-z0-9][a-z0-9-]+$/`，要么返回错误；精确匹配优先于降级匹配
    - **Validates: Requirements 2.2, 2.3, 2.6**

  - [ ]* 1.3 编写 WAF 检测逻辑的属性测试
    - **Property 3: WAF 检测正确性** — 仅当 HTML 长度 < 10000 且包含 `challenge.js` 时返回 WAF_BLOCKED；长度 >= 10000 时无论内容如何都不触发
    - **Validates: Requirements 3.1, 3.2**

  - [ ]* 1.4 编写 HOTEL 类型筛选的属性测试
    - **Property 1: HOTEL 类型筛选正确性** — 对任意混合 destType 的结果数组，筛选后仅包含 `destType === 'HOTEL'` 的元素，且为输入子集、顺序不变
    - **Validates: Requirement 1.2**

- [x] 2. 注册 api-booking-hotel-search skill
  - [x] 2.1 创建 `skills/api-booking-hotel-search/SKILL.md`
    - 参考 `skills/api-ctrip-hotel-search/SKILL.md` 格式
    - name 以 `api-` 开头，确保 SkillExecutor 自动注入 Cookie
    - 声明 `keyword`（required）和 `cookieDomain`（required）参数
    - 包含使用方法说明和 API 失效时的恢复指引
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 3. Checkpoint — 验证 api-booking-hotel-search skill
  - Ensure all tests pass, ask the user if questions arise.
  - 可用 `scripts/test-booking-slug-resolve.js` 的已有测试数据对比验证逻辑一致性

- [x] 4. 适配 heartbeat-manager.ts 竞品采集
  - [x] 4.1 修改 `src/main/heartbeat/heartbeat-manager.ts` 中 `executeCompetitorTasks` 方法
    - 在 `compParams` 构造处增加 Booking 平台判断：`if (task.platform === 'booking')` 传 `hotelSlug`，否则保持原有 `hotelId` 逻辑
    - 仅修改约 3 行代码，不改动方法的其他部分
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.2_

  - [ ]* 4.2 编写平台参数隔离性的属性测试
    - **Property 4: 平台参数隔离性** — 当 platform 为 `booking` 时 compParams 有 `hotelSlug` 且无 `hotelId`；当 platform 非 `booking` 时有 `hotelId` 且无 `hotelSlug`
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 5. 清理测试文件
  - [x] 5.1 删除 `skills/test-booking-slug-resolve/` 目录（如存在）
    - 正式 skill 已创建，测试 skill 注册不再需要
    - _Requirements: 4.1_

  - [x] 5.2 删除 `skills/api-booking-slug-test/` 目录（如存在）
    - 正式 skill 已创建，测试 skill 注册不再需要
    - _Requirements: 4.1_

- [x] 6. Final checkpoint — 全链路验证
  - Ensure all tests pass, ask the user if questions arise.
  - 确认 `api-booking-hotel-search` skill 可被 SkillExecutor 正常加载
  - 确认 `executeCompetitorTasks` 对 Booking 平台传 `hotelSlug`，对其他平台行为不变

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- 已有 `api-booking-public-price` skill 和 `adapter.js` 无需修改
- `scripts/test-booking-slug-resolve.js` 保留作为参考脚本（非 skill 注册），不删除
- 代码风格保持简洁，与现有 ctrip-hotel-search 对齐
- Property tests validate universal correctness properties from the design document
