# Review

Self-review of work done in the current session.

## Steps

### 1. Enumerate changes

List every file changed in the current working branch (compared to `origin/main`). For each file, write a one-line summary of what changed and why.

### 2. Correctness review

Re-read each changed file in full. For each one, check:

- **Logic errors**: off-by-ones, wrong conditions, missing early returns, state that survives a mode switch it shouldn't.
- **Regressions**: did the change break an existing behaviour or contract? Check callers of any function whose signature or semantics changed.
- **Boundary**: does engine code stay pure (no DOM, no Three.js, no Node, no `Math.random`)? Does client or server code re-implement a rule the engine already owns?
- **Consistency**: does the change follow the patterns established by neighbouring code? If it introduces a new pattern, is there a good reason?
- **Security**: no secrets in code, no unvalidated client input trusted by the server.

Flag anything found. Fix it if straightforward; otherwise present it to the human.

### 3. Edge cases and failure modes

For each changed component, think through:

- What happens at the edges of the grid, at chunk borders, at 0 HP, at max difficulty, with an empty party?
- What happens on rapid or held input, on a key held across a mode switch, on window resize or tab blur?
- What happens when the server or DB is unreachable?
- What state is left behind after a partial failure?

List any edge cases that are not handled. For each, assess severity (will it crash? corrupt a save? just look wrong?) and recommend whether to fix now or defer.

### 4. Test coverage

Consult the **Testing ideology** section in [[DEVELOPMENT]], then assess:

- Are there existing tests that cover the changed behaviour? If you haven't already, run them and confirm they pass.
- Does the change introduce new engine logic that warrants a test? Balance-affecting numbers warrant a property test over the catalog.

If new tests are needed, write them. If coverage is sufficient, state why.

### 5. Summary

Present a concise summary of your findings, and as applicable state your plan for fixing any issues found.
