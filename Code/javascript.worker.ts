type RunRequest = {
  id: number;
  code: string;
};

type RunResponse = {
  id: number;
  type: "log" | "warn" | "error" | "result" | "done";
  text?: string;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<RunRequest>) => void) | null;
  postMessage(message: RunResponse): void;
};

const workerScope = globalThis as unknown as WorkerScope;

function format(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "function") return `[Function ${value.name || "anonymous"}]`;
  if (value instanceof Error) return value.stack ?? value.message;

  const seen = new WeakSet<object>();
  try {
    const serialized = JSON.stringify(
      value,
      (_key, item: unknown) => {
        if (typeof item === "bigint") return `${item}n`;
        if (typeof item === "object" && item !== null) {
          if (seen.has(item)) return "[Circular]";
          seen.add(item);
        }
        return item;
      },
      2,
    );
    return serialized ?? String(value);
  } catch {
    return String(value);
  }
}

function post(id: number, type: RunResponse["type"], text?: string) {
  workerScope.postMessage({ id, type, ...(text === undefined ? {} : { text }) });
}

workerScope.onmessage = async ({ data }) => {
  const { id, code } = data;
  const originalConsole = globalThis.console;
  const consoleProxy = {
    ...originalConsole,
    log: (...values: unknown[]) => post(id, "log", values.map(format).join(" ")),
    info: (...values: unknown[]) => post(id, "log", values.map(format).join(" ")),
    warn: (...values: unknown[]) => post(id, "warn", values.map(format).join(" ")),
    error: (...values: unknown[]) => post(id, "error", values.map(format).join(" ")),
  };

  try {
    globalThis.console = consoleProxy;
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      body: string,
    ) => () => Promise<unknown>;
    const result = await new AsyncFunction(`"use strict";\n${code}`)();
    if (result !== undefined) post(id, "result", format(result));
  } catch (error) {
    post(id, "error", format(error));
  } finally {
    globalThis.console = originalConsole;
    post(id, "done");
  }
};
