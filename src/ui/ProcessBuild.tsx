import { setUi, useStore } from "../store";
import { BuildStage, buildStatusSchema, ExtendAction } from "../wire";
import { showProcess } from "./navigation";
import { parseProcessId, processIds } from "../model/ids";

const tellServer = (body: ExtendAction) => fetch("/api/extend", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// A finished build reloads the page, so what happened is asked for again on the way back in.
export function followBuilds() {
  void fetch("/api/extend", { cache: "no-store" })
    .then((response) => (response.ok ? response.json() : null))
    .then((raw: unknown) => setUi({ build: raw === null ? null : buildStatusSchema.parse(raw) }))
    .catch(() => undefined);
  import.meta.hot?.on("bodylang:build", (raw: unknown) => setUi({ build: buildStatusSchema.parse(raw) }));
}

export async function removeAddedProcess(processId: string) {
  const response = await tellServer({ action: "remove", id: parseProcessId(processId).ref }).catch(() => null);
  if (!response?.ok) setUi({ dayProblem: `That process could not be removed. ${(await response?.text()) ?? "Is the dev server running?"}` });
}

const WORKING: Partial<Record<BuildStage, string>> = {
  writing: "A separate Claude session is writing it.",
  testing: "Running its tests.",
  final: "Running every test before it goes in.",
};

const dismiss = () => {
  setUi({ build: null });
  void tellServer({ action: "dismiss" });
};

// Where a process being added has got to. It stays small, because you can keep using everything else.
export function BuildLine() {
  const build = useStore((s) => s.build);
  if (!build) return null;
  const { stage, title, message, id } = build;
  const working = WORKING[stage];
  if (working) {
    return (
      <p className="build-line" data-working="" role="status">
        <span>
          Adding {title}. {working}
        </span>
        <button type="button" className="link" onClick={() => void tellServer({ action: "stop" })}>
          Stop
        </button>
      </p>
    );
  }
  if (stage === "ready") {
    return (
      <p className="build-line" role="status">
        <span>{title} passed its tests and is on your body.</span>
        <button
          type="button"
          className="link"
          onClick={() => {
            dismiss();
            showProcess(processIds.added(id));
          }}
        >
          Show it
        </button>
      </p>
    );
  }
  return (
    <p className="build-line" data-failed={stage === "failed" || undefined} role="status">
      <span>{stage === "failed" ? `Couldn't add ${title}. ${message ?? ""}` : `Stopped adding ${title}.`}</span>
      <button type="button" className="link" onClick={dismiss}>
        Dismiss
      </button>
    </p>
  );
}
