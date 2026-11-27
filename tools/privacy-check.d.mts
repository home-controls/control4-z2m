export interface Hit {
    line: number;
    pattern: number;
    exif?: boolean;
}
export function parsePatterns(text: string): RegExp[];
export function hitsIn(text: string, patterns: RegExp[]): Hit[];
export function hitsInFile(name: string, buf: Buffer, patterns: RegExp[]): Hit[];
export function describe(where: string, hit: Hit): string;
