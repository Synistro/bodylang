// The Ask film after its opening: one question followed all the way through, then one about the person's own day. The
// mouse clicks through at reading pace and the app does the explaining, so nothing on the film talks over it. Words
// appear only on black, to move things on. Every answer is what Claude really sent, in recordings/, played faster than
// it took to arrive, and the first walkthrough shows three of its six steps.
(() => {
  const { covid, coffee, dinner } = window.__recordings;
  // Long enough to read each step at an easy pace, with a moment to look at the body too.
  const readingSeconds = (step) => Math.max(7, step.say.length / 20 + 2);
  const { box, button, card, centre, click, duration, find, finish, names, say, sendSentence, startsWith, useScore, wait, waitUntil, write } = window.__take();
  useScore("chill");
  startsWith.push(...dinner.events);

  const onlySteps = (recording, chosen) => ({
    ...recording,
    events: recording.events.map((entry) =>
      entry.event.name === "guide"
        ? { ...entry, event: { ...entry.event, args: { steps: chosen.map((index) => entry.event.args.steps[index]) } } }
        : entry,
    ),
  });
  const covidShort = onlySteps(covid, [0, 2, 4]);
  names[covid.text] = "Coronavirus";
  names[coffee.text] = "Skipping the second coffee";

  const mode = (label) => () => centre(find(".mode-switch button", label));
  const arrives = (recording, speed) => recording.events.find(({ event }) => event.name === "guide").ms / 1000 / speed + 0.4;

  const ask = (recording, speed) => {
    say(null, 4, "message");
    wait(0.5);
    click(box, 0.25, 0.8);
    write(recording.text);
    wait(0.9);
    say(null, 3);
    sendSentence(recording, speed);
    wait(arrives(recording, speed));
  };
  const clickThrough = (recording) => {
    const { steps } = recording.events.find(({ event }) => event.name === "guide").event.args;
    say(null, 2, "guide");
    steps.forEach((step, index) => {
      if (index > 0) click(button("Next"), 0, 0.6);
      wait(readingSeconds(step));
    });
  };

  let from = duration();
  card("Follow one, all the way through.", null, 3.6);
  wait(0.6);
  click(mode("Ask"), 0.2, 0.5);
  click(mode("Deep"), 0.2, 0.4);
  waitUntil(from + 3.6);

  ask(covidShort, 5);
  clickThrough(covidShort);

  from = duration();
  card("Or ask about your own day.", null, 3.6);
  wait(0.5);
  click(button("Back to your day"), 0.25, 0.6);
  click(mode("Simple"), 0.2, 0.5);
  waitUntil(from + 3.6);

  ask(coffee, 3);
  clickThrough(coffee);

  from = duration();
  card("Ask it anything.", "Nothing you ask is saved. Your real day stays exactly as it was.", 5);
  wait(5);
  finish();
})()
