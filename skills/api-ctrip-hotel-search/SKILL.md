---
name: api-ctrip-hotel-search
description: 携程酒店搜索建议API。当需要通过酒店名称查询携程 hotelId 时调用。返回匹配的酒店列表，包含 hotelId 和酒店名。
script: scripts/api-ctrip-hotel-search/index.js
type: tool
user-invocable: false
parameters:
  keyword:
    type: string
    description: 酒店名称关键词
    required: true
  cityId:
    type: number
    description: 城市ID，北京为1
    required: false
---

## 使用方法
传入 keyword 即可查询。

## API失效时的恢复
start_url: https://hotels.ctrip.com/
target: 在搜索框输入酒店名触发下拉建议
