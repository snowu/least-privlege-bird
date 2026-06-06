// The UI files (game.ts, clave.ts, scores.ts) are ported from loose JS that freely
// reads .value/.checked/.disabled off getElementById() and treats the AudioContext
// vendor prefix as present. Rather than cast every DOM call site (no runtime payoff —
// esbuild strips types anyway), narrow getElementById to `any` project-wide, matching
// the original JS semantics. The physics core does no DOM access and stays fully typed.
interface Document {
  getElementById(elementId: string): any;
}
interface Window {
  webkitAudioContext: typeof AudioContext;
}
