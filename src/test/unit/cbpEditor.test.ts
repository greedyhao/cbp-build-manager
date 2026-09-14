import * as assert from "assert";
import * as path from "path";
import {
  buildUnitTree,
  encodeXmlAttr,
  extractCompilerLinkerSections,
  extractUnitEntries,
  filterUnitTree,
  planUnitInsertions,
  rewriteSectionBody,
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

suite("extractCompilerLinkerSections", () => {
  const cbp = [
    "<?xml version=\"1.0\"?>",
    "<CodeBlocks_project_file>",
    "\t<Project>",
    "\t\t<Option title=\"Demo\" />",
    "\t\t<Compiler>",
    "\t\t\t<Add option=\"-Wall\" />",
    "\t\t\t<Add option=\"-Os\" />",
    "\t\t</Compiler>",
    "\t\t<Linker>",
    "\t\t\t<Add option=\"-Wl,--gc-sections\" />",
    "\t\t\t<Add library=\"m\" />",
    "\t\t</Linker>",
    "\t\t<Build>",
    "\t\t\t<Target title=\"Debug\">",
    "\t\t\t\t<Compiler>",
    "\t\t\t\t\t<Add option=\"-DDEBUG=1\" />",
    "\t\t\t\t</Compiler>",
    "\t\t\t</Target>",
    "\t\t\t<Target title=\"Release\">",
    "\t\t\t\t<Linker>",
    "\t\t\t\t\t<Add option=\"-T$(TARGET_OBJECT_DIR)ram.o\" />",
    "\t\t\t\t\t<Add directory=\"libs\" />",
    "\t\t\t\t</Linker>",
    "\t\t\t</Target>",
    "\t\t</Build>",
    "\t\t<Unit filename=\"main.c\" />",
    "\t</Project>",
    "</CodeBlocks_project_file>",
  ].join("\n");

  test("extracts project-level and target-level entries with positions", () => {
    const sections = extractCompilerLinkerSections(cbp);
    assert.strictEqual(sections.length, 3);

    const global = sections[0];
    assert.strictEqual(global.projectLevel, true);
    assert.deepStrictEqual(
      global.compiler.map((entry) => [entry.kind, entry.value]),
      [["option", "-Wall"], ["option", "-Os"]],
    );
    assert.deepStrictEqual(
      global.linker.map((entry) => [entry.kind, entry.value]),
      [["option", "-Wl,--gc-sections"], ["library", "m"]],
    );

    const debug = sections[1];
    assert.strictEqual(debug.projectLevel, false);
    assert.strictEqual(debug.target, "Debug");
    assert.deepStrictEqual(debug.compiler.map((entry) => entry.value), ["-DDEBUG=1"]);
    assert.deepStrictEqual(debug.linker, []);

    const release = sections[2];
    assert.strictEqual(release.target, "Release");
    assert.deepStrictEqual(release.compiler, []);
    assert.deepStrictEqual(
      release.linker.map((entry) => [entry.kind, entry.value]),
      [["option", "-T$(TARGET_OBJECT_DIR)ram.o"], ["directory", "libs"]],
    );
  });

  test("entry offsets point at the <Add tag in the full document", () => {
    const sections = extractCompilerLinkerSections(cbp);
    const first = sections[0].compiler[0];
    assert.strictEqual(cbp.slice(first.offset, first.end), '<Add option="-Wall" />');
    assert.strictEqual(cbp.slice(first.lineStart, first.offset), "\t\t\t");
    assert.strictEqual(cbp.slice(first.lineStart, first.end).trim(), '<Add option="-Wall" />');
    const releaseLinker = sections[2].linker[0];
    assert.strictEqual(
      cbp.slice(releaseLinker.offset, releaseLinker.end),
      '<Add option="-T$(TARGET_OBJECT_DIR)ram.o" />',
    );
  });

  test("target sections never leak global or sibling options", () => {
    const sections = extractCompilerLinkerSections(cbp);
    assert.ok(sections[1].compiler.every((entry) => entry.value !== "-Wall"));
    assert.ok(sections[2].linker.every((entry) => entry.value !== "-Wl,--gc-sections"));
    assert.ok(sections.every((section) => section.compiler.every((entry) => entry.value !== "-DDEBUG=1") || section === sections[1]));
  });

  test("returns an empty list for content without a Project element", () => {
    assert.deepStrictEqual(extractCompilerLinkerSections("<html></html>"), []);
  });

  test("preserves entries separated by CRLF newlines", () => {
    const crlf = cbp.replace(/\n/g, "\r\n");
    const sections = extractCompilerLinkerSections(crlf);
    const first = sections[0].compiler[0];
    assert.strictEqual(first.newline, "\r\n");
    assert.strictEqual(crlf.slice(first.offset, first.end), '<Add option="-Wall" />');
  });
});

suite("rewriteSectionBody", () => {
  const sectionText = [
    "",
    "\t\t\t<Add option=\"-Wall\" />",
    "\t\t\t<Add option=\"-Os\" />",
    "\t\t",
  ].join("\n");
  // Build a document whose <Compiler> body starts exactly at offset 50, as it
  // would in a real CBP file, so entries carry absolute document offsets.
  const prefix = "<Project>";
  const openTag = '<Compiler x="xx">';
  const bodyOffset = prefix.length + openTag.length; // = body start
  const wrapped = `${prefix}${openTag}${sectionText}</Compiler></Project>`;
  const entries = extractCompilerLinkerSections(wrapped)[0].compiler;
  assert.strictEqual(entries[0].lineStart - bodyOffset, sectionText.indexOf("\t\t\t<Add"));

  test("removing an entry drops only its line", () => {
    const body = rewriteSectionBody(sectionText, bodyOffset, entries, [entries[0].offset], new Map(), [], "\t\t\t", "\n");
    assert.ok(!body.includes("-Wall"));
    assert.ok(body.includes("-Os"));
    // The removed line disappears entirely; everything else stays.
    assert.strictEqual(body.split("\n").length, sectionText.split("\n").length - 1);
  });

  test("editing an entry keeps position and indentation", () => {
    const body = rewriteSectionBody(
      sectionText,
      bodyOffset,
      entries,
      [],
      new Map([[entries[1].offset, "-O3"]]),
      [],
      "\t\t\t",
      "\n",
    );
    assert.ok(body.includes('<Add option="-O3" />'));
    const lines = body.split("\n");
    assert.strictEqual(lines[2], "\t\t\t<Add option=\"-O3\" />");
  });

  test("adding entries appends them before the closing indentation", () => {
    const body = rewriteSectionBody(
      sectionText,
      bodyOffset,
      entries,
      [],
      new Map(),
      [{ kind: "library", value: "m" }],
      "\t\t\t",
      "\n",
    );
    assert.ok(body.includes('<Add library="m" />'));
    assert.ok(body.lastIndexOf("<Add library=\"m\" />") > body.lastIndexOf("<Add option=\"-Os\" />"));
  });

  test("added entry keeps the closing tag indentation intact (CRLF, tabs)", () => {
    const lines = [
      "<CodeBlocks_project_file>",
      "\t<Project>",
      "\t\t<Compiler>",
      "\t\t\t<Add directory=\"../../platform/modules/ws_air\" />",
      "\t\t</Compiler>",
      "\t</Project>",
      "</CodeBlocks_project_file>",
    ].join("\r\n");
    const wrapped = lines;
    const bodyStart = wrapped.indexOf("<Compiler>") + "<Compiler>".length;
    const bodyEnd = wrapped.lastIndexOf("</Compiler>");
    const section = wrapped.slice(bodyStart, bodyEnd);
    const secEntries = extractCompilerLinkerSections(wrapped)[0].compiler;
    const body = rewriteSectionBody(
      section,
      bodyStart,
      secEntries,
      [],
      new Map(),
      [{ kind: "directory", value: "../../platform/modules/ws_air" }],
      "\t\t\t",
      "\r\n",
    );
    const rebuilt = wrapped.slice(0, bodyStart) + body + wrapped.slice(bodyEnd);
    // Closing tag keeps its own line with original indentation, no blank line.
    assert.ok(rebuilt.includes("\r\n\t\t</Compiler>"));
    assert.ok(!rebuilt.includes("\r\n\r\n"));
    assert.ok(rebuilt.includes("\r\n\t\t\t<Add directory=\"../../platform/modules/ws_air\" />\r\n\t\t\t<Add directory=\"../../platform/modules/ws_air\" />\r\n\t\t</Compiler>"));
  });

  test("combined remove, update, and add in one pass", () => {
    const body = rewriteSectionBody(
      sectionText,
      bodyOffset,
      entries,
      [entries[0].offset],
      new Map([[entries[1].offset, "-O2"]]),
      [{ kind: "option", value: "-std=c99" }],
      "\t\t\t",
      "\n",
    );
    assert.ok(!body.includes("-Wall"));
    assert.ok(body.includes('<Add option="-O2" />'));
    assert.ok(body.includes('<Add option="-std=c99" />'));
  });

  test("values are XML-escaped on write", () => {
    const body = rewriteSectionBody(
      sectionText,
      bodyOffset,
      entries,
      [],
      new Map([[entries[0].offset, '-DMSG="a&b"']]),
      [],
      "\t\t\t",
      "\n",
    );
    assert.ok(body.includes('<Add option="-DMSG=&quot;a&amp;b&quot;" />'));
  });

  test("encodeXmlAttr escapes entities", () => {
    assert.strictEqual(encodeXmlAttr('a<b&"c>d'), "a&lt;b&amp;&quot;c&gt;d");
  });
});
