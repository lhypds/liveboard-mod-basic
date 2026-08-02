import { loadPyodide, version, type PyodideAPI } from "pyodide";
import type { PyProxy } from "pyodide/ffi";

type RunRequest = {
  id: number;
  code: string;
  interpreter: boolean;
  warmup?: boolean;
};

type RunResponse = {
  id: number;
  type: "ready" | "progress" | "banner" | "stdout" | "stderr" | "result" | "error" | "done";
  text?: string;
};

type WorkerScope = {
  onmessage: ((event: MessageEvent<RunRequest>) => void) | null;
  postMessage(message: RunResponse): void;
};

const workerScope = globalThis as unknown as WorkerScope;
let pyodidePromise: Promise<PyodideAPI> | null = null;
let interpreterGlobals: PyProxy | null = null;
let activeId = 0;
let bannerPosted = false;

function post(id: number, type: RunResponse["type"], text?: string) {
  workerScope.postMessage({ id, type, ...(text === undefined ? {} : { text }) });
}

function ensurePyodide(id: number): Promise<PyodideAPI> {
  if (!pyodidePromise) {
    post(id, "progress", "Downloading Python…");
    pyodidePromise = (async () => {
      const pyodide = await loadPyodide({
        indexURL: `https://cdn.jsdelivr.net/pyodide/v${version}/full/`,
        stdout: (message) => {
          if (activeId) post(activeId, "stdout", message);
        },
        stderr: (message) => {
          if (activeId) post(activeId, "stderr", message);
        },
      });
      post(activeId || id, "progress", "Python download complete.");
      return pyodide;
    })();
  }
  return pyodidePromise;
}

function pythonBanner(pyodide: PyodideAPI): string {
  return String(pyodide.runPython(`
import sys
f'''Python {sys.version} on {sys.platform}
Type "help", "copyright", "credits" or "license" for more information.'''
`));
}

function resultText(result: unknown): string {
  if (result === undefined || result === null) return "";
  try {
    return String(result);
  } finally {
    if (typeof result === "object" && "destroy" in result && typeof result.destroy === "function") {
      result.destroy();
    }
  }
}

workerScope.onmessage = async ({ data }) => {
  const { id, code, interpreter, warmup } = data;

  if (warmup) {
    try {
      const pyodide = await ensurePyodide(id);
      if (interpreter) {
        post(id, "banner", pythonBanner(pyodide));
        bannerPosted = true;
      }
      post(id, "ready");
    } catch (error) {
      post(id, "error", error instanceof Error ? error.message : String(error));
    } finally {
      post(id, "done");
    }
    return;
  }

  activeId = id;
  let disposableGlobals: PyProxy | null = null;

  try {
    const pyodide = await ensurePyodide(id);
    if (interpreter && !bannerPosted) {
      post(id, "banner", pythonBanner(pyodide));
      bannerPosted = true;
    }
    post(id, "ready");
    await pyodide.loadPackagesFromImports(code);

    let globals: PyProxy;
    if (interpreter) {
      interpreterGlobals ??= pyodide.runPython("dict()") as PyProxy;
      globals = interpreterGlobals;
    } else {
      disposableGlobals = pyodide.runPython("dict()") as PyProxy;
      globals = disposableGlobals;
    }

    const result = await pyodide.runPythonAsync(code, { globals, filename: "<code>" });
    const text = resultText(result);
    if (text) post(id, "result", text);
  } catch (error) {
    post(id, "error", error instanceof Error ? error.message : String(error));
  } finally {
    disposableGlobals?.destroy();
    activeId = 0;
    post(id, "done");
  }
};
