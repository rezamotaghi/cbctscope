# How CBCTScope describes itself

CBCTScope is a CBCT and 2D radiograph viewer first. The agent is an optional way to move
its camera. Every public surface says it in that order. `tests/posture.test.ts` enforces
the rules marked (test); the others are checked by the author of a change.

1. **The name of the thing is "agent".** The interface and the docs call it the agent, in
   sentence case on a control, and never an assistant, a copilot or an AI helper.
2. **No AI words in a first sentence (test).** The first sentence of the page title, the
   page and share descriptions, the README bold line, the manual front page, the
   CITATION.cff title, and the package.json and MCP bundle descriptions names the viewer
   and, where there is room, its author. It contains none of: AI, agent, model, LLM, MCP,
   or a vendor or model name.
3. **The agent comes once, with its rule.** Where a surface introduces the agent, one plain
   sentence carries the rule: the agent moves the camera, the human reads.
4. **One priority claim, hedged (test).** "First" as a claim of priority appears at most
   once across the README and the manual front page, in body text, never in a bold line,
   always as "to our knowledge, the first purpose-built CBCT reading viewer with native
   AI-agent control", linked to the comparison in the README's "Why this exists". Outside
   the repository (the GitHub About, the project page) there is no priority claim.
5. **The agent control sits at the end.** In the viewer's header it comes after every
   reading control, at full contrast like every other control.
6. **The first image shows reading.** The README and any share image lead with a reading
   still captioned by its clinical content; agent recordings belong in the agent section.
7. **No glyphs, no preselected vendor.** No emoji or pictograph in a control, and the agent
   setup starts with no provider and no model chosen.
8. **A capability sentence says what the agent never does.** Every sentence that says what
   the agent can do also says it never produces findings.
