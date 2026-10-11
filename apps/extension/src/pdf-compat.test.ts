import { describe, expect, it } from "vitest";
import { installPdfCompatibility } from "./pdf-compat";

describe("PDF.js Chrome 116 compatibility", () => {
  it("supplies Promise.withResolvers when missing without replacing an existing implementation", async () => {
    class BrowserPromise<T> extends Promise<T> {}
    Object.defineProperty(BrowserPromise, "withResolvers", { value: undefined, configurable: true });
    installPdfCompatibility({ Promise: BrowserPromise });
    const constructor = BrowserPromise as typeof BrowserPromise & { withResolvers: <T>() => { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void } };
    const pending = constructor.withResolvers<number>(); pending.resolve(42);
    expect(pending.promise).toBeInstanceOf(BrowserPromise); expect(await pending.promise).toBe(42);
    const implementation = constructor.withResolvers;
    installPdfCompatibility({ Promise: BrowserPromise }); expect(constructor.withResolvers).toBe(implementation);
    const failed = constructor.withResolvers<number>(); const error = new Error("failed"); failed.reject(error);
    await expect(failed.promise).rejects.toBe(error);
  });
});
