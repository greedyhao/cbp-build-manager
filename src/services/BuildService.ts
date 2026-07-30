import * as path from "path";
import * as vscode from "vscode";
import { CbpDataManager } from "./DataManager";
import {
  createOrShowTerminal,
  runCommand,
  runCommandInDirectory,
} from "../terminal/TerminalManager";
import { mergeCompileCommandsFiles } from "./index";

interface BuildConfig {
  cbp2clangPath: string;
  convertCommandTemplate: string;
  buildScript: string;
  ninjaPath: string;
  noHeaderInsertion: boolean;
  debugMode: boolean;
  stopOnFailure: boolean;
}

interface Diagnostics {
  warnings: string[];
  errors: string[];
}

type BuildPhase = "build" | "rebuild" | "clean";

const STOPPED = "STOPPED";

export class BuildService {
  constructor(private readonly manager: CbpDataManager) {}

  static readConfig(): BuildConfig {
    const config = vscode.workspace.getConfiguration("cbpBuildManager");
    return {
      cbp2clangPath: config.get<string>("cbp2clangPath", "cbp2clang"),
      convertCommandTemplate: config.get<string>(
        "convertCommand",
        "{cbp2clang} {cbpFile} {compileCommands} {target} -l ld",
      ),
      buildScript: config.get<string>("buildCommand", "./build.bat"),
      ninjaPath: config.get<string>("ninjaPath", ""),
      noHeaderInsertion: config.get<boolean>("noHeaderInsertion", false),
      debugMode: config.get<boolean>("debug", false),
      stopOnFailure: config.get<boolean>("stopOnFailure", false),
    };
  }

  async run(phase: BuildPhase): Promise<void> {
    const terminal = createOrShowTerminal();
    const labelMap: Record<BuildPhase, string> = {
      build: "构建",
      rebuild: "重新编译",
      clean: "清理",
    };
    terminal.write(`\x1b[36m=== 开始${labelMap[phase]}流程 ===\x1b[0m\n`);

    const selectedProjects = this.manager
      .getQueueItems()
      .filter((p) => p.checkboxState === vscode.TreeItemCheckboxState.Checked);

    terminal.write(`选中项目数: ${selectedProjects.length}\n`);
    if (selectedProjects.length === 0) {
      vscode.window.showInformationMessage(`没有选中要${labelMap[phase]}的项目。`);
      return;
    }

    const cfg = BuildService.readConfig();
    if (cfg.debugMode) {
      terminal.write(`\x1b[36m[调试] 调试模式已开启\x1b[0m\n`);
    }

    const diagnostics: Diagnostics = { warnings: [], errors: [] };
    let stopped = false;

    for (const project of selectedProjects) {
      if (stopped) {
        break;
      }
      terminal.write(`\n\x1b[33m>>> 处理项目: ${project.label}\x1b[0m\n`);

      const targets = this.manager.getBuildTargets(project.fsPath);
      if (targets.length === 0) {
        terminal.write(
          `\x1b[33m>>> 项目 ${project.label} 无可用 Target，跳过\x1b[0m\n`,
        );
        continue;
      }

      let projectFailed = false;
      for (const target of targets) {
        if (stopped || projectFailed) {
          break;
        }
        terminal.write(
          `\n\x1b[34m>>> [${project.label}][${target}]\x1b[0m\n`,
        );
        try {
          if (phase === "rebuild" || phase === "clean") {
            await this.cleanTarget(project, target, cfg, terminal);
            if (phase === "clean") {
              continue;
            }
          }
          await this.convertAndBuild(project, target, cfg, terminal, diagnostics);
        } catch (error) {
          if ((error as Error).message === STOPPED) {
            terminal.write(
              `\x1b[33m>>> [${project.label}][${target}] 已停止\x1b[0m\n`,
            );
            stopped = true;
            break;
          }
          terminal.write(
            `\x1b[31m!!! [${project.label}][${target}] 失败: ${error}\x1b[0m\n`,
          );
          if (cfg.stopOnFailure) {
            terminal.write(`\x1b[31m>>> 失败，停止后续 Target/项目\x1b[0m\n`);
            stopped = true;
            break;
          }
          projectFailed = true;
        }
      }

      // 多 Target 操作结束后，恢复当前 Target 的生成文件，避免工程目录里
      // 留下最后一个 XML Target 的 build.ninja/build.bat/.clangd。
      if (phase !== "clean" && targets.length > 1) {
        const current = this.manager.getTargetSelection(project.fsPath);
        if (current && !targets.includes(current)) {
          await this.convertOnly(project, current, cfg, terminal).catch(() => {
            /* 恢复失败不阻断整体流程 */
          });
        }
      }

      if (!stopped && !projectFailed) {
        terminal.write(
          `\x1b[32m>>> 项目 ${project.label} 完成.\x1b[0m\n`,
        );
      }
    }

    if (phase !== "clean") {
      await this.manager.scanCompileCommands();
      const ccItems = this.manager
        .getCompileCommandsItems()
        .filter(
          (item) =>
            item.checkboxState === vscode.TreeItemCheckboxState.Checked,
        );
      if (ccItems.length >= 2) {
        terminal.write(
          `\n\x1b[36m=== 自动合并 ${ccItems.length} 个 compile_commands.json ===\x1b[0m\n`,
        );
        const ccFiles = ccItems.map((item) => item.fsPath);
        await mergeCompileCommandsFiles(
          ccFiles,
          cfg.cbp2clangPath,
          cfg.debugMode,
          (msg) => terminal.write(msg),
        );
      }
    }

    terminal.write(`\n\x1b[36m=== ${labelMap[phase]}流程结束 ===\x1b[0m\n`);

    if (diagnostics.errors.length > 0 || diagnostics.warnings.length > 0) {
      terminal.write(`\n\x1b[36m========================================\x1b[0m\n`);
      terminal.write(`\x1b[36m=== 编译诊断汇总 ===\x1b[0m\n`);
      if (diagnostics.errors.length > 0) {
        terminal.write(
          `\x1b[31m--- 错误 (${diagnostics.errors.length}) ---\x1b[0m\n`,
        );
        diagnostics.errors.forEach((err) =>
          terminal.write(`\x1b[31m${err}\x1b[0m\n`),
        );
      }
      if (diagnostics.warnings.length > 0) {
        terminal.write(
          `\x1b[33m--- 警告 (${diagnostics.warnings.length}) ---\x1b[0m\n`,
        );
        diagnostics.warnings.forEach((warn) =>
          terminal.write(`\x1b[33m${warn}\x1b[0m\n`),
        );
      }
      terminal.write(`\x1b[36m=== 诊断汇总结束 ===\x1b[0m\n`);
      terminal.write(`\x1b[36m========================================\x1b[0m\n`);
    }
  }

  private buildConvertCommand(
    projectFsPath: string,
    target: string,
    cfg: BuildConfig,
    convertOnly: boolean,
  ): string {
    const workspacePath =
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      path.dirname(projectFsPath);
    let convertCommand = cfg.convertCommandTemplate
      .replace("{cbp2clang}", cfg.cbp2clangPath)
      .replace("{cbpFile}", projectFsPath)
      .replace("{compileCommands}", workspacePath)
      .replace("{target}", `--target ${target}`);

    // 兼容未包含 {target} 的旧模板：追加 --target，避免升级后仍构建首 Target
    if (!cfg.convertCommandTemplate.includes("{target}")) {
      convertCommand += ` --target ${target}`;
    }

    if (cfg.ninjaPath) {
      convertCommand += ` --ninja "${cfg.ninjaPath}"`;
    }
    if (cfg.noHeaderInsertion) {
      convertCommand += ` --no-header-insertion`;
    }
    if (cfg.debugMode) {
      convertCommand += ` --debug`;
    }
    if (convertOnly) {
      // 仅转换不构建；cbp2clangd 没有此开关，这里保留以备将来使用
    }
    return convertCommand;
  }

  private async convertAndBuild(
    project: { fsPath: string; label: string },
    target: string,
    cfg: BuildConfig,
    terminal: { write: (s: string) => void },
    diagnostics: Diagnostics,
  ): Promise<void> {
    const projectDir = path.dirname(project.fsPath);
    const convertCommand = this.buildConvertCommand(
      project.fsPath,
      target,
      cfg,
      false,
    );
    terminal.write(`执行的转换命令: ${convertCommand}\n`);
    terminal.write(`\x1b[32m[1/2] 生成 Compile Commands...\x1b[0m\n`);
    await runCommand(convertCommand);

    terminal.write(`\x1b[32m[2/2] 执行构建脚本...\x1b[0m\n`);
    await runCommandInDirectory(cfg.buildScript, projectDir, diagnostics);
  }

  private async convertOnly(
    project: { fsPath: string; label: string },
    target: string,
    cfg: BuildConfig,
    terminal: { write: (s: string) => void },
  ): Promise<void> {
    const convertCommand = this.buildConvertCommand(
      project.fsPath,
      target,
      cfg,
      true,
    );
    terminal.write(
      `\x1b[36m>>> 恢复当前 Target [${target}] 的生成文件\x1b[0m\n`,
    );
    terminal.write(`执行的转换命令: ${convertCommand}\n`);
    await runCommand(convertCommand);
  }

  private async cleanTarget(
    project: { fsPath: string; label: string },
    target: string,
    cfg: BuildConfig,
    terminal: { write: (s: string) => void },
  ): Promise<void> {
    const projectDir = path.dirname(project.fsPath);
    // 先转换该 Target，得到对应的 build.ninja，再 ninja -t clean，
    // 修正原来“用旧 build.ninja 清理、再转换”的顺序问题。
    const convertCommand = this.buildConvertCommand(
      project.fsPath,
      target,
      cfg,
      false,
    );
    terminal.write(`执行的转换命令: ${convertCommand}\n`);
    terminal.write(`\x1b[32m[清理] 生成 Target Ninja...\x1b[0m\n`);
    await runCommand(convertCommand);

    terminal.write(`\x1b[32m[清理] 执行 ninja -t clean...\x1b[0m\n`);
    const ninjaCommand = cfg.ninjaPath
      ? `${cfg.ninjaPath} -t clean`
      : `ninja -t clean`;
    await runCommandInDirectory(ninjaCommand, projectDir);
  }
}
