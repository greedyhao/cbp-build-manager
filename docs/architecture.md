# CBP Build Manager 项目架构文档

## 项目概述

CBP Build Manager 是一个 VS Code 扩展，用于管理和构建 Code::Blocks 项目。它提供项目队列、按 Target 构建、compile_commands.json 管理，以及 CBP 图形化编辑功能。

扩展通过外部 `cbp2clangd` 完成 CBP 转换。当前要求 cbp2clangd 1.8.2 或更高版本，以支持 `--target <name>`、构建脚本的 pre/post 命令错误检查（检查行不回显，不污染构建日志与诊断汇总），以及 `merge-compile-commands --json --output-dir` 将 `.clangd` 写到工作区根目录（合并后拍平各项目的 `PathMatch` 片段）。

## 技术栈

- **开发语言**: TypeScript
- **运行环境**: VS Code Extension Host
- **构建工具**: esbuild
- **测试框架**: Mocha + @vscode/test-electron
- **依赖工具**: cbp2clangd（外部命令行工具）
- **编辑器 UI**: VS Code CustomTextEditorProvider + 原生 Webview DOM

## 目录结构

```
cbp-build-manager/
├── src/
│   ├── extension.ts                  # 扩展入口、视图和命令注册
│   ├── models/
│   │   ├── items.ts                  # CbpProjectItem、DirectoryItem
│   │   └── CompileCommandsItem.ts    # 编译数据库节点
│   ├── services/
│   │   ├── DataManager.ts            # 队列、Target 状态、持久化
│   │   ├── BuildService.ts            # build/rebuild/clean Target 执行计划
│   │   ├── BuildConcurrency.ts        # Ninja -j 上限注入与 {jobs} 占位符
│   │   ├── CbpProjectService.ts       # CBP Target/Unit 元数据读取
│   │   ├── CompileCommandsMerger.ts   # 编译数据库合并
│   │   └── index.ts
│   ├── providers/
│   │   ├── BuildQueueProvider.ts      # 构建队列视图
│   │   ├── ProjectLibraryProvider.ts  # 项目资源库视图
│   │   ├── CompileCommandsProvider.ts # 编译数据库视图
│   │   ├── CbpEditorProvider.ts       # CBP 图形化 Custom Text Editor
│   │   ├── cbpEditorUtils.ts           # Unit 公共根目录、树和搜索模型
│   │   └── index.ts
│   ├── terminal/                      # 伪终端、命令执行与输出分行
│   ├── utils/                         # 编码、版本、输出行缓冲
│   └── test/unit/                     # 单元测试
├── docs/                              # 文档
├── package.json                       # 扩展配置和贡献点
└── tsconfig.json
```

## 核心模块

### 1. CbpDataManager

`CbpDataManager` 是扩展状态的唯一来源，管理：

- 有序构建队列、勾选状态和拖放顺序
- 工作区发现的 CBP 文件
- compile_commands.json 顺序和勾选状态
- 当前 CBP Target
- “构建全部 Target”模式
- 芯片筛选状态

Target 状态通过 `CbpProjectService` 读取 CBP XML 的 Target 标题，并保存到 `.cbp-build/queue.json`。保存状态中的 Target 被删除或重命名时，自动回退到 XML 中的第一个 Target。

队列项显示：

- 单 Target：`工程名 · Debug_lea`
- 全部模式：`工程名 · 全部 Target (3)`

构建列表不提供 Target 切换按钮；Target 相关操作统一在 CBP 图形编辑器中完成。

### 2. CbpProjectService

该服务只读取 CBP 的轻量元数据，不负责构建和写回 XML：

- 按 XML 顺序读取 `<Target title="...">`
- 读取 `<Unit filename="...">`
- 对同一路径做内存缓存
- 文件内容变化后可调用 `invalidate()` 清除缓存

### 3. BuildService

BuildService 将 build、rebuild、clean 的 Target 执行逻辑统一起来。

每个工程的执行计划为：

```text
build:
  convert --target <Target>
  build.bat

rebuild:
  convert --target <Target>
  ninja -t clean
  convert --target <Target>
  build.bat

clean:
  convert --target <Target>
  ninja -t clean
```

Target 列表来源：

- 普通模式：当前 Target
- “构建全部 Target”：CBP XML 中的全部 Target，保持 XML 顺序

每个 Target 的日志使用 `[工程][Target]` 标识。`stopOnFailure` 开启时，某个 Target 失败会停止后续 Target 和项目；关闭时继续执行。

全部 Target 操作结束后，会重新生成当前 Target 的 `build.ninja`、`build.bat` 和 `.clangd`，避免最后一个 Target 覆盖默认工作环境。

转换命令支持：

```text
{cbp2clang} {cbpFile} {compileCommands} {target} -l ld
```

其中 `{target}` 展开为 `--target <name>`。用户旧模板未包含 `{target}` 时，扩展会自动在末尾追加 `--target <name>`。

并行任务数（`cbpBuildManager.maxParallelJobs`，默认 8，最小 1）：

- 构建命令是 `build.bat` 时，扩展在执行前改写该脚本里 `ninja ... -f build.ninja ...` 那一行的 `-j`：替换已有的 `-jN`/`-jobs N`/`-j N`，没有则插入；其余行（含生成的 pre/post 钩子）原样透传，单一换行风格（纯 CRLF 或纯 LF）逐字保留
- 找不到 Ninja 命令时只输出警告、不改脚本
- 边界行为：同一行出现多个 `-j` 时按“未找到 Ninja 命令”处理（只警告）；文件混用 CRLF/LF 时，改写会把全文换行统一成 CRLF
- 自定义 `buildCommand` 不受上述改写影响，需要时用 `{jobs}` 占位符展开为 `-j <数量>`

### 4. CbpEditorProvider

`.cbp` 文件通过 `CustomTextEditorProvider` 默认使用图形编辑器打开。编辑器底层仍使用 VS Code `TextDocument`，因此保存、dirty 状态、撤销/重做和外部变更由 VS Code 管理。

首版界面支持：

- 当前 Target 下拉框
- “构建全部 Target”开关
- Unit 文件列表
- 添加已有文件
- 移出工程
- 以文本方式打开
- Compiler / Linker 配置编辑（按全局与各 Target 分组）

Unit 文件展示和搜索规则：

- 以 CBP 所在目录为路径解析基准，计算所有 Unit 的公共显示根目录
- 文件按目录树展示，目录默认展开第一层
- 显示时隐藏路径中的 `..`，但保留 CBP XML 中的原始 `filename`
- 搜索按原始路径、显示路径和文件名进行大小写不敏感的部分匹配
- 输入时实时过滤；按 Enter 定位到第一个匹配文件，自动展开父目录、滚动并短暂高亮
- 搜索定位只发生在图形编辑器中，不打开外部源文件，便于随后右键移出工程
- 没有匹配时显示提示；Escape 清空搜索并恢复完整树
- 文档或 Target 状态刷新时保留目录展开状态

文件操作只修改 `<Unit>` XML 引用，不删除磁盘文件。添加的 Unit 默认对全部 Target 共享。添加/删除通过 `WorkspaceEdit` 进行局部修改，尽量保持原有缩进和换行风格。

Compiler / Linker 配置编辑：

- 编辑器分为“工程文件 / Compiler 配置 / Linker 配置”三个标签页，配置编辑在对应标签页内完成；初始数据随 HTML 内联下发，打开即完整显示，之后通过 `webviewReady` 握手与文档/队列变化事件刷新
- 解析 Project 级（全局）和各 `<Target>` 内的 `<Compiler>`、`<Linker>` 段，收集 `<Add>` 子节点的 `option`、`library`、`directory` 属性（同一 `<Add>` 按此优先级取第一个出现的属性）
- 界面在各自标签页内按“全局 + 各 Target”分组展示；没有配置项的组显示提示
- 支持新增（选择属性类型并输入值后点击“添加”或回车）、编辑值（失焦或回车生效）、删除（✕，清空值后失焦等同删除）；每次修改立即写回对应 XML 段，文档刷新后 UI 重新渲染
- 写回使用 `WorkspaceEdit` 只替换对应 `<Compiler>`/`<Linker>` 段的内部内容，保留原有缩进与换行风格；新增行插入在闭合标签缩进之前（`</Compiler>`/`</Linker>` 的行与列保持不变），属性值做 XML 转义（`& < > "`）
- 位置信息（offset）基于文档原文计算，外部修改文档后 webview 会重新接收最新模型，避免基于过期位置写回

添加文件时，与官方 Code::Blocks 一致，`<Unit filename>` 写入相对于 `.cbp` 所在目录的相对路径（工程目录之外的文件使用 `../` 前缀，例如 `../../platform/bsp/bsp_app/ab_command/ab_common.c`）；仅当文件与 `.cbp` 不在同一盘符/根下时才写入绝对路径。新增 `<Unit>` 会复用文件中已有 Unit 的 `<Option>` 属性风格（如 `compilerVar="CC"`），以 `<Unit>...<Option .../></Unit>` 的形式插入。每个新 Unit 按相对路径的大小写不敏感排序，插入到已有 Unit 列表中应在的位置（排在所有 Unit 之后时插入 `</Project>` 前），使 CBP 中的 Unit 顺序与官方 Code::Blocks 保存工程时一样保持有序；批量添加的多个文件也按排序后的顺序逐个插入。

### 5. TreeView 提供者

#### BuildQueueProvider

- 显示已加入构建队列的项目
- 支持复选框、多选、拖放排序
- 点击项目打开 CBP 图形编辑器

#### ProjectLibraryProvider

- 按文件夹层级展示未加入队列的 CBP 项目
- 支持多选添加
- 支持芯片系列筛选

#### CompileCommandsProvider

- 展示工作区发现的 compile_commands.json
- 支持复选框和拖放排序
- 支持手动合并

### 6. 构建输出终端（terminal/）

构建命令以 `cmd.exe /d /c <命令>` 启动，输出写进一个 Pseudoterminal：

- **按流分离缓冲**：stdout 与 stderr 各自持有一个 `OutputLineBuffer`（由 `StreamOutputBuffer` 持有）。两条管道的分块边界互不相干，共用一个缓冲时，一条流的半行会被拼到另一条流的半行前面，产出在两个流里都不存在的行（如 `    sw a4, s9(a0)g.bin" successful`、`             ^\...\xcfg.h" successful`），既读不懂，caret 的列号也随之错位，并会污染诊断汇总
- **行结束符**：`\n`、`\r\n` 和裸 `\r` 都算行结束。构建脚本用 `\r` 原地刷新进度（如 `"xxx.g.bin" successful`），只认 `\n` 会让这类半行一直留到后面某条无关输出带来换行；CRLF 被数据块从中间切断时也不会多出一个空行
- **进度行**：匹配 `[n/m] ...` 的行用 `\r\x1b[K` 原地刷新，不换行；能从命令里认出源文件时压缩成 `Building xxx.c` 形式的短信息，认不出时原样显示命令
- **诊断汇总**：非进度行按错误/警告模式收集，路径经 `processBuildCommandPath` 转成绝对路径，便于在终端里按住 Ctrl 点击跳转
- **停止构建**：Windows 上用 `taskkill /T /F` 结束整棵进程树，避免孙进程继续持有管道导致 `close` 事件不来

## 状态持久化

文件：`.cbp-build/queue.json`

```json
{
  "queuePaths": ["path/to/project.cbp"],
  "checkState": { "path/to/project.cbp": true },
  "chipFilter": "bt5790",
  "compileCommandsCheckState": {},
  "compileCommandsOrder": [],
  "targetSelections": {
    "path/to/project.cbp": "Debug"
  },
  "buildAllTargets": {
    "path/to/project.cbp": false
  }
}
```

## 视图和命令

主要命令包括：

- `buildSelected`：构建勾选的项目及其 Target
- `rebuildSelected`：按 Target 重建
- `cleanSelected`：按 Target 清理
- `refreshProjects`：重新扫描 CBP 项目
- `addToBuild` / `removeFromBuild`：管理构建队列
- `refreshCompileCommands` / `mergeCompileCommands`：管理编译数据库
- `stopBuild`：停止当前构建
- `checkCbp2clangVersion`：检查 cbp2clangd 版本

Target 选择和“构建全部 Target”不再作为构建队列行内菜单，而只在 CBP 图形编辑器中操作，以避免占用队列显示空间。

## 配置项

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `cbpBuildManager.cbp2clangPath` | string | `cbp2clang` | cbp2clangd 可执行文件路径 |
| `cbpBuildManager.convertCommand` | string | `{cbp2clang} {cbpFile} {compileCommands} {target} -l ld` | 转换命令模板；`{target}` 展开为 `--target <name>` |
| `cbpBuildManager.buildCommand` | string | `./build.bat` | 构建脚本命令 |
| `cbpBuildManager.ninjaPath` | string | 空 | Ninja 可执行文件路径 |
| `cbpBuildManager.noHeaderInsertion` | boolean | true | 禁止 clangd 自动插入头文件，需要 clangd v21+ |
| `cbpBuildManager.debug` | boolean | false | 启用调试模式 |
| `cbpBuildManager.stopOnFailure` | boolean | true | Target 或项目失败时停止后续构建 |
| `cbpBuildManager.maxParallelJobs` | number | 8 | 最大并行编译任务数（Ninja `-j`），最小 1；构建命令是 `build.bat` 时自动写入 `-j <数量>`，自定义命令用 `{jobs}` 占位符 |

## 测试策略

- DataManager：队列、Target 状态、全部 Target 模式、状态迁移
- CbpProjectService：Target/Unit 顺序、缓存和失效
- CbpEditorProvider：Unit 增删、格式保留和文本切换
- Provider/Model：TreeView 节点和显示信息
- Terminal/BuildService：命令执行、Target 顺序和失败行为
- utils：输出行缓冲（`\r`/`\n`/`\r\n` 分行、跨数据块的 CRLF、stdout/stderr 按流分离不粘连）
- Rust cbp2clangd：Target 解析、宏展开、生成器一致性和静态库链接名

## 已知限制

1. 当前假设使用单个工作区文件夹。
2. 多 Target 构建按顺序执行，不并行执行。
3. Unit 首版默认对所有 Target 共享，不编辑 `<Option target="...">` 归属。
4. 图形编辑器的 Compiler/Linker 编辑支持 `option`/`library`/`directory` 属性的增删改；`<Add>` 上的其他属性（如 `compiler`、`target`、`before`、`after`）不解析也不保留，含这些属性的行请使用文本编辑器修改。
5. `noHeaderInsertion` 需要 clangd v21 或更高版本。
