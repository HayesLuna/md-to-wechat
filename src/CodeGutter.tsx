import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  codeLineAt,
  codeLines,
  findCodeFolds,
  type CodeFoldRange,
} from './codeFolding';

export const CODE_LINE_HEIGHT = 22.75;
export function CodeGutter({
  source,
  language,
  starts,
  folds,
  nearViewport,
  first,
  height,
  toggle,
}: {
  source: string;
  language: string;
  starts: number[];
  folds: CodeFoldRange[];
  nearViewport: boolean;
  first: number;
  height: number;
  toggle: (range: CodeFoldRange) => void;
}) {
  const [analysis, setAnalysis] = useState({
    source: '',
    language: '',
    regions: [] as CodeFoldRange[],
  });
  useEffect(() => {
    if (!nearViewport) return;
    const timer = setTimeout(
      () =>
        setAnalysis({
          source,
          language,
          regions: findCodeFolds(source, language),
        }),
      100,
    );
    return () => clearTimeout(timer);
  }, [source, language, nearViewport]);
  const analyzedStarts = useMemo(
    () => codeLines(analysis.source).starts,
    [analysis.source],
  );
  const ranges = analysis.language === language ? analysis.regions : [];
  const stale = analysis.source !== source;
  const regions = new Map(
    ranges.map((range) => [
      codeLineAt(analyzedStarts, range.from),
      { range, stale, end: codeLineAt(analyzedStarts, range.to) },
    ]),
  );
  for (const range of folds)
    regions.set(codeLineAt(starts, range.from), {
      range,
      stale: false,
      end: codeLineAt(starts, range.to),
    });
  const segments = useMemo(() => {
    const segments: { start: number; end: number; visual: number }[] = [];
    let line = 0,
      visual = 0;
    for (const fold of [...folds].sort(
      (a, b) => a.from - b.from || b.to - a.to,
    )) {
      const start = codeLineAt(starts, fold.from) + 1,
        end = codeLineAt(starts, fold.to);
      if (start < line || end < start) continue;
      segments.push({ start: line, end: start, visual });
      visual += start - line;
      line = end + 1;
    }
    segments.push({ start: line, end: starts.length, visual });
    return { segments, count: visual + starts.length - line };
  }, [starts, folds]);
  const begin = Math.max(0, first - 3),
    end = Math.min(
      segments.count,
      first + Math.ceil(height / CODE_LINE_HEIGHT) + 4,
    );
  const rows = [];
  for (let visual = begin; visual < end; visual++) {
    const segment = segments.segments.find(
      (segment) =>
        visual >= segment.visual &&
        visual < segment.visual + segment.end - segment.start,
    );
    if (!segment) continue;
    const line = segment.start + visual - segment.visual;
    const region = regions.get(line);
    const range = region?.range;
    const folded =
      range &&
      folds.some((fold) => fold.from === range.from && fold.to === range.to);
    rows.push(
      <div
        className="code-gutter-row"
        data-line={line + 1}
        key={line}
        style={{ top: 16 + visual * CODE_LINE_HEIGHT }}
      >
        <span>{line + 1}</span>
        {range ? (
          <button
            type="button"
            className="code-fold-toggle"
            aria-label={`${folded ? '展开' : '折叠'}第 ${line + 1}–${region!.end + 1} 行代码`}
            aria-expanded={!folded}
            disabled={region!.stale}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => toggle(range)}
          >
            {folded ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
        ) : (
          <span className="code-fold-space" />
        )}
      </div>,
    );
  }
  return (
    <div
      className="code-gutter"
      contentEditable={false}
      aria-label="代码行号"
      style={{
        width: `calc(${String(starts.length).length}ch + 28px)`,
        height: segments.count * CODE_LINE_HEIGHT + 32,
      }}
    >
      {rows}
    </div>
  );
}
