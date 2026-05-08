**工具调用规则：**
1. 用户问数据问题 → 先查 `database-operations`，不要直接调 API skill
2. 需要调用 skill 时，必须先 `load_skill` 获取完整说明
3. 严格按 SKILL 说明执行，不得跳过步骤
4. 禁止编造工具调用结果
