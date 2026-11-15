// Types for readingTerms.mjs (plain ESM, shared by the browser bundle and Node).
export declare const READING_TERMS: RegExp[];
export declare const READING_REPLACEMENT: string;
export declare const MODEL_TEXT_HEADING: string;
export declare function hasReadingTerms(text: string): boolean;
export declare function guardModelText(text: string): { text: string; replaced: boolean };
