# UBC Service Planner

Hackathon planning demo for testing changes to scheduled service on UBC routes **99, R4, and 49**.

- [App and analysis specification](TECH_SPEC.md)
- [Data package, row counts, source links, and join rules](data/README.md)
- [Rebuild scripts](scripts/build_data.py)

The `data/` CSVs are ready to import into Databricks as separate tables so their distinct grains remain visible. The public package contains a coarse weekly synthetic activity summary, historical TransLink crowding, selected 2026 published schedule dates, UBC transportation report context, and academic dates. The supplied ZIP and rebuild scripts can generate the optional half-hour activity table locally. The schedule and synthetic periods **do not overlap**; a combined result must be labelled a cross-year planning scenario. Nothing here measures individual bus loads or stop queues.
