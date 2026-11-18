/** Minimal types for word-extractor (reads legacy Word .doc files; no published types). */
declare module "word-extractor" {
  class WordDocument {
    getBody(): string;
  }

  export default class WordExtractor {
    extract(source: string | Buffer): Promise<WordDocument>;
  }
}
