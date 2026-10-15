---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Ask in Chinese: question titles, bodies, options, descriptions and recommendations are all written in Chinese. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round using the question format below, and give your recommended answer for each question. Then wait for the user's answers before the next round.

## Ask every round with AskUserQuestion

Always ask through the **AskUserQuestion** tool, however many questions the frontier has. Do not present the questions as a prose list in the conversation.

The tool takes at most 4 questions per call. When the frontier has more, split it into batches of up to 4 and call the tool once per batch, one call at a time: wait for each response before sending the next batch.

- Before the first batch of a multi-batch round, say in one short line how many questions and batches this round has (for example "本轮共 11 个问题，分 3 组").
- Put the most consequential questions in the first batch, and keep related questions in the same batch.
- Before sending each later batch, check the answers so far. If an answer (especially a custom response) makes a queued question moot or changes it, drop or rewrite that question; questions it newly opens up belong to the next round.

For each question:

- Give each question a concise `header` (at most 12 characters), a self-contained `question`, and 2-4 meaningful `options`. If the question needs background, put it briefly in the `question` text.
- Put your recommended option first, mark its label with `(Recommended)`, and explain the reason or trade-off in its `description`. Give the other options useful descriptions too.
- For open-ended questions, still offer 2-4 concrete candidate answers, recommended first; the user can type their own.
- Set `multiSelect: false` for mutually exclusive choices; use `true` only when several answers can apply together.
- The tool provides an Other/custom-response option automatically. Let the user use it for open-ended answers or corrections; do not add a duplicate Other option or treat a suggested answer as confirmed.

If the tool is unavailable or its call fails, say so briefly and list the round's remaining questions in the conversation instead, each with its options and your recommended answer.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), look it up yourself before asking; don't ask the user for anything you could look up. Use a sub-agent only for a broad search, since it starts cold and has to re-read what you already know. Don't block on it: only the questions downstream of it wait for its report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
