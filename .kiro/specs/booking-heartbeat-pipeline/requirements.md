# Requirements Document

## Introduction

本文档定义 Booking 平台心跳链路数据采集流程的功能需求。该功能打通 Booking 平台在心跳系统中的完整数据采集链路，包括：新增 `api-booking-hotel-search` skill 实现酒店名到 slug 的解析，以及适配 `heartbeat-manager.ts` 使竞品采集支持 Booking 平台的 slug 参数。

本功能为正向新增，不改动其他平台的现有逻辑。整体逻辑参考携程（`api-ctrip-hotel-search`）对齐颗粒度，但解析方式不同（Booking 解析 HTML，携程解析 JSON）。

## Glossary

- **Skill**: 系统中可执行的 API 调用单元，由 `SKILL.md` 描述元数据、`index.js` 实现逻辑
- **Slug**: Booking 酒店 URL 中的唯一标识符，由小写字母、数字和连字符组成（如 `intercontinental-beijing-sanlitun`）
- **DestId**: Booking 内部的 destination ID，用于标识酒店、城市等实体
- **GraphQL_AutoComplete_API**: Booking 提供的 GraphQL 自动补全接口，根据关键词返回匹配的酒店、城市等结果
- **SearchResultPage**: Booking 搜索结果页 HTML，包含酒店链接和 slug 信息
- **HeartbeatManager**: 心跳管理器，负责定时触发 API 采集任务并展开竞品采集
- **CompetitorPlatformIds**: 数据库表 `competitor_platform_ids`，存储竞品在各平台的标识（Booking 平台存储 slug）
- **SkillExecutor**: 技能执行器，负责运行 skill 脚本并自动注入 Cookie
- **WAF**: Web Application Firewall，Booking 的反爬机制
- **APIRuntime**: 内部 HTTP 请求运行时，提供 `fetch`、`output`、`outputError` 等方法

## Requirements

### Requirement 1: GraphQL AutoComplete 酒店搜索

**User Story:** As a 系统运维人员, I want to 通过酒店名关键词查询 Booking 酒店的 destId 和 countryCode, so that 后续流程可以构造搜索结果页 URL 提取 slug。

#### Acceptance Criteria

1. WHEN a keyword parameter is provided, THE GraphQL_AutoComplete_API SHALL be called with the keyword as `prefixQuery` and return matching results
2. WHEN the GraphQL_AutoComplete_API returns results, THE api-booking-hotel-search Skill SHALL filter results to only those with `destType` equal to `HOTEL`
3. WHEN no results with `destType` equal to `HOTEL` are found, THE api-booking-hotel-search Skill SHALL output error code `NO_HOTEL_RESULTS` with the search keyword
4. WHEN hotel results are found, THE api-booking-hotel-search Skill SHALL select the first hotel result and extract its `destId`, `countryCode`, and `hotelName`
5. IF the keyword parameter is empty or missing, THEN THE api-booking-hotel-search Skill SHALL output error code `MISSING_PARAM`

### Requirement 2: 搜索结果页 Slug 提取

**User Story:** As a 系统运维人员, I want to 从 Booking 搜索结果页 HTML 中提取目标酒店的 URL slug, so that 该 slug 可用于后续房价采集。

#### Acceptance Criteria

1. WHEN destId and countryCode are obtained, THE api-booking-hotel-search Skill SHALL construct a SearchResultPage URL with the hotel name, destId, dynamic check-in/check-out dates, and request the HTML
2. WHEN the SearchResultPage HTML is received, THE api-booking-hotel-search Skill SHALL use a regex pattern `/hotel/{countryCode}/{slug}.*dest_id={destId}/` to extract the slug
3. WHEN the precise regex match fails, THE api-booking-hotel-search Skill SHALL fall back to extracting the first slug matching `/hotel/{countryCode}/{slug}.` from the HTML
4. WHEN a slug is successfully extracted, THE api-booking-hotel-search Skill SHALL return an object containing `slug`, `destId`, `countryCode`, and `hotelName`
5. WHEN no slug can be extracted from the HTML, THE api-booking-hotel-search Skill SHALL output error code `NO_SLUG_FOUND`
6. THE api-booking-hotel-search Skill SHALL validate that extracted slugs match the format `/^[a-z0-9][a-z0-9-]+$/`

### Requirement 3: WAF 拦截检测

**User Story:** As a 系统运维人员, I want to 检测 Booking 搜索结果页是否被 WAF 拦截, so that 系统能及时报告 Cookie 失效问题而非返回错误数据。

#### Acceptance Criteria

1. WHEN the SearchResultPage HTML length is less than 10000 bytes AND the HTML contains the string `challenge.js`, THE api-booking-hotel-search Skill SHALL output error code `WAF_BLOCKED`
2. WHEN the SearchResultPage HTML length is 10000 bytes or greater, THE api-booking-hotel-search Skill SHALL proceed with slug extraction regardless of HTML content

### Requirement 4: Skill 注册与 Cookie 注入

**User Story:** As a 系统运维人员, I want to 将 api-booking-hotel-search 注册为标准 skill 并自动注入 Cookie, so that 该 skill 可被 SkillExecutor 调用且能通过 Booking 的认证。

#### Acceptance Criteria

1. THE api-booking-hotel-search Skill SHALL have a SKILL.md file with name starting with `api-` to enable automatic Cookie injection
2. THE api-booking-hotel-search Skill SHALL declare `keyword` as a required string parameter and `cookieDomain` as a required string parameter
3. THE api-booking-hotel-search Skill SHALL use the APIRuntime for HTTP requests, consistent with existing skills

### Requirement 5: 心跳竞品采集 Booking 平台适配

**User Story:** As a 系统运维人员, I want to 心跳竞品采集在 Booking 平台传递 `hotelSlug` 而非 `hotelId`, so that `api-booking-public-price` skill 能正确接收 slug 参数并采集竞品房价。

#### Acceptance Criteria

1. WHEN the task platform is `booking`, THE HeartbeatManager SHALL set `compParams.hotelSlug` to the value of `comp.platformHotelId` from CompetitorPlatformIds
2. WHEN the task platform is `booking`, THE HeartbeatManager SHALL NOT set `compParams.hotelId`
3. WHEN the task platform is not `booking`, THE HeartbeatManager SHALL set `compParams.hotelId` using the existing logic `parseInt(comp.platformHotelId) || comp.platformHotelId`
4. WHEN the task platform is not `booking`, THE HeartbeatManager SHALL NOT set `compParams.hotelSlug`

### Requirement 6: 错误处理与日志

**User Story:** As a 系统运维人员, I want to 在 Booking 链路各环节有明确的错误码和日志, so that 问题发生时能快速定位原因。

#### Acceptance Criteria

1. WHEN the api-booking-hotel-search Skill encounters an error, THE Skill SHALL output a structured error with a specific error code from the set `{MISSING_PARAM, NO_HOTEL_RESULTS, WAF_BLOCKED, NO_SLUG_FOUND, EXCEPTION}`
2. WHEN a single competitor API call fails during heartbeat competitor collection, THE HeartbeatManager SHALL log a warning and continue processing the remaining competitors
3. IF an unexpected exception occurs during api-booking-hotel-search execution, THEN THE Skill SHALL catch the exception and output error code `EXCEPTION` with the error message
