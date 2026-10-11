/** PDF.js 6's legacy bundle includes newer iterator/base64 shims but assumes this API. */
export function installPdfCompatibility(scope: Pick<typeof globalThis, "Promise"> = globalThis) {
  const constructor = scope.Promise as PromiseConstructor & { withResolvers?: () => unknown };
  if (typeof constructor.withResolvers !== "function") Object.defineProperty(constructor, "withResolvers", {
    configurable: true, writable: true,
    value: function <T>(this: PromiseConstructor) {
      let resolve!: (value: T | PromiseLike<T>) => void, reject!: (reason?: unknown) => void;
      const promise = new this<T>((accept, decline) => { resolve = accept; reject = decline; });
      return { promise, resolve, reject };
    },
  });
}
installPdfCompatibility();
