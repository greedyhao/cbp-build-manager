# CBP Build Manager

一个用于管理和构建 Code::Blocks 项目（.cbp 文件）的 VS Code 扩展，使用 cbp2clang 和自定义构建脚本。

## 功能特性

- **项目扫描**：自动查找工作区中的所有 .cbp 文件
- **复选框选择**：使用简单的复选框选择要构建的项目
- **拖放排序**：拖动项目来控制构建顺序
- **项目级配置**：为每个项目设置 compile_commands.json 路径
- **可自定义命令**：配置 cbp2clang 路径和构建脚本
- **构建输出**：在 VS Code 终端和输出面板中显示日志
- **跨平台兼容**：在 Windows 上与 PowerShell 和 cmd 兼容

## 安装方法

### 方法 1：从 VSIX 包安装

1. 下载最新的 `cbp-build-manager-0.0.1.vsix` 文件
2. 打开 VS Code
3. 按 `Ctrl+Shift+X` 打开扩展面板
4. 点击右上角的 `...` 菜单
5. 选择 **从 VSIX 安装...**
6. 浏览并选择下载的 VSIX 文件
7. 重启 VS Code 以激活扩展

### 方法 2：开发模式

1. 克隆此仓库
2. 在 VS Code 中打开文件夹
3. 运行 `pnpm install` 安装依赖
4. 运行 `pnpm run compile` 编译扩展
5. 按 `F5` 在开发模式下运行扩展

## 配置选项

打开 VS Code 设置 (`Ctrl+,`) 并搜索 **CBP Build Manager** 来配置以下设置：

| 设置项 | 默认值 | 描述 |
|--------|--------|------|
| `cbpBuildManager.cbp2clangPath` | `cbp2clang` | cbp2clang 可执行文件的路径 |
| `cbpBuildManager.compileCommandsPath` | `../../../` | compile_commands.json 的默认相对路径（相对于 .cbp 文件） |
| `cbpBuildManager.convertCommand` | `{cbp2clang} {cbpFile} {compileCommands} -l ld` | 转换命令的模板 |
| `cbpBuildManager.buildCommand` | `./build.bat` | 运行构建脚本的命令 |

## 使用指南

### 1. 打开工作区

在 VS Code 中打开包含 Code::Blocks 项目（.cbp 文件）的文件夹。

### 2. 访问扩展

点击活动栏（侧边栏）中的 **CBP Builder** 图标打开 CBP Build Manager 视图。

### 3. 扫描项目

点击 **刷新** 按钮（🔄）扫描工作区中的 .cbp 文件。

### 4. 选择项目

- **复选框**：点击项目前的复选框选择要构建的项目
- **拖放**：拖动项目上下移动来更改构建顺序

### 5. 配置项目级设置

右键点击项目可访问上下文菜单选项：
- **Set Compile Commands Path**：为特定项目配置 compile_commands.json 的输出路径

### 6. 构建项目

点击 **构建** 按钮（▶️）开始按指定顺序构建所选项目。

## 构建流程

当你点击构建按钮时，扩展会执行以下步骤：

1. **读取配置**：获取 cbp2clang 和命令的设置
2. **生成命令**：为每个选中的项目创建转换命令
3. **运行转换**：执行 cbp2clang 生成 compile_commands.json
4. **执行构建脚本**：运行配置的构建脚本（默认：./build.bat）
5. **显示输出**：在输出面板和终端中显示日志

### 命令执行流程

```
对于每个选中的项目：
1. pushd "项目目录"
2. cbp2clang app.cbp ../../../ -l ld
3. ./build.bat
4. popd
```

## 故障排除

### "No projects selected for building" 错误

1. **检查调试日志**：查看 "CBP Build Manager" 输出面板中的调试信息
2. **验证选择**：确保至少选中了一个项目的复选框
3. **刷新项目**：点击刷新按钮重新扫描项目
4. **检查 VS Code 版本**：确保使用的是 VS Code 1.107.0 或更高版本

### 构建脚本问题

1. **检查脚本存在性**：确保 build.bat 存在于项目目录中
2. **验证权限**：确保构建脚本具有执行权限
3. **检查 cbp2clang 路径**：确保 cbp2clang 在系统 PATH 中或配置正确

### 拖放功能不工作

1. **检查 VS Code 版本**：确保使用的是 VS Code 1.64.0 或更高版本（支持 TreeView 拖放）
2. **禁用冲突扩展**：暂时禁用其他扩展以检查冲突
3. **重启 VS Code**：有时重启可以解决 UI 问题

## 开发指南

### 前提条件

- Node.js 18.x 或更高版本
- pnpm 包管理器
- VS Code 1.107.0 或更高版本

### 开发命令

```bash
# 安装依赖
pnpm install

# 编译扩展
pnpm run compile

# 运行测试
pnpm run test

# 生成 VSIX 包
vsce package
```

### 项目结构

```
cbp-build-manager/
├── src/
│   ├── extension.ts          # 主扩展代码
│   └── test/                 # 测试文件
├── package.json              # 扩展配置
├── tsconfig.json             # TypeScript 配置
├── esbuild.js                # 构建脚本
└── README.md                 # 此文件
```

## 贡献指南

1. Fork 此仓库
2. 创建功能分支
3. 进行更改
4. 运行测试确保没有回归问题
5. 提交拉取请求

## 许可证

MIT 许可证 - 详见 LICENSE 文件

## 支持

如果遇到问题，请：
1. 查看上面的故障排除部分
2. 查看输出面板中的调试日志
3. 在仓库中搜索现有问题
4. 创建新问题并提供详细信息

---

**享受使用 CBP Build Manager 构建 Code::Blocks 项目！🚀**
