# Change Log

All notable changes to the "cbp-build-manager" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.3.0] - 2026-04-29

### Added
- 新增**编译数据库 (Compile Commands)** 视图，自动扫描工作区中所有 `compile_commands.json` 文件
- 编译数据库支持复选框勾选，手动触发合并选中的 `compile_commands.json`
- 合并功能改用 cbp2clangd 的 `merge-compile-commands` 命令（`--json` 参数），合并目标自动为构建队列最后一个 CBP 项目对应的 json
- 构建队列和编译数据库列表项支持双击在编辑器中打开对应文件

### Changed
- 移除 `cbpBuildManager.mergeCompileCommands` 配置项，合并改为手动触发
- cbp2clangd 最低版本要求从 v1.3.0 提升至 v1.4.0
- `ProjectLibraryProvider` 空工作区时自动计算文件公共父目录作为根

### Fixed
- 修复所有单元测试用例，全部 73 个测试通过
- 测试用例全部改用临时目录动态路径，不再使用硬编码平台路径

## [1.2.0] - 2026-04-23

### Changed
- 优化构建队列持久化机制，队列数据保存到项目文件夹的 `.cbp-build/queue.json`
- 使用同步文件写入替代异步 globalState，解决 VS Code 异常关闭时数据丢失问题
- 队列加载时直接检查文件是否存在，不再依赖 VS Code 工作区索引

### Fixed
- 修复 VS Code 重启后队列有时消失的问题

## [1.1.2] - 2026-03-27

### Fixed
- 修复构建队列拖拽时无法将项目拖到队尾的问题，现在可以将项目直接拖动到列表末尾

## [1.1.1] - 2026-03-26

### Added
- 增加出错停止编译的功能

### Fixed
- 修复 Windows 绝对路径处理时产生的双重盘符问题（如 `D:d:`）
- 当编译器输出中已经是 Windows 绝对路径时，不再与 cwd 拼接

## [1.1.0] - 2026-03-17

### Added
- 新增芯片系列筛选功能，支持按芯片系列（如 bt5790、bt5690）筛选项目资源库
- 自动识别项目路径中的芯片系列标识（`project/` 文件夹后的第一个文件夹名）
- 筛选状态以工作区级别持久化保存，不同项目文件夹可以有独立的筛选配置

## [1.0.1] - 2026-03-16

### Changed
- 将 VS Code 最低版本要求从 1.64.0 提升到 1.79.0
- 默认开启 `mergeCompileCommands`

## [1.0.0] - 2026-03-15

### Added
- 新增 `mergeCompileCommands` 配置项，支持自动合并多个项目的 compile_commands.json
- 新增 `debug` 配置项，启用调试模式，显示详细调试信息并在 cbp2clangd 命令中添加 --debug 参数
- 优化 clangd 对多工程的函数索引能力

### Changed
- 将数据模型移至 src/models/ (CbpProjectItem, DirectoryItem)
- 将业务逻辑移至 src/services/ (CbpDataManager)
- 将终端管理移至 src/terminal/ (BuildTerminal, createOrShowTerminal)
- 将树视图提供者移至 src/providers/ (BuildQueueProvider, ProjectLibraryProvider)
- 将工具函数移至 src/utils/ (decodeBuffer, formatOutput, compareVersions, OutputLineBuffer)
- 使用构造函数注入消除全局变量依赖
- 保持原有功能完整: Ninja进度条单行刷新、ANSI颜色渲染、GBK自动解码

### Fixed
- 修复 compile_commands.json 合并功能路径查找问题
- 设置 cbp2clangd 最小要求版本为 v1.3.0

## [0.1.2] - 2026-01-29

### Changed
- 修复特殊文件输出编译命令的问题

## [0.1.1] - 2026-01-25

### Changed
- 错误文件路径改为绝对路径显示
- 更新文档，明确说明 "No Header Insertion" 配置需要 clangd v21 以上版本

### Fixed
- 修复 No Header Insertion 配置在 clangd v21 以下版本会产生 lint 错误的文档说明

## [0.1.0] - 2026-01-25

### Changed
- 错误文件路径改为绝对路径显示

## [0.0.10] - 2026-01-16
### Changed
- 将插件输出改为 Pseudoterminal，支持 ANSI 控制符
- 改进终端管理，实现终端复用，避免一直创建新终端
- 优化输出格式，添加彩色标识增强可读性

### Fixed
- 修复手动关闭终端后点击编译无反应的问题
- 修复输出格式混乱，解决阶梯状输出和错位问题
- 修复命令执行失败，解决 "文件名、目录名或卷标语法不正确" 错误
- 完善 ANSI 控制符处理，确保输出效果与真实终端一致

## [0.0.8] - 2025-12-26
### Changed
- 删除了 Compile Commands Path 的配置选项和功能
- 直接使用 VSCode 当前打开的文件夹的绝对路径作为 compile_commands.json 输出路径
- 简化了项目配置，移除了项目级别的编译命令路径设置
- 更新了文档，删除了与 Compile Commands Path 相关的内容

### Fixed
- 设置 cbp2clangd 最小要求版本为 v1.2.1

## [0.0.7] - 2025-12-20
### Added
- 增加文件保存的检查

### Fixed
- 设置 cbp2clangd 最小要求版本为 v1.1.8

## [0.0.6] - 2025-12-20
### Fixed
- 重新发布版本

## [0.0.5] - 2025-12-20
### Added
- 重构为双视图管理：构建队列和项目资源库
- 实现 cbp2clangd 版本自动检查功能
- 添加 cbp2clangd 版本命令，支持手动检查
- 设置 cbp2clangd 最小要求版本为 v1.1.7
- 构建前自动检查版本，不兼容时禁止编译
- 项目资源库按文件夹层级显示
- 项目资源库自动隐藏已在队列中的项目
- 添加重新编译功能：先运行 `ninja -t clean` 清理，再执行构建流程
- 添加单独清理功能：仅运行 `ninja -t clean` 清理构建文件
- 在构建队列标题栏添加重新编译按钮（🔄）
- 在构建队列标题栏添加清理按钮（🗑️）
- 支持使用自定义 ninja 路径进行清理操作
- Ninja 路径配置增强：添加了 Ninja 路径自动检查功能
- 支持文件夹路径自动补充 ninja.exe
- 插件启动时检测 Ninja 路径，兼容旧版本设置

### Changed
- 改进构建队列显示，添加编译命令路径
- 移除项目资源库中的复选框
- 修复单个项目删除功能
- 改进 Ninja 路径检查失败时的弹窗信息，更友好易读
- 只在插件启动时检测 Ninja 路径，提高性能

### Fixed
- 修复拖拽项目容易跳到另一个列表的问题
- 兼容旧版本的文件夹路径设置，自动更新为完整可执行文件路径

## [0.0.4] - 2025-12-18
### Fixed
- 修复拖拽项目容易跳到另一个列表的问题

## [0.0.3] - 2025-12-18

### Changed
- 允许外部配置 ninja 路径
- 调整默认command输出路径

## [0.0.2] - 2025-12-16

### Added
- 改进命令执行功能以支持实时输出和编码处理
- 增强项目树显示功能并持久化编译命令路径

### Fixed
- 修正命令分组以正确显示在视图标题中

### Changed
- 优化编译状态显示

## [0.0.1] - 2025-12-16

### Added
- 自动扫描工作区中的.cbp文件
- 支持复选框选择要构建的项目
- 支持拖放排序项目
- 支持为每个项目设置compile_commands.json路径
- 可配置cbp2clang路径和构建命令
- 支持在终端和输出面板显示构建日志
