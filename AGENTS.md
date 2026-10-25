# Global working rules (all projects)

## Second brain
The knowledge vault is `~/Documents/ob_notes`. Read `wiki/index.md` there first when a task
touches anything recorded before — projects, decisions, machine setup, prior research.
Vault conventions (domains, page types, ingest/query flows) live in
`~/Documents/ob_notes/CLAUDE.md`. Inside the vault that file loads automatically; outside it,
read it only when you need to write to the vault.

## How to work
- Verify before claiming. Run the command, read the file, check the live state. Never report
  "done" or "works" from a config file alone — check the outcome the change was meant to cause.
- Say plainly whether a claim was just checked or carried over from earlier notes or docs.
- Ask before anything irreversible: deletes, force-pushes, destructive SQL, credential rotation,
  changes to production. `bash-guard` covers the obvious cases; it is not a substitute for asking.
- Fix the root cause, not the symptom. Diagnose before changing things.
- Python: use `uv`, not bare `pip` or `python3 -m venv`.
- Prefer editing config files over one-off state; keep secrets out of anything tracked by git
  and never echo them into the transcript.
