---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phrases.
---

Interview the user relentlessly until you reach a shared understanding. Ask in Chinese: question titles, bodies, options, descriptions and recommendations are all written in Chinese. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round using the question format below, and give your recommended answer for each question. Then wait for the user's answers before the next round.

## Choose the question format for each round

Count the questions on the current frontier, not the total questions you expect across the session. Re-evaluate the format after each round of answers.

### 1-4 questions: use AskUserQuestion

Call the **AskUserQuestion** tool once with all questions in this round. Do not present the questions as a prose list in the conversation.

- Give each question a concise `header` (at most 12 characters), a self-contained `question`, and 2-4 meaningful `options`.
- Put your recommended option first, mark its label with `(Recommended)`, and explain the reason or trade-off in its `description`. Give the other options useful descriptions too.
- Set `multiSelect: false` for mutually exclusive choices; use `true` only when several answers can apply together.
- The tool provides an Other/custom-response option automatically. Let the user use it for open-ended answers or corrections; do not add a duplicate Other option or treat a suggested answer as confirmed.
- Wait for the tool response before continuing. If the tool is unavailable or its call fails, briefly explain that and use the conversation format below for this round.

### 5 or more questions: list them in the conversation

Present the whole frontier as numbered questions in one message, with a recommended answer for each. Do not split a large frontier into multiple AskUserQuestion calls just to fit the tool's question limit. Wait for the user's answers before moving to the next round.

Use this format for conversation questions:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.
