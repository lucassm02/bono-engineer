/**
 * Stand-in for `@resvg/resvg-js` inside the desktop bundle. The real module is a native addon
 * (a prebuilt .node per platform); loading it lazily means a machine where it cannot load only
 * loses the PNG charts of the MCP tool (a normal tool error) instead of the whole app failing to
 * start. In the packaged app the addon lives in app.asar.unpacked (see electron-builder.yml).
 */

interface ResvgInstance {
  render(): { asPng(): Uint8Array };
}
type ResvgCtor = new (svg: string, options?: unknown) => ResvgInstance;

let real: ResvgCtor | null = null;

function load(): ResvgCtor {
  if (!real) {
    const name = '@resvg/resvg-js'; // not a literal: the bundler must leave it alone
    real = (require(name) as { Resvg: ResvgCtor }).Resvg;
  }
  return real;
}

export class Resvg {
  readonly #inner: ResvgInstance;

  constructor(svg: string, options?: unknown) {
    this.#inner = new (load())(svg, options);
  }

  render(): { asPng(): Uint8Array } {
    return this.#inner.render();
  }
}
