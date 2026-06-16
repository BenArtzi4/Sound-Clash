"""Conditional OpenTelemetry tracing → Grafana Cloud (Tempo).

Mirrors :mod:`app.middleware.sentry`: skips initialization in tests
(``PYTEST_CURRENT_TEST`` is set by pytest) and when no OTLP endpoint is
configured.

When ``OTEL_EXPORTER_OTLP_ENDPOINT`` is set (a Grafana Cloud OTLP gateway), this
wires a batched OTLP/HTTP span exporter and auto-instruments FastAPI request
handling plus outbound httpx calls (which is how supabase-py reaches Postgres).
The exporter reads its endpoint + auth from the standard ``OTEL_EXPORTER_OTLP_*``
environment variables; we only check the endpoint to decide whether to enable.

Batching keeps span export off the request path. The hot-path RPCs
(buzz / score / next-round) go browser→Supabase directly and never reach
FastAPI, so backend traces only cover create / join / bonus / end.
"""

from __future__ import annotations

import os

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app import __version__


def install(app: FastAPI) -> None:
    """Enable OTLP tracing when configured; otherwise a no-op."""
    if os.environ.get("PYTEST_CURRENT_TEST"):
        return
    if not os.environ.get("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return
    _configure(app)


def _configure(app: FastAPI) -> None:
    resource = Resource.create(
        {
            "service.name": os.environ.get("OTEL_SERVICE_NAME", "sound-clash-backend"),
            "service.version": __version__,
        }
    )
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    HTTPXClientInstrumentor().instrument(tracer_provider=provider)
