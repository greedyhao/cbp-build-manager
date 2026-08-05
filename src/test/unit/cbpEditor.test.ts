import * as assert from "assert";
import { buildUnitTree, filterUnitTree } from "../../providers/cbpEditorUtils";

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
    assert.strictEqual(tree[0].children[0].path, "../common/platform.c");
    assert.strictEqual(tree[0].children[0].displayPath, "common/platform.c");
    assert.strictEqual(tree[0].children[1].children[0].displayPath, "common/include/platform.h");
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
    assert.strictEqual(filtered[0].children[0].path, "projects/watch320/main.c");
    assert.strictEqual(filtered[0].children[0].displayPath, "projects/watch320/main.c");
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
