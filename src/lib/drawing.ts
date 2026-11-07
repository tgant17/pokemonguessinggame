// Doodles posted to a room's chat log. A drawing is a list of pen strokes on a small fixed grid rather than
// an image, so it's tiny to send, easy for the room server to check, and stays crisp at any size as SVG.
// Shared by the browser and the room server; keep it free of React/Next and Worker-only imports.

// The drawing pad's grid. Every point is a whole number from 0 up to these, inclusive.
export const DRAWING_WIDTH = 256;
export const DRAWING_HEIGHT = 128;
// Limits on one drawing, so a scribble can't bloat the log that everyone in the room is sent.
export const MAX_DRAWING_POINTS = 600;
export const MAX_DRAWING_STROKES = 150;

// One pen stroke, its points flattened as [x0, y0, x1, y1, …].
export type Stroke = number[];
export type Drawing = Stroke[];

export const countPoints = (drawing: Drawing) => drawing.reduce((sum, stroke) => sum + stroke.length / 2, 0);

// Whether a drawing has used up its points or strokes, so the pad should stop taking ink.
export const isDrawingFull = (drawing: Drawing) =>
  countPoints(drawing) >= MAX_DRAWING_POINTS || drawing.length >= MAX_DRAWING_STROKES;

const onGrid = (value: unknown, max: number) => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= max;

// Checks a drawing sent by a browser. The server trusts nothing it receives.
export const parseDrawing = (value: unknown): Drawing | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_DRAWING_STROKES) return null;
  let points = 0;
  for (const stroke of value) {
    if (!Array.isArray(stroke) || stroke.length < 2 || stroke.length % 2 !== 0) return null;
    points += stroke.length / 2;
    if (points > MAX_DRAWING_POINTS) return null;
    for (let index = 0; index < stroke.length; index += 2) {
      if (!onGrid(stroke[index], DRAWING_WIDTH) || !onGrid(stroke[index + 1], DRAWING_HEIGHT)) return null;
    }
  }
  return value.map((stroke: number[]) => [...stroke]);
};

const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));

// Turns the raw pointer positions of one stroke into what gets sent: points that barely change the line's
// shape are dropped (Ramer–Douglas–Peucker), and the rest are snapped to the grid. A straight line ends up
// as just its two ends, while curves keep enough points to stay round.
export const simplifyStroke = (raw: number[], tolerance = 0.7): Stroke => {
  const count = Math.floor(raw.length / 2);
  if (count === 0) return [];
  const keep = new Uint8Array(count);
  keep[0] = 1;
  keep[count - 1] = 1;
  const spans: [number, number][] = [[0, count - 1]];
  while (spans.length) {
    const [first, last] = spans.pop()!;
    let farthest = -1;
    let farthestDistance = tolerance;
    for (let index = first + 1; index < last; index += 1) {
      const distance = distanceToSegment(
        raw[index * 2],
        raw[index * 2 + 1],
        raw[first * 2],
        raw[first * 2 + 1],
        raw[last * 2],
        raw[last * 2 + 1],
      );
      if (distance > farthestDistance) {
        farthest = index;
        farthestDistance = distance;
      }
    }
    if (farthest !== -1) {
      keep[farthest] = 1;
      spans.push([first, farthest], [farthest, last]);
    }
  }
  const stroke: Stroke = [];
  for (let index = 0; index < count; index += 1) {
    if (!keep[index]) continue;
    const x = Math.round(clamp(raw[index * 2], DRAWING_WIDTH));
    const y = Math.round(clamp(raw[index * 2 + 1], DRAWING_HEIGHT));
    // Points that land on the same grid square as the one before add nothing.
    if (stroke.length && stroke[stroke.length - 2] === x && stroke[stroke.length - 1] === y) continue;
    stroke.push(x, y);
  }
  return stroke;
};

const formatNumber = (value: number) => String(Math.round(value * 10) / 10);

// An SVG path for one stroke. Lines curve through the midpoints between points, so a stroke drawn with few
// points still looks like a smooth pen line rather than a chain of straight segments.
export const strokePath = (stroke: Stroke) => {
  const count = Math.floor(stroke.length / 2);
  if (count === 0) return "";
  const x = (index: number) => formatNumber(stroke[index * 2]);
  const y = (index: number) => formatNumber(stroke[index * 2 + 1]);
  // A tap is a single point: a tiny line with round caps draws it as a dot.
  if (count === 1) return `M${x(0)} ${y(0)}h0.01`;
  let path = `M${x(0)} ${y(0)}`;
  for (let index = 1; index < count - 1; index += 1) {
    const midX = formatNumber((stroke[index * 2] + stroke[index * 2 + 2]) / 2);
    const midY = formatNumber((stroke[index * 2 + 1] + stroke[index * 2 + 3]) / 2);
    path += `Q${x(index)} ${y(index)} ${midX} ${midY}`;
  }
  return `${path}L${x(count - 1)} ${y(count - 1)}`;
};
