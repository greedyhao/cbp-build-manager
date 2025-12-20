# Change Log

All notable changes to the "cbp-build-manager" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
