// 默认最大并行编译任务数
export const DEFAULT_MAX_PARALLEL_JOBS = 8;

// 归一化并行任务数：非法值回退到默认值，低于最小值 1 时按 1 处理
export function normalizeMaxParallelJobs(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return DEFAULT_MAX_PARALLEL_JOBS;
  }
  return Math.max(1, value);
}

export interface NinjaJobLimitResult {
  content: string;
  foundNinjaCommand: boolean;
}

/**
 * Add or update the job limit on cbp2clangd's generated Ninja command in
 * build.bat. The rest of the generated pre-build and post-build hooks remain
 * untouched.
 */
export function applyNinjaJobLimitToBuildScript(
  content: string,
  jobs: number,
): NinjaJobLimitResult {
  const normalizedJobs = normalizeMaxParallelJobs(jobs);
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  let foundNinjaCommand = false;
  const jobLimitPattern = /\s-j(?:obs)?(?:=|\s*)\d+\b/i;
  const updatedLines = content.split(/\r?\n/).map((line) => {
    const match = line.match(
      /^([ \t]*)(.*?)([ \t]+-f[ \t]+build\.ninja\b.*)$/i,
    );
    if (!match) {
      return line;
    }

    const executable = match[2].replace(jobLimitPattern, "").trim();
    if (!/(?:^|[\\/])ninja(?:\.exe)?["']?$/i.test(executable)) {
      return line;
    }

    foundNinjaCommand = true;
    const command = `${match[2]}${match[3]}`;
    if (jobLimitPattern.test(command)) {
      return `${match[1]}${command.replace(
        jobLimitPattern,
        ` -j ${normalizedJobs}`,
      )}`;
    }

    return `${match[1]}${match[2]} -j ${normalizedJobs}${match[3]}`;
  });

  return {
    content: foundNinjaCommand ? updatedLines.join(newline) : content,
    foundNinjaCommand,
  };
}

export function expandBuildJobsPlaceholder(
  command: string,
  jobs: number,
): string {
  const normalizedJobs = normalizeMaxParallelJobs(jobs);
  return command.replaceAll("{jobs}", `-j ${normalizedJobs}`);
}
