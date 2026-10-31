/**
 * Seeded randomness. Math.random draws from mulberry32(seed); ggSDK.random()
 * draws from a second stream so a game's own gameplay draws can be told apart.
 */

export const GAMEPLAY_SALT = 0x9E3779B9;

export function mulberry32(seed: number): () => number {
    let a = seed;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export function gameplaySeed(seed: number): number {
    return (seed ^ GAMEPLAY_SALT) >>> 0;
}
