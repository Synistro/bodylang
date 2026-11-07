// The app's overview: one unbroken take of someone using it. The day comes from day.json and the sentence from
// dinner.json, both what Claude really sent, and the sentence's reply plays at twice its real speed.
(() => {
  const { dinner } = window.__recordings;
  const { answerTime, box, button, click, clickHere, cue, drag, finish, labelled, leaf, moveTo, muscle, onBody, organ, plot, replyLine, say, sendSentence, system, wait, write } = window.__take();

  // The take.
  cue("hush");
  say("Here is how it works.", 2.1);
  wait(1.5);
  moveTo(box, 0.9);
  cue("low");
  say("Tell it what you had, in plain words.", 5.5, "message");
  wait(0.5);
  clickHere();
  wait(0.1);
  write(dinner.text);
  wait(0.2);
  say("Claude logs it. A model simulates your day.", 5);
  sendSentence(dinner, 2);
  wait(answerTime(dinner, 2) + 0.1);
  say("It tells you what that means for you.", 3, "message");
  wait(2.6);
  say("Click anything to go inside.");
  moveTo(replyLine("Your stomach"));
  wait(0.3);
  clickHere();
  wait(2.8);
  click(labelled("Dismiss this answer"), 0.2);

  cue("groove");
  say("Every system of the body.");
  for (const title of ["Sugar & energy", "Heart & lungs", "Brain & mood", "Liver & kidneys"]) click(system(title), 1.7);

  say("Follow what you ate.");
  click(system("Digestion"), 0.6);
  click(leaf("Ate pizza and beer"), 2);

  cue("lift");
  say("Drag through time, and watch it move.");
  moveTo(plot(0.3));
  drag([plot(0.1), plot(0.85)], 5);
  wait(0.3);
  click(button("Back to now"), 0.3);

  cue("groove");
  say("Or let it walk you through.");
  click(system("Overview"), 0.5);
  click(leaf("Drank beer"), 1.2);
  click(button("Walk me through it"), 3);
  for (let next = 0; next < 3; next++) click(button("Next"), 3);
  click(button("Next"), 3.4);
  click(button("Done"), 0.3);

  cue("break");
  say("Go inside any organ.");
  click(system("Liver & kidneys"), 1);
  click(organ("liver"), 2.6);
  click(system("Heart & lungs"), 1.3);
  click(organ("heart"), 2.6);

  cue("groove");
  say("See how a muscle heals, days ahead.");
  click(system("Muscles"), 1.5);
  click(muscle("quads"), 1.8);
  moveTo(plot(0.1));
  drag([plot(0.45)], 2.4);
  wait(0.8);
  click(button("Back to now"), 0.2);

  cue("land");
  say("Your body, minute by minute.", 5);
  click(system("Overview"), 0.6);
  moveTo(onBody(0.5, 0.45));
  // It ends away from where it began, because a drag that comes back to its start counts as a click.
  drag([onBody(0.66, 0.45), onBody(0.42, 0.48)], 2.4);
  wait(1.6);

  finish();
})()
