/**
 * A board series' name as the API writes it ("Cambridge International November
 * 2026", "Pearson Edexcel January 2027 (IAL)"), split into its own nodes so the
 * page translator (lib/i18n.tsx) turns the month into Arabic while the board's
 * name and its label stay as the board writes them. Used by the candidates and
 * the deadlines screens.
 */

import { BoardText } from '../exam-f4-shared';

const SERIES_NAME = /^(.*?)\s*(January|June|October|November) (\d{4})(?: \((.+)\))?$/;

export function SeriesWords({ name, className }: { name: string; className?: string }): React.JSX.Element {
  const m = SERIES_NAME.exec(name);
  if (!m) return <BoardText className={className}>{name}</BoardText>;
  return (
    <span className={className}>
      {m[1] ? <><BoardText>{m[1]}</BoardText> </> : null}
      <span>{m[2]}</span> <span dir="ltr">{m[3]}</span>
      {m[4] ? <> <span className="text-muted-foreground">(<BoardText>{m[4]}</BoardText>)</span></> : null}
    </span>
  );
}
