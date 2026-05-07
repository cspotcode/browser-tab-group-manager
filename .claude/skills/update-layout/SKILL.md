---
model: haiku
disable-model-invocation: true
---

Read @dev/layout.md which summarizes the scope of each file in this codebase. These summaries do not comprehensively enumerate everything in the file, rather they describe the scope; the area of responsibility. The goal is that an AI or person reading the layout may know where in the codebase to locate existing code or to add new code. This allows more rapid contributions and avoids duplication which may occur when someone is unaware that relevant code already exists elsewhere.

Read all files in src/*.

Are their descriptions in layout accurate and appropriate? If not, adjust them.
Does layout.md mention files that no longer exist? If so, remove them from layout.md
Does layout omit files? If so, add them.