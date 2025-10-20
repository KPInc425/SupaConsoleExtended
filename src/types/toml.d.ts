declare module '@iarna/toml' {
  export function parse(input: string): unknown
  export function stringify(obj: unknown): string
  const toml: { parse: (s: string) => unknown; stringify: (o: unknown) => string }
  export default toml
}
