import * as path from "path";

export interface UnitTreeNode {
  name: string;
  /** Original path stored in the CBP Unit attribute. */
  path?: string;
  /** Path relative to the common display root. */
  displayPath?: string;
  children: UnitTreeNode[];
}

function normalizePath(path: string): string[] {
  return path.replace(/\\/g, "/").split("/").filter(Boolean).reduce<string[]>(
    (segments, segment) => {
      if (segment === ".") {
        return segments;
      }
      if (segment === ".." && segments.length > 0 && segments[segments.length - 1] !== "..") {
        segments.pop();
      } else if (segment !== "..") {
        segments.push(segment);
      } else {
        segments.push(segment);
      }
      return segments;
    },
    [],
  );
}

function commonPrefix(paths: string[][]): string[] {
  if (paths.length === 0) {
    return [];
  }
  const prefix = [...paths[0]];
  for (const path of paths.slice(1)) {
    let length = 0;
    while (length < prefix.length && length < path.length && prefix[length].toLocaleLowerCase() === path[length].toLocaleLowerCase()) {
      length += 1;
    }
    prefix.length = length;
  }
  return prefix;
}

export function buildUnitTree(
  units: readonly string[],
  basePath?: string,
): UnitTreeNode[] {
  const originalPaths = units.map((unit) => unit.replace(/\\/g, "/").replace(/^\.\//, ""));
  const baseSegments = basePath ? normalizePath(basePath) : [];
  const resolvedPaths = originalPaths.map((unit) => {
    const unitSegments = normalizePath(unit);
    if (/^(?:[A-Za-z]:\/|\/)/.test(unit)) {
      return unitSegments;
    }
    return normalizePath([...baseSegments, ...unitSegments].join("/"));
  });
  const rootSegments = commonPrefix(resolvedPaths);
  const roots: UnitTreeNode[] = [];

  originalPaths.forEach((originalPath, unitIndex) => {
    const resolved = resolvedPaths[unitIndex];
    // Hide leading `..` in the display tree while keeping the original path.
    let displaySegments = resolved.slice(rootSegments.length);
    while (displaySegments.length > 1 && displaySegments[0] === "..") {
      displaySegments = displaySegments.slice(1);
    }
    const segments = displaySegments.length > 0 ? displaySegments : resolved.slice(-1);
    if (segments.length === 0) {
      return;
    }

    const displayPath = segments.join("/");
    let level = roots;
    for (let index = 0; index < segments.length; index += 1) {
      const name = segments[index];
      let node = level.find((candidate) => candidate.name === name);
      if (!node) {
        node = { name, children: [] };
        level.push(node);
      }
      if (index === segments.length - 1) {
        node.path = originalPath;
        node.displayPath = displayPath;
      }
      level = node.children;
    }
  });

  const sortNodes = (nodes: UnitTreeNode[]) => {
    nodes.sort((left, right) => {
      const leftIsFile = left.path !== undefined;
      const rightIsFile = right.path !== undefined;
      if (leftIsFile !== rightIsFile) {
        return leftIsFile ? 1 : -1;
      }
      return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
    });
    nodes.forEach((node) => sortNodes(node.children));
  };
  sortNodes(roots);
  return roots;
}

export function filterUnitTree(nodes: readonly UnitTreeNode[], query: string): UnitTreeNode[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    return nodes.map((node) => ({ ...node, children: filterUnitTree(node.children, "") }));
  }

  const result: UnitTreeNode[] = [];
  for (const node of nodes) {
    if (node.path !== undefined) {
      const searchable = `${node.path} ${node.displayPath || node.path} ${node.name}`.toLocaleLowerCase();
      if (searchable.includes(normalizedQuery)) {
        result.push({ ...node, children: [] });
      }
      continue;
    }
    const children = filterUnitTree(node.children, normalizedQuery);
    if (children.length > 0) {
      result.push({ ...node, children });
    }
  }
  return result;
}

/**
 * Convert an absolute file path to a CBP-style path relative to the CBP
 * directory, matching the official Code::Blocks layout (e.g.
 * `../../platform/...` for files outside the project directory). Falls back
 * to the absolute form only when the file sits on a different drive/root.
 */
export function toCbpRelativePath(projectDir: string, filePath: string): string {
  const relative = path.relative(projectDir, filePath);
  if (!relative || path.isAbsolute(relative)) {
    return filePath.replace(/\\/g, "/");
  }
  return relative.replace(/\\/g, "/");
}

export const unitPattern = /<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/Unit>|<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*\/>/gi;

export interface UnitEntry {
  /** filename attribute with backslashes normalized to forward slashes */
  filename: string;
  /** Offset of the `<Unit` tag start in the document text. */
  offset: number;
  /** Offset of the first character of the line containing the tag. */
  lineStart: number;
}

export function extractUnitEntries(text: string): UnitEntry[] {
  return Array.from(text.matchAll(unitPattern), (match) => {
    const offset = match.index ?? 0;
    return {
      filename: (match[1] || match[2]).replace(/\\/g, "/"),
      offset,
      lineStart: text.lastIndexOf("\n", offset - 1) + 1,
    };
  });
}

/**
 * Plan where each new Unit should be inserted so the Unit order in the file
 * stays sorted, matching how official Code::Blocks saves projects. A file
 * sorting after every existing unit goes to fallbackOffset (the position of
 * `</Project>`). Comparison is case-insensitive on the stored relative path.
 */
export function planUnitInsertions(
  entries: readonly UnitEntry[],
  additions: readonly string[],
  fallbackOffset: number,
): Array<{ filename: string; offset: number }> {
  const compare = (left: string, right: string) =>
    left.localeCompare(right, undefined, { sensitivity: "base" });
  return [...additions]
    .map((filename) => filename.replace(/\\/g, "/"))
    .sort(compare)
    .map((filename) => {
      const greater = entries.find((entry) => compare(entry.filename, filename) > 0);
      return { filename, offset: greater ? greater.lineStart : fallbackOffset };
    });
}
