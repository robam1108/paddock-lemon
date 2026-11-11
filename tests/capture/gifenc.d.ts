// gifenc 는 타입 선언을 싣지 않는다. 시연 GIF 를 만드는 데 쓰는 부분만 적는다.
declare module "gifenc" {
  type Palette = number[][];
  export function quantize(rgba: Uint8Array | Uint8ClampedArray, maxColors: number): Palette;
  export function applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: Palette): Uint8Array;
  export function GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, opts: { palette: Palette; delay?: number }): void;
    finish(): void;
    bytes(): Uint8Array;
  };
}
