import type { ReactNode } from "react";

interface TagProps {
  part: string;
  x: number;
  y: number;
  anchor?: "start" | "end";
  children: ReactNode;
}

// A word sitting right on the thing it names, so nobody has to look away to a legend. It appears when that
// thing does, which also means a step only ever names what it is showing.
export const Tag = ({ part, x, y, anchor = "start", children }: TagProps) => (
  <text data-part={part} className="part-tag" x={x} y={y} textAnchor={anchor} dominantBaseline="central">
    {children}
  </text>
);
