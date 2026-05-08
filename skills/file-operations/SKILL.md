---
name: file-operations
description: 文件操作工具。为Agent提供受限的文件读写能力，仅允许操作scripts/和skills/目录。支持writeFile(写入文件)、readFile(读取文件)、editFile(编辑文件)、listDir(列出目录)四种操作。
script: scripts/file-operations/index.js
type: tool
user-invocable: false
allowed-tools: []
parameters:
  operation:
    type: string
    description: "操作类型：writeFile(写入文件)、readFile(读取文件)、editFile(编辑文件内容替换)、listDir(列出目录内容)"
    required: true
    enum: [writeFile, readFile, editFile, listDir]
  filePath:
    type: string
    description: "文件路径（相对于项目根目录），必须以scripts/或skills/开头。用于writeFile、readFile、editFile操作。"
    required: false
  content:
    type: string
    description: "文件内容，用于writeFile操作。最大100KB。"
    required: false
  oldContent:
    type: string
    description: "要替换的原始内容，用于editFile操作。"
    required: false
  newContent:
    type: string
    description: "替换后的新内容，用于editFile操作。"
    required: false
  dirPath:
    type: string
    description: "目录路径（相对于项目根目录），必须以scripts/或skills/开头。用于listDir操作。"
    required: false
---

# 文件操作工具

为Agent提供受限的文件读写能力，用于创建和维护API脚本及SKILL.md定义文件。

## 安全约束

- 仅允许操作 `scripts/` 和 `skills/` 目录下的文件
- 路径中不允许包含 `..` 或 `~`（防止路径遍历攻击）
- 单文件写入内容最大100KB
- 写入时自动创建不存在的目录

## 操作说明

### writeFile - 写入文件

将内容写入指定文件路径。如果目录不存在会自动创建。

**参数：**
```json
{
  "operation": "writeFile",
  "filePath": "scripts/api-meituan-price/index.js",
  "content": "const { APIRuntime } = require('../api-runtime');\n..."
}
```

**返回（成功）：**
```json
{ "success": true }
```

### readFile - 读取文件

读取指定文件的内容。

**参数：**
```json
{
  "operation": "readFile",
  "filePath": "scripts/api-meituan-price/index.js"
}
```

**返回（成功）：**
```json
{ "success": true, "data": "文件内容..." }
```

### editFile - 编辑文件（内容替换）

将文件中匹配 oldContent 的内容替换为 newContent。

**参数：**
```json
{
  "operation": "editFile",
  "filePath": "scripts/api-meituan-price/index.js",
  "oldContent": "旧的API端点",
  "newContent": "新的API端点"
}
```

**返回（成功）：**
```json
{ "success": true }
```

### listDir - 列出目录内容

列出指定目录下的文件和子目录。

**参数：**
```json
{
  "operation": "listDir",
  "dirPath": "scripts/"
}
```

**返回（成功）：**
```json
{ "success": true, "data": "file1.js\nfile2.js\nsubdir/" }
```
