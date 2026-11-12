# Expected database fingerprint

Produced by `scripts/local-db/fingerprint.sql` on a database built from `supabase/standalone/0000_standalone_bootstrap.sql` plus migrations 0001 to 0023, on PostgreSQL 16.

```json
{"enums": {"n": 10, "defs": "200320e1", "names": "90217420"}, "tables": {"n": 19, "defs": "462a6db9", "names": "ee49b5f3"}, "columns": {"n": 152, "defs": "8e5abdef", "names": "9adcee37"}, "indexes": {"n": 50, "defs": "1a5efa9e", "names": "3be219f7"}, "policies": {"n": 35, "defs": "a600dbfc", "names": "31254d4f"}, "triggers": {"n": 24, "defs": "1ff25a9d", "names": "440244c0"}, "functions": {"n": 23, "defs": "7ddcc6c9", "names": "64244be2"}, "constraints": {"n": 77, "defs": "32e9071d", "names": "1c6ae899"}}
```

How to read it: for each kind of object, `n` is how many there are, `names` is a code for the list of names, and `defs` is a code for the exact definitions.

| Result on your database | Meaning |
|---|---|
| everything matches | the database holds exactly what this repository's SQL produces |
| `n` or `names` differs | an object exists on one side only (SQL run in an editor but not saved in the repo, or a migration not run) |
| only `defs` differs | same names, different content (an object was edited, or PostgreSQL printed it slightly differently) |

Notes:
- Supabase's own helper function `rls_auto_enable()` is ignored by the fingerprint; Supabase adds it, this repository does not.
- On a Supabase project running PostgreSQL 17, seven kinds (enums, tables, columns, indexes, policies, triggers, constraints) matched this table exactly and the function **names** matched (23 of 23). The function **definitions** code differed from the PostgreSQL 16 value; that comparison was not investigated further, so treat `defs` for functions as informational and rely on `n` and `names`.
- Other parts of K2 that share the database will show as extra objects in `n`.
