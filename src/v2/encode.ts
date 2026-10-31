/**
 * Input log encoding: every int zigzagged, written as an unsigned LEB128
 * varint, compressed with deflate-raw when the browser has CompressionStream,
 * then base64.
 */

export const ENC_DEFLATE = 'zz-varint+deflate+base64';
export const ENC_PLAIN = 'zz-varint+base64';

export interface Encoded {
    enc: string;
    data: string;
}

export const zz = (n: number): number => (n << 1) ^ (n >> 31);

export function writeVarint(out: number[], v: number): void {
    v >>>= 0;
    while (v > 127) {
        out.push((v & 127) | 128);
        v >>>= 7;
    }
    out.push(v);
}

export function toVarintBytes(ints: number[]): Uint8Array {
    const out: number[] = [];
    for (let i = 0; i < ints.length; i++) writeVarint(out, zz(ints[i] | 0));
    return new Uint8Array(out);
}

export function toBase64(bytes: Uint8Array, btoaFn: (s: string) => string): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        const part = bytes.subarray(i, Math.min(i + chunk, bytes.length));
        binary += String.fromCharCode.apply(null, Array.prototype.slice.call(part) as number[]);
    }
    return btoaFn(binary);
}

/** deflate-raw through CompressionStream, or null when the browser has none. */
export function deflateRaw(bytes: Uint8Array, CompressionStreamCtor: any): Promise<Uint8Array> | null {
    if (typeof CompressionStreamCtor !== 'function') return null;
    let stream: any;
    try {
        stream = new CompressionStreamCtor('deflate-raw');
    } catch {
        return null;
    }
    const writer = stream.writable.getWriter();
    writer.write(bytes);
    writer.close();

    const reader = stream.readable.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    function pump(): Promise<Uint8Array> {
        return reader.read().then(function (result: { done: boolean; value?: Uint8Array }) {
            if (result.done) {
                const joined = new Uint8Array(total);
                let offset = 0;
                for (let i = 0; i < chunks.length; i++) {
                    joined.set(chunks[i], offset);
                    offset += chunks[i].length;
                }
                return joined;
            }
            if (result.value) {
                chunks.push(result.value);
                total += result.value.length;
            }
            return pump();
        });
    }
    return pump();
}

export function encodeInts(ints: number[], btoaFn: (s: string) => string, CompressionStreamCtor: any): Promise<Encoded> {
    const raw = toVarintBytes(ints);
    const plain = function (): Encoded {
        return { enc: ENC_PLAIN, data: toBase64(raw, btoaFn) };
    };
    const deflated = deflateRaw(raw, CompressionStreamCtor);
    if (!deflated) return Promise.resolve(plain());
    return deflated.then(
        function (bytes) {
            return { enc: ENC_DEFLATE, data: toBase64(bytes, btoaFn) };
        },
        plain
    );
}
