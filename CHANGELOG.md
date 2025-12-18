# Change Log

All notable changes to the "cbp-build-manager" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
