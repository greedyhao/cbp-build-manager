# CBP 构建管理器

一个用于管理和构建 Code::Blocks 项目（.cbp 文件）的 VS Code 扩展，使用 [cbp2clang](https://github.com/greedyhao/cbp2clangd) 和自定义构建脚本。

## 功能特性

- **项目扫描**：自动查找工作区中的所有 `.cbp` `compile_commands.json` 文件
- **多视图管理**：
  - **构建队列**：显示已选择的项目，支持拖放排序和复选框选择，点击打开 CBP 文件
  - **编译数据库**：自动扫描工作区中所有 `compile_commands.json`，支持拖拽排序、勾选合并，点击打开 json
  - **项目资源库**：按文件夹层级显示可用项目，自动隐藏已在队列中的项目。支持按芯片筛选显示项目，减少 project 的显示
- **拖放操作**：在构建队列中拖动来控制构建顺序
- **cbp2clangd 版本检查**：自动检查 cbp2clangd 版本，确保使用兼容版本
- **Ninja 路径配置**：支持自动检查和更新 Ninja 路径
- **可自定义命令**：配置 cbp2clang 路径和构建脚本
- **构建输出**：使用 Pseudoterminal 在终端中显示日志，支持 ANSI 控制符和彩色输出
- **队列持久化**：构建队列自动保存到项目文件夹的 `.cbp-build/queue.json`，重启 VS Code 后自动恢复队列顺序和勾选状态
- **重新编译功能**：先清理后构建，提高开发效率
- **单独清理功能**：可单独运行清理命令，方便管理构建文件
- **compile_commands.json 合并**：手动勾选编译数据库中的文件，通过 cbp2clangd 合并优化 clangd 跨工程索引

## 使用指南

### 1. 打开工作区

在 VS Code 中打开包含 Code::Blocks 项目（.cbp 文件）的文件夹。

### 2. 访问扩展

点击活动栏（侧边栏）中的 **CBP Builder** 图标打开 CBP Build Manager 视图。

### 3. 管理项目

#### 芯片系列筛选

当项目路径中包含芯片系列标识时（如 `project/bt5790/lib.cbp`），建议先按芯片系列缩小范围，便于快速定位：

1. 点击**项目资源库**标题栏的 **筛选** 按钮（🔍）
2. 从下拉列表中选择要筛选的芯片系列（如 bt5790）
3. 资源库将只显示：
   - 选中芯片系列的项目（如 `project/bt5790/` 下的项目）
   - 没有芯片系列标识的项目（如 `app/project/watch320/app.cbp`）
4. 选择 **显示全部** 可取消筛选

**芯片识别规则**：扩展会自动识别路径中 `project/` 文件夹后的第一个文件夹名作为芯片系列标识。

**筛选状态保存**：筛选设置会保存在工作区级别，每个项目文件夹可以有独立的筛选配置。

#### 添加到构建队列

1. 在筛选后的**项目资源库**视图中浏览可用项目
2. 选择要构建的项目（支持多选）
3. 点击 **添加到构建** 按钮（➕）将其添加到**构建队列**

#### 配置构建队列

- **复选框**：点击项目前的复选框选择要参与构建的项目
- **拖放**：在**构建队列**中拖动来更改构建顺序
- **删除项目**：光标移动到项目行时，最右侧出现 `-` 删除按钮，点击移除

### 4. 构建项目

点击 **构建** 按钮（▶️）开始按指定顺序构建**构建队列**中勾选的项目。
构建完成后，`cbp2clangd` 会为每个项目生成 `compile_commands.json`，该文件将自动出现在**编译数据库**视图中。

### 5. 编译数据库合并

构建项目后，**编译数据库**视图会自动扫描到各项目生成的 `compile_commands.json`，可进行合并：

1. 勾选需要参与合并的文件，拖拽调整顺序
2. 点击 **合并** 按钮，将勾选的文件按列表顺序合并（最后一位为合并目标）
3. 点击任意文件可在编辑器中打开查看

### 6. 重新编译项目

点击 **重新编译** 按钮（🔄）开始按指定顺序重新编译**构建队列**中勾选的项目：
- 首先运行 `ninja -t clean` 清理构建文件
- 然后执行正常的构建流程

### 7. 清理项目

点击 **清理** 按钮（🗑️）开始按指定顺序清理**构建队列**中勾选的项目：
- 仅运行 `ninja -t clean` 清理构建文件
- 不执行后续的构建流程

## 配置选项

打开 VS Code 设置 (`Ctrl+,`) 并搜索 **CBP Build Manager** 来配置以下设置：

| 设置项 | 默认值 | 描述 |
|--------|--------|------|
| `cbpBuildManager.cbp2clangPath` | `cbp2clang` | cbp2clang 可执行文件的路径，可从 [GitHub](https://github.com/greedyhao/cbp2clangd) 下载 |
| `cbpBuildManager.convertCommand` | `{cbp2clang} {cbpFile} {compileCommands} -l ld` | 转换命令的模板 |
| `cbpBuildManager.buildCommand` | `./build.bat` | 运行构建脚本的命令 |
| `cbpBuildManager.ninjaPath` | `""` | ninja 可执行文件的路径 |
| `cbpBuildManager.noHeaderInsertion` | `true` | 禁止 clangd 在补全代码时插入头文件（需要 clangd v21+） |
| `cbpBuildManager.debug` | `false` | 启用调试模式，显示详细的调试信息 |
| `cbpBuildManager.stopOnFailure` | `true` | 编译失败时停止后续项目的编译 |

## 故障排除

### 构建脚本问题

1. **检查脚本存在性**：确保 build.bat 存在于项目目录中
2. **验证权限**：确保构建脚本具有执行权限
3. **检查 cbp2clang 路径**：确保 cbp2clang 在系统 PATH 中或配置正确

### 拖放功能不工作

1. **检查 VS Code 版本**：确保使用的是 VS Code 1.79.0 或更高版本（支持 TreeView 拖放）
2. **禁用冲突扩展**：暂时禁用其他扩展以检查冲突
3. **重启 VS Code**：有时重启可以解决 UI 问题

## 开发指南

### 前提条件

- **Node.js 18.x 或更高版本**：用于运行 JavaScript/TypeScript 代码
- **pnpm 包管理器**：用于管理项目依赖
- **VS Code 1.79.0 或更高版本**：用于开发和测试扩展
- **Git**：用于版本控制

### 编译环境准备

1. **克隆仓库**
   ```bash
   git clone https://github.com/greedyhao/cbp-build-manager.git
   cd cbp-build-manager
   ```

2. **安装项目依赖**
   ```bash
   pnpm install
   ```

3. **安装 VSCE 工具**（用于生成 VSIX 包）
   ```bash
   pnpm add -D @vscode/vsce
   ```

### 编译扩展

#### 开发模式编译
- **单次编译**：
  ```bash
  pnpm run compile
  ```
  该命令会执行：
  - 类型检查 (`tsc --noEmit`)
  - 代码 lint 检查 (`eslint src`)
  - 使用 esbuild 编译扩展 (`node esbuild.js`)

- **监听模式编译**（开发时推荐）：
  ```bash
  pnpm run watch
  ```
  该命令会：
  - 启动 esbuild 监听模式，自动编译代码变更
  - 启动 TypeScript 类型检查监听

#### 生产模式编译
- **生产编译**：
  ```bash
  pnpm run package
  ```
  该命令会执行：
  - 类型检查 (`tsc --noEmit`)
  - 代码 lint 检查 (`eslint src`)
  - 使用 esbuild 生产模式编译（压缩代码，无 sourcemap）

### 打包 VSIX 扩展包

1. **确保生产编译完成**
   ```bash
   pnpm run package
   ```

2. **生成 VSIX 包**
   ```bash
   pnpm run vsix
   ```

3. **输出文件**
   - 生成的 VSIX 文件位于项目根目录：`cbp-build-manager-x.x.x.vsix`
- 可直接安装到 VS Code 中使用

### 开发测试

- **运行测试**：
  ```bash
  pnpm run test
  ```

- **在 VS Code 中调试**：
  1. 按 `F5` 或点击 "Run and Debug" 面板中的 "Run Extension" 按钮
  2. VS Code 会启动一个新的实例，加载你的扩展
  3. 可以在原 VS Code 实例中设置断点、查看日志

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

## 更新日志

详细的更新日志请查看 [CHANGELOG.md](CHANGELOG.md) 文件。

---

**享受使用 CBP Build Manager 构建 Code::Blocks 项目！🚀**
