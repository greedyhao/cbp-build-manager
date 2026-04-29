# CBP Build Manager 项目架构文档

## 项目概述

CBP Build Manager 是一个 VS Code 扩展，用于管理和构建 Code::Blocks 项目。它提供了项目队列管理、批量构建、compile_commands.json 生成等功能。

## 技术栈

- **开发语言**: TypeScript
- **运行环境**: VS Code Extension Host
- **构建工具**: esbuild
- **测试框架**: Mocha + @vscode/test-electron
- **依赖工具**: cbp2clangd (外部命令行工具)

## 目录结构

```
cbp-build-manager/
├── src/
│   ├── extension.ts              # 扩展入口，命令注册
│   ├── models/                   # 数据模型
│   │   ├── items.ts             # CbpProjectItem, DirectoryItem
│   │   └── index.ts
│   ├── services/                 # 业务逻辑
│   │   ├── DataManager.ts       # 队列管理、状态持久化
│   │   └── index.ts
│   ├── terminal/                 # 终端管理
│   │   ├── TerminalManager.ts   # 伪终端、命令执行
│   │   └── index.ts
│   ├── providers/                # TreeView 提供者
│   │   ├── BuildQueueProvider.ts      # 构建队列视图
│   │   ├── ProjectLibraryProvider.ts  # 项目资源库视图
│   │   └── index.ts
│   ├── utils/                    # 工具函数
│   │   ├── CommonUtils.ts       # 编码、版本比较、输出格式化
│   │   └── index.ts
│   └── test/                     # 测试文件
│       ├── unit/                # 单元测试
│       │   ├── utils.test.ts
│       │   ├── dataManager.test.ts
│       │   ├── models.test.ts
│       │   └── providers.test.ts
│       ├── integration/         # 集成测试
│       │   └── terminal.test.ts
│       └── extension.test.ts    # 扩展集成测试
├── docs/                         # 文档
│   ├── architecture.md          # 本文档
│   └── development-plan.md      # 开发计划
├── resources/                    # 资源文件
│   └── icon.svg                 # 扩展图标
├── package.json                  # 扩展配置
└── tsconfig.json                 # TypeScript 配置
```

## 核心模块

### 1. 数据模型 (models/)

#### CbpProjectItem
- **职责**: 表示一个 CBP 项目节点
- **属性**:
  - `label`: 项目名称
  - `fsPath`: 文件系统路径
  - `isChecked`: 是否被勾选
  - `checkboxState`: 复选框状态
  - `showCheckbox`: 是否显示复选框

#### DirectoryItem
- **职责**: 表示一个文件夹节点
- **用途**: 在项目资源库视图中组织项目

### 2. 业务逻辑 (services/)

#### CbpDataManager
- **职责**: 管理构建队列和项目状态
- **核心功能**:
  - `scanWorkspace()`: 扫描工作区中的 .cbp 文件
  - `addToQueue()`: 添加项目到构建队列
  - `removeFromQueue()`: 从队列移除项目
  - `moveQueueItem()`: 调整队列顺序（拖拽支持）
  - `updateCheckState()`: 更新项目勾选状态
  - `saveState()` / `loadState()`: 状态持久化到 `.cbp-build/queue.json`

- **数据结构**:
  - `buildQueue`: 有序的构建队列
  - `allDetectedProjects`: 所有检测到的项目路径
  - `stateFilePath`: 持久化文件路径

### 3. 终端管理 (terminal/)

#### BuildTerminal
- **职责**: 实现 VS Code Pseudoterminal 接口
- **特性**:
  - ANSI 颜色支持
  - Ninja 进度条单行刷新
  - GBK 编码自动解码

#### TerminalManager
- **职责**: 管理终端实例和命令执行
- **核心功能**:
  - `createOrShowTerminal()`: 创建或复用终端
  - `runCommand()`: 执行命令
  - `runCommandInDirectory()`: 在指定目录执行命令

- **特性**:
  - 单例模式，避免重复创建终端
  - 跨平台命令执行（Windows/Linux）
  - 实时输出流处理
  - 相对路径转换为绝对路径

### 4. 视图提供者 (providers/)

#### BuildQueueProvider
- **职责**: 提供构建队列 TreeView
- **特性**:
  - 支持拖拽排序
  - 支持多选
  - 支持复选框

#### ProjectLibraryProvider
- **职责**: 提供项目资源库 TreeView
- **特性**:
  - 按目录分组显示
  - 自动过滤已在队列中的项目
  - 支持多选添加

### 5. 工具函数 (utils/)

#### CommonUtils
- **核心函数**:
  - `decodeBuffer()`: 自动检测并解码 Buffer（UTF-8/GBK）
  - `formatOutput()`: 格式化输出（\n → \r\n）
  - `compareVersions()`: 版本号比较
  - `parseNinjaProgress()`: 解析 Ninja 进度条
  - `processBuildCommandPath()`: 处理构建输出中的相对路径
  - `OutputLineBuffer`: 行缓冲器，处理流式输出

## 数据流

### 1. 扩展激活流程
```
activate()
  ├─> CbpDataManager.setContext()
  │     └─> loadState() (从 .cbp-build/queue.json 恢复状态)
  ├─> 创建 BuildQueueProvider
  ├─> 创建 ProjectLibraryProvider
  ├─> 注册 TreeView
  ├─> 注册命令
  └─> scanWorkspace() (初始扫描)
```

### 2. 构建流程
```
buildSelected 命令
  ├─> checkAndPromptSave() (检查未保存文件)
  ├─> 获取勾选的项目
  ├─> checkCbp2clangVersion() (版本检查)
  └─> 对每个项目:
        ├─> 生成 cbp2clang 命令
        ├─> runCommand() 生成 compile_commands.json
        └─> runCommandInDirectory() 执行构建脚本
```

### 3. 状态持久化
```
用户操作 (添加/移除/排序/勾选)
  ├─> 更新内存中的 buildQueue
  ├─> saveState()
  │     └─> 写入 .cbp-build/queue.json 文件
  └─> 触发 TreeView 刷新
```

**持久化文件格式** (`.cbp-build/queue.json`):
```json
{
  "queuePaths": ["path/to/project1.cbp", "path/to/project2.cbp"],
  "checkState": { "path/to/project1.cbp": true },
  "chipFilter": "bt5790"
}
```

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cbpBuildManager.cbp2clangPath` | string | `cbp2clang` | cbp2clangd 可执行文件路径 |
| `cbpBuildManager.convertCommand` | string | `{cbp2clang} {cbpFile} {compileCommands} -l ld` | 转换命令模板 |
| `cbpBuildManager.buildCommand` | string | `./build.bat` | 构建脚本命令 |
| `cbpBuildManager.ninjaPath` | string | `` | Ninja 可执行文件路径 |
| `cbpBuildManager.noHeaderInsertion` | boolean | `true` | 禁止 clangd 自动插入头文件 |
| `cbpBuildManager.mergeCompileCommands` | boolean | `true` | 自动合并 compile_commands.json |
| `cbpBuildManager.debug` | boolean | `false` | 启用调试模式 |
| `cbpBuildManager.stopOnFailure` | boolean | `true` | 编译失败时停止后续编译 |

## 命令列表

| 命令 ID | 标题 | 功能 |
|---------|------|------|
| `cbp-build-manager.buildSelected` | 构建所选项目 | 构建队列中勾选的项目 |
| `cbp-build-manager.rebuildSelected` | 重新编译所选项目 | 清理后重新构建 |
| `cbp-build-manager.cleanSelected` | 清理所选项目 | 运行 ninja -t clean |
| `cbp-build-manager.refreshProjects` | 刷新项目 | 重新扫描工作区 |
| `cbp-build-manager.addToBuild` | 添加到编译列表 | 从资源库添加到队列 |
| `cbp-build-manager.removeFromBuild` | 从编译列表移除 | 从队列移除项目 |
| `cbp-build-manager.checkCbp2clangVersion` | 检查版本 | 检查 cbp2clangd 版本 |

## 依赖关系

```
extension.ts
  ├─> services/DataManager
  ├─> providers/BuildQueueProvider
  ├─> providers/ProjectLibraryProvider
  ├─> terminal/TerminalManager
  └─> utils/CommonUtils

BuildQueueProvider
  └─> services/DataManager

ProjectLibraryProvider
  └─> services/DataManager

TerminalManager
  └─> utils/CommonUtils

DataManager
  └─> models/items
```

## 测试策略

### 单元测试
- **utils.test.ts**: 测试工具函数（版本比较、编码解码、行缓冲）
- **dataManager.test.ts**: 测试队列管理逻辑
- **models.test.ts**: 测试数据模型初始化
- **providers.test.ts**: 测试 TreeView 数据提供

### 集成测试
- **terminal.test.ts**: 测试终端创建和命令执行
- **extension.test.ts**: 测试扩展激活和命令注册

## 设计原则

1. **单一职责**: 每个模块只负责一个明确的功能
2. **依赖注入**: 通过构造函数注入依赖，便于测试
3. **状态管理**: 集中在 DataManager，避免状态分散
4. **错误处理**: 所有异步操作都有错误处理和用户提示
5. **跨平台**: 命令执行兼容 Windows 和 Linux

## 性能优化

1. **终端复用**: 使用单例模式避免重复创建终端
2. **增量更新**: TreeView 只在数据变化时刷新
3. **异步扫描**: 使用 `vscode.workspace.findFiles` 异步扫描
4. **流式处理**: 使用 OutputLineBuffer 处理大量输出

## 已知限制

1. **cbp2clangd 版本要求**: 最低 v1.4.0
2. **clangd 版本要求**: noHeaderInsertion 需要 v21+
3. **平台支持**: 主要针对 Windows，Linux 支持有限
4. **工作区限制**: 假设单个工作区文件夹

## 未来扩展方向

1. 支持多工作区文件夹
2. 支持自定义构建配置
3. 支持构建任务并行执行
4. 支持构建历史记录
5. 支持构建性能分析
