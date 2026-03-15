import React from 'react';

const renderInline = (text: string): React.ReactNode[] => {
  const parts: React.ReactNode[] = [];
  const regex = /\*\*(.+?)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push(<strong key={idx++}>{match[1]}</strong>);
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
};

export const FormatText: React.FC<{ text: string }> = ({ text }) => {
  const blocks = text.split(/\n\n+/);
  return (
    <div className="explain-formatted">
      {blocks.map((block, bi) => {
        const trimmed = block.trim();
        if (!trimmed) return null;
        const lines = trimmed.split(/\n/).map(l => l.trim()).filter(Boolean);
        const isList = lines.length > 1 && lines.every(l => /^[-\u2022*\d]+[.):\s]/.test(l));
        if (isList) {
          return (
            <ul key={bi} className="explain-formatted-list">
              {lines.map((line, li) => (
                <li key={li}>{renderInline(line.replace(/^[-\u2022*\d]+[.):\s]+/, ''))}</li>
              ))}
            </ul>
          );
        }
        const headingMatch = trimmed.match(/^#{1,3}\s+(.+?)(?:\n|$)/);
        if (headingMatch) {
          const rest = trimmed.slice(headingMatch[0].length).trim();
          return (
            <React.Fragment key={bi}>
              <h4 className="explain-formatted-heading">{renderInline(headingMatch[1] ?? '')}</h4>
              {rest && <p className="explain-formatted-para">{renderInline(rest)}</p>}
            </React.Fragment>
          );
        }
        return (
          <p key={bi} className="explain-formatted-para">{renderInline(trimmed.replace(/\n/g, ' '))}</p>
        );
      })}
    </div>
  );
};
