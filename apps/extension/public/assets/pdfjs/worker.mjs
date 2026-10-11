/* Chrome 116 lacks Promise.withResolvers, which PDF.js 6's legacy worker assumes. */
if (typeof Promise.withResolvers !== "function") {
  Object.defineProperty(Promise, "withResolvers", {
    configurable: true,
    writable: true,
    value: function () {
      let resolve, reject;
      const promise = new this((accept, decline) => { resolve = accept; reject = decline; });
      return { promise, resolve, reject };
    },
  });
}
export const WorkerMessageHandler = (await import("./pdf.worker.min.mjs")).WorkerMessageHandler;
