"use client";

import React, { useMemo } from "react";

type MarkdownAlign = "left" | "center" | "right";

type MarkdownBlock =
    | { kind: "paragraph"; text: string }
    | { kind: "code"; text: string; language: string | null }
    | { kind: "table"; headers: string[]; aligns: MarkdownAlign[]; rows: string[][] };

type MarkdownLiteProps = {
    content: string;
    className?: string;
};

function parseTableRow(line: string): string[] | null {
    const trimmed = line.trim();
    if (!trimmed.includes("|")) {
        return null;
    }

    const normalized = trimmed.replace(/^\|/u, "").replace(/\|$/u, "");
    const cells = normalized.split("|").map((cell) => cell.trim());
    if (cells.length < 2) {
        return null;
    }
    return cells;
}

function isTableSeparatorRow(cells: string[]): boolean {
    return cells.every((cell) => /^:?-{3,}:?$/u.test(cell.trim()));
}

function parseTableAlignment(cells: string[]): MarkdownAlign[] {
    return cells.map((cell) => {
        const trimmed = cell.trim();
        const left = trimmed.startsWith(":");
        const right = trimmed.endsWith(":");
        if (left && right) return "center";
        if (right) return "right";
        return "left";
    });
}

function parseMarkdownBlocks(content: string): MarkdownBlock[] {
    const lines = content.replace(/\r\n/gu, "\n").split("\n");
    const blocks: MarkdownBlock[] = [];
    let index = 0;

    while (index < lines.length) {
        const line = lines[index] ?? "";
        const trimmed = line.trim();

        if (!trimmed) {
            index += 1;
            continue;
        }

        if (trimmed.startsWith("```")) {
            const language = trimmed.slice(3).trim() || null;
            const codeLines: string[] = [];
            index += 1;
            while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
                codeLines.push(lines[index] ?? "");
                index += 1;
            }
            if (index < lines.length) {
                index += 1;
            }
            blocks.push({ kind: "code", text: codeLines.join("\n"), language });
            continue;
        }

        const headerCells = parseTableRow(line);
        const separatorLine = lines[index + 1] ?? "";
        const separatorCells = parseTableRow(separatorLine);
        const tableStart =
            headerCells &&
            separatorCells &&
            headerCells.length === separatorCells.length &&
            isTableSeparatorRow(separatorCells);

        if (tableStart && headerCells && separatorCells) {
            const rows: string[][] = [];
            const aligns = parseTableAlignment(separatorCells);
            index += 2;
            while (index < lines.length) {
                const rowCells = parseTableRow(lines[index] ?? "");
                if (!rowCells || isTableSeparatorRow(rowCells)) {
                    break;
                }
                rows.push(rowCells);
                index += 1;
            }
            blocks.push({
                kind: "table",
                headers: headerCells,
                aligns,
                rows,
            });
            continue;
        }

        const paragraphLines: string[] = [line];
        index += 1;
        while (index < lines.length) {
            const candidate = lines[index] ?? "";
            const candidateTrimmed = candidate.trim();
            if (!candidateTrimmed) {
                index += 1;
                break;
            }
            if (candidateTrimmed.startsWith("```")) {
                break;
            }
            const maybeHeader = parseTableRow(candidate);
            const maybeSeparator = parseTableRow(lines[index + 1] ?? "");
            if (
                maybeHeader &&
                maybeSeparator &&
                maybeHeader.length === maybeSeparator.length &&
                isTableSeparatorRow(maybeSeparator)
            ) {
                break;
            }
            paragraphLines.push(candidate);
            index += 1;
        }
        blocks.push({ kind: "paragraph", text: paragraphLines.join("\n") });
    }

    return blocks;
}

function renderInlineLinks(text: string): React.ReactNode[] {
    const parts: React.ReactNode[] = [];
    const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/giu;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = linkPattern.exec(text)) !== null) {
        const [raw, label, href] = match;
        const start = match.index;
        if (start > lastIndex) {
            parts.push(text.slice(lastIndex, start));
        }
        parts.push(
            <a
                key={`${href}_${start}`}
                href={href}
                target="_blank"
                rel="noreferrer"
                className="text-cyan-300 underline decoration-cyan-500/40 hover:text-cyan-200"
            >
                {label}
            </a>
        );
        lastIndex = start + raw.length;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    if (parts.length === 0) {
        return [text];
    }
    return parts;
}

function alignClass(align: MarkdownAlign | undefined): string {
    if (align === "right") return "text-right";
    if (align === "center") return "text-center";
    return "text-left";
}

export function MarkdownLite({ content, className }: MarkdownLiteProps) {
    const blocks = useMemo(() => parseMarkdownBlocks(content), [content]);

    return (
        <div className={className ?? ""}>
            {blocks.map((block, blockIndex) => {
                if (block.kind === "paragraph") {
                    return (
                        <p key={`md_para_${blockIndex}`} className="whitespace-pre-wrap break-words">
                            {renderInlineLinks(block.text)}
                        </p>
                    );
                }

                if (block.kind === "code") {
                    return (
                        <pre
                            key={`md_code_${blockIndex}`}
                            className="mt-3 overflow-x-auto rounded-md border border-white/10 bg-black/45 px-3 py-2 text-[12px] leading-relaxed text-cyan-100"
                        >
                            <code>{block.text}</code>
                        </pre>
                    );
                }

                return (
                    <div key={`md_table_${blockIndex}`} className="mt-3 overflow-x-auto rounded-md border border-white/10 bg-black/35">
                        <table className="min-w-full border-collapse text-[13px] text-white/80">
                            <thead className="bg-white/5">
                                <tr>
                                    {block.headers.map((header, headerIndex) => (
                                        <th
                                            key={`md_table_h_${blockIndex}_${headerIndex}`}
                                            className={`border-b border-white/10 px-3 py-2 text-[11px] font-mono uppercase tracking-widest text-cyan-300 ${alignClass(
                                                block.aligns[headerIndex]
                                            )}`}
                                        >
                                            {renderInlineLinks(header)}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {block.rows.map((row, rowIndex) => (
                                    <tr key={`md_table_r_${blockIndex}_${rowIndex}`} className="odd:bg-white/[0.02]">
                                        {block.headers.map((_, cellIndex) => (
                                            <td
                                                key={`md_table_c_${blockIndex}_${rowIndex}_${cellIndex}`}
                                                className={`border-t border-white/10 px-3 py-2 align-top ${alignClass(block.aligns[cellIndex])}`}
                                            >
                                                {renderInlineLinks(row[cellIndex] ?? "")}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
}

