---
'whydiff': patch
---

`whydiff report --merge` keeps the elements of a cause on one screenshot in the order their shard's report gives them, the run's own order, so the shards of a run merge into the same report.json as the run itself, byte for byte. Before, it ordered them by locator and could name another element as the cause's example.
