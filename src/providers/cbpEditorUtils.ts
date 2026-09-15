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

export interface CompilerLinkerEntry {
  /** Attribute name carrying the value: option | library | directory | */
  kind: "option" | "library" | "directory";
  /** Raw attribute value with entities decoded for display. */
  value: string;
  /** Offset of the `<Add` tag start in the document text. */
  offset: number;
  /** Offset of the first character of the line containing the tag. */
  lineStart: number;
  /** Offset of the end of the `<Add ... />` tag. */
  end: number;
  /** Indentation (whitespace) prefix of the line containing the tag. */
  indent: string;
  /** Newline sequence used by the document at this location. */
  newline: string;
}

export interface CompilerLinkerSection {
  /** true when the options come from the project-level (shared) section. */
  projectLevel: boolean;
  /** Target title when section is target-level; undefined for project-level. */
  target?: string;
  compiler: CompilerLinkerEntry[];
  linker: CompilerLinkerEntry[];
}

const attrValuePattern = (attr: string) =>
  new RegExp(`\\b${attr}\\s*=\\s*(["'])(.*?)\\1`, "i");

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export function encodeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function extractAddEntries(sectionText: string, baseOffset: number): CompilerLinkerEntry[] {
  const entries: CompilerLinkerEntry[] = [];
  const addPattern = /<Add\b([^>]*?)\/?>/gi;
  for (const match of sectionText.matchAll(addPattern)) {
    const attrs = match[1] || "";
    const matchIndex = match.index ?? 0;
    const offset = baseOffset + matchIndex;
    for (const kind of ["option", "library", "directory"] as const) {
      const attrMatch = attrs.match(attrValuePattern(kind));
      if (attrMatch) {
        const lineStart = sectionText.lastIndexOf("\n", matchIndex - 1) + 1;
        const linePrefix = sectionText.slice(lineStart, matchIndex);
        const newline = sectionText.includes("\r\n") ? "\r\n" : "\n";
        entries.push({
          kind,
          value: decodeXmlEntities(attrMatch[2]),
          offset,
          lineStart: baseOffset + lineStart,
          end: offset + match[0].length,
          indent: linePrefix.match(/^[ \t]*/)?.[0] || "",
          newline,
        });
        break;
      }
    }
  }
  return entries;
}

interface SectionMatch {
  start: number;
  end: number;
  text: string;
}

/**
 * Find the first `<section>...</section>` block after `searchFrom` by walking
 * open/close tags in document order and tracking nesting depth. Depth
 * tracking is what keeps a Target-level `<Compiler>` from being picked up as
 * the project-level one (the previous fixed-size search window broke on
 * files with many `<Option>`/`<Add>` lines before the global section).
 */
function findSectionFrom(text: string, searchFrom: number, section: "Compiler" | "Linker"): SectionMatch | undefined {
  const tagPattern = new RegExp(`<(/?)${section}\\b[^>]*>`, "gi");
  tagPattern.lastIndex = searchFrom;
  let depth = 0;
  let start = -1;
  let match: RegExpExecArray | null;
  while ((match = tagPattern.exec(text))) {
    if (match[1] === "/") {
      depth -= 1;
      if (depth === 0) {
        return { start, end: match.index, text: text.slice(start, match.index) };
      }
    } else {
      depth += 1;
      if (depth === 1) {
        start = match.index + match[0].length;
      }
    }
  }
  return undefined;
}

function findProjectScope(text: string): SectionMatch | undefined {
  const openMatch = /<Project\b[^>]*>/i.exec(text);
  if (!openMatch) {
    return undefined;
  }
  const closeOffset = text.lastIndexOf("</Project>");
  if (closeOffset < 0) {
    return undefined;
  }
  return { start: openMatch.index, end: closeOffset, text };
}

/**
 * Collect the [start, end) spans of every `<Target title="...">...</Target>`
 * block, so project-level section lookups can reject sections that actually
 * live inside a target.
 */
function findTargetSpans(text: string): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  const targetPattern = /<Target\b[^>]*\btitle\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const targetMatch of text.matchAll(targetPattern)) {
    const scopeStart = targetMatch.index ?? 0;
    const closeOffset = text.indexOf("</Target>", scopeStart);
    spans.push({ start: scopeStart, end: closeOffset < 0 ? text.length : closeOffset });
  }
  return spans;
}

/**
 * Extract the `<Add>` entries of project-level and target-level Compiler and
 * Linker sections, in document order, with enough position info to edit them
 * in place. Target order follows the `<Target title>` XML order.
 */
export function extractCompilerLinkerSections(text: string): CompilerLinkerSection[] {
  const sections: CompilerLinkerSection[] = [];

  const projectScope = findProjectScope(text);
  if (!projectScope) {
    return sections;
  }

  const targetSpans = findTargetSpans(text);
  const inAnyTarget = (offset: number) =>
    targetSpans.some((span) => offset >= span.start && offset < span.end);

  const pickProjectSection = (section: "Compiler" | "Linker"): SectionMatch | undefined => {
    // Walk every candidate block and take the first one that sits directly
    // under <Project> (not inside a <Target>), so a target-level section
    // appearing earlier in the file is never mistaken for the global one.
    let from = projectScope.start + 1;
    for (;;) {
      const candidate = findSectionFrom(text, from, section);
      if (!candidate) {
        return undefined;
      }
      if (!inAnyTarget(candidate.start - 1)) {
        return candidate;
      }
      from = candidate.end + 1;
    }
  };

  const projectCompiler = pickProjectSection("Compiler");
  const projectLinker = pickProjectSection("Linker");
  sections.push({
    projectLevel: true,
    compiler: projectCompiler ? extractAddEntries(projectCompiler.text, projectCompiler.start) : [],
    linker: projectLinker ? extractAddEntries(projectLinker.text, projectLinker.start) : [],
  });

  const targetPattern = /<Target\b[^>]*\btitle\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const targetMatch of text.matchAll(targetPattern)) {
    const scopeStart = targetMatch.index ?? 0;
    const closeOffset = text.indexOf("</Target>", scopeStart);
    const scopeEnd = closeOffset < 0 ? text.length : closeOffset;
    const inScope = (section: SectionMatch | undefined) =>
      section && section.start < scopeEnd ? section : undefined;
    const targetCompiler = inScope(findSectionFrom(text, scopeStart + targetMatch[0].length, "Compiler"));
    const targetLinker = inScope(findSectionFrom(text, scopeStart + targetMatch[0].length, "Linker"));
    sections.push({
      projectLevel: false,
      target: targetMatch[1],
      compiler: targetCompiler
        ? extractAddEntries(targetCompiler.text, targetCompiler.start)
        : [],
      linker: targetLinker
        ? extractAddEntries(targetLinker.text, targetLinker.start)
        : [],
    });
  }

  return sections;
}

/**
 * Build the replacement text for a Compiler/Linker section body after adding,
 * removing, or editing `<Add>` entries. `original` is the section body slice
 * the caller will replace; entry offsets are absolute document offsets, so the
 * caller passes `bodyOffset` (the document offset where `original` starts) for
 * mapping. Untouched bytes keep their original form.
 */
export function rewriteSectionBody(
  original: string,
  bodyOffset: number,
  entries: readonly CompilerLinkerEntry[],
  removed: readonly number[],
  updated: ReadonlyMap<number, string>,
  added: readonly { kind: CompilerLinkerEntry["kind"]; value: string }[],
  indent: string,
  newline: string,
): string {
  const removalSet = new Set(removed);
  const mapEntry = (entry: CompilerLinkerEntry): CompilerLinkerEntry => ({
    ...entry,
    offset: entry.offset - bodyOffset,
    lineStart: entry.lineStart - bodyOffset,
    end: entry.end - bodyOffset,
  });
  const lines: string[] = [];
  let cursor = 0;
  // Each cut swallows the whole line (indent + tag + trailing newline) so a
  // removed entry leaves no blank line behind and a kept entry is rewritten
  // from its single canonical form.
  const cutPoints = entries
    .map((entry) => {
      const mapped = mapEntry(entry);
      let to = mapped.end;
      if (original.startsWith("\r\n", to)) {
        to += 2;
      } else if (original.startsWith("\n", to)) {
        to += 1;
      }
      return {
        entry: mapped,
        removed: removalSet.has(entry.offset),
        from: mapped.lineStart,
        to,
      };
    })
    .sort((left, right) => left.from - right.from);
  for (const cut of cutPoints) {
    if (cut.from < cursor) {
      continue;
    }
    lines.push(original.slice(cursor, cut.from));
    if (!cut.removed) {
      const newValue = updated.get(cut.entry.offset + bodyOffset);
      const attrs = `${cut.entry.kind}="${encodeXmlAttr(newValue ?? cut.entry.value)}"`;
      lines.push(`${cut.entry.indent}<Add ${attrs} />${cut.entry.newline}`);
    }
    cursor = cut.to;
  }
  lines.push(original.slice(cursor));
  let body = lines.join("");
  if (added.length > 0) {
    const additionText = added
      .map((addition) => `${indent}<Add ${addition.kind}="${encodeXmlAttr(addition.value)}" />${newline}`)
      .join("");
    // Insert before the closing tag's indentation (the whitespace run after
    // the last newline) so `</Compiler>`/`</Linker>` keeps its own line and
    // column, and the new line gets exactly the entry indent.
    const tail = /\r?\n([ \t]*)$/.exec(body);
    if (tail) {
      const split = body.length - tail[1].length;
      body = body.slice(0, split) + additionText + body.slice(split);
    } else if (body.trim() === "") {
      body = newline + additionText + body;
    } else {
      body = body + newline + additionText;
    }
  }
  return body;
}

export const unitPattern =
  /<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*>[\s\S]*?<\/Unit>|<Unit\b[^>]*\bfilename\s*=\s*["']([^"']+)["'][^>]*\/>/gi;

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
