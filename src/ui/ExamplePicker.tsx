import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";
import { askExample, useExamples } from "./embed";
import { CaretUpDown } from "./icons";

// Where the message box sits, an embedded page offers its example questions to choose from. The list starts open,
// so a visitor sees at once what they can ask, and closes once they pick one.
export function ExamplePicker() {
  const examples = useExamples();
  const asked = useStore((s) => (s.asking ? (s.exchanges.at(-1)?.text ?? null) : null));
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  return (
    <div className="composer example-picker" data-mode="ask" ref={box}>
      {open && examples.length ? (
        <ul className="example-list" role="listbox" aria-label="Questions to ask">
          {examples.map((example) => (
            <li key={example.text}>
              <button
                type="button"
                role="option"
                aria-selected={example.text === asked}
                onClick={() => {
                  setOpen(false);
                  askExample(example);
                }}
              >
                {example.text}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <button
        type="button"
        className="example-choice"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-empty={asked === null || undefined}
        disabled={!examples.length}
        onClick={() => setOpen(!open)}
      >
        <span>{asked ?? "Pick a question to ask"}</span>
        <CaretUpDown />
      </button>
      <p className="example-note">Recorded answers. Run it to ask your own.</p>
    </div>
  );
}
