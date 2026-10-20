import * as assert from "assert";
import {
  applyNinjaJobLimitToBuildScript,
  DEFAULT_MAX_PARALLEL_JOBS,
  expandBuildJobsPlaceholder,
  normalizeMaxParallelJobs,
} from "../../services/BuildConcurrency";

suite("Build Concurrency Test Suite", () => {
  test("defaults to 8 and never drops below 1", () => {
    assert.strictEqual(DEFAULT_MAX_PARALLEL_JOBS, 8);
    assert.strictEqual(normalizeMaxParallelJobs(undefined), 8);
    assert.strictEqual(normalizeMaxParallelJobs(Number.NaN), 8);
    assert.strictEqual(normalizeMaxParallelJobs(16), 16);
    assert.strictEqual(normalizeMaxParallelJobs(8), 8);
    assert.strictEqual(normalizeMaxParallelJobs(1), 1);
    assert.strictEqual(normalizeMaxParallelJobs(0), 1);
    assert.strictEqual(normalizeMaxParallelJobs(-3), 1);
  });

  test("adds a parallel job limit to the generated Ninja command", () => {
    const result = applyNinjaJobLimitToBuildScript(
      "@echo off\nninja -f build.ninja\necho done\n",
      8,
    );

    assert.strictEqual(result.foundNinjaCommand, true);
    assert.strictEqual(
      result.content,
      "@echo off\nninja -j 8 -f build.ninja\necho done\n",
    );
  });

  test("updates an existing Ninja job limit and preserves CRLF", () => {
    const result = applyNinjaJobLimitToBuildScript(
      '"C:\\Program Files\\ninja.exe" -j 16 -f build.ninja\r\n',
      8,
    );

    assert.strictEqual(result.foundNinjaCommand, true);
    assert.strictEqual(
      result.content,
      '"C:\\Program Files\\ninja.exe" -j 8 -f build.ninja\r\n',
    );
  });

  test("leaves scripts without a Ninja command untouched", () => {
    const original = "@echo off\nmake all\n";
    const result = applyNinjaJobLimitToBuildScript(original, 8);

    assert.strictEqual(result.foundNinjaCommand, false);
    assert.strictEqual(result.content, original);
  });

  test("expands the jobs placeholder with the configured or default limit", () => {
    assert.strictEqual(
      expandBuildJobsPlaceholder("ninja {jobs} -f build.ninja", 6),
      "ninja -j 6 -f build.ninja",
    );
    assert.strictEqual(
      expandBuildJobsPlaceholder("ninja {jobs} -f build.ninja", 8),
      "ninja -j 8 -f build.ninja",
    );
    assert.strictEqual(
      expandBuildJobsPlaceholder("ninja {jobs} -f build.ninja", 0),
      "ninja -j 1 -f build.ninja",
    );
  });
});
