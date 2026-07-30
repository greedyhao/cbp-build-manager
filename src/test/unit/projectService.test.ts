import * as assert from "assert";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as vscode from "vscode";
import { CbpProjectService } from "../../services/CbpProjectService";

function getWorkspaceRoot(): string {
  return vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || os.tmpdir();
}

suite("CbpProjectService Test Suite", () => {
  let tempDir: string;

  setup(() => {
    tempDir = fs.mkdtempSync(path.join(getWorkspaceRoot(), ".cbp-svc-"));
  });

  teardown(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  test("read returns targets in XML order and unit filenames", () => {
    const cbp = path.join(tempDir, "p.cbp");
    fs.writeFileSync(
      cbp,
      `<?xml version="1.0"?>\n<CodeBlocks_project_file><Project>
<Option title="p"/><Build>
<Target title="Debug"><Option output="a.a"/></Target>
<Target title="Debug_1to3"><Option output="b.a"/></Target>
<Target title="Debug_lea"><Option output="c.a"/></Target>
</Build>
<Unit filename="src/main.c"/>
<Unit filename="src/util.c"/>
</Project></CodeBlocks_project_file>`,
      "utf-8",
    );
    const svc = new CbpProjectService();
    const meta = svc.read(cbp);
    assert.deepStrictEqual(meta.targets, ["Debug", "Debug_1to3", "Debug_lea"]);
    assert.deepStrictEqual(meta.units, ["src/main.c", "src/util.c"]);
  });

  test("read caches and invalidate refreshes", () => {
    const cbp = path.join(tempDir, "p.cbp");
    fs.writeFileSync(cbp, `<Project><Build><Target title="A"/></Build></Project>`, "utf-8");
    const svc = new CbpProjectService();
    assert.deepStrictEqual(svc.read(cbp).targets, ["A"]);
    fs.writeFileSync(cbp, `<Project><Build><Target title="B"/></Build></Project>`, "utf-8");
    // 缓存命中，仍返回 A
    assert.deepStrictEqual(svc.read(cbp).targets, ["A"]);
    svc.invalidate(cbp);
    assert.deepStrictEqual(svc.read(cbp).targets, ["B"]);
  });

  test("read on malformed XML returns empty rather than throwing", () => {
    const cbp = path.join(tempDir, "bad.cbp");
    fs.writeFileSync(cbp, `not xml at all`, "utf-8");
    const svc = new CbpProjectService();
    // matchAll 在无匹配时返回空，不会抛错
    assert.deepStrictEqual(svc.read(cbp).targets, []);
  });
});
