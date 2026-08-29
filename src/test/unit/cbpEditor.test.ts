import * as assert from "assert";
import * as path from "path";
import {
  buildUnitTree,
  extractUnitEntries,
  filterUnitTree,
  planUnitInsertions,
  toCbpRelativePath,
} from "../../providers/cbpEditorUtils";

suite("CBP Editor UI helpers", () => {
  test("builds and sorts a normalized directory tree", () => {
    const tree = buildUnitTree([
      "src\\z.c",
      "src/a.c",
      "src/driver/b.c",
      "include/a.h",
    ]);

    assert.deepStrictEqual(tree.map((node) => node.name), ["include", "src"]);
    assert.deepStrictEqual(tree[1].children.map((node) => node.name), ["driver", "a.c", "z.c"]);
    assert.strictEqual(tree[1].children[0].children[0].path, "src/driver/b.c");
  });

  test("removes leading parent directories from display while preserving original path", () => {
    const tree = buildUnitTree(["../common/platform.c", "../common/include/platform.h", "src/main.c"]);
    assert.deepStrictEqual(tree.map((node) => node.name), ["common", "src"]);
    assert.strictEqual(tree[0].children[1].path, "../common/platform.c");
    assert.strictEqual(tree[0].children[1].displayPath, "common/platform.c");
    assert.strictEqual(tree[0].children[0].children[0].displayPath, "common/include/platform.h");
  });
  test("uses the project directory as the base for common-root display", () => {
    const tree = buildUnitTree(
      [
        "projects/watch320/main.c",
        "projects/watch320/config.h",
        "projects/watch320/functions/func.h",
        "platform/bsp/bsp.h",
      ],
      "D:/workspace",
    );
    assert.deepStrictEqual(tree.map((node) => node.name), ["platform", "projects"]);
    assert.deepStrictEqual(tree[1].children.map((node) => node.name), ["watch320"]);
    assert.deepStrictEqual(tree[1].children[0].children.map((node) => node.name), ["functions", "config.h", "main.c"]);
  });
  test("filters files case-insensitively and retains matching ancestors", () => {
    const tree = buildUnitTree(["src/Driver/Main.C", "src/platform.c", "README.md"]);
    const filtered = filterUnitTree(tree, "main.c");

    assert.deepStrictEqual(filtered.map((node) => node.name), ["src"]);
    assert.deepStrictEqual(filtered[0].children.map((node) => node.name), ["Driver"]);
    assert.strictEqual(filtered[0].children[0].children[0].path, "src/Driver/Main.C");
  });

  test("partial filename matching keeps the original path for removal", () => {
    const tree = buildUnitTree(["projects/watch320/main.c", "platform/bsp/bsp.h"], "D:/workspace");
    const filtered = filterUnitTree(tree, "main");
    assert.strictEqual(filtered[0].name, "projects");
    assert.strictEqual(filtered[0].children[0].children[0].path, "projects/watch320/main.c");
    assert.strictEqual(filtered[0].children[0].children[0].displayPath, "projects/watch320/main.c");
  });
  test("returns an empty tree when there is no match", () => {
    const tree = buildUnitTree(["src/main.c", "include/main.h"]);
    assert.deepStrictEqual(filterUnitTree(tree, "missing"), []);
  });

  test("an empty query preserves the complete tree", () => {
    const tree = buildUnitTree(["a.c", "src/b.c"]);
    assert.deepStrictEqual(filterUnitTree(tree, ""), tree);
  });
});

suite("toCbpRelativePath", () => {
  const projectDir = path.join("D:", "workspace", "projects", "watch320");

  test("files under the project dir stay relative to the cbp directory", () => {
    assert.strictEqual(
      toCbpRelativePath(projectDir, path.join("D:", "workspace", "projects", "watch320", "app.c")),
      "app.c",
    );
    assert.strictEqual(
      toCbpRelativePath(projectDir, path.join("D:", "workspace", "projects", "watch320", "src", "boot.c")),
      "src/boot.c",
    );
  });

  test("files outside the project dir use ../ prefixes", () => {
    assert.strictEqual(
      toCbpRelativePath(projectDir, path.join("D:", "workspace", "platform", "bsp", "bsp_app", "ab_command", "ab_common.c")),
      "../../platform/bsp/bsp_app/ab_command/ab_common.c",
    );
  });

  test("sibling files reference the parent directory", () => {
    assert.strictEqual(
      toCbpRelativePath(projectDir, path.join("D:", "workspace", "projects", "shared", "lib.c")),
      "../shared/lib.c",
    );
  });

  test("paths on a different drive keep the absolute form", () => {
    assert.strictEqual(
      toCbpRelativePath(projectDir, path.join("E:", "libs", "sdk.c")),
      "E:/libs/sdk.c",
    );
  });
});

suite("planUnitInsertions", () => {
  const cbp = [
    "<?xml version=\"1.0\"?>",
    "<Project>",
    "\t<Unit filename=\"main.c\">",
    "\t\t<Option compilerVar=\"CC\" />",
    "\t</Unit>",
    "\t<Unit filename=\"src/util.c\" />",
    "</Project>",
  ].join("\n");

  test("inserts before the first unit that sorts after the new file", () => {
    const entries = extractUnitEntries(cbp);
    const plans = planUnitInsertions(entries, ["include/config.h"], cbp.lastIndexOf("</Project>"));
    assert.strictEqual(plans.length, 1);
    assert.strictEqual(plans[0].filename, "include/config.h");
    // before the line of <Unit filename="main.c">
    assert.ok(cbp.slice(plans[0].offset).startsWith('\t<Unit filename="main.c">'));
  });

  test("a file sorting after every unit falls back to </Project>", () => {
    const entries = extractUnitEntries(cbp);
    const plans = planUnitInsertions(entries, ["src/zzz.c"], cbp.lastIndexOf("</Project>"));
    assert.strictEqual(plans[0].offset, cbp.lastIndexOf("</Project>"));
  });

  test("multiple additions are returned sorted, not in selection order", () => {
    const entries = extractUnitEntries(cbp);
    const plans = planUnitInsertions(
      entries,
      ["src/zzz.c", "include/config.h", "app.c"],
      cbp.lastIndexOf("</Project>"),
    );
    assert.deepStrictEqual(plans.map((plan) => plan.filename), ["app.c", "include/config.h", "src/zzz.c"]);
  });

  test("comparison is case-insensitive and tolerates mixed separators", () => {
    const text = "<Project>\n<Unit filename=\"SRC/A.c\" />\n<Unit filename=\"src/b.c\" />\n</Project>";
    const entries = extractUnitEntries(text);
    const plans = planUnitInsertions(entries, ["src\\a1.c"], text.lastIndexOf("</Project>"));
    // "src/a1.c" sorts after "SRC/A.c" and before "src/b.c" under
    // case-insensitive comparison, so it inserts before the "src/b.c" line.
    assert.ok(text.slice(plans[0].offset).startsWith('<Unit filename="src/b.c"'));
  });
});
