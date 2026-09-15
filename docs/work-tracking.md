# Work-tracking conventions (Linear)

How the Take5 tracker organizes work in Linear: initiatives for direction, projects for delivery, labels for the map of the system, and issues that carry exactly the knowledge the next person needs. Team: **Take5 Tracker** (`T5TIMER`).

## 1. The shape of the workspace

Each layer answers a different question:

| Layer | Question it answers |
| --- | --- |
| **Initiative** | *Why* — a workstream or strategic theme that outlives any single push (e.g. Hands-off publishing, Tracker experience) |
| **Project** | *What, by roughly when* — a concrete, finishable deliverable; sprint-scale work with an outcome |
| **Issue** | The unit of work: one change, one owner, a definition of done |
| **Labels** | *Where and what kind* — the subsystem map (`area`) and the nature of the change (`type`), orthogonal to all of the above |

The important separation: **projects are not subsystems**. The subsystem an issue touches is carried by its `area` label; projects are free to cut across subsystems, and one subsystem will accumulate many projects over time. Delivery structure (what we're shipping) stays independent of code structure (where it lives).

## 2. Initiatives & projects

### Initiatives are workstreams

An initiative names a direction the team keeps investing in across many projects — the level a lead checks weekly to see how a bet is going. Give each a one-paragraph charter: the goal, and roughly what "winning" looks like. Retire it when the bet is resolved, not when a sprint ends.

### Projects are deliverables

A project is a chunk of work the team intends to *finish* — one to a few weeks of effort with a shippable outcome. It should have:

- **An outcome-shaped name** — what will be true when it's done, not a topic ("First automated release to Chrome & Firefox", not "Releases").
- **A target date**, even a rough one — projects without dates quietly become junk drawers.
- **A short description** stating the outcome, its done-condition, and any scope explicitly cut.
- **An initiative**, when one fits — a standalone project is fine for one-off pushes.

Multiple projects will touch the same subsystem, and one project may span several. When a project ships, mark it done and start the next; don't reuse a completed project as a container for follow-ups.

> **Routing test:** if you can't say what would make a project *done*, it's an initiative (or just a label). If it's done in under a day, it's an issue.

## 3. Labels: the subsystem map

Labels are two orthogonal dimensions, nested in Linear under `area` and `type` parents. The baseline is one of each per issue — that's what makes "everything touching the background worker" a one-click view — but it's a default, not a ceiling: add a second area when work genuinely spans subsystems, and extend the taxonomy as the product grows rather than forcing new work into old buckets.

### Area — where in the system

| Label | Covers |
| --- | --- |
| `background` | Background/service worker: tracking, storage, alarms, badge |
| `content` | Content scripts: timer pill, in-page messaging |
| `popup` | Extension popup UI |
| `infra` | Build, CI, release pipeline, store tooling |
| `types` | Shared type definitions |
| `api`, `web` | Backend and web companion — seeded ahead of the work that will need them |

### Type — what kind of change

| Label | Meaning |
| --- | --- |
| `bug` | Observable incorrect behavior — wrong data, hung sender, visual glitch |
| `feature` | New capability that didn't exist before |
| `improvement` | Existing behavior made better: structural fixes, diagnostics, UX polish |
| `chore` | Work with no behavior change: accounts, credentials, config, IDs |

## 4. Writing the issue

### Titles

Terse and declarative; no prefixes, no trailing punctuation. A **bug title states the symptom** ("Invalid messages are acknowledged as async but never answered, hanging senders"). A **work title states the change** ("Segment elapsed intervals across hour/day boundaries when recording time"). Someone scanning a board should know what an issue is without opening it.

### The shaping principle

An issue's job is to close the gap between **what's known now** and **what someone will need to know to do the work**. Shape the body to that gap, not to a template:

- **Capture what can't be re-derived.** Debugging conclusions, decisions and their rationale, constraints discovered the hard way, tribal context — if it lives only in someone's head or a chat scrollback, it goes in the issue. Skip what the reader can get themselves from code, docs, or git history; *point* at those instead.
- **Ground it in code.** Real identifiers in backticks (`recordElapsedTime`, `MessageRouter.destroy()`), file and module names, links to related issues and PRs — enough handles that the reader can find things and go deeper where they need to.
- **Give the mechanism, not just the symptom**, for bugs: which function does what wrong and why that produces the observed behavior — including intentional workarounds already in the code, so a fixer doesn't "simplify" them away.
- **Offer direction where you have it** ("Likely fix: …", "Candidate approaches: …") as a head start, clearly separated from the requirement itself.

### Definition of done

Every issue gets acceptance criteria — a short, checkable statement of what "done" means — **except** two kinds:

- **Quick-stores:** a thought captured in seconds so it isn't lost. A title (maybe a sentence) is enough; it earns a real body if it's ever picked up.
- **Explorations:** spikes and investigations, marked as such in the title or body. Their done-condition is the question answered, and their output is findings — often the acceptance criteria for the follow-up issues they spawn.

Acceptance criteria can be a checklist, a sentence, or a test description — whatever is cheapest to verify against. The test: could a teammate (or an agent) pick this up cold, finish it, and know they've finished?

## 5. Priority & status

Priority is about **sequencing under scarcity** — with a small team, it encodes what gets traded away, not how bad something feels:

| Priority | Means |
| --- | --- |
| **Urgent** | Drop what you're doing — users are hurting now or the release is blocked. Should be rare; if everything is urgent, nothing is. |
| **High** | Belongs in the current push; sequenced ahead of new work when a slot opens |
| **Medium** | The default — real work that will get scheduled into a project on its merits |
| **Low** | Genuinely deferrable — worth keeping, fine to not do this quarter |

Re-triage beats precision: a rough call at filing time plus a weekly sweep outperforms agonizing over the initial value.

### Status

`Backlog → Todo → In Progress → In Review → Done`

- **Backlog** is uncommitted; **Todo** means it's in the current push and someone will pick it up. Uncommitted backlog issues may sit project-less until scheduled into a dated project.
- **In Progress** means actively being worked — including work parked as a WIP branch or stash, which the issue should name.
- **Canceled** is a healthy outcome. Close liberally with one line of why; a canceled issue with a reason is documentation, a stale open issue is noise.

## 6. Operating rhythm for a team of five

The conventions above only pay off with a matching cadence. The defaults:

- **File fast, shape later.** The bar for creating an issue is near zero — quick-store it the moment it's noticed. Shaping (labels, project, acceptance criteria) happens at triage, not at capture.
- **One owner per issue.** The assignee is the single accountable person, set when work starts. Pairing happens in the PR, not in the assignee field.
- **Keep WIP low.** One or two In Progress issues per person. Finishing beats starting; a stuck issue goes back to Todo with a comment saying why.
- **The issue is the source of truth.** Decisions made in chat or calls get one summarizing comment on the issue. Anyone — including an agent picking up the branch — should be able to work from the issue alone.
- **Weekly triage, ~15 minutes.** Sweep new captures into shape, re-sequence priorities, kill stale issues, and check each active project against its target date. This is the only recurring process the system needs.
- **Projects over ceremonies.** There are no sprint rituals beyond triage; committing to a project with a date *is* the sprint. When scope grows, cut scope or move the date — visibly, in the project description.

## 7. Linking to git

- **Branches** use Linear's generated branch name (`feature/t5timer-17-segment-elapsed-intervals…`) so the issue attaches automatically and status flows from PR events.
- **Commits** end with a `Refs:` trailer naming the issue(s) (`Refs: T5TIMER-17`), plus a `Co-Authored-By:` trailer crediting any assistant that co-authored the change.
- **After merge**, if the landed fix diverged from the issue's proposed direction, note the divergence in a comment rather than rewriting the description.
- **In Linear descriptions and comments, reference PRs by full GitHub URL**, never bare `#N` — Linear's auto-linker resolves bare references against the wrong repository when the workspace spans several.

> **Rule of thumb:** traceable in both directions — from the commit to the reasoning (via `Refs:`), and from the issue to the code (via the identifiers and links in its body).
