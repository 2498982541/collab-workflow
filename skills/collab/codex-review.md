Review the code changes on this branch. Run `git diff {{BASE}}...HEAD`, read files as needed, and read `.collab/spec.md` to see what the code is meant to do.

Report only:
- P1, real bugs: wrong behavior, crashes, data loss, or reachable security holes;
- P2, unnecessary complexity: code that could be much simpler or shorter with the same behavior.

Don't suggest adding defensive checks, validation, or edge-case handling. Don't report style nits. Don't modify any files.

Output a numbered list, one item per issue, P1 items first and at most 10 items in all: `P1|P2 file:line — problem — fix`. If nothing is worth fixing, output exactly `NO_ISSUES`.
