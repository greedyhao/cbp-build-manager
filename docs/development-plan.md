# merge-compile-commands 功能开发计划

## 功能概述

cbp2clangd 新增了 `merge-compile-commands` 命令，可以合并多个 compile_commands.json 文件。本功能将在构建流程中自动调用该命令，将所有项目的 compile_commands.json 合并到最后一个项目的 compile_commands.json 中，从而优化 clangd 对多个工程的函数索引。

## 需求分析

### 功能需求
1. 在构建队列中所有项目构建完成后，自动合并 compile_commands.json
2. 合并目标：最后一个项目的 compile_commands.json
3. 合并源：所有其他项目的 compile_commands.json
4. 该功能需要可配置，用户可以选择是否开启

### 技术需求
1. 新增配置项 `cbpBuildManager.mergeCompileCommands`
2. 在构建流程结束前调用 `cbp2clang merge-compile-commands` 命令
3. 需要收集所有项目的 compile_commands.json 路径
4. 需要确定合并目标路径（最后一个项目）

## 开发计划

### 第一阶段：配置项添加 (0.5h)

#### 1.1 更新 package.json
在 `contributes.configuration.properties` 中添加新配置项：

```json
"cbpBuildManager.mergeCompileCommands": {
  "type": "boolean",
  "default": false,
  "description": "构建完成后自动合并所有项目的 compile_commands.json 到最后一个项目（需要 cbp2clangd 支持 merge-compile-commands 命令）"
}
```

#### 1.2 更新最小版本要求
由于 `merge-compile-commands` 是新功能，需要更新 `MIN_REQUIRED_CBP2CLANG_VERSION`：
- 当前: `1.3.0`
- 建议: 根据 cbp2clangd 实际支持该命令的版本更新（假设为 `1.3.0`）

**注意**: 如果不想强制升级，可以在运行 merge 命令前先检查版本，不满足则跳��合并并提示用户。

### 第二阶段：核心逻辑实现 (1.5h)

#### 2.1 创建合并函数
在 `src/services/DataManager.ts` 或新建 `src/services/CompileCommandsMerger.ts`：

```typescript
/**
 * 合并多个项目的 compile_commands.json
 * @param projects 项目列表
 * @param cbp2clangPath cbp2clangd 可执行文件路径
 * @param workspacePath 工作区路径
 */
export async function mergeCompileCommands(
    projects: CbpProjectItem[],
    cbp2clangPath: string,
    workspacePath: string
): Promise<void> {
    if (projects.length <= 1) {
        // 只有一个或没有项目，无需合并
        return;
    }

    // 获取所有项目的 compile_commands.json 路径
    const compileCommandsPaths = projects.map(project => {
        const projectDir = path.dirname(project.fsPath);
        return path.join(projectDir, 'compile_commands.json');
    });

    // 检查文件是否存在
    const existingPaths = compileCommandsPaths.filter(p => fs.existsSync(p));

    if (existingPaths.length <= 1) {
        // 只有一个或没有 compile_commands.json，无需合并
        return;
    }

    // 合并目标：最后一个项目的 compile_commands.json
    const targetPath = existingPaths[existingPaths.length - 1];

    // 合并源：除了最后一个之外的所有 compile_commands.json
    const sourcePaths = existingPaths.slice(0, -1);

    // 构造合并命令
    // cbp2clang merge-compile-commands <target> <source1> <source2> ...
    const mergeCommand = `${cbp2clangPath} merge-compile-commands "${targetPath}" ${sourcePaths.map(p => `"${p}"`).join(' ')}`;

    // 执行合并命令
    await runCommand(mergeCommand);
}
```

#### 2.2 集成到构建流程
在 `src/extension.ts` 的 `buildSelected` 和 `rebuildSelected` 命令中：

```typescript
// 在构建循环结束后，添加合并逻辑
const config = vscode.workspace.getConfiguration('cbpBuildManager');
const mergeEnabled = config.get<boolean>('mergeCompileCommands', false);

if (mergeEnabled && selectedProjects.length > 1) {
    terminal.write(`\n\x1b[36m=== 合并 compile_commands.json ===\x1b[0m\n`);
    try {
        const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '';
        await mergeCompileCommands(selectedProjects, cbp2clangPath, workspacePath);
        terminal.write(`\x1b[32m合并完成: 已将所有项目的 compile_commands.json 合并到最后一个项目\x1b[0m\n`);
    } catch (error) {
        terminal.write(`\x1b[33m警告: 合并 compile_commands.json 失败: ${(error as Error).message}\x1b[0m\n`);
        // 不阻断构建流程，仅警告
    }
}
```

### 第三阶段：错误处理和边界情况 (1h)

#### 3.1 版本检查
在执行合并前检查 cbp2clangd 是否支持 `merge-compile-commands` 命令：

```typescript
async function checkMergeCommandSupport(cbp2clangPath: string): Promise<boolean> {
    try {
        // 运行 cbp2clang --help 检查是否有 merge-compile-commands
        const helpOutput = await runCommandAndCapture(`${cbp2clangPath} --help`);
        return helpOutput.includes('merge-compile-commands');
    } catch {
        return false;
    }
}
```

#### 3.2 边界情况处理
- **情况 1**: 只有一个项目 → 跳过合并
- **情况 2**: 某些项目没有生成 compile_commands.json → 只合并存在的文件
- **情况 3**: cbp2clangd 不支持 merge 命令 → 提示用户升级并跳过
- **情况 4**: 合并失败 → 记录警告但不阻断构建流程

### 第四阶段：测试 (1.5h)

#### 4.1 单元测试
创建 `src/test/unit/compileCommandsMerger.test.ts`：

```typescript
import * as assert from 'assert';
import * as path from 'path';
import { mergeCompileCommands } from '../../services/CompileCommandsMerger';

suite('CompileCommandsMerger Test Suite', () => {
    test('应该跳过只有一个项目的情况', async () => {
        // 测试逻辑
    });

    test('应该正确构造合并命令', async () => {
        // 测试逻辑
    });

    test('应该处理文件不存在的情况', async () => {
        // 测试逻辑
    });
});
```

#### 4.2 集成测试
在实际项目中测试：
1. 创建多个 CBP 项目
2. 开启 `mergeCompileCommands` 配置
3. 执行构建
4. 验证最后一个项目的 compile_commands.json 包含所有项目的编译命令

### 第五阶段：文档更新 (0.5h)

#### 5.1 更新 README.md
添加新功能说明：

```markdown
### compile_commands.json 合并

当你有多个相互依赖的 CBP 项目时，可以开启 `cbpBuildManager.mergeCompileCommands` 配置，
插件会在构建完成后自动将所有项目的 compile_commands.json 合并到最后一个项目中。
这样 clangd 就能正确索引跨项目的函数定义和引用。

**配置示例**:
```json
{
  "cbpBuildManager.mergeCompileCommands": true
}
```

**要求**: cbp2clangd >= 1.3.0
```

#### 5.2 更新 CHANGELOG.md
```markdown
## [0.2.0] - 2026-03-XX

### Added
- 新增 `mergeCompileCommands` 配置项，支持自动合并多个项目的 compile_commands.json
- 优化 clangd 对多工程的函数索引能力

### Changed
- 更新 cbp2clangd 最小版本要求至 1.3.0（如果强制要求）
```

## 实现细节

### 文件修改清单

| 文件 | 修改内容 | 优先级 |
|------|----------|--------|
| `package.json` | 添加 `mergeCompileCommands` 配置项 | P0 |
| `src/extension.ts` | 在构建流程中集成合并逻辑 | P0 |
| `src/services/CompileCommandsMerger.ts` | 新建，实现合并函数 | P0 |
| `src/services/index.ts` | 导出 `mergeCompileCommands` | P0 |
| `src/test/unit/compileCommandsMerger.test.ts` | 新建，单元测试 | P1 |
| `README.md` | 添加功能说明 | P1 |
| `CHANGELOG.md` | 记录版本变更 | P1 |
| `docs/architecture.md` | 更新架构文档 | P2 |

### 命令格式

根据 cbp2clangd 的命令格式：
```bash
cbp2clang merge-compile-commands <target> <source1> <source2> ...
```

示例：
```bash
cbp2clang merge-compile-commands \
  "D:/Project/app/compile_commands.json" \
  "D:/Project/lib1/compile_commands.json" \
  "D:/Project/lib2/compile_commands.json"
```

### 配置项设计

```typescript
interface MergeConfig {
    enabled: boolean;           // 是否启用合并
    targetStrategy: 'last' | 'first' | 'workspace';  // 合并目标策略（未来扩展）
    // 'last': 合并到最后一个项目（默认）
    // 'first': 合并到第一个项目
    // 'workspace': 合并到工作区根目录
}
```

**第一版实现**: 只支持 `enabled: boolean`，默认合并到最后一个项目。

## 时间估算

| 阶段 | 预计时间 | 说明 |
|------|----------|------|
| 配置项添加 | 0.5h | 修改 package.json |
| 核心逻辑实现 | 1.5h | 实现合并函数和集成 |
| 错误处理 | 1h | 版本检查、边界情况 |
| 测试 | 1.5h | 单元测试 + 集成测试 |
| 文档更新 | 0.5h | README、CHANGELOG |
| **总计** | **5h** | 约 1 个工作日 |

## 风险评估

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| cbp2clangd 版本不支持 | 高 | 添加版本检查，不支持则跳过并提示 |
| 合并失败导致构建中断 | 中 | 合并失败只记录警告，不阻断构建 |
| 文件路径包含特殊字符 | 低 | 使用引号包裹路径 |
| 跨平台兼容性 | 低 | 使用 path.join 处理路径 |

## 验收标准

1. ✅ 配置项 `mergeCompileCommands` 可以在 VS Code 设置中找到
2. ✅ 开启配置后，构建多个项目会自动合并 compile_commands.json
3. ✅ 合并失败不会阻断构建流程
4. ✅ 只有一个项目时不执行合并
5. ✅ 终端输出清晰显示合并过程和结果
6. ✅ 单元测试覆盖核心逻辑
7. ✅ 文档完整说明新功能

## 后续优化方向

1. **智能合并策略**: 支持用户自定义合并目标（第一个/最后一个/工作区根目录）
2. **增量合并**: 只合并变化的项目，避免重复合并
3. **合并验证**: 合并后验证 JSON 格式是否正确
4. **性能优化**: 对于大量项目，考虑并行处理
5. **UI 反馈**: 在状态栏显示合并进度

## 参考资料

- cbp2clangd 仓库: https://github.com/greedyhao/cbp2clangd
- compile_commands.json 规范: https://clang.llvm.org/docs/JSONCompilationDatabase.html
- VS Code 扩展配置: https://code.visualstudio.com/api/references/contribution-points#contributes.configuration
