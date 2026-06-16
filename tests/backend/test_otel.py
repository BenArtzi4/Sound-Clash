"""Conditional OpenTelemetry init (app.middleware.otel).

Mirrors the Sentry install tests: the default test run must NOT configure OTel,
and the production path (endpoint set, PYTEST guard removed) must wire the
provider + instrumentors. We monkeypatch the OTel symbols so no real tracer
provider is set globally and httpx is not patched.
"""

from __future__ import annotations

from app.middleware import otel as otel_module


def test_otel_skipped_in_tests(monkeypatch) -> None:
    """PYTEST_CURRENT_TEST is set, so install() must not configure anything."""
    called: dict[str, object] = {}
    monkeypatch.setattr(otel_module, "_configure", lambda app: called.setdefault("app", app))
    otel_module.install(object())  # sentinel app
    assert called == {}


def test_otel_skipped_without_endpoint(monkeypatch) -> None:
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.delenv("OTEL_EXPORTER_OTLP_ENDPOINT", raising=False)
    called: dict[str, object] = {}
    monkeypatch.setattr(otel_module, "_configure", lambda app: called.setdefault("app", app))
    otel_module.install(object())
    assert called == {}


def test_otel_configures_when_endpoint_set(monkeypatch) -> None:
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
    monkeypatch.setenv("OTEL_EXPORTER_OTLP_ENDPOINT", "https://otlp.example/otlp")
    sentinel = object()
    called: dict[str, object] = {}
    monkeypatch.setattr(otel_module, "_configure", lambda app: called.setdefault("app", app))
    otel_module.install(sentinel)
    assert called["app"] is sentinel


def test_configure_wires_provider_and_instrumentors(monkeypatch) -> None:
    """_configure builds a provider + exporter and instruments FastAPI + httpx,
    all against fakes so nothing touches global state or the network."""
    calls: dict[str, object] = {}

    class FakeResource:
        @staticmethod
        def create(attrs: dict[str, object]) -> dict[str, object]:
            calls["resource"] = attrs
            return attrs

    class FakeProvider:
        def __init__(self, resource: object = None) -> None:
            calls["provider_resource"] = resource

        def add_span_processor(self, processor: object) -> None:
            calls["processor"] = processor

    class FakeBatch:
        def __init__(self, exporter: object) -> None:
            calls["exporter"] = exporter

    class FakeExporter:
        def __init__(self) -> None:
            calls["exporter_created"] = True

    class FakeTrace:
        @staticmethod
        def set_tracer_provider(provider: object) -> None:
            calls["set_provider"] = provider

    class FakeFastAPIInstrumentor:
        @staticmethod
        def instrument_app(app: object, tracer_provider: object = None) -> None:
            calls["fastapi_app"] = app
            calls["fastapi_provider"] = tracer_provider

    class FakeHTTPX:
        def instrument(self, tracer_provider: object = None) -> None:
            calls["httpx_provider"] = tracer_provider

    monkeypatch.setattr(otel_module, "Resource", FakeResource)
    monkeypatch.setattr(otel_module, "TracerProvider", FakeProvider)
    monkeypatch.setattr(otel_module, "BatchSpanProcessor", FakeBatch)
    monkeypatch.setattr(otel_module, "OTLPSpanExporter", FakeExporter)
    monkeypatch.setattr(otel_module, "trace", FakeTrace)
    monkeypatch.setattr(otel_module, "FastAPIInstrumentor", FakeFastAPIInstrumentor)
    monkeypatch.setattr(otel_module, "HTTPXClientInstrumentor", FakeHTTPX)

    app = object()
    otel_module._configure(app)

    assert calls["fastapi_app"] is app
    assert calls["set_provider"] is not None
    assert calls["fastapi_provider"] is calls["set_provider"]
    assert calls["httpx_provider"] is calls["set_provider"]
    assert calls["exporter_created"] is True
    # service.name + service.version present on the resource.
    resource = calls["resource"]
    assert isinstance(resource, dict)
    assert resource["service.name"] == "sound-clash-backend"


def test_configure_honours_custom_service_name(monkeypatch) -> None:
    monkeypatch.setenv("OTEL_SERVICE_NAME", "custom-svc")
    captured: dict[str, object] = {}

    class FakeResource:
        @staticmethod
        def create(attrs: dict[str, object]) -> dict[str, object]:
            captured.update(attrs)
            return attrs

    monkeypatch.setattr(otel_module, "Resource", FakeResource)
    monkeypatch.setattr(otel_module, "TracerProvider", lambda resource=None: _Noop())
    monkeypatch.setattr(otel_module, "BatchSpanProcessor", lambda exporter: None)
    monkeypatch.setattr(otel_module, "OTLPSpanExporter", lambda: None)
    monkeypatch.setattr(otel_module, "trace", _NoopTrace())
    monkeypatch.setattr(otel_module, "FastAPIInstrumentor", _NoopInstrumentor())
    monkeypatch.setattr(otel_module, "HTTPXClientInstrumentor", lambda: _NoopHTTPX())

    otel_module._configure(object())
    assert captured["service.name"] == "custom-svc"


class _Noop:
    def add_span_processor(self, processor: object) -> None:
        return None


class _NoopTrace:
    def set_tracer_provider(self, provider: object) -> None:
        return None


class _NoopInstrumentor:
    def instrument_app(self, app: object, tracer_provider: object = None) -> None:
        return None


class _NoopHTTPX:
    def instrument(self, tracer_provider: object = None) -> None:
        return None
