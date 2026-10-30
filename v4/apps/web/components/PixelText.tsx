/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { PixelWait } from './PixelLoaders';

/*
 * Squik's display lettering, drawn on the wordmark's grid rather than set in a
 * font: one-unit strokes, square corners, a five-row x-height (rows 2-6) with
 * ascenders and capitals on rows 0-6 and descenders on rows 7-8. Accents over
 * capitals sit on rows -2 and -1, above the box, so they never push lines
 * apart. Digits keep cut corners, so 5 never reads as S or 2 as Z.
 *
 * Each glyph is its rows from `top`, '#' for ink. Glyphs are as wide as their
 * rows; one empty unit separates letters.
 */
type Glyph = { top: number; rows: string[] };

const g = (top: number, ...rows: string[]): Glyph => ({ top, rows });

const BOX = ['#####', '#...#', '#...#', '#...#', '#####'];
const C_BOX = ['#####', '#....', '#....', '#....', '#####'];
const G_LOW = ['#####', '#...#', '#...#', '#...#', '#####', '....#', '#####'];
const S_LOW = ['#####', '#....', '#####', '....#', '#####'];
const CEDILLA = ['..#..', '.##..'];
const O_CAP = ['#####', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'];
const S_CAP = ['#####', '#....', '#....', '#####', '....#', '....#', '#####'];
const C_CAP = ['#####', '#....', '#....', '#....', '#....', '#....', '#####'];
const G_CAP = ['#####', '#....', '#....', '#.###', '#...#', '#...#', '#####'];
const U_CAP = ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '#####'];
const I_CAP = ['###', '.#.', '.#.', '.#.', '.#.', '.#.', '###'];

const GLYPHS: Record<string, Glyph> = {
  a: g(2, '#####', '....#', '#####', '#...#', '#####'),
  b: g(0, '#....', '#....', ...BOX),
  c: g(2, ...C_BOX),
  ç: g(2, ...C_BOX, ...CEDILLA),
  d: g(0, '....#', '....#', ...BOX),
  e: g(2, '#####', '#...#', '#####', '#....', '#####'),
  f: g(0, '.###', '.#..', '####', '.#..', '.#..', '.#..', '.#..'),
  g: g(2, ...G_LOW),
  ğ: g(0, '#...#', '.###.', ...G_LOW),
  h: g(0, '#....', '#....', '#####', '#...#', '#...#', '#...#', '#...#'),
  i: g(0, '#', '.', '#', '#', '#', '#', '#'),
  ı: g(2, '#', '#', '#', '#', '#'),
  j: g(0, '..#', '...', '..#', '..#', '..#', '..#', '..#', '..#', '###'),
  k: g(0, '#....', '#....', '#...#', '#..#.', '###..', '#..#.', '#...#'),
  l: g(0, '#.', '#.', '#.', '#.', '#.', '#.', '##'),
  m: g(2, '#######', '#..#..#', '#..#..#', '#..#..#', '#..#..#'),
  n: g(2, '#####', '#...#', '#...#', '#...#', '#...#'),
  o: g(2, ...BOX),
  ö: g(0, '.#.#.', '.....', ...BOX),
  p: g(2, ...BOX, '#....', '#....'),
  q: g(2, ...BOX, '....#', '....#'),
  r: g(2, '####', '#...', '#...', '#...', '#...'),
  s: g(2, ...S_LOW),
  ş: g(2, ...S_LOW, ...CEDILLA),
  t: g(0, '.#..', '.#..', '####', '.#..', '.#..', '.#..', '.###'),
  u: g(2, '#...#', '#...#', '#...#', '#...#', '#####'),
  ü: g(0, '.#.#.', '.....', '#...#', '#...#', '#...#', '#...#', '#####'),
  v: g(2, '#...#', '#...#', '#...#', '.#.#.', '..#..'),
  w: g(2, '#..#..#', '#..#..#', '#..#..#', '#..#..#', '#######'),
  x: g(2, '#...#', '.#.#.', '..#..', '.#.#.', '#...#'),
  y: g(2, '#...#', '#...#', '#...#', '#...#', '#####', '....#', '#####'),
  z: g(2, '#####', '...#.', '..#..', '.#...', '#####'),

  A: g(0, '#####', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
  B: g(0, '####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'),
  C: g(0, ...C_CAP),
  Ç: g(0, ...C_CAP, ...CEDILLA),
  D: g(0, '####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'),
  E: g(0, '#####', '#....', '#....', '####.', '#....', '#....', '#####'),
  F: g(0, '#####', '#....', '#....', '####.', '#....', '#....', '#....'),
  G: g(0, ...G_CAP),
  Ğ: g(-2, '#...#', '.###.', ...G_CAP),
  H: g(0, '#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'),
  I: g(0, ...I_CAP),
  İ: g(-2, '.#.', '...', ...I_CAP),
  J: g(0, '....#', '....#', '....#', '....#', '....#', '#...#', '#####'),
  K: g(0, '#...#', '#..#.', '#.#..', '###..', '#.#..', '#..#.', '#...#'),
  L: g(0, '#....', '#....', '#....', '#....', '#....', '#....', '#####'),
  M: g(0, '#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'),
  N: g(0, '#...#', '##..#', '##..#', '#.#.#', '#..##', '#..##', '#...#'),
  O: g(0, ...O_CAP),
  Ö: g(-2, '.#.#.', '.....', ...O_CAP),
  P: g(0, '#####', '#...#', '#...#', '#####', '#....', '#....', '#....'),
  Q: g(0, '#####', '#...#', '#...#', '#...#', '#...#', '#..#.', '###.#'),
  R: g(0, '#####', '#...#', '#...#', '#####', '#..#.', '#...#', '#...#'),
  S: g(0, ...S_CAP),
  Ş: g(0, ...S_CAP, ...CEDILLA),
  T: g(0, '#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'),
  U: g(0, ...U_CAP),
  Ü: g(-2, '.#.#.', '.....', ...U_CAP),
  V: g(0, '#...#', '#...#', '#...#', '#...#', '.#.#.', '.#.#.', '..#..'),
  W: g(0, '#..#..#', '#..#..#', '#..#..#', '#..#..#', '#..#..#', '#..#..#', '#######'),
  X: g(0, '#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'),
  Y: g(0, '#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'),
  Z: g(0, '#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'),

  '0': g(0, '.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'),
  '1': g(0, '.#.', '##.', '.#.', '.#.', '.#.', '.#.', '###'),
  '2': g(0, '.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'),
  '3': g(0, '.###.', '#...#', '....#', '..##.', '....#', '#...#', '.###.'),
  '4': g(0, '...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'),
  '5': g(0, '#####', '#....', '####.', '....#', '....#', '#...#', '.###.'),
  '6': g(0, '.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'),
  '7': g(0, '#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'),
  '8': g(0, '.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'),
  '9': g(0, '.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'),

  '!': g(0, '#', '#', '#', '#', '#', '.', '#'),
  '?': g(0, '#####', '....#', '....#', '..###', '..#..', '.....', '..#..'),
  '.': g(6, '#'),
  ',': g(6, '#', '#'),
  ':': g(3, '#', '.', '#'),
  '…': g(6, '#.#.#'),
  '-': g(4, '###'),
  '—': g(4, '#####'),
  '·': g(4, '#'),
  "'": g(0, '#', '#'),
  '’': g(0, '#', '#'),
  '%': g(0, '##..#', '##..#', '...#.', '..#..', '.#...', '#..##', '#..##'),
};

/** True when every character of every part can be drawn. */
function drawable(text: string): boolean {
  for (const ch of text) if (ch !== ' ' && !(ch in GLYPHS)) return false;
  return true;
}

type Run = { d: string; className?: string };
type Word = { width: number; runs: Run[] };

/** One word as SVG path data per colour, laid out left to right. */
function layoutWord(chars: { ch: string; className?: string }[]): Word {
  const paths = new Map<string | undefined, string[]>();
  let x = 0;
  chars.forEach(({ ch, className }, index) => {
    const glyph = GLYPHS[ch];
    const width = Math.max(...glyph.rows.map((row) => row.length));
    const d = paths.get(className) ?? [];
    glyph.rows.forEach((row, r) => {
      // Runs of ink in a row become one rectangle each.
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== '#') continue;
        let end = c;
        while (row[end + 1] === '#') end++;
        d.push(`M${x + c} ${glyph.top + r}h${end - c + 1}v1h${c - end - 1}z`);
        c = end;
      }
    });
    paths.set(className, d);
    x += width + (index < chars.length - 1 ? 1 : 0);
  });
  return { width: x, runs: [...paths].map(([className, d]) => ({ className, d: d.join('') })) };
}

export interface PixelTextPart {
  text: string;
  className?: string;
}

interface PixelTextProps {
  /** The line, whole or in coloured parts; parts join with no space between. */
  parts: PixelTextPart[] | string;
  className?: string;
  /** A trailing "…" becomes dots that draw in turn, for a line that waits. */
  waiting?: boolean;
}

/**
 * A display line in Squik's drawn lettering. Words wrap like text; the unit
 * (one grid square, in px) comes from `--pixel-unit` so CSS sizes it at whole
 * pixels. Screen readers get the text itself. A line with a character the
 * alphabet doesn't have (a name, another script) falls back to the font.
 */
export default function PixelText({ parts, className = '', waiting = false }: PixelTextProps) {
  const list = typeof parts === 'string' ? [{ text: parts }] : parts;
  const text = list.map((part) => part.text).join('');
  const last = list[list.length - 1];
  const animateWait = waiting && last?.text.endsWith('…');
  const drawn = animateWait ? [...list.slice(0, -1), { ...last, text: last.text.slice(0, -1) }] : list;

  if (!drawable(text)) {
    return (
      <span className={className}>
        {list.map((part, i) => (
          <span key={i} className={part.className}>
            {part.text}
          </span>
        ))}
      </span>
    );
  }

  const words: { ch: string; className?: string }[][] = [[]];
  for (const part of drawn) {
    for (const ch of part.text) {
      if (ch === ' ') {
        if (words[words.length - 1].length) words.push([]);
      } else {
        words[words.length - 1].push({ ch, className: part.className });
      }
    }
  }

  return (
    <span className={`pixel-text ${className}`.trim()}>
      <span className="sr-only">{text}</span>
      {words
        .filter((word) => word.length)
        .map((chars, i, all) => {
          const word = layoutWord(chars);
          const svg = (
            <svg
              key={i}
              className="pixel-text-word"
              viewBox={`0 0 ${word.width} 9`}
              style={{ '--pixel-width': word.width } as React.CSSProperties}
              shapeRendering="crispEdges"
              aria-hidden="true"
              focusable="false"
            >
              {word.runs.map((run, j) => (
                <path key={j} className={run.className} fill="currentColor" d={run.d} />
              ))}
            </svg>
          );
          // The dots hold to the last word, one unit apart, as a "…" would.
          return animateWait && i === all.length - 1 ? (
            <span key={i} className="pixel-text-tail">
              {svg}
              <PixelWait />
            </span>
          ) : (
            svg
          );
        })}
    </span>
  );
}
