"""A fake supabase-py client backed by asyncpg.

The real backend uses ``supabase-py`` (sync HTTP client over PostgREST). The
fake here implements just the surface our routers and services exercise:
``client.table(name).select/insert/update/delete/upsert/eq/in_/ilike/limit/order/execute()``
and ``client.rpc(name, params).execute()``.

It runs against the same testcontainer Postgres as ``tests/db``, and
surfaces error shapes that ``app.db.errors.map_postgrest_error`` understands
(an exception with ``.code`` set to a Postgres SQLSTATE).
"""

from __future__ import annotations

import asyncio
import threading
import uuid as _uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import asyncpg


def _normalize(value: Any) -> Any:
    """Convert asyncpg-native types to JSON-friendly stdlib equivalents.

    asyncpg returns ``asyncpg.pgproto.pgproto.UUID`` for uuid columns; pydantic
    refuses these because ``uuid.UUID(...)`` calls ``.replace`` on the input.
    Converting to stdlib ``uuid.UUID`` (or ``str`` for the array case) sidesteps
    that without polluting prod code.
    """
    if isinstance(value, _uuid.UUID):
        return value
    if isinstance(value, datetime):
        return value
    if hasattr(value, "hex") and hasattr(value, "int") and not isinstance(value, int):
        return _uuid.UUID(str(value))
    if isinstance(value, list):
        return [_normalize(v) for v in value]
    if isinstance(value, dict):
        return {k: _normalize(v) for k, v in value.items()}
    return value


def _record_to_dict(record: asyncpg.Record) -> dict[str, Any]:
    return {k: _normalize(v) for k, v in dict(record).items()}


# ---------------------------------------------------------------------------
# sync wrapper around asyncpg
# ---------------------------------------------------------------------------


class _AsyncRunner:
    """Run async functions synchronously on a dedicated background loop."""

    def __init__(self) -> None:
        self._loop = asyncio.new_event_loop()
        self._thread = threading.Thread(
            target=self._loop.run_forever, daemon=True, name="fake-supabase-loop"
        )
        self._thread.start()

    def run(self, coro: Any) -> Any:
        future = asyncio.run_coroutine_threadsafe(coro, self._loop)
        return future.result()

    def close(self) -> None:
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(timeout=2)


class FakeAPIError(Exception):
    """Mimics ``postgrest.exceptions.APIError`` shape."""

    def __init__(
        self, *, code: str, message: str, details: dict[str, Any] | None = None
    ) -> None:
        super().__init__({"code": code, "message": message, "details": details})
        self.code = code
        self.message = message
        self.details = details


def _map_pg_exc(exc: Exception) -> FakeAPIError:
    sqlstate = getattr(exc, "sqlstate", None) or "XX000"
    msg = getattr(exc, "message", None) or str(exc)
    return FakeAPIError(code=sqlstate, message=msg)


# ---------------------------------------------------------------------------
# query response & builder
# ---------------------------------------------------------------------------


@dataclass
class FakeResponse:
    data: list[dict[str, Any]] | dict[str, Any] | Any


class _Query:
    def __init__(self, fake: "FakeSupabaseClient", table: str) -> None:
        self._fake = fake
        self._table = table
        self._op: str | None = None
        self._cols: str = "*"
        self._values: dict[str, Any] | list[dict[str, Any]] | None = None
        self._eq: list[tuple[str, Any]] = []
        self._in: list[tuple[str, list[Any]]] = []
        self._ilike: list[tuple[str, str]] = []
        self._limit: int | None = None
        self._order: str | None = None
        self._on_conflict: str | None = None

    # builder methods -----------------------------------------------------

    def select(self, cols: str = "*") -> "_Query":
        self._op = "select"
        self._cols = cols
        return self

    def insert(self, values: dict[str, Any] | list[dict[str, Any]]) -> "_Query":
        self._op = "insert"
        self._values = values
        return self

    def update(self, values: dict[str, Any]) -> "_Query":
        self._op = "update"
        self._values = values
        return self

    def upsert(
        self,
        values: dict[str, Any] | list[dict[str, Any]],
        *,
        on_conflict: str | None = None,
    ) -> "_Query":
        self._op = "upsert"
        self._values = values
        self._on_conflict = on_conflict
        return self

    def delete(self) -> "_Query":
        self._op = "delete"
        return self

    def eq(self, col: str, val: Any) -> "_Query":
        self._eq.append((col, val))
        return self

    def in_(self, col: str, vals: list[Any]) -> "_Query":
        self._in.append((col, list(vals)))
        return self

    def ilike(self, col: str, pattern: str) -> "_Query":
        self._ilike.append((col, pattern))
        return self

    def limit(self, n: int) -> "_Query":
        self._limit = n
        return self

    def order(self, col: str) -> "_Query":
        self._order = col
        return self

    # execute -------------------------------------------------------------

    def execute(self) -> FakeResponse:
        return self._fake._run_query(self)


# ---------------------------------------------------------------------------
# the fake client
# ---------------------------------------------------------------------------


class FakeSupabaseClient:
    """Sync supabase-like façade backed by asyncpg."""

    def __init__(self, dsn: str) -> None:
        self._dsn = dsn
        self._runner = _AsyncRunner()

    def table(self, name: str) -> _Query:
        return _Query(self, name)

    def rpc(self, name: str, params: dict[str, Any] | None = None) -> "_Rpc":
        return _Rpc(self, name, params or {})

    # --- internals -------------------------------------------------------

    def _connect(self) -> Any:
        return self._runner.run(asyncpg.connect(self._dsn))

    def _exec(self, conn: Any, coro: Any) -> Any:
        try:
            return self._runner.run(coro)
        finally:
            pass

    def _close_conn(self, conn: Any) -> None:
        self._runner.run(conn.close())

    def _run_query(self, q: _Query) -> FakeResponse:
        conn = self._connect()
        try:
            if q._op == "select":
                return FakeResponse(self._do_select(conn, q))
            if q._op == "insert":
                return FakeResponse(self._do_insert(conn, q))
            if q._op == "update":
                return FakeResponse(self._do_update(conn, q))
            if q._op == "upsert":
                return FakeResponse(self._do_upsert(conn, q))
            if q._op == "delete":
                return FakeResponse(self._do_delete(conn, q))
            raise RuntimeError(f"unsupported op {q._op}")
        finally:
            self._close_conn(conn)

    def _build_where(
        self, q: _Query
    ) -> tuple[str, list[Any]]:
        conds: list[str] = []
        params: list[Any] = []
        for col, val in q._eq:
            params.append(val)
            conds.append(f"{col} = ${len(params)}")
        for col, vals in q._in:
            if not vals:
                conds.append("FALSE")
                continue
            placeholders: list[str] = []
            for v in vals:
                params.append(v)
                placeholders.append(f"${len(params)}")
            conds.append(f"{col} IN ({', '.join(placeholders)})")
        for col, pattern in q._ilike:
            params.append(pattern)
            conds.append(f"{col} ILIKE ${len(params)}")
        return ((" WHERE " + " AND ".join(conds)) if conds else ""), params

    def _do_select(self, conn: Any, q: _Query) -> list[dict[str, Any]]:
        where, params = self._build_where(q)
        sql = f"SELECT {q._cols} FROM {q._table}{where}"
        if q._order:
            sql += f" ORDER BY {q._order}"
        if q._limit is not None:
            sql += f" LIMIT {q._limit}"
        try:
            rows = self._runner.run(conn.fetch(sql, *params))
        except asyncpg.PostgresError as exc:
            raise _map_pg_exc(exc) from exc
        return [_record_to_dict(r) for r in rows]

    def _normalize_values(
        self, values: dict[str, Any] | list[dict[str, Any]] | None
    ) -> list[dict[str, Any]]:
        if values is None:
            return []
        if isinstance(values, dict):
            return [values]
        return list(values)

    def _do_insert(self, conn: Any, q: _Query) -> list[dict[str, Any]]:
        rows = self._normalize_values(q._values)
        if not rows:
            return []
        out: list[dict[str, Any]] = []
        for row in rows:
            cols = list(row.keys())
            placeholders = [f"${i + 1}" for i in range(len(cols))]
            sql = (
                f"INSERT INTO {q._table} ({', '.join(cols)}) "
                f"VALUES ({', '.join(placeholders)}) RETURNING *"
            )
            try:
                rec = self._runner.run(conn.fetchrow(sql, *row.values()))
            except asyncpg.PostgresError as exc:
                raise _map_pg_exc(exc) from exc
            if rec is not None:
                out.append(_record_to_dict(rec))
        return out

    def _do_update(self, conn: Any, q: _Query) -> list[dict[str, Any]]:
        if not isinstance(q._values, dict):
            return []
        cols = list(q._values.keys())
        params = list(q._values.values())
        set_clause = ", ".join(f"{c} = ${i + 1}" for i, c in enumerate(cols))
        where, where_params = self._build_where_offset(q, len(params))
        params.extend(where_params)
        sql = f"UPDATE {q._table} SET {set_clause}{where} RETURNING *"
        try:
            rows = self._runner.run(conn.fetch(sql, *params))
        except asyncpg.PostgresError as exc:
            raise _map_pg_exc(exc) from exc
        return [_record_to_dict(r) for r in rows]

    def _do_upsert(self, conn: Any, q: _Query) -> list[dict[str, Any]]:
        rows = self._normalize_values(q._values)
        if not rows:
            return []
        out: list[dict[str, Any]] = []
        conflict_cols = q._on_conflict.split(",") if q._on_conflict else []
        for row in rows:
            cols = list(row.keys())
            placeholders = [f"${i + 1}" for i in range(len(cols))]
            update_cols = [c for c in cols if c not in conflict_cols]
            if conflict_cols and update_cols:
                set_clause = ", ".join(
                    f"{c} = EXCLUDED.{c}" for c in update_cols
                )
                conflict = (
                    f" ON CONFLICT ({', '.join(conflict_cols)}) DO UPDATE SET {set_clause}"
                )
            elif conflict_cols:
                conflict = f" ON CONFLICT ({', '.join(conflict_cols)}) DO NOTHING"
            else:
                conflict = ""
            sql = (
                f"INSERT INTO {q._table} ({', '.join(cols)}) "
                f"VALUES ({', '.join(placeholders)}){conflict} RETURNING *"
            )
            try:
                rec = self._runner.run(conn.fetchrow(sql, *row.values()))
            except asyncpg.PostgresError as exc:
                raise _map_pg_exc(exc) from exc
            if rec is not None:
                out.append(_record_to_dict(rec))
        return out

    def _do_delete(self, conn: Any, q: _Query) -> list[dict[str, Any]]:
        where, params = self._build_where(q)
        sql = f"DELETE FROM {q._table}{where} RETURNING *"
        try:
            rows = self._runner.run(conn.fetch(sql, *params))
        except asyncpg.PostgresError as exc:
            raise _map_pg_exc(exc) from exc
        return [_record_to_dict(r) for r in rows]

    def _build_where_offset(
        self, q: _Query, offset: int
    ) -> tuple[str, list[Any]]:
        conds: list[str] = []
        params: list[Any] = []
        for col, val in q._eq:
            params.append(val)
            conds.append(f"{col} = ${offset + len(params)}")
        for col, vals in q._in:
            if not vals:
                conds.append("FALSE")
                continue
            placeholders: list[str] = []
            for v in vals:
                params.append(v)
                placeholders.append(f"${offset + len(params)}")
            conds.append(f"{col} IN ({', '.join(placeholders)})")
        for col, pattern in q._ilike:
            params.append(pattern)
            conds.append(f"{col} ILIKE ${offset + len(params)}")
        return ((" WHERE " + " AND ".join(conds)) if conds else ""), params

    def close(self) -> None:
        self._runner.close()


class _Rpc:
    def __init__(
        self,
        fake: FakeSupabaseClient,
        name: str,
        params: dict[str, Any],
    ) -> None:
        self._fake = fake
        self._name = name
        self._params = params

    def execute(self) -> FakeResponse:
        conn = self._fake._connect()
        try:
            param_names = list(self._params.keys())
            named_args = ", ".join(
                f"{name} := ${i + 1}" for i, name in enumerate(param_names)
            )
            sql = f"SELECT * FROM {self._name}({named_args})"
            try:
                rows = self._fake._runner.run(
                    conn.fetch(sql, *self._params.values())
                )
            except asyncpg.PostgresError as exc:
                raise _map_pg_exc(exc) from exc
            data: Any
            if not rows:
                data = None
            elif len(rows[0]) == 1 and self._name not in {"award_points", "buzz_in"}:
                # scalar-returning function — unwrap single column
                data = _normalize(list(rows[0].values())[0])
            else:
                # Real PostgREST always returns TABLE-shaped functions as a
                # list of row-dicts, even for single-row results — never
                # auto-unwraps. Match that. (Earlier this fake unwrapped a
                # length-1 list into a bare dict; that masked the regression
                # in d49cb6f where _award_blocking dropped its list-defensive
                # handling.)
                data = [_record_to_dict(r) for r in rows]
            return FakeResponse(data)
        finally:
            self._fake._close_conn(conn)
