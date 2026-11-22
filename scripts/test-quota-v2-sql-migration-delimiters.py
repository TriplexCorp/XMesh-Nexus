#!/usr/bin/env python3
"""Fail early if a draft quota migration has malformed PL/pgSQL dollar quotes.

This is only a narrow syntax regression, NOT a substitute for PostgreSQL
parsing / function compilation / actual transactional tests.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
FILES = tuple(
    ROOT / "backend/migrations" / f"{number}_quota_v2_{name}.sql"
    for number, name in (
        ("0155", "calendar_closures"),
        ("0156", "wal_stream_owners"),
        ("0157", "calendar_successor_zero_authority"),
        ("0158", "calendar_closed_settlement_guard"),
        ("0159", "successor_predecessor_binding"),
        ("0160", "successor_fresh_meter_staging"),
        ("0161", "calendar_successor_positive_outbox"),
    )
)
for path in FILES:
    content = path.read_text(encoding="utf-8")
    if re.search(r"\bEND\s*\$;", content):
        raise AssertionError(f"{path.name}: invalid PL/pgSQL END $; terminator")
    # Every $$ opening must have a closing $$; bare dollar characters in
    # anchored regexes and canonical non-PL/pgSQL text are not delimiters.
    if content.count("$$") % 2 != 0:
        raise AssertionError(f"{path.name}: unbalanced $$ function delimiter")
    if not content.strip().endswith(";"):
        raise AssertionError(f"{path.name}: incomplete trailing SQL statement")
print(f"PASS: {len(FILES)} staged calendar migration delimiter checks")
