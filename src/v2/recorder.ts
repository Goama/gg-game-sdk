/**
 * The input diary: one row of 8 ints per input, deltas against the previous
 * row so the log compresses well.
 *
 * Row types 0-14 are as in the handover's input log encoding. 15 is new:
 * the session was reseeded by GG_NEW_SESSION (play again without a reload).
 * Its x holds how many Math.random draws the game made between the previous
 * game over and the reseed, which a replay needs to line the streams up.
 */

export const FIELDS = ['dt', 'df', 'type', 'x', 'y', 'pid', 'ptype', 'flags'];

export const ROW = {
    POINTER_DOWN: 0,
    POINTER_UP: 1,
    POINTER_MOVE: 2,
    POINTER_CANCEL: 3,
    KEY_DOWN: 4,
    KEY_UP: 5,
    WHEEL: 6,
    BLUR: 7,
    FOCUS: 8,
    VIEWPORT_RESIZE: 9,
    CANVAS_RESIZE: 10,
    PAGE_HIDDEN: 11,
    PAGE_VISIBLE: 12,
    PAUSE: 13,
    RESUME: 14,
    RESEED: 15,
};

export const PTYPE = { mouse: 0, touch: 1, pen: 2, none: 3 };

export const FLAG = { TRUSTED: 1, PRIMARY: 2, REPEAT: 4, BUTTON_HELD: 8 };

export const MOVE_ROW_LIMIT = 40000;
export const ROW_LIMIT = 60000;

export class Recorder {
    rows: number[] = [];
    count = 0;
    truncated = false;
    keys: string[] = [];
    private keyIndexes: { [code: string]: number } = {};
    private lastT = 0;
    private lastFrame = 0;

    constructor(private startT: number) {}

    add(t: number, frame: number, type: number, x: number, y: number, pid: number, ptype: number, flags: number): boolean {
        if (this.count >= ROW_LIMIT) {
            this.truncated = true;
            return false;
        }
        if (type === ROW.POINTER_MOVE && this.count >= MOVE_ROW_LIMIT) return false;
        const tInt = Math.max(this.lastT, Math.round(t - this.startT));
        this.rows.push(tInt - this.lastT, frame - this.lastFrame, type, x | 0, y | 0, pid | 0, ptype | 0, flags | 0);
        this.lastT = tInt;
        this.lastFrame = frame;
        this.count++;
        return true;
    }

    keyIndex(code: string): number {
        if (!Object.prototype.hasOwnProperty.call(this.keyIndexes, code)) {
            this.keyIndexes[code] = this.keys.length;
            this.keys.push(code);
        }
        return this.keyIndexes[code];
    }
}

/** The same diary without pointer moves, for runs too big to send whole. */
export function withoutMoves(rows: number[]): number[] {
    const out: number[] = [];
    let carryDt = 0;
    let carryDf = 0;
    for (let i = 0; i < rows.length; i += 8) {
        if (rows[i + 2] === ROW.POINTER_MOVE) {
            carryDt += rows[i];
            carryDf += rows[i + 1];
            continue;
        }
        out.push(rows[i] + carryDt, rows[i + 1] + carryDf);
        for (let j = 2; j < 8; j++) out.push(rows[i + j]);
        carryDt = 0;
        carryDf = 0;
    }
    return out;
}
