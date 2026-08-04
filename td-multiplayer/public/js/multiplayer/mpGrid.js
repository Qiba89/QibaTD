import { CELL, LANE_COLS, LANE_ROWS, PATH_ROW } from './mpConstants.js';

export function cellFromPixel(x, y) { return { c: Math.floor(x / CELL), r: Math.floor(y / CELL) }; }
export function cellCenter(c, r) { return { x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }; }
export function isBuildable(c, r) { return c >= 0 && r >= 0 && c < LANE_COLS && r < LANE_ROWS && r !== PATH_ROW; }
