# Expected database fingerprint

Produced by `scripts/local-db/fingerprint.sql` on a database built from `supabase/standalone/0000_standalone_bootstrap.sql` plus migrations 0001 to 0021b, on PostgreSQL 16.

```json
{"enums": {"n": 10, "defs": "200320e1", "names": "90217420"}, "tables": {"n": 20, "defs": "4623b5c4", "names": "94e73e31"}, "columns": {"n": 163, "defs": "8d49b4f5", "names": "1906da1b"}, "indexes": {"n": 52, "defs": "a4cf5bbf", "names": "73ff3189"}, "policies": {"n": 36, "defs": "23a0db60", "names": "43feee63"}, "triggers": {"n": 24, "defs": "1ff25a9d", "names": "440244c0"}, "functions": {"n": 23, "defs": "1b2ec7df", "names": "3cb50e3a"}, "constraints": {"n": 82, "defs": "76b5bdc4", "names": "0ef47588"}}
```

How to read it: for each kind of object, `n` is how many there are, `names` is a code for the list of names, and `defs` is a code for the exact definitions.

| Result on your database | Meaning |
|---|---|
| everything matches | the database holds exactly what this repository's SQL produces |
| `n` or `names` differs | an object exists on one side only (SQL run in the editor but not saved in the repo, or a migration not run) |
| only `defs` differs | same names, different content (an object was edited, or PostgreSQL printed it slightly differently) |

Differences in `defs` can be harmless when your Supabase runs a different PostgreSQL version than 16, because the databases may print some definitions slightly differently. Always compare `n` and `names` first; they do not depend on the version. Extra objects from other parts of K2 that share the database will also show as `n` differences.
