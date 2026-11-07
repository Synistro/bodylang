import { useState } from "react";
import { Check, Copy, GithubLogo, Play } from "./icons";

// What the app shows in place of its clock, its view controls and its footnotes when it is the landing page:
// the product's name, where to find it, and how to run it.
const REPOSITORY = "https://github.com/yahorbarkouski/bodylang";
const COMMANDS = `git clone ${REPOSITORY}\ncd bodylang && pnpm install && pnpm dev`;

export function EmbedHeader() {
  return (
    <header className="header">
      <h1 className="clock">
        <span className="clock-time">Bodylang</span>
        <span className="clock-state embed-demo">Alpha, demo</span>
      </h1>
      <p className="tagline">See what is happening inside your body</p>
    </header>
  );
}

export function EmbedLinks() {
  return (
    <nav className="embed-links" aria-label="Bodylang">
      <button type="button" onClick={() => window.parent.postMessage({ type: "bodylang:film" }, location.origin)}>
        <Play weight="fill" />
        Watch the film
      </button>
      <a href={REPOSITORY} target="_top">
        <GithubLogo />
        GitHub
      </a>
    </nav>
  );
}

export function EmbedRun() {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    void navigator.clipboard.writeText(COMMANDS).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  return (
    <div className="right-foot embed-run">
      <div className="embed-run-head">
        <p className="embed-run-title">Run it with your own setup</p>
        <button type="button" onClick={copy} aria-label={copied ? "Copied" : "Copy the commands"}>
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="embed-commands">
        <code>{COMMANDS}</code>
      </pre>
    </div>
  );
}
