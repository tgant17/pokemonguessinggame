import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DRAWING_HEIGHT,
  DRAWING_WIDTH,
  MAX_DRAWING_POINTS,
  MAX_DRAWING_STROKES,
  countPoints,
  isDrawingFull,
  parseDrawing,
  simplifyStroke,
  strokePath,
} from "./drawing.ts";

test("a straight line drawn with many points is sent as just its two ends", () => {
  const raw = Array.from({ length: 50 }, (_, index) => [10 + index * 2.03, 20 + index * 0.51]).flat();
  assert.deepEqual(simplifyStroke(raw), [10, 20, 109, 45]);
});

test("simplifying keeps the corners and curves that give a stroke its shape", () => {
  // An L: along the top, then straight down.
  const raw = [
    ...Array.from({ length: 20 }, (_, index) => [index * 5, 10]).flat(),
    ...Array.from({ length: 20 }, (_, index) => [100, 10 + (index + 1) * 5]).flat(),
  ];
  assert.deepEqual(simplifyStroke(raw), [0, 10, 95, 10, 100, 15, 100, 110]);

  const circle = Array.from({ length: 120 }, (_, index) => {
    const angle = (index / 119) * Math.PI * 2;
    return [128 + Math.cos(angle) * 40, 64 + Math.sin(angle) * 40];
  }).flat();
  const simplified = simplifyStroke(circle);
  assert.ok(simplified.length / 2 < 40, "a circle needs far fewer points than the pointer reported");
  assert.ok(simplified.length / 2 > 12, "but enough to stay round");
});

test("simplified points are whole numbers on the grid, with repeats dropped", () => {
  assert.deepEqual(simplifyStroke([-5, -3, 300.4, 200]), [0, 0, DRAWING_WIDTH, DRAWING_HEIGHT]);
  assert.deepEqual(simplifyStroke([12.2, 30.4]), [12, 30], "a tap is a one-point stroke");
  assert.deepEqual(simplifyStroke([12.2, 30.4, 12.4, 29.8]), [12, 30], "a wiggle on one spot is still a dot");
  assert.deepEqual(simplifyStroke([]), []);
});

test("strokes become smooth SVG paths, and taps become dots", () => {
  assert.equal(strokePath([5, 6]), "M5 6h0.01");
  assert.equal(strokePath([0, 0, 10, 10]), "M0 0L10 10");
  assert.equal(strokePath([0, 0, 10, 0, 10, 10]), "M0 0Q10 0 10 5L10 10");
  assert.equal(strokePath([]), "");
});

test("drawings from browsers are checked before anyone sees them", () => {
  assert.deepEqual(parseDrawing([[1, 2, 3, 4], [5, 6]]), [[1, 2, 3, 4], [5, 6]]);
  assert.deepEqual(parseDrawing([[0, 0, DRAWING_WIDTH, DRAWING_HEIGHT]]), [[0, 0, DRAWING_WIDTH, DRAWING_HEIGHT]]);

  assert.equal(parseDrawing([]), null, "an empty page isn't a drawing");
  assert.equal(parseDrawing("M0 0L10 10"), null);
  assert.equal(parseDrawing([[1, 2, 3]]), null, "every point has an x and a y");
  assert.equal(parseDrawing([[]]), null);
  assert.equal(parseDrawing([[1.5, 2]]), null, "points sit on the grid");
  assert.equal(parseDrawing([[-1, 2]]), null);
  assert.equal(parseDrawing([[DRAWING_WIDTH + 1, 2]]), null);
  assert.equal(parseDrawing([[1, DRAWING_HEIGHT + 1]]), null);
  assert.equal(parseDrawing([["1", 2]]), null);
  assert.equal(parseDrawing([{ 0: 1, 1: 2, length: 2 }]), null);

  const tooManyPoints = [Array.from({ length: MAX_DRAWING_POINTS + 1 }, () => [1, 1]).flat()];
  assert.equal(parseDrawing(tooManyPoints), null);
  const tooManyStrokes = Array.from({ length: MAX_DRAWING_STROKES + 1 }, () => [1, 1]);
  assert.equal(parseDrawing(tooManyStrokes), null);
});

test("a drawing is full once it uses up its points or strokes", () => {
  assert.equal(countPoints([[1, 2, 3, 4], [5, 6]]), 3);
  assert.equal(isDrawingFull([[1, 2, 3, 4]]), false);
  assert.equal(isDrawingFull([Array.from({ length: MAX_DRAWING_POINTS }, () => [1, 1]).flat()]), true);
  assert.equal(isDrawingFull(Array.from({ length: MAX_DRAWING_STROKES }, () => [1, 1])), true);
});
