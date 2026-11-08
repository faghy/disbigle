/**
 * Formatting buttons for the post text, which is Markdown (as on diaspora*): each one wraps the
 * selection or prefixes its lines, and pressing it again on formatted text removes the format.
 */
export type Format =
  | 'bold'
  | 'italic'
  | 'strike'
  | 'code'
  | 'heading'
  | 'quote'
  | 'list'
  | 'numbered'
  | 'link';

export interface Edit {
  text: string;
  /** The new selection. */
  start: number;
  end: number;
}

const WRAPS: Partial<Record<Format, string>> = {
  bold: '**',
  italic: '*',
  strike: '~~',
  code: '`',
};

const PREFIXES: Partial<Record<Format, string>> = {
  heading: '## ',
  quote: '> ',
  list: '- ',
  numbered: '1. ',
};

function wrap(text: string, start: number, end: number, mark: string, placeholder: string): Edit {
  const before = text.slice(0, start);
  const selected = text.slice(start, end);
  const after = text.slice(end);
  // Already wrapped: unwrap.
  if (before.endsWith(mark) && after.startsWith(mark)) {
    return {
      text: before.slice(0, -mark.length) + selected + after.slice(mark.length),
      start: start - mark.length,
      end: end - mark.length,
    };
  }
  const inner = selected || placeholder;
  return {
    text: before + mark + inner + mark + after,
    start: start + mark.length,
    end: start + mark.length + inner.length,
  };
}

function prefixLines(text: string, start: number, end: number, format: Format): Edit {
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const nextBreak = text.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split('\n');
  const prefix = PREFIXES[format] as string;
  const pattern =
    format === 'numbered' ? /^\d+\. / : new RegExp(`^${prefix.replace(/[*.>#-]/g, '\\$&')}`);
  const all = lines.every((line) => pattern.test(line));
  const changed = lines.map((line, index) => {
    if (all) return line.replace(pattern, '');
    const bare = line.replace(/^(#{1,6} |> |- |\d+\. )/, '');
    return (format === 'numbered' ? `${index + 1}. ` : prefix) + bare;
  });
  const block = changed.join('\n');
  return {
    text: text.slice(0, lineStart) + block + text.slice(lineEnd),
    start: lineStart,
    end: lineStart + block.length,
  };
}

/** Applies a format to the selection `start`–`end` of `text`. */
export function applyFormat(
  text: string,
  start: number,
  end: number,
  format: Format,
  placeholders: { text: string; link: string },
): Edit {
  const mark = WRAPS[format];
  if (mark) return wrap(text, start, end, mark, placeholders.text);
  if (format === 'link') {
    const label = text.slice(start, end) || placeholders.text;
    const inserted = `[${label}](https://)`;
    const urlStart = start + label.length + 3;
    return {
      text: text.slice(0, start) + inserted + text.slice(end),
      start: urlStart,
      end: urlStart + 'https://'.length,
    };
  }
  return prefixLines(text, start, end, format);
}

/** Keyboard shortcuts: Ctrl/⌘ + B, I, K, E. */
export function shortcutFormat(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): Format | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null;
  return (
    ({ b: 'bold', i: 'italic', k: 'link', e: 'code' } as const)[event.key.toLowerCase()] ?? null
  );
}
